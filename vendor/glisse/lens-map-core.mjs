/**
 * Glisse Liquid Glass — Lens & rim map mathematics (DOM-free)
 * Source: https://github.com/0kzh/glisse (v0.5.0)
 * MIT License — © Kelvin Zhang
 *
 * Extracted from internal/lens.ts (lensMap) and internal/refraction.ts (rimMap)
 * so the geometry can be unit-tested without a browser and reused by the
 * runtime module. No canvas, no document, no navigator — pure functions over
 * typed arrays.
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
// erf(x) ≈ tanh(√π x)
const erf = x => Math.tanh(1.7724538509 * x);

/* ── signed distance to a rounded rectangle centred on the origin ── */
export function distance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/* ── circular arc that sags by `sag` across `half`, scaled to mean slope 0.5 ── */
function arc(sag, half) {
  const radius = (half * half + sag * sag) / (2 * sag);
  let sum = 0;
  for (let i = 0; i <= 200; i++) {
    const x = (i / 200) * half;
    const slope = x / Math.sqrt(radius * radius - x * x);
    sum += (i === 0 || i === 200 ? slope / 2 : slope);
  }
  const mean = sum / 200;
  return { radius, scale: mean > 0 ? 0.5 / mean : 1 };
}

const slope = (x, { radius, scale }) => {
  const inside = Math.min(x, 0.999 * radius);
  return (inside / Math.sqrt(radius * radius - inside * inside)) * scale;
};

/* ── light presets (Aave's) ── */
export const DARK_LIGHT = { angle: 45, glow: 0.4, spread: 0.5, glowPower: 1.5, edge: 0.5, edgeWidth: 2, edgePower: 1.5 };
export const LIGHT_LIGHT = { angle: 30, glow: 0.4, spread: 0.5, glowPower: 2, edge: 0.5, edgeWidth: 1.5, edgePower: 1 };

/**
 * Draws a lens's map, after Aave's: within a band about `depth` wide around
 * the rim, each point shows content from further in, by the slope of a
 * shallow dome there, and the rest is left as it is. The light is a glow
 * along the light's axis and a thin lit edge.
 *
 * @param shape {{width, height, radius}} px, CSS pixels
 * @param options LensOptions
 * @param light Light preset
 * @param density device-pixel ratio
 * @returns {{columns, rows, across, down, light, shape}} typed arrays
 */
export function lensMap(shape, options, light, density) {
  const { width, height } = shape;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = clamp(shape.radius, 0, Math.min(halfWidth, halfHeight));
  // A zero-sized glass draws nothing; clamp the grid to one device pixel so
  // the caller never divides by zero or builds an empty map.
  const columns = Math.max(1, Math.round(width * density));
  const rows = Math.max(1, Math.round(height * density));
  const pullAcross = new Uint8ClampedArray(columns * rows * 4);
  const pullDown = new Uint8ClampedArray(columns * rows * 4);
  const caught = new Uint8ClampedArray(columns * rows * 4);
  const shapeMask = new Uint8ClampedArray(columns * rows * 4);
  const grey = (data, i, value, alpha = 255) => {
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = alpha;
  };

  const share = options.relative ? Math.min(width, height) : 1;
  const depth = options.depth * share;
  const dome = options.dome * share;
  const { splay } = options;
  const innerWidth = Math.max(0, halfWidth - depth);
  const innerHeight = Math.max(0, halfHeight - depth);
  const innerRadius = clamp(radius, 0, Math.min(innerWidth, innerHeight));
  const ramp = depth > 0 ? 1 / (depth * Math.SQRT2) : 1e6;
  const sag = Math.max(0.01, Math.min(dome, Math.min(halfWidth, halfHeight) - 1));
  const across = dome > 0 ? arc(sag, halfWidth) : null;
  const down = dome > 0 ? arc(sag, halfHeight) : null;
  const reach = 0.5 * Math.min(halfWidth, halfHeight);
  const cos = Math.cos((light.angle * Math.PI) / 180);
  const sin = Math.sin((light.angle * Math.PI) / 180);
  const glowStart = (1 - light.spread) * Math.SQRT2;
  const glowRange = light.spread * Math.SQRT2;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = (row * columns + column) * 4;
      const x = ((column + 0.5) / columns) * width - halfWidth;
      const y = ((row + 0.5) / rows) * height - halfHeight;
      const edge = distance(x, y, halfWidth, halfHeight, radius);
      // Smoothed over the last pixel at the edge.
      const inside = Math.round(255 * clamp(-edge, 0, 1));
      grey(shapeMask, i, 0, inside);
      if (edge >= 0) {
        grey(pullAcross, i, 128);
        grey(pullDown, i, 128);
        grey(caught, i, 128, 0);
        continue;
      }

      const ax = Math.abs(x);
      const ay = Math.abs(y);
      let dx = across ? Math.sign(x) * slope(ax, across) : clamp(x / halfWidth, -1, 1);
      let dy = down ? Math.sign(y) * slope(ay, down) : clamp(y / halfHeight, -1, 1);

      // Near the top and bottom the pull turns towards straight down and up,
      // near the sides towards straight across, keeping its strength.
      if (splay < 1 && reach > 0) {
        const keepX = Math.max(0, 1 - (halfHeight - ay) / reach) * (1 - splay);
        const keepY = Math.max(0, 1 - (halfWidth - ax) / reach) * (1 - splay);
        if (keepX > 0.001 || keepY > 0.001) {
          const before = Math.hypot(dx, dy);
          dx *= 1 - keepX;
          dy *= 1 - keepY;
          const after = Math.hypot(dx, dy);
          if (after > 0.001) {
            dx *= before / after;
            dy *= before / after;
          }
        }
      }

      const falloff = 0.5 * (1 + erf(distance(x, y, innerWidth, innerHeight, innerRadius) * ramp));
      grey(shapeMask, i, Math.round(255 * falloff), inside);
      grey(pullAcross, i, Math.round((0.5 - 0.5 * dx * falloff) * 255));
      grey(pullDown, i, Math.round((0.5 - 0.5 * dy * falloff) * 255));

      const facing = Math.abs(
        clamp(x / halfWidth, -1, 1) * cos + clamp(y / halfHeight, -1, 1) * sin
      );
      const glow =
        glowRange > 0.001
          ? light.glow * clamp((facing - glowStart) / glowRange, 0, 1) ** light.glowPower * falloff
          : 0;
      const rim = light.edge * Math.max(0, 1 + edge / light.edgeWidth) * facing ** light.edgePower;
      const amount = Math.min(1, glow + rim);
      // Fully in once the pull reaches about a twentieth of its strength, and
      // smoothed over the last pixel at the edge.
      const bends = Math.min(1, falloff * 20, -edge);
      grey(caught, i, Math.round(127 * amount + 128), Math.round(255 * bends));
    }
  }
  return { columns, rows, across: pullAcross, down: pullDown, light: caught, shape: shapeMask };
}

/**
 * The rim's light, white, over its edge line, at `density` pixels to the px.
 * Measured at 3x over flat grey: a line brightest at the very edge and gone
 * 1.22px in, slightly bowed; a top-left light lights the left, top and the
 * two corners between them, and reflects the right and bottom.
 *
 * @param shape {{width, height, radius}}
 * @param shine 0..1 (--lg-rim-shine: 0.3 light page, 0.13 dark)
 * @param density device-pixel ratio
 * @param edge [r,g,b,a] of --lg-edge, or transparent
 */
export function rimMap({ width, height, radius }, shine, density, edge = [0, 0, 0, 0]) {
  const columns = Math.max(1, Math.round(width * density));
  const rows = Math.max(1, Math.round(height * density));
  const data = new Uint8ClampedArray(columns * rows * 4);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corner = clamp(radius, 0, Math.min(halfWidth, halfHeight));
  const half = 0.5 / density;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = ((column + 0.5) / columns) * width - halfWidth;
      const y = ((row + 0.5) / rows) * height - halfHeight;
      const depth = -distance(x, y, halfWidth, halfHeight, corner);
      if (depth < -half || depth > 2 * RIM_WIDTH) continue;
      // The nearest edge's outward normal.
      const qx = Math.abs(x) - halfWidth + corner;
      const qy = Math.abs(y) - halfHeight + corner;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy);
        nx = (Math.sign(x) * qx) / length;
        ny = (Math.sign(y) * qy) / length;
      } else if (qx > qy) nx = Math.sign(x);
      else ny = Math.sign(y);
      // 1 along the lit sides, √2 on the corners they meet at, 0 on the others.
      const facing = Math.abs(nx + ny);
      const along = Math.max(0, depth) / (RIM_WIDTH * Math.sqrt(Math.max(1, facing)));
      // How much of the pixel the shape, and the edge line, cover.
      const cover = clamp((depth + half) * density, 0, 1);
      const lined = clamp((Math.min(EDGE_WIDTH, depth + half) - Math.max(0, depth - half)) * density, 0, 1);
      const light = along < 1 ? shine * Math.min(1, facing) ** 1.5 * (1 - along ** 1.5) * cover : 0;
      const line = edge[3] * lined * (1 - light);
      const alpha = light + line;
      if (alpha <= 0) continue;
      const i = (row * columns + column) * 4;
      for (let channel = 0; channel < 3; channel++) {
        data[i + channel] = Math.round((255 * light + edge[channel] * line) / alpha);
      }
      data[i + 3] = Math.round(255 * alpha);
    }
  }
  return { columns, rows, data };
}

const RIM_WIDTH = 1.22;
const EDGE_WIDTH = 0.5;

/** Lens presets, matching upstream's internal values. */
export const GLASS_LENS = {
  strength: 0.45, strengthProperty: "--lg-glass-bend",
  dispersion: 0.4, dispersionProperty: "--lg-glass-dispersion",
  depth: 0.25, dome: 0.5, splay: 1, relative: true, paintsLight: true
};
export const TAB_LENS = {
  strength: 0.2, strengthProperty: "--lg-tab-bend",
  dispersion: 2, dispersionProperty: "--lg-tab-dispersion",
  depth: 4, dome: 0, splay: 1, ink: true, blur: 2
};
export const SEGMENT_LENS = {
  strength: 0.3, strengthProperty: "--lg-segment-bend",
  dispersion: 0.1, depth: 2.5, dome: 0, splay: 1
};
export const SWITCH_LENS = {
  strength: 0.45, strengthProperty: "--lg-switch-bend",
  dispersion: 1, depth: 2, dome: 6, splay: 0.4
};
export const SLIDER_LENS = {
  strength: 0.75, strengthProperty: "--lg-slider-bend",
  dispersion: 0.65, depth: 2, dome: 5, splay: 0.5
};