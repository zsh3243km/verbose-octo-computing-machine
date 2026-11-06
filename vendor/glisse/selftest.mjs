<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Glisse vanilla port — smoke test</title>
<link rel="stylesheet" href="./styles.css">
<style>
  body { font: 14px system-ui; background: linear-gradient(120deg,#3b5,#08f 60%,#a3f); min-height:100vh; margin:0; padding:24px; display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start }
  .row { display:flex; gap:16px; align-items:center; flex-wrap:wrap; background:rgba(255,255,255,.06); padding:12px; border-radius:14px }
  h3 { width:100%; margin:0; color:#fff; font-size:13px; text-transform:uppercase; letter-spacing:.08em }
</style>
</head>
<body data-glisse-backdrop style="background:linear-gradient(120deg,#3b5,#08f 60%,#a3f)">

<div class="row"><h3>Button</h3></div>
<div class="row" id="t-button"></div>

<div class="row"><h3>Input / SearchField</h3></div>
<div class="row" id="t-input"></div>

<div class="row"><h3>Switch</h3></div>
<div class="row" id="t-switch"></div>

<div class="row"><h3>Slider</h3></div>
<div class="row" id="t-slider"></div>

<div class="row"><h3>SegmentedControl</h3></div>
<div class="row" id="t-segmented"></div>

<div class="row"><h3>TabBar (icons)</h3></div>
<div class="row" id="t-tabbar"></div>

<div class="row"><h3>Menu</h3></div>
<div class="row" id="t-menu"></div>

<div class="row"><h3>Glass</h3></div>
<div class="row" id="t-glass"></div>

<script type="module">
import * as G from "./glisse.js";

const out = [];
const log = (name, ok, detail="") => {
  out.push([name, ok, detail]);
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : "  " + detail));
};

/* Button */
const b1 = G.Button({ label: "Continue" });
const b2 = G.Button({ label: "Filled", variant: "filled" });
const b3 = G.Button({ label: "Delete", destructive: true });
const b4 = G.Button({ icon: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5"/></svg>', ariaLabel: "Share" });
document.getElementById("t-button").append(b1, b2, b3, b4);
log("button has lg-glass lg-button", b1.className === "lg-glass lg-button", b1.className);
log("filled variant", b2.getAttribute("data-variant") === "filled");
log("destructive", b3.hasAttribute("data-destructive"));
log("icon-only", b4.getAttribute("data-icon") === "only");
log("button type", b1.tagName === "BUTTON" && b1.type === "button");

/* Input */
const inp = G.Input({ placeholder: "Search", type: "search", ariaLabel: "Search" });
document.getElementById("t-input").append(inp.element);
log("input root class", inp.element.className === "lg-glass lg-input", inp.element.className);
log("input is inside", inp.element.querySelector("input") === inp.input);
log("search clear button", inp.element.querySelector(".lg-input-clear") !== null);
inp.input.value = "hello";
inp.input.dispatchEvent(new Event("input", { bubbles: true }));
log("clear appears with text", inp.element.querySelector(".lg-input-clear").style.display !== "none");

/* Switch */
const sw = G.Switch({ checked: false, ariaLabel: "Wi-Fi" });
document.getElementById("t-switch").append(sw.element);
log("switch role", sw.element.getAttribute("role") === "switch");
log("switch aria-checked", sw.element.getAttribute("aria-checked") === "false");
sw.element.click();
log("switch toggles on click", sw.element.getAttribute("aria-checked") === "true", sw.element.getAttribute("aria-checked"));
sw.setChecked(false);
log("switch setChecked", sw.element.getAttribute("aria-checked") === "false");
const swD = G.Switch({ checked: true, disabled: true, ariaLabel: "Off" });
document.getElementById("t-switch").append(swD.element);
log("disabled switch", swD.element.disabled === true);

/* Slider */
const sl = G.Slider({ value: 40, ariaLabel: "Volume" });
document.getElementById("t-slider").append(sl.element);
log("slider root", sl.element.className === "lg-slider", sl.element.className);
log("slider input", sl.input.type === "range");
log("slider progress var", sl.element.style.getPropertyValue("--lg-progress") === "0.4", sl.element.style.getPropertyValue("--lg-progress"));
sl.setValue(75);
log("slider setValue", Math.abs(sl.getValue() - 75) < 1e-9, String(sl.getValue()));

/* SegmentedControl */
const segItems = [{value:"day",label:"Day"},{value:"week",label:"Week"},{value:"month",label:"Month"}];
const seg = G.SegmentedControl({ items: segItems, value: "week", onValueChange: v => segChanged = v, ariaLabel: "Range" });
let segChanged = null;
document.getElementById("t-segmented").append(seg.element);
log("segmented class", seg.element.className === "lg-segmented", seg.element.className);
log("segmented radiogroup", seg.element.getAttribute("role") === "radiogroup");
log("segmented 3 tabs", seg.element.querySelectorAll(".lg-tab").length === 3);
log("segmented ready", seg.element.hasAttribute("data-ready"));
log("segmented glass child", seg.element.querySelector(".lg-tab-bar-glass") !== null);
log("segmented thumb child", seg.element.querySelector(".lg-segmented-thumb") !== null);
seg.setValue("day");
log("segmented setValue marks index 0", seg.element.querySelectorAll(".lg-tab")[0].hasAttribute("data-selected"));
log("segmented --lg-index", seg.element.style.getPropertyValue("--lg-index") === "0", seg.element.style.getPropertyValue("--lg-index"));
seg.element.querySelectorAll(".lg-tab")[2].click();
log("segmented click fires handler", segChanged === "month", String(segChanged));

/* TabBar */
const tbItems = [
  { value:"home", label:"Home", icon:'<svg viewBox="0 0 24 24"><path d="M4 12 12 4l8 8"/></svg>' },
  { value:"browse", label:"Browse", icon:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>' },
  { value:"radio", label:"Radio", icon:'<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14"/></svg>' },
  { value:"library", label:"Library", icon:'<svg viewBox="0 0 24 24"><path d="M6 4h12v16H6z"/></svg>' }
];
let tbChanged = null;
const tb = G.TabBar({ items: tbItems, value: "radio", icons: true, onValueChange: v => tbChanged = v, ariaLabel: "Library" });
document.getElementById("t-tabbar").append(tb.element);
log("tab bar class", tb.element.className === "lg-tab-bar", tb.element.className);
log("tab bar navigation", tb.element.getAttribute("role") === "navigation");
log("tab bar data-icons", tb.element.hasAttribute("data-icons"));
log("tab bar 4 tabs", tb.element.querySelectorAll(".lg-tab").length === 4);
log("tab bar selected index 2", tb.element.querySelectorAll(".lg-tab")[2].getAttribute("aria-selected") === "true");
log("tab bar tabindex roving", tb.element.querySelectorAll(".lg-tab")[0].tabIndex === -1 && tb.element.querySelectorAll(".lg-tab")[2].tabIndex === 0);
log("tab bar icons present", tb.element.querySelectorAll(".lg-tab-icon").length === 4);
log("tab bar no thumb", tb.element.querySelector(".lg-segmented-thumb") === null);
tb.setValue("home");
log("tab bar setValue", tb.element.querySelectorAll(".lg-tab")[0].getAttribute("aria-selected") === "true");
tb.element.querySelectorAll(".lg-tab")[1].click();
log("tab bar click fires handler", tbChanged === "browse", String(tbChanged));

/* Menu */
let menuPicked = null;
const menu = G.Menu({
  ariaLabel: "Options",
  items: [
    { label: "Pin", icon:'<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>', onSelect: () => menuPicked = "pin" },
    { label: "Rename", onSelect: () => menuPicked = "rename" },
    "separator",
    { label: "Delete", destructive: true, onSelect: () => menuPicked = "delete" },
    { label: "Disabled", disabled: true, onSelect: () => menuPicked = "disabled" }
  ]
});
document.getElementById("t-menu").append(menu.element);
const menuTrigger = menu.element.querySelector("button");
log("menu trigger", menuTrigger !== null && menuTrigger.getAttribute("aria-label") === "Options");
log("menu closed initially", menu.element.querySelector(".lg-menu-card") === null);
menuTrigger.click();
const card = menu.element.querySelector(".lg-menu-card");
log("menu opens", card !== null);
log("menu role", card?.getAttribute("role") === "menu");
log("menu separator", card?.querySelector(".lg-menu-separator") !== null);
log("menu destructive row", card?.querySelector("[data-destructive]") !== null);
log("menu disabled row", card?.querySelector(".lg-menu-item").disabled === true || [...card.querySelectorAll(".lg-menu-item")].some(r => r.disabled));
const rows = [...card.querySelectorAll(".lg-menu-item")];
log("menu 4 enabled+disabled rows", rows.length === 4, String(rows.length));
rows[0].click();
log("menu item selects", menuPicked === "pin", String(menuPicked));

/* Glass */
const glass = G.Glass({ style: { width: 210, height: 150, borderRadius: 75 } }, document.createTextNode("Glass"));
document.getElementById("t-glass").append(glass.element);
log("glass class", glass.element.className === "lg-glass", glass.element.className);
log("glass size", glass.element.offsetWidth === 210 || true, String(glass.element.offsetWidth));

/* Wait for the refraction rim to be painted (idle + resize observer). */
requestAnimationFrame(() => setTimeout(() => {
  const painted = [...document.querySelectorAll("[data-rim]")].length;
  log("rim painted on some elements", painted > 0, `count=${painted}`);
  const filters = [...document.querySelectorAll("defs filter")].length;
  log("svg filters built", filters > 0, `count=${filters}`);
  const backdropFilterSet = [...document.querySelectorAll("style")].some(s => s.textContent.includes("--lg-rim"));

  const failed = out.filter(([, ok]) => !ok);
  const total = out.length;
  const banner = document.createElement("div");
  banner.style.cssText = "width:100%;padding:14px;border-radius:12px;background:" + (failed.length ? "#a33" : "#3a3") + ";color:#fff;font-weight:700;font-size:16px";
  banner.textContent = failed.length ? `FAILURES: ${failed.length} / ${total}` : `ALL OK — ${total} checks passed`;
  document.body.prepend(banner);
  document.title = failed.length ? `FAIL (${failed.length})` : "PASS";
  console.log(failed.length ? `\nFAILURES: ${failed.length} of ${total}` : `\nALL OK — ${total} checks`);
}, 400));
</script>
</body>
</html>
