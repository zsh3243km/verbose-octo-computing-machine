/**
 * Glisse Liquid Glass — Lens Engine (vanilla JS runtime)
 * Source: https://github.com/0kzh/glisse (v0.5.0)
 * MIT License — © Kelvin Zhang
 *
 * Framework-free port of the React library's lens engine. The DOM-free map
 * mathematics lives in lens-map-core.mjs (shared with the Node test harness);
 * this module adds canvas encoding, SVG filter graph construction, and the
 * surface/lens runtime that drives it.
 */

import {
  lensMap, distance,
  DARK_LIGHT, LIGHT_LIGHT,
  GLASS_LENS, TAB_LENS, SEGMENT_LENS, SWITCH_LENS, SLIDER_LENS
} from "./lens-map-core.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

/* ─── SVG helpers (internal/svg.ts) ─── */
let _defs;

function svg(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function container() {
  if (_defs?.isConnected) return _defs;
  const root = svg("svg", { width: 0, height: 0, "aria-hidden": "true" });
  root.style.cssText = "position:absolute;pointer-events:none";
  _defs = svg("defs", {});
  root.append(_defs);
  document.body.append(root);
  return _defs;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ─── PNG encoding cache (internal/lens.ts) ─── */
const encoded = new Map();

function encode(key, draw) {
  const cached = encoded.get(key);
  if (cached) return cached;
  const map = draw();
  const canvas = document.createElement("canvas");
  canvas.width = map.columns;
  canvas.height = map.rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(map.columns, map.rows);
  const png = data => { img.data.set(data); ctx.putImageData(img, 0, 0); return canvas.toDataURL(); };
  const res = { across: png(map.across), down: png(map.down), light: png(map.light), shape: png(map.shape) };
  encoded.set(key, res);
  return res;
}

/* ─── Filter graph (internal/lens.ts) ─── */
const boxUnits = () =>
  /AppleWebKit\//.test(navigator.userAgent) && !/Chrom(?:e|ium)\//.test(navigator.userAgent);

const CHANNELS = [
  "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0",
  "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0",
  "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"
];

function matrix(input, values, result) {
  return svg("feColorMatrix", { in: input, type: "matrix", values, result });
}

function sum(a, b, k2, k3, result) {
  return svg("feComposite", { in: a, in2: b, operator: "arithmetic", k2, k3, result });
}

// Lens k's rays added up as content of its own colour.
function spread(k) {
  return CHANNELS.map((ch, i) => matrix(`ray-${k}-${i}`, `${ch}  0 0 0 0.3333 0`, `light-${k}-${i}`))
    .concat(
      sum(`light-${k}-0`, `light-${k}-1`, 1, 1, `light-${k}-01`),
      sum(`light-${k}-01`, `light-${k}-2`, 1, 1, `spread-${k}`),
      matrix(`spread-${k}`, "3 0 0 0 0  0 3 0 0 0  0 0 3 0 0  0 0 0 1 0", `bent-${k}`)
    );
}

// Lens k's rays added up as ink (labels), over the page's own tone.
function inked(k, page) {
  const white = page === "light" ? 1 : 0;
  const steps = [];
  const own = i =>
    [0, 1, 2]
      .map(r => r === i ? `${[0, 1, 2].map(c => (c === i ? (white ? -1 : 1) : 0)).join(" ")} 0 ${white}` : "0 0 0 0 0")
      .join("  ") + "  0 0 0 1 0";
  CHANNELS.forEach((_, i) => {
    const ray = `ray-${k}-${i}`;
    steps.push(
      matrix(ray, "0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1", `cover-${k}-${i}`),
      matrix(ray, "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", `covers-${k}-${i}`),
      matrix(ray, own(i), `inks-${k}-${i}`)
    );
  });
  steps.push(
    svg("feBlend", { in: `cover-${k}-0`, in2: `cover-${k}-1`, mode: "lighten", result: `most-${k}-01` }),
    svg("feBlend", { in: `most-${k}-01`, in2: `cover-${k}-2`, mode: "lighten", result: `most-${k}` }),
    matrix(`most-${k}`, `0 0 0 0 ${white}  0 0 0 0 ${white}  0 0 0 0 ${white}  1 0 0 0 0`, `inked-${k}`)
  );
  let at = `inked-${k}`;
  CHANNELS.forEach((_, i) => {
    const [gain, loss] = white ? [`covers-${k}-${i}`, `inks-${k}-${i}`] : [`inks-${k}-${i}`, `covers-${k}-${i}`];
    steps.push(
      sum(at, gain, i === 0 ? 0.5 : 1, 0.5, `inked-${k}-${i}a`),
      sum(`inked-${k}-${i}a`, loss, 1, -0.5, `inked-${k}-${i}b`)
    );
    at = `inked-${k}-${i}b`;
  });
  const dbl = svg("feComponentTransfer", { in: at, result: `bent-${k}` });
  dbl.append(svg("feFuncA", { type: "linear", slope: 2, intercept: 0 }));
  steps.push(dbl);
  return steps;
}

function graph(lenses, box, standIn) {
  const unit = box ? "objectBoundingBox" : "userSpaceOnUse";
  const filter = svg("filter", { filterUnits: unit, primitiveUnits: unit, "color-interpolation-filters": "sRGB" });
  if (box) {
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: 1, height: 1 })) filter.setAttribute(k, String(v));
  }
  const single = lenses.length === 1;
  const parts = lenses.map(({ maps, shine, blur, ink }, k) => {
    const merged = n => (single ? n : `${n}-${k}`);
    const image = (href, result) => svg("feImage", { href, preserveAspectRatio: "none", result });
    const boxed = [
      image(maps.across, `across-${k}`),
      image(maps.down, `down-${k}`),
      image(maps.light, merged("raw")),
      svg("feFlood", { "flood-color": "rgb(128, 128, 128)", result: `neutral-${k}` })
    ];
    if (standIn) boxed.push(image(maps.shape, merged("shape")));
    filter.append(...boxed);
    // Each pull, with an alpha of one half for the direction it doesn't pull in.
    for (const pull of ["across", "down"]) {
      const half = svg("feComponentTransfer", { in: `${pull}-grey-${k}`, result: `${pull}-pull-${k}` });
      half.append(svg("feFuncA", { type: "linear", slope: 0, intercept: 0.5 }));
      filter.append(
        svg("feComposite", { in: `${pull}-${k}`, in2: `neutral-${k}`, operator: "over", result: `${pull}-grey-${k}` }),
        half
      );
    }
    // Each colour's ray: the content displaced as far as that colour bends.
    const rays = CHANNELS.map((_, i) => {
      const across = svg("feDisplacementMap", {
        in: "SourceGraphic", in2: `across-pull-${k}`,
        xChannelSelector: "R", yChannelSelector: "A", result: `across-${k}-${i}`
      });
      const down = svg("feDisplacementMap", {
        in: `across-${k}-${i}`, in2: `down-pull-${k}`,
        xChannelSelector: "A", yChannelSelector: "R", result: `ray-${k}-${i}`
      });
      boxed.push(across);
      filter.append(across, down);
      return [across, down];
    });
    filter.append(...(ink ? inked(k, ink) : spread(k)));
    let soften;
    if (blur) {
      soften = svg("feGaussianBlur", { in: `bent-${k}`, result: `soft-${k}` });
      const weight = image(maps.shape, `weight-${k}`);
      boxed.push(weight);
      filter.append(
        weight,
        matrix(`weight-${k}`, "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0", `bends-${k}`),
        soften,
        svg("feComposite", { in: `soft-${k}`, in2: `bends-${k}`, operator: "in", result: `soft-in-${k}` }),
        svg("feComposite", { in: `bent-${k}`, in2: `bends-${k}`, operator: "out", result: `sharp-${k}` }),
        svg("feComposite", { in: `soft-in-${k}`, in2: `sharp-${k}`, operator: "arithmetic", k2: 1, k3: 1, result: `softened-${k}` })
      );
    }
    const bent = blur ? `softened-${k}` : `bent-${k}`;
    let lit = bent;
    if (shine > 0) {
      const white = `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 ${-128 / 255}`;
      filter.append(
        matrix(merged("raw"), white, `glint-${k}`),
        svg("feComposite", { in: `glint-${k}`, in2: bent, operator: "arithmetic", k2: shine, k3: 1, result: `lit-${k}` })
      );
      lit = `lit-${k}`;
    } else if (shine < 0) {
      const row = `0 0 ${shine} 0 ${1 - (128 * shine) / 255}`;
      filter.append(
        matrix(merged("raw"), `${row}  ${row}  ${row}  0 0 0 0 1`, `shade-${k}`),
        svg("feComposite", { in: `shade-${k}`, in2: bent, operator: "arithmetic", k1: 1, result: `lit-${k}` })
      );
      lit = `lit-${k}`;
    }
    filter.append(svg("feComposite", { in: lit, in2: merged("raw"), operator: "in", result: merged("inside") }));
    return { boxed, rays, soften };
  });
  if (!single) {
    for (const name of ["raw", "inside", ...(standIn ? ["shape"] : [])]) {
      const merge = svg("feMerge", { result: name });
      lenses.forEach((_, k) => merge.append(svg("feMergeNode", { in: `${name}-${k}` })));
      filter.append(merge);
    }
  }
  filter.append(
    svg("feComposite", { in: "SourceGraphic", in2: "raw", operator: "out", result: "outside" }),
    svg("feComposite", { in: "inside", in2: "outside", operator: "arithmetic", k2: 1, k3: 1, result: "seen" })
  );
  if (standIn) filter.append(svg("feComposite", { in: "seen", in2: "shape", operator: "in" }));
  return { filter, parts };
}

function place(graph, placed, across, down, box) {
  if (!box) {
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: across, height: down })) {
      graph.filter.setAttribute(k, String(v));
    }
  }
  placed.forEach((lens, k) => {
    const part = graph.parts[k];
    const spectrum = [1 + 0.2 * lens.dispersion, 1 + 0.1 * lens.dispersion, 1];
    part.rays.forEach(([pullAcross, pullDown], i) => {
      pullAcross.setAttribute("scale", String((box ? lens.reach / across : lens.reach) * spectrum[i]));
      pullDown.setAttribute("scale", String((box ? lens.reach / down : lens.reach) * spectrum[i]));
    });
    // A blur of nothing is a tiny one: some browsers draw nothing at all for 0.
    const blur = Math.max(lens.blur, 0.01);
    part.soften?.setAttribute("stdDeviation", box ? `${blur / across} ${blur / down}` : String(blur));
    const rect = box
      ? { x: lens.x / across, y: lens.y / down, width: lens.width / across, height: lens.height / down }
      : { x: lens.x, y: lens.y, width: lens.width, height: lens.height };
    for (const element of part.boxed) {
      for (const [k, v] of Object.entries(rect)) element.setAttribute(k, String(v));
    }
  });
}

/* ─── Shape & fit ─── */
function shapeOf(el, style = getComputedStyle(el)) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return null;
  const c = style.borderTopLeftRadius;
  const r = Math.min(w / 2, h / 2, c.endsWith("%") ? (Math.min(w, h) * parseFloat(c)) / 100 : parseFloat(c) || 0);
  return { width: w, height: h, radius: r };
}

function fit(el, options) {
  const style = getComputedStyle(el);
  const shape = shapeOf(el, style);
  if (!shape) return null;
  const { width, height, radius } = shape;
  // The page's shine is negative on a light page, where the rim darkens.
  const page = parseFloat(style.getPropertyValue("--lg-lens-shine")) || 0;
  const shine = options.paintsLight ? 0 : options.shine === undefined ? page : Math.sign(page) * options.shine;
  const tuned = options.strengthProperty ? parseFloat(style.getPropertyValue(options.strengthProperty)) : NaN;
  const own = page > 0 ? (options.darkStrength ?? options.strength) : options.strength;
  const strength = Number.isFinite(tuned) ? tuned : own;
  const split = options.dispersionProperty ? parseFloat(style.getPropertyValue(options.dispersionProperty)) : NaN;
  const dispersion = Number.isFinite(split) ? Math.max(0, split) : options.dispersion;
  const density = Math.min(devicePixelRatio || 1, 2);
  // Glass that paints its own light uses only where the map bends.
  const theme = page < 0 && !options.paintsLight ? LIGHT_LIGHT : DARK_LIGHT;
  const light = options.edgeWidth === undefined ? theme : { ...theme, edgeWidth: options.edgeWidth };
  const key = [width, height, radius, density, JSON.stringify(light), JSON.stringify(options)].join("|");
  const maps = encode(key, () => lensMap(shape, options, light, density));
  const blur = options.blur ?? 0;
  const ink = options.ink ? (page < 0 ? "light" : "dark") : undefined;
  return maps ? { maps, key: `${key}|${shine}|${ink}`, shine, ink, blur, strength, dispersion, width, height } : null;
}

/* ─── Surface runtime ─── */
const surfaces = new Map();
let made = 0;

const MASKING = ["image", "position", "size", "repeat", "composite"];

function mask(el, layers) {
  for (const part of MASKING) {
    el.style.removeProperty(`-webkit-mask-${part}`);
    el.style.removeProperty(`mask-${part}`);
  }
  if (!layers) return;
  const values = { ...layers, repeat: "no-repeat", composite: "exclude" };
  for (const part of MASKING) {
    // Older WebKit knows only the prefixed names, and calls exclude xor.
    el.style.setProperty(`-webkit-mask-${part}`, part === "composite" ? "xor" : values[part]);
    el.style.setProperty(`mask-${part}`, values[part]);
  }
}

function render(surface) {
  const { content } = surface;
  const aw = content.offsetWidth, dh = content.offsetHeight;
  const from = content.getBoundingClientRect();
  const shown = [];
  if (aw && dh) {
    const unit = from.width / aw || 1;
    for (const m of surface.members) {
      const at = m.glass.getBoundingClientRect();
      if (!m.fit || !at.width || !at.height) continue;
      const width = at.width / unit;
      const height = at.height / unit;
      const reach = m.fit.strength * Math.min(width, height) * m.amount;
      const { dispersion } = m.fit;
      const blur = m.fit.blur * m.amount;
      m.placed = { x: (at.left - from.left) / unit, y: (at.top - from.top) / unit, width, height, reach, dispersion, blur };
      shown.push(m);
    }
  }
  if (!shown.length) {
    surface.placed = "";
    content.style.removeProperty("filter");
    if (surface.standIn) content.style.removeProperty("visibility");
    surface.standIn = false;
    return;
  }
  const box = boxUnits();
  const standIn = shown.some(m => m.replaces);
  surface.standIn = standIn;
  const structure = shown.map(m => m.fit.key).join("\n") + (standIn ? "\nstand-in" : "");
  if (structure !== surface.built || !surface.graph) {
    surface.graph?.filter.remove();
    surface.graph = graph(shown.map(m => m.fit), box, standIn);
    container().append(surface.graph.filter);
    surface.built = structure;
    surface.placed = "";
  }
  const placed = shown.map(m => m.placed);
  const next = [aw, dh,
    ...placed.flatMap(({ x, y, width, height, reach, dispersion, blur }) => [x, y, width, height, reach, dispersion, blur])
  ].map(v => v.toFixed(2)).join(" ");
  if (next === surface.placed) return;
  surface.placed = next;
  place(surface.graph, placed, aw, dh, box);
  // WebKit keeps showing a filter's old output until the filter's id changes.
  surface.graph.filter.id = `${surface.name}-${++surface.version}`;
  content.style.filter = `url("#${surface.graph.filter.id}")`;

  for (const m of shown) {
    if (!m.replaces) continue;
    content.style.visibility = "visible";
    // What's replaced keeps everything but the lens's shape.
    const { x, y, width, height } = m.placed;
    const behind = m.replaces.getBoundingClientRect();
    const unit = from.width / aw || 1;
    mask(m.replaces, {
      image: `url("${m.fit.maps.shape}"), linear-gradient(#000, #000)`,
      position: `${x + (from.left - behind.left) / unit}px ${y + (from.top - behind.top) / unit}px, 0 0`,
      size: `${width}px ${height}px, 100% 100%`
    });
  }
}

/* ─── Public API ─── */

/**
 * Makes `glass` a lens over `content`.
 * @param options LensOptions
 * @param replaces optional stand-in element, hidden under the lens
 * @returns {{setActive, update, refit, destroy}}
 */
export function createLens(glass, content, options, replaces) {
  let surface = surfaces.get(content);
  if (!surface) {
    surface = {
      content, lenses: 0, members: [], name: `glisse-lens-${made++}`,
      standIn: false, built: "", placed: "", version: 0
    };
    surfaces.set(content, surface);
  }
  const shared = surface;
  shared.lenses++;
  const member = { glass, options, replaces, amount: 1, fit: undefined, placed: undefined };
  let active = false;

  const prepare = () => { member.fit = fit(glass, options) ?? undefined; };

  const lens = {
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) { shared.members.push(member); prepare(); }
      else { shared.members.splice(shared.members.indexOf(member), 1); if (replaces) mask(replaces); }
      render(shared);
    },
    update(amount) { if (amount !== undefined) member.amount = clamp(amount, 0, 1); if (active) render(shared); },
    refit() { if (!active) return; prepare(); render(shared); },
    destroy() { lens.setActive(false); if (--shared.lenses > 0) return; shared.graph?.filter.remove(); surfaces.delete(content); }
  };
  return lens;
}

/** Bends the live backdrop behind `glass`, as only Chromium can. */
export function createBackdropLens(glass, options) {
  const name = `glisse-bend-${made++}`;
  let fitted = null, built = null, key = "", amount = 0, version = 0;
  const draw = () => {
    if (!fitted || !built) return;
    const { width, height, strength, dispersion, blur } = fitted;
    const reach = strength * Math.min(width, height) * amount;
    place(built, [{ x: 0, y: 0, width, height, reach, dispersion, blur: blur * amount }], width, height, false);
    built.filter.id = `${name}-${++version}`;
    glass.style.setProperty("--lg-filter", `url("#${built.filter.id}")`);
  };
  return {
    update(next) {
      // In twentieths: each change rebuilds the backdrop's filter.
      next = Math.round(clamp(next, 0, 1) * 20) / 20;
      if (next === amount) return;
      amount = next;
      draw();
    },
    refit() {
      fitted = fit(glass, options);
      if (!fitted) return;
      if (fitted.key !== key) {
        built?.filter.remove();
        built = graph([{ maps: fitted.maps, shine: 0, blur: fitted.blur }], false, false);
        container().append(built.filter);
        key = fitted.key;
      }
      draw();
    },
    destroy() { built?.filter.remove(); built = null; glass.style.removeProperty("--lg-filter"); }
  };
}

const backdrops = new Map();

/** Fits a static backdrop lens, cached by the glass's shape and settings. */
export function fitBackdropLens(glass, options) {
  const fitted = fit(glass, options);
  if (!fitted) return;
  const { maps, key, shine, strength, dispersion, width, height } = fitted;
  const reach = strength * Math.min(width, height);
  const id = `${key}|${reach}|${dispersion}`;
  let name = backdrops.get(id);
  if (!name) {
    const built = graph([{ maps, shine }], false, false);
    place(built, [{ x: 0, y: 0, width, height, reach, dispersion, blur: 0 }], width, height, false);
    name = `glisse-backdrop-${backdrops.size}`;
    built.filter.id = name;
    container().append(built.filter);
    backdrops.set(id, name);
  }
  glass.style.setProperty("--lg-filter", `url("#${name}") saturate(1.5)`);
}

/** Only Chromium applies SVG filters to the live backdrop. */
export const refractsBackdrop = () =>
  /Chrom(?:e|ium)\//.test(navigator.userAgent);

export { shapeOf, distance, DARK_LIGHT, LIGHT_LIGHT };
export { GLASS_LENS, TAB_LENS, SEGMENT_LENS, SWITCH_LENS, SLIDER_LENS };