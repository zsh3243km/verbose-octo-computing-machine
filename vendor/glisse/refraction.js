/**
 * Glisse Liquid Glass — Refraction Engine (vanilla JS port)
 * Source: https://github.com/0kzh/glisse (v0.5.0)
 * MIT License — © Kelvin Zhang
 *
 * Framework-free port of internal/refraction.ts: painted rim light, theme
 * watching, idle-fitted resize observation, backdrop lens fitting.
 */

import {
  shapeOf,
  GLASS_LENS,
  createLens, createBackdropLens, fitBackdropLens, refractsBackdrop
} from "./lens.js";
import { rimMap } from "./lens-map-core.mjs";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const MARK = "data-glisse-backdrop";

export { rimMap };

/* ──────────────────────────────────────────────────────────────
   Rim painting (from internal/refraction.ts)
   ────────────────────────────────────────────────────────────── */
function parseColour(ctx, colour) {
  ctx.fillStyle = "#0000";
  ctx.fillStyle = colour;
  const v = String(ctx.fillStyle);
  if (v.startsWith("#")) {
    const [r, g, b] = [1, 3, 5].map(at => parseInt(v.slice(at, at + 2), 16));
    return [r, g, b, 1];
  }
  const [r = 0, g = 0, b = 0, a = 1] = (v.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
}

const rims = new Map();
let palette;

function paintRim(el) {
  const style = getComputedStyle(el);
  const shape = shapeOf(el, style);
  palette ??= document.createElement("canvas").getContext("2d");
  if (!shape || !palette) return;
  const tuned = parseFloat(style.getPropertyValue("--lg-rim-shine"));
  const shine = Number.isFinite(tuned) ? clamp(tuned, 0, 1) : 0.13;
  const edge = parseColour(palette, style.getPropertyValue("--lg-edge").trim() || "transparent");
  const density = Math.min(devicePixelRatio || 1, 3);
  const key = [shape.width, shape.height, shape.radius, shine, edge, density].join("|");
  let url = rims.get(key);
  if (!url) {
    const { columns, rows, data } = rimMap(shape, shine, density, edge);
    const canvas = document.createElement("canvas");
    canvas.width = columns; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(columns, rows);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    url = `url("${canvas.toDataURL()}")`;
    rims.set(key, url);
  }
  el.style.setProperty("--lg-rim", url);
  el.setAttribute("data-rim", "");
}

/* ──────────────────────────────────────────────────────────────
   Theme watching (from internal/refraction.ts)
   ────────────────────────────────────────────────────────────── */
const repaints = new Set();
let unwatch;

function onThemeChange(repaint) {
  repaints.add(repaint);
  if (!unwatch) {
    const run = () => repaints.forEach(fn => fn());
    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"], subtree: true });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener?.("change", run);
    unwatch = () => { observer.disconnect(); scheme.removeEventListener?.("change", run); };
  }
  return () => {
    repaints.delete(repaint);
    if (repaints.size) return;
    unwatch?.();
    unwatch = undefined;
  };
}

/* ──────────────────────────────────────────────────────────────
   Idle fit + resize observation (from internal/refraction.ts)
   ────────────────────────────────────────────────────────────── */
function whenIdle(cb) {
  if ("requestIdleCallback" in window) {
    const h = requestIdleCallback(cb, { timeout: 500 });
    return () => cancelIdleCallback(h);
  }
  const h = setTimeout(cb, 50);
  return () => clearTimeout(h);
}

function refitting(el, fit, properties) {
  let cancel, fitted = false;
  const observer = new ResizeObserver(() => { cancel?.(); cancel = whenIdle(() => { fitted = true; fit(); }); });
  observer.observe(el);
  return {
    refit: () => { if (fitted) fit(); },
    stop: () => { cancel?.(); observer.disconnect(); for (const p of properties) el.style.removeProperty(p); }
  };
}

/* ──────────────────────────────────────────────────────────────
   Backdrop discovery (from internal/refraction.ts)
   ────────────────────────────────────────────────────────────── */
function visibleBox(el) {
  let { left, top, right, bottom } = el.getBoundingClientRect();
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/hidden|clip|auto|scroll/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) continue;
    const clip = node.getBoundingClientRect();
    left = Math.max(left, clip.left); top = Math.max(top, clip.top);
    right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
  }
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

function findBackdrop(el) {
  const box = el.getBoundingClientRect();
  const behind = candidate => {
    if (candidate.contains(el) || el.contains(candidate)) return false;
    const other = visibleBox(candidate);
    return other.left < box.right && other.right > box.left && other.top < box.bottom && other.bottom > box.top;
  };
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const found = [...node.querySelectorAll(`[${MARK}]`)].find(behind);
    if (found) return found;
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────
   Follow loop (from internal/refraction.ts)
   ────────────────────────────────────────────────────────────── */
const followed = new Map();
let following = 0;

function follow() {
  for (const lenses of followed.values()) lenses.values().next().value?.update();
  following = followed.size ? requestAnimationFrame(follow) : 0;
}

function bend(el, source) {
  const lens = createLens(el, source, GLASS_LENS);
  let started = false;
  const fitting = refitting(el, () => {
    paintRim(el);
    if (started) return lens.refit();
    started = true;
    lens.setActive(true);
    let lenses = followed.get(source);
    if (!lenses) followed.set(source, (lenses = new Set()));
    lenses.add(lens);
    following ||= requestAnimationFrame(follow);
  }, ["--lg-rim"]);
  return {
    refit: fitting.refit,
    stop: () => {
      fitting.stop();
      // Remove only this lens; other glass over the same backdrop keeps moving.
      const lenses = followed.get(source);
      if (lenses) {
        lenses.delete(lens);
        if (!lenses.size) followed.delete(source);
      }
      lens.destroy();
    }
  };
}

/* ──────────────────────────────────────────────────────────────
   Public API — activates glass behaviour on a DOM element.
   ────────────────────────────────────────────────────────────── */

/**
 * Activates Liquid Glass behaviour on `element`.
 * `selection` — true for tab bar / segmented control selection lenses.
 * `bendsBackdrop` — false to only take rims without bending the backdrop.
 * Returns a live handle { refit, stop }.
 */
export function useRefraction(element, selection = false, bendsBackdrop = true) {
  if (!element) return { refit() {}, stop() {} };
  let refit = null;

  if (selection) {
    // Selection lens: rim only (Chromium takes the displacement filter).
    const props = bendsBackdrop
      ? ["--lg-filter", "--lg-rim", "--lg-rim-bright"]
      : ["--lg-rim", "--lg-rim-bright"];
    const fitting = refitting(element, () => paintRim(element), props);
    refit = fitting.refit;
    const stopWatching = onThemeChange(() => paintRim(element));
    return {
      refit,
      stop: () => { stopWatching(); fitting.stop(); element.removeAttribute("data-rim"); }
    };
  }

  const source = findBackdrop(element);
  let fitting, stopWatching;
  if (source) {
    fitting = bend(element, source);
  } else {
    fitting = refitting(element, () => {
      paintRim(element);
      if (refractsBackdrop()) fitBackdropLens(element, GLASS_LENS);
    }, ["--lg-filter", "--lg-rim"]);
  }
  refit = fitting.refit;
  stopWatching = onThemeChange(() => paintRim(element));
  return {
    refit,
    stop: () => { stopWatching(); fitting.stop(); element.removeAttribute("data-rim"); }
  };
}

export { paintRim };