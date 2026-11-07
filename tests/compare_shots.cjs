/**
 * Visual diff: baseline vs new, page for page.
 *
 * Decodes both PNGs without dependencies (zlib + PNG chunk parsing), compares
 * pixel data, and reports the fraction of pixels that differ plus the mean
 * absolute difference. This is what proves the redesign is real and visible,
 * rather than "the CSS is present".
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG bd=${bitDepth} ct=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // Undo PNG filtering.
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { width, height, bpp, data: out };
}

function diff(a, b) {
  /* Compare only the region both images share: a fullPage shot's height
     depends on how much content the page happened to render. */
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  if (w === 0 || h === 0) return { sizeMismatch: true, a: [a.width, a.height], b: [b.width, b.height] };
  const n = w * h;
  let changed = 0, sum = 0;
  for (let y = 0; y < h; y++) {
    const ay = y * a.width, by = y * b.width;
    for (let x = 0; x < w; x++) {
      const ao = (ay + x) * a.bpp, bo = (by + x) * b.bpp;
      const d = Math.abs(a.data[ao] - b.data[bo]) + Math.abs(a.data[ao + 1] - b.data[bo + 1]) + Math.abs(a.data[ao + 2] - b.data[bo + 2]);
      if (d > 12) changed++;
      sum += d;
    }
  }
  const clipped = (a.width !== b.width || a.height !== b.height);
  return { pixels: n, changed, pct: (100 * changed / n).toFixed(1) + "%", meanDiff: (sum / n).toFixed(2), clipped,
           a: [a.width, a.height], b: [b.width, b.height] };
}

const BASE = process.argv[2] || "E:/ZZTHS-LMNT/_shots/baseline";
const NEW = process.argv[3] || "E:/ZZTHS-LMNT/_shots/final";

const wanted = [
  "01-login-desktop", "03-dashboard-desktop",
  ...["overview","links","subscriptions","subgroups","connections","traffic","logs","errors","security","settings"]
    .map(p => `10-page-${p}-desktop`),
  "20-login-mobile", "21-dashboard-mobile",
  "22-links-mobile", "22-settings-mobile", "22-connections-mobile",
  "30-settings-desktop", "32-sni-off-desktop", "40-dashboard-dark-desktop", "41-modal-desktop",
];

console.log("VISUAL DIFF — baseline vs new (same viewport, same steps)\n");
let failures = 0;
const rows = [];
for (const name of wanted) {
  const bp = path.join(BASE, name + ".png");
  const np = path.join(NEW, name + ".png");
  if (!fs.existsSync(bp) || !fs.existsSync(np)) {
    console.log(`  MISSING ${name}  base=${fs.existsSync(bp)} new=${fs.existsSync(np)}`);
    failures++;
    continue;
  }
  try {
    const a = decodePNG(fs.readFileSync(bp));
    const b = decodePNG(fs.readFileSync(np));
    const d = diff(a, b);
    if (d.sizeMismatch) { console.log(`  SIZE   ${name}  ${d.a} vs ${d.b}`); failures++; continue; }
    rows.push([name, d.pct, d.meanDiff, d.changed, d.pixels]);
    console.log(`  ${d.pct.padStart(6)} changed  meanΔ${String(d.meanDiff).padStart(6)}  ${name}${d.clipped ? "  (clipped to the shared region)" : ""}`);
  } catch (e) {
    console.log(`  ERROR  ${name}  ${e.message.slice(0, 90)}`);
    failures++;
  }
}

console.log("\nsummary");
const changed = rows.filter(r => parseFloat(r[1]) > 1);
console.log(`  pages compared: ${rows.length}`);
console.log(`  pages with a visible change (>1% of pixels): ${changed.length}`);
console.log(`  pages with essentially no change: ${rows.length - changed.length}`);
if (rows.length - changed.length > 0) {
  console.log("  unchanged pages: " + rows.filter(r => parseFloat(r[1]) <= 1).map(r => `${r[0]} (${r[1]})`).join(", "));
}
if (failures) { console.log(`\nFAILURES: ${failures}`); process.exit(1); }
if (changed.length < rows.length * 0.6) {
  console.log(`\nFAIL: the redesign is not visible on enough pages (${changed.length}/${rows.length})`);
  process.exit(1);
}
console.log("\nVisual diff: the redesign is measurably present across the panel");
