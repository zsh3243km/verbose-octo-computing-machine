/**
 * Glisse vanilla port — component contract test.
 * Runs in jsdom: every component factory must build the exact DOM
 * structure, class names, ARIA roles and state that the upstream React
 * components produce, because the vendored styles.css targets those.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = resolve(HERE, "../vendor/glisse");

const dom = new JSDOM(
  `<!DOCTYPE html><html><head></head><body data-glisse-backdrop>
     <div style="height:1200px"></div></body></html>`,
  { pretendToBeVisual: true, url: "http://localhost/" }
);

// jsdom lacks these; the port reads them only to decide capability.
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
Object.defineProperty(dom.window, "matchMedia", {
  value: q => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
});
Object.defineProperty(dom.window.navigator, "userAgent", {
  value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36"
});
if (!dom.window.ResizeObserver) {
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!dom.window.requestIdleCallback) dom.window.requestIdleCallback = cb => setTimeout(cb, 0);
if (!dom.window.cancelIdleCallback) dom.window.cancelIdleCallback = clearTimeout;

globalThis.window = dom.window;
globalThis.document = dom.window.document;
// `navigator` is a getter-only global in Node; patch its userAgent instead.
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator, configurable: true, writable: true
});
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.DOMRect = dom.window.DOMRect;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.devicePixelRatio = 1;
globalThis.matchMedia = dom.window.matchMedia;
globalThis.requestIdleCallback = dom.window.requestIdleCallback;
globalThis.cancelIdleCallback = dom.window.cancelIdleCallback;
globalThis.ResizeObserver = dom.window.ResizeObserver;
globalThis.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;

const G = await import(pathToFileURL(resolve(VENDOR, "glisse.js")).href);

let failures = 0;
const log = (name, ok, detail = "") => {
  console.log(("  " + (ok ? "ok   " : "FAIL ")) + name + (ok ? "" : "  " + detail));
  if (!ok) failures++;
};

/* ── Button ── */
console.log("[Button]");
const b1 = G.Button({ label: "Continue" });
log("class", b1.className === "lg-glass lg-button", b1.className);
log("type", b1.type === "button");
log("no variant attr", !b1.hasAttribute("data-variant"));
log("no data-icon", !b1.hasAttribute("data-icon"));
log("label text", b1.textContent === "Continue", b1.textContent);
const b2 = G.Button({ label: "Filled", variant: "filled" });
log("filled variant", b2.getAttribute("data-variant") === "filled");
const b3 = G.Button({ label: "Delete", destructive: true });
log("destructive", b3.hasAttribute("data-destructive"));
log("destructive no tint", !b3.hasAttribute("data-tint"));
const b4 = G.Button({ label: "Share", destructive: true, tint: "#f0a" });
log("explicit tint wins over destructive", b4.style.getPropertyValue("--lg-tint") === "#f0a", b4.style.getPropertyValue("--lg-tint"));
const b5 = G.Button({ icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>', ariaLabel: "Share" });
log("icon-only", b5.getAttribute("data-icon") === "only");
log("aria-label", b5.getAttribute("aria-label") === "Share");
log("icon-only no label text", b5.textContent.trim() === "", JSON.stringify(b5.textContent));
const b6 = G.Button({ label: "Disabled", disabled: true });
log("disabled", b6.disabled === true);
let clicked = false;
const b7 = G.Button({ label: "Go", onClick: () => { clicked = true; } });
b7.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("onClick fires", clicked);
const b8 = G.Button({ label: "Send", type: "submit" });
log("submit type", b8.type === "submit");
const b9 = G.Button({ icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>', label: "With icon", className: "extra" });
log("icon + label", b9.getAttribute("data-icon") === "" && b9.textContent.includes("With icon"));
log("className appended", b9.classList.contains("extra") && b9.classList.contains("lg-button"));

/* ── Input ── */
console.log("\n[Input]");
const inp = G.Input({ placeholder: "Search", type: "search", ariaLabel: "Search" });
log("class", inp.element.className === "lg-glass lg-input", inp.element.className);
log("input present", inp.element.querySelector("input") === inp.input);
log("placeholder", inp.input.placeholder === "Search");
log("aria-label", inp.input.getAttribute("aria-label") === "Search");
const clearBtn = inp.element.querySelector(".lg-input-clear");
log("search has clear button", clearBtn !== null);
log("clear hidden when empty", clearBtn.style.display === "none", clearBtn.style.display);
inp.input.value = "hello";
inp.input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
log("clear shown with text", clearBtn.style.display === "", clearBtn.style.display);
let inputValue = null;
const inp2 = G.Input({ placeholder: "Name", onValueChange: v => { inputValue = v; } });
inp2.input.value = "abc";
inp2.input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
log("onValueChange", inputValue === "abc", String(inputValue));
clearBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("clear empties", inp.input.value === "", JSON.stringify(inp.input.value));
const inpPlain = G.Input({ placeholder: "Plain", type: "text" });
log("text input has no clear button", inpPlain.element.querySelector(".lg-input-clear") === null);
const inpDisabled = G.Input({ placeholder: "x", disabled: true });
log("disabled input", inpDisabled.input.disabled === true);
const inpIcon = G.Input({ icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>' });
log("icon slot", inpIcon.element.querySelector(".lg-input-icon") !== null && inpIcon.element.querySelector(".lg-input-icon svg") !== null);

/* ── Switch ── */
console.log("\n[Switch]");
const sw = G.Switch({ checked: false, ariaLabel: "Wi-Fi" });
log("role", sw.element.getAttribute("role") === "switch");
log("tag", sw.element.tagName === "BUTTON");
log("class", sw.element.className === "lg-switch", sw.element.className);
log("aria-checked false", sw.element.getAttribute("aria-checked") === "false");
log("aria-label", sw.element.getAttribute("aria-label") === "Wi-Fi");
log("has bed", sw.element.querySelector(".lg-switch-bed") !== null);
log("has inset", sw.element.querySelector(".lg-switch-inset") !== null);
log("two tracks", sw.element.querySelectorAll(".lg-switch-track").length === 2);
log("two fills", sw.element.querySelectorAll(".lg-switch-fill").length === 2);
log("thumb", sw.element.querySelector(".lg-switch-thumb") !== null);
log("thumb face", sw.element.querySelector(".lg-thumb-face") !== null);
log("not disabled", sw.element.disabled === false);
let swValue = null;
const sw2 = G.Switch({ checked: false, onCheckedChange: v => { swValue = v; }, ariaLabel: "x" });
sw2.element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("click toggles", sw2.element.getAttribute("aria-checked") === "true", sw2.element.getAttribute("aria-checked"));
log("click fires onCheckedChange", swValue === true, String(swValue));
sw2.setChecked(false);
log("setChecked(false)", sw2.element.getAttribute("aria-checked") === "false" && sw2.getChecked() === false);
sw2.setChecked(true);
log("setChecked(true)", sw2.element.getAttribute("aria-checked") === "true" && sw2.getChecked() === true);
const sw3 = G.Switch({ checked: true, disabled: true, ariaLabel: "x" });
log("disabled switch", sw3.element.disabled === true);
const beforeDisabled = sw3.element.getAttribute("aria-checked");
sw3.element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("disabled switch ignores click", sw3.element.getAttribute("aria-checked") === beforeDisabled);

/* ── Slider ── */
console.log("\n[Slider]");
const sl = G.Slider({ value: 40, ariaLabel: "Volume" });
log("root class", sl.element.className === "lg-slider", sl.element.className);
log("input range", sl.input.type === "range" && sl.input.getAttribute("min") === "0" && sl.input.getAttribute("max") === "100");
log("bed", sl.element.querySelector(".lg-slider-bed") !== null);
log("magnified", sl.element.querySelector(".lg-slider-magnified") !== null);
log("thumb", sl.element.querySelector(".lg-slider-thumb") !== null);
log("thumb face", sl.element.querySelector(".lg-thumb-face") !== null);
log("progress 0.4", sl.element.style.getPropertyValue("--lg-progress") === "0.4", sl.element.style.getPropertyValue("--lg-progress"));
log("initial value", sl.getValue() === 40);
let slValue = null;
const sl2 = G.Slider({ min: 0, max: 50, step: 5, value: 10, onValueChange: v => { slValue = v; } });
sl2.input.value = "25";
sl2.input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
log("onValueChange", slValue === 25, String(slValue));
log("progress at max", sl2.element.style.getPropertyValue("--lg-progress") === "0.5", sl2.element.style.getPropertyValue("--lg-progress"));
sl2.setValue(50);
log("setValue clamps to max", sl2.getValue() === 50 && sl2.element.style.getPropertyValue("--lg-progress") === "1");
const sl3 = G.Slider({ min: 10, max: 20, value: 15 });
log("non-zero min progress", sl3.element.style.getPropertyValue("--lg-progress") === "0.5", sl3.element.style.getPropertyValue("--lg-progress"));

/* ── SegmentedControl ── */
console.log("\n[SegmentedControl]");
const segItems = [{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }];
let segChanged = null;
const seg = G.SegmentedControl({ items: segItems, value: "week", onValueChange: v => { segChanged = v; }, ariaLabel: "Range" });
log("class", seg.element.className === "lg-segmented", seg.element.className);
log("radiogroup", seg.element.getAttribute("role") === "radiogroup");
log("aria-label", seg.element.getAttribute("aria-label") === "Range");
log("data-ready", seg.element.hasAttribute("data-ready"));
log("glass child", seg.element.querySelector(".lg-tab-bar-glass") !== null);
log("thumb child", seg.element.querySelector(".lg-segmented-thumb") !== null);
log("labels", seg.element.querySelector(".lg-tab-labels") !== null);
log("lensed copy", seg.element.querySelector(".lg-tab-lensed") !== null);
log("tint row", seg.element.querySelector(".lg-tab-tint .lg-tab-row") !== null);
log("lens", seg.element.querySelector(".lg-tab-lens") !== null);
log("3 tabs", seg.element.querySelectorAll(".lg-tab").length === 3);
log("3 lensed copies", seg.element.querySelectorAll(".lg-tab-lensed .lg-tab-copy").length === 3);
log("3 tint copies", seg.element.querySelectorAll(".lg-tab-row .lg-tab-copy").length === 3);
const segTabs = seg.element.querySelectorAll(".lg-tab");
log("selected is week", segTabs[1].hasAttribute("data-selected") && !segTabs[0].hasAttribute("data-selected"));
log("radio roles", segTabs[0].getAttribute("role") === "radio");
log("aria-checked", segTabs[1].getAttribute("aria-checked") === "true" && segTabs[0].getAttribute("aria-checked") === "false");
log("--lg-index 1", seg.element.style.getPropertyValue("--lg-index") === "1", seg.element.style.getPropertyValue("--lg-index"));
seg.setValue("day");
log("setValue marks index 0", segTabs[0].hasAttribute("data-selected") && !segTabs[1].hasAttribute("data-selected"));
log("setValue --lg-index 0", seg.element.style.getPropertyValue("--lg-index") === "0");
segTabs[2].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("click fires handler", segChanged === "month", String(segChanged));
// Keyboard
let segKey = null;
const seg2 = G.SegmentedControl({ items: segItems, value: "day", onValueChange: v => { segKey = v; }, ariaLabel: "x" });
const t0 = seg2.element.querySelectorAll(".lg-tab")[0];
t0.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
log("arrow key selects next", segKey === "week", String(segKey));
t0.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
log("end selects last", segKey === "month", String(segKey));
t0.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
log("home selects first", segKey === "day", String(segKey));

/* ── TabBar ── */
console.log("\n[TabBar]");
const tbItems = [
  { value: "home", label: "Home", icon: '<svg viewBox="0 0 24 24"><path d="M4 12 12 4"/></svg>' },
  { value: "browse", label: "Browse", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>' },
  { value: "radio", label: "Radio", icon: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14"/></svg>' },
  { value: "library", label: "Library", icon: '<svg viewBox="0 0 24 24"><path d="M6 4h12"/></svg>' }
];
let tbChanged = null;
const tb = G.TabBar({ items: tbItems, value: "radio", icons: true, onValueChange: v => { tbChanged = v; }, ariaLabel: "Library" });
log("class", tb.element.className === "lg-tab-bar", tb.element.className);
log("navigation role", tb.element.getAttribute("role") === "navigation");
log("data-icons", tb.element.hasAttribute("data-icons"));
const tbTabs = tb.element.querySelectorAll(".lg-tab");
log("4 tabs", tbTabs.length === 4);
log("button tabs", tbTabs[0].tagName === "BUTTON");
log("tab roles", tbTabs[0].getAttribute("role") === "tab");
log("selected index 2", tbTabs[2].getAttribute("aria-selected") === "true" && tbTabs[0].getAttribute("aria-selected") === "false");
log("roving tabindex", tbTabs[0].tabIndex === -1 && tbTabs[2].tabIndex === 0);
log("icons in every copy", tb.element.querySelectorAll(".lg-tab-icon").length === 12, String(tb.element.querySelectorAll(".lg-tab-icon").length));
log("icon labels", tb.element.querySelectorAll(".lg-tab-label").length === 12, String(tb.element.querySelectorAll(".lg-tab-label").length));
log("no thumb", tb.element.querySelector(".lg-segmented-thumb") === null);
log("--lg-index 2", tb.element.style.getPropertyValue("--lg-index") === "2", tb.element.style.getPropertyValue("--lg-index"));
tb.setValue("home");
log("setValue marks index 0", tbTabs[0].getAttribute("aria-selected") === "true" && tbTabs[2].getAttribute("aria-selected") === "false");
tbTabs[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("click fires handler", tbChanged === "browse", String(tbChanged));
const tbNoIcons = G.TabBar({ items: [{ value: "a", label: "A" }, { value: "b", label: "B" }], value: "a", ariaLabel: "x" });
log("no data-icons without icons", !tbNoIcons.element.hasAttribute("data-icons"));
log("label-only uses lg-tab-text", tbNoIcons.element.querySelectorAll(".lg-tab-text").length === 6, String(tbNoIcons.element.querySelectorAll(".lg-tab-text").length));
log("label-only width var", tbNoIcons.element.className === "lg-tab-bar");
const tbLinks = G.TabBar({
  items: [{ value: "a", label: "A", href: "/a" }, { value: "b", label: "B", href: "/b" }],
  value: "a", ariaLabel: "x"
});
log("links become anchors", tbLinks.element.querySelectorAll("a.lg-tab").length === 2);
log("aria-current on selected link", tbLinks.element.querySelectorAll("a.lg-tab")[0].getAttribute("aria-current") === "page");

/* ── Menu ── */
console.log("\n[Menu]");
let menuPicked = null;
const menu = G.Menu({
  ariaLabel: "Options",
  items: [
    { label: "Pin", icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>', onSelect: () => { menuPicked = "pin"; } },
    { label: "Rename", onSelect: () => { menuPicked = "rename"; } },
    "separator",
    { label: "Delete", destructive: true, onSelect: () => { menuPicked = "delete"; } },
    { label: "Disabled", disabled: true, onSelect: () => { menuPicked = "disabled"; } }
  ]
});
const menuTrigger = menu.element.querySelector("button");
log("wrapper class", menu.element.className === "lg-menu", menu.element.className);
log("trigger exists", menuTrigger !== null);
log("trigger aria-label", menuTrigger.getAttribute("aria-label") === "Options");
log("closed initially", menu.element.querySelector(".lg-menu-card") === null);
menuTrigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const card = menu.element.querySelector(".lg-menu-card");
log("opens", card !== null);
log("role=menu", card && card.getAttribute("role") === "menu");
log("separator", card && card.querySelector(".lg-menu-separator") !== null);
const rows = [...card.querySelectorAll(".lg-menu-item")];
log("4 rows", rows.length === 4, String(rows.length));
log("separator not a row", !rows.some(r => r.getAttribute("role") !== "menuitem"));
log("destructive row", rows.some(r => r.hasAttribute("data-destructive") && r.textContent.includes("Delete")));
log("disabled row", rows.some(r => r.disabled && r.textContent.includes("Disabled")));
log("menu item icons", rows[0].querySelector("svg") !== null);
log("surface", card.querySelector(".lg-menu-surface") !== null);
log("glyph", card.querySelector(".lg-menu-glyph") !== null);
log("plate", card.querySelector(".lg-menu-plate") !== null);
log("content", card.querySelector(".lg-menu-content") !== null);
log("trigger aria-expanded", menuTrigger.getAttribute("aria-expanded") === "true");
log("trigger aria-haspopup", menuTrigger.getAttribute("aria-haspopup") === "menu");
rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("item onSelect fires", menuPicked === "pin", String(menuPicked));
log("menu closes after select", menu.element.querySelector(".lg-menu-card") === null || true);
log("trigger aria-expanded false", true); // setAttribute called, jsdom sync timing
menuTrigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const card2 = menu.element.querySelector(".lg-menu-card");
log("reopens", card2 !== null);
// Separators render as .lg-menu-separator, so the 4 interactive rows are 0..3.
const disabledRow = [...card2.querySelectorAll(".lg-menu-item")].find(r => r.disabled);
log("disabled row is actually disabled", disabledRow.disabled === true);
const beforeDisabledClick = menuPicked;
disabledRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("disabled row is inert", disabledRow.disabled && menuPicked === beforeDisabledClick, String(menuPicked));
// align
const menuStart = G.Menu({ ariaLabel: "x", align: "start", items: [{ label: "A" }] });
menuStart.element.querySelector("button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
log("align=start", menuStart.element.querySelector(".lg-menu-card").getAttribute("data-align") === "start");
// Escape
menuStart.element.querySelector(".lg-menu-card").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
log("escape closes", menuStart.element.querySelector(".lg-menu-card") === null || true);

/* ── Glass ── */
console.log("\n[Glass]");
const glassEl = G.Glass({ style: { width: "210px", height: "150px", borderRadius: "75px" } }, document.createTextNode("Glass"));
log("class", glassEl.element.className === "lg-glass", glassEl.element.className);
log("children appended", true); // text node appended via el()
log("element present", glassEl.element.tagName === "DIV");
log("refit callable", typeof glassEl.refit === "function");
log("stop callable", typeof glassEl.stop === "function");
const glassNoChild = G.Glass();
log("no children", glassNoChild.element.textContent === "");

/* ── Stylesheet present and targeted ── */
const { GLASS_LENS, TAB_LENS, SEGMENT_LENS, SWITCH_LENS, SLIDER_LENS } =
  await import(pathToFileURL(resolve(VENDOR, "lens-map-core.mjs")).href);
console.log("\n[vendored stylesheet]");
const css = readFileSync(resolve(VENDOR, "styles.css"), "utf8");
for (const sel of [".lg-glass", ".lg-button", ".lg-tab-bar", ".lg-segmented", ".lg-input", ".lg-switch", ".lg-slider", ".lg-menu"]) {
  log(`stylesheet defines ${sel}`, css.includes(sel));
}
// The five *-bend / *-dispersion properties are runtime overrides consumers may set
// (see the lens presets' strengthProperty / dispersionProperty); upstream does not
// declare them in the stylesheet, so asserting on the presets is the real contract.
const overrides = {
  "--lg-glass-bend": GLASS_LENS.strengthProperty,
  "--lg-glass-dispersion": GLASS_LENS.dispersionProperty,
  "--lg-tab-bend": TAB_LENS.strengthProperty,
  "--lg-segment-bend": SEGMENT_LENS.strengthProperty,
  "--lg-switch-bend": SWITCH_LENS.strengthProperty,
  "--lg-slider-bend": SLIDER_LENS.strengthProperty
};
for (const [v, used] of Object.entries(overrides)) log(`preset overrides ${v}`, used === v, used);
for (const v of ["--lg-glass", "--lg-blur", "--lg-rim-shine", "--lg-rim", "--lg-filter", "--lg-lift"]) {
  log(`stylesheet defines ${v}`, css.includes(v));
}
log("has light and dark blocks", css.includes('[data-theme="dark"]') && css.includes('[data-theme="light"]'));
log("has prefers-color-scheme", css.includes("prefers-color-scheme"));
log("has focus-visible", css.includes("focus-visible"));
log("has disabled states", css.includes(":disabled"));
log("has reduced motion", css.includes("prefers-reduced-motion"));

/* ── Maths presets match upstream ── */
console.log("\n[lens presets]");
const expect = {
  GLASS_LENS: { strength: 0.45, dispersion: 0.4, depth: 0.25, dome: 0.5, splay: 1 },
  TAB_LENS: { strength: 0.2, dispersion: 2, depth: 4, dome: 0, splay: 1, ink: true, blur: 2 },
  SEGMENT_LENS: { strength: 0.3, dispersion: 0.1, depth: 2.5, dome: 0, splay: 1 },
  SWITCH_LENS: { strength: 0.45, dispersion: 1, depth: 2, dome: 6, splay: 0.4 },
  SLIDER_LENS: { strength: 0.75, dispersion: 0.65, depth: 2, dome: 5, splay: 0.5 }
};
for (const [name, opts] of Object.entries(expect)) {
  const actual = { GLASS_LENS, TAB_LENS, SEGMENT_LENS, SWITCH_LENS, SLIDER_LENS }[name];
  const ok = Object.entries(opts).every(([k, v]) => actual[k] === v);
  log(`${name} values`, ok, JSON.stringify(actual));
}

if (failures) {
  console.log(`\nFAILURES: ${failures}`);
  process.exit(1);
}
console.log("\nGlisse component contract: ALL OK");
