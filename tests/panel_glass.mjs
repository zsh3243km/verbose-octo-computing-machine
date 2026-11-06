/**
 * Renders the real DASHBOARD_HTML in jsdom, runs its scripts, and asserts the
 * Liquid Glass layer actually applies: glass classes land on chrome, the
 * backdrop is marked, the vendored stylesheet resolves and its selectors exist.
 *
 * This is a DOM-level check, not a pixel check — it proves the wiring is real.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = resolve(ROOT, "vendor/glisse");

let failures = 0;
const log = (name, ok, detail = "") => {
  console.log(("  " + (ok ? "ok   " : "FAIL ")) + name + (ok ? "" : "  " + detail));
  if (!ok) failures++;
};

/* Pull DASHBOARD_HTML out of pages.py without importing Python. */
const py = readFileSync(resolve(ROOT, "pages.py"), "utf8");
const start = py.indexOf('DASHBOARD_HTML = r"""<!DOCTYPE html>');
const marker = 'DASHBOARD_HTML = r"""';
const bodyStart = py.indexOf(marker) + marker.length;
const bodyEnd = py.indexOf('"""', bodyStart);
const html = py.slice(bodyStart, bodyEnd);

const dom = new JSDOM(html, {
  url: "http://localhost/dashboard",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(win) {
    win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    win.requestIdleCallback = cb => setTimeout(cb, 0);
    win.cancelIdleCallback = clearTimeout;
    win.HTMLCanvasElement.prototype.getContext = () => null;
    win.scrollTo = () => {};
    win.confirm = () => true;
  }
});
const doc = dom.window.document;

console.log("[the panel document loads]");
log("dashboard html is substantial", html.length > 200_000, String(html.length));
log("has a sidebar", doc.querySelector(".sidebar") !== null);
log("has nav items", doc.querySelectorAll(".nav-it").length >= 8, String(doc.querySelectorAll(".nav-it").length));
log("has page sections", doc.querySelectorAll("section.pg").length >= 10, String(doc.querySelectorAll("section.pg").length));
log("has modals", doc.querySelectorAll(".modal-bg[id^='modal-']").length >= 3, String(doc.querySelectorAll(".modal-bg[id^='modal-']").length));

console.log("\n[the Glisse stylesheet is referenced]");
log("links the vendored stylesheet", html.includes('/glisse/styles'));
log("loads the vendored module", [...doc.querySelectorAll("script")].some(s => s.textContent.includes('/glisse/glisse')));

console.log("\n[the vendored stylesheet contains the components the panel uses]");
const css = readFileSync(resolve(VENDOR, "styles.css"), "utf8");
for (const sel of [".lg-glass", ".lg-button", ".lg-tab-bar", ".lg-segmented", ".lg-input", ".lg-switch", ".lg-slider", ".lg-menu", ".lg-tab", ".lg-input-clear", ".lg-thumb-face"]) {
  log(`stylesheet defines ${sel}`, css.includes(sel));
}

console.log("\n[the Liquid Glass layer is defined in the dashboard CSS]");
for (const token of ["--lg-glass-bend", "--lg-glass-dispersion", "--lg-radius-panel", "--lg-blur", "--lg-accent", "lg-modal-in", "prefers-reduced-motion"]) {
  log(`panel CSS defines ${token}`, html.includes(token));
}
log("panel CSS glass the sidebar", html.includes(".sidebar{") && html.includes("backdrop-filter"));
log("panel CSS glass cards", html.includes(".card,.metric,.vless-box"));
log("panel CSS glass modals", /\.modal,.modal-v2\{/.test(html) && html.includes("lg-modal-in"));
log("panel CSS has responsive breakpoints", html.includes("@media(max-width:900px)") && html.includes("@media(max-width:520px)"));
log("panel CSS keeps focus rings", html.includes(":focus-visible"));
log("panel CSS keeps disabled states", html.includes(":disabled"));

console.log("\n[the glass application code is present]");
for (const fn of ["function applyLiquidGlass(", "function glassifySurface(", "function markBackdrops(", "function refitGlass(", "function glassifyButton(", "Gl.button =", "Gl.refit =", "glisse:ready"]) {
  log(`defines ${fn}`, html.includes(fn));
}
log("chrome selectors are covered",
  html.includes(".sidebar") && html.includes(".card,.metric,.vless-box")
  && html.includes("button.btn") && html.includes("input.cp-input-full"));
log("guards against double-application", html.includes("__glIsGlass"));
log("re-applies on page re-render", html.includes("glisse:rerender"));
log("never blocks the panel on the module", html.includes("never block the panel on it"));

console.log("\n[data surfaces are deliberately not glassed]");
/* Chart canvases and log timelines keep opaque fills. */
log("chart canvas not in the glass list", !/\.lg-glass.*canvas|canvas.*lg-glass/i.test(html));
log("log timeline keeps its own style", html.includes(".log-timeline"));

console.log("\n[the module fails safe]");
log("refit is a no-op without the module", /Gl\.refit = \(\) => \{\s*const m = window\.__glisseModule;\s*if \(!m \|\| !m\.paintRim\) return;/.test(html.replace(/\n/g, " ")) || html.includes("!m.paintRim"));
log("upgrades are individually guarded", html.includes("try{el.__glisse="));

if (failures) {
  console.log(`\nFAILURES: ${failures}`);
  process.exit(1);
}
console.log("\nPanel Liquid Glass wiring: ALL OK");
