/**
 * Glisse Liquid Glass — Component Layer (vanilla JS)
 * Source: https://github.com/0kzh/glisse (v0.5.0)
 * MIT License — © Kelvin Zhang
 *
 * Framework-free port of the React components. Same class names, same
 * --lg-* custom properties, same behaviour. Each factory returns a DOM
 * element plus a controller.
 */

import {
  createLens, createBackdropLens, refractsBackdrop, shapeOf
} from "./lens.js";
import { useRefraction, paintRim } from "./refraction.js";
import { createSpring, prefersReducedMotion, HOLD } from "./spring.mjs";

/* ─── helpers ─── */
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const GLISSE_ICONS = {
  ellipsis: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>'
};

/** Parse HTML markup into a fragment. */
function parse(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content;
}

/* ═══════════════════════════════════════════════════════════════
   Glass
   ═══════════════════════════════════════════════════════════════ */

/**
 * Creates a Glass surface. Returns the element plus a controller.
 * `style` — map or string of CSS. `tunable` — read the
 * --lg-glass-bend / --lg-glass-dispersion / --lg-blur / --lg-rim-shine custom properties
 * as CSS vars set on the element or an ancestor.
 */
export function Glass({ className = "", style, children, tunable = true } = {}) {
  const node = el("div", { class: `lg-glass${className ? " " + className : ""}`, style });
  if (children) node.append(...(Array.isArray(children) ? children : [children]));
  const handle = useRefraction(node);
  return { element: node, ...handle };
}

/* ═══════════════════════════════════════════════════════════════
   Button
   ═══════════════════════════════════════════════════════════════ */

/**
 * Glass / filled / destructive button. Returns the element and a controller.
 *
 * opts: {
 *   variant: "glass" | "filled"      (default "glass")
 *   icon: string|Element             (shown before the label; alone, the button
 *                                    becomes a circle — give an aria-label)
 *   destructive: boolean
 *   tint: string                     (CSS colour: tints a glass label or a filled fill)
 *   type: "button" | "submit" | "reset"
 *   label / children: string|Element
 *   disabled: boolean
 *   onClick: fn
 * }
 */
export function Button(opts = {}) {
  const {
    variant = "glass", icon, destructive, tint, type = "button",
    label, children, disabled, onClick, className = "", style,
    ariaLabel, ariaExpanded, ariaPressed, ariaHasPopup, title, id
  } = opts;
  const content = children ?? label ?? "";
  const hasIcon = icon != null;
  // Icon-only means "no label text at all", including an empty string.
  const iconOnly = hasIcon && (content == null || content === "");

  const btn = el("button", {
    type, id, title,
    class: `lg-glass lg-button${className ? " " + className : ""}`,
    style,
    disabled: disabled || undefined,
    "aria-label": ariaLabel,
    "aria-expanded": ariaExpanded,
    "aria-pressed": ariaPressed,
    "aria-haspopup": ariaHasPopup,
    "data-variant": variant === "glass" ? undefined : variant,
    "data-destructive": destructive ? "" : undefined,
    "data-tint": tint ? "" : undefined,
    "data-icon": hasIcon ? (iconOnly ? "only" : "") : undefined
  });
  if (tint) btn.style.setProperty("--lg-tint", tint);
  if (hasIcon) {
    btn.append(typeof icon === "string" ? parse(icon) : icon);
  }
  if (content) {
    btn.append(typeof content === "string" ? parse(`<span>${content}</span>`) : content);
  }
  if (onClick) btn.addEventListener("click", onClick);
  applyPressFeedback(btn);
  useRefraction(btn);
  return btn;
}

/* ═══════════════════════════════════════════════════════════════
   Input / SearchField
   ═══════════════════════════════════════════════════════════════ */

/**
 * Glass input. Returns { element, input }.
 * opts: {
 *   type: "text" | "search" | ...
 *   icon: string|Element
 *   placeholder, value, disabled, required
 *   onValueChange: fn(value)
 *   onKeyDown: fn(event)
 *   maxLength, min, max, step
 * }
 */
export function Input(opts = {}) {
  const {
    type = "text", icon, placeholder, value = "", disabled, required,
    onValueChange, onKeyDown, maxLength, min, max, step,
    ariaLabel, name, className = "", style, autoComplete
  } = opts;
  const input = el("input", {
    type, placeholder, maxLength, min, max, step, name,
    "aria-label": ariaLabel, autocomplete: autoComplete, required: required || undefined,
    disabled: disabled || undefined
  });
  input.value = value;
  const root = el("div", { class: `lg-glass lg-input${className ? " " + className : ""}`, style });
  if (input.value || type !== "search") input.value = value;
  root.addEventListener("pointerdown", e => {
    if (e.target !== input) input.focus();
  });
  if (icon) root.append(el("span", { class: "lg-input-icon" }, typeof icon === "string" ? parse(icon) : icon));
  root.append(input);
  input.addEventListener("input", () => onValueChange?.(input.value));
  if (onKeyDown) input.addEventListener("keydown", onKeyDown);

  if (type === "search") {
    const clear = el("button", {
      type: "button", class: "lg-input-clear", "aria-label": "Clear",
      style: "display:none",
      onPointerdown: e => e.preventDefault()
    }, parse(GLISSE_ICONS.close));
    clear.addEventListener("click", () => {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
    root.append(clear);
    const syncClear = () => {
      clear.style.display = input.value && !input.disabled ? "" : "none";
    };
    input.addEventListener("input", syncClear);
    syncClear();
  }

  useRefraction(root);
  return { element: root, input };
}

/* ═══════════════════════════════════════════════════════════════
   Switch
   ═══════════════════════════════════════════════════════════════ */

const SWITCH_TRAVEL = 57.9 * 0.375;
const unit = v => Math.min(1, Math.max(0, v));

/**
 * Glass switch. Returns { element, setChecked, getChecked }.
 * opts: { checked: boolean, onCheckedChange: fn(checked), disabled, ariaLabel, label }
 */
export function Switch(opts = {}) {
  const { checked = false, onCheckedChange, disabled, ariaLabel, label } = opts;

  const bed = el("span", { class: "lg-switch-bed", "aria-hidden": "true" },
    el("span", { class: "lg-switch-track" }, el("span", { class: "lg-switch-fill" })));
  const inset = el("span", { class: "lg-switch-bed lg-switch-inset", "aria-hidden": "true" },
    el("span", { class: "lg-switch-track" }, el("span", { class: "lg-switch-fill" })));
  const thumb = el("span", { class: "lg-switch-thumb", "aria-hidden": "true" },
    el("span", { class: "lg-thumb-face" }));

  const node = el("button", {
    type: "button", role: "switch", class: "lg-switch",
    "aria-checked": String(checked),
    "aria-label": ariaLabel || label,
    disabled: disabled || undefined
  }, bed, inset, thumb);
  if (label && !ariaLabel) node.setAttribute("title", label);

  const fills = [bed.querySelector(".lg-switch-fill"), inset.querySelector(".lg-switch-fill")];
  const face = thumb.querySelector(".lg-thumb-face");
  const lens = createLens(thumb, inset, SWITCH_LENS_OPTIONS, bed);

  let x = 0, scale = 0.65;
  const paint = () => {
    thumb.style.transform = `translate(${x}px, -50%) scale(${scale})`;
    lens.update();
  };
  const setChecked = next => {
    node.setAttribute("aria-checked", String(next));
    position.set(next ? 1 : 0);
    color.set(next ? 1 : 0);
  };
  const sync = () => setChecked(node.getAttribute("aria-checked") === "true");

  const position = createSpring(checked ? 1 : 0, 1000, 80, v => { x = v * SWITCH_TRAVEL; paint(); });
  const color = createSpring(checked ? 1 : 0, 1000, 80, v => { for (const f of fills) f.style.opacity = String(unit(v)); });
  const lift = createSpring(0, 2000, 80, v => {
    scale = 0.65 + 0.25 * v;
    face.style.opacity = String(1 - 0.85 * unit(v));
    node.style.setProperty("--lg-lift", String(unit(v)));
    lens.setActive(v > 0.01);
    paint();
  });
  position.paint(); color.paint(); lift.paint();

  let gesture = null, ignoreClick = false;

  const settle = next => {
    const old = gesture;
    gesture = null;
    lift.set(0);
    if (old && node.hasPointerCapture(old.id)) node.releasePointerCapture(old.id);
    if (next === undefined || next === (node.getAttribute("aria-checked") === "true")) return sync();
    node.setAttribute("aria-checked", String(next));
    onCheckedChange?.(next);
    requestAnimationFrame(sync);
  };

  node.addEventListener("pointerdown", e => {
    if (!e.isPrimary || e.button !== 0 || node.disabled) return;
    e.preventDefault();
    ignoreClick = false;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, from: node.getAttribute("aria-checked") === "true" ? 1 : 0, moved: false, at: performance.now(), box: node.getBoundingClientRect() };
    node.setPointerCapture(e.pointerId);
    lift.set(1);
  });
  node.addEventListener("pointermove", e => {
    if (e.pointerId !== gesture?.id) return;
    const dx = e.clientX - gesture.x, dy = Math.abs(e.clientY - gesture.y);
    if (!HOLD(gesture.at, gesture.moved) && dy > 10 && dy > Math.abs(dx) + 4) { ignoreClick = true; return settle(); }
    if (!gesture.moved && Math.abs(dx) < 4) return;
    gesture.moved = true;
    const v = gesture.from + dx / SWITCH_TRAVEL;
    const over = v < 0 ? v : v > 1 ? v - 1 : 0;
    position.set(unit(v) + over / 22);
    color.set(v > 0.5 ? 1 : 0);
  });
  node.addEventListener("pointerup", e => {
    if (e.pointerId !== gesture?.id) return;
    ignoreClick = true;
    const { from, x: gx, moved, box } = gesture;
    const v = from + (e.clientX - gx) / SWITCH_TRAVEL;
    const near = e.clientY >= box.top - 24 && e.clientY <= box.bottom + 24;
    settle(moved ? v > 0.5 : near ? node.getAttribute("aria-checked") !== "true" : undefined);
  });
  node.addEventListener("pointercancel", () => { if (gesture) { ignoreClick = true; settle(); } });
  node.addEventListener("lostpointercapture", () => { if (gesture) { ignoreClick = true; settle(); } });
  node.addEventListener("touchmove", e => { if (gesture && e.cancelable && HOLD(gesture.at, gesture.moved)) e.preventDefault(); }, { passive: false });
  node.addEventListener("click", () => {
    if (ignoreClick) ignoreClick = false;
    else if (!node.disabled) {
      node.setAttribute("aria-checked", String(node.getAttribute("aria-checked") !== "true"));
      onCheckedChange?.(node.getAttribute("aria-checked") === "true");
      sync();
    }
  });

  return {
    element: node,
    setChecked,
    getChecked: () => node.getAttribute("aria-checked") === "true",
    setDisabled(next) { node.disabled = !!next; }
  };
}

const SWITCH_LENS_OPTIONS = { strength: 0.45, strengthProperty: "--lg-switch-bend", dispersion: 1, depth: 2, dome: 6, splay: 0.4 };

/* ═══════════════════════════════════════════════════════════════
   Slider
   ═══════════════════════════════════════════════════════════════ */

/**
 * Glass slider. Returns { element, setValue, getValue }.
 * opts: { value, min, max, step, onValueChange, disabled, ariaLabel }
 */
export function Slider(opts = {}) {
  const { value = 0, min = 0, max = 100, step = 1, onValueChange, disabled, ariaLabel } = opts;

  const bed = el("span", { class: "lg-slider-bed", "aria-hidden": "true" },
    el("span", { class: "lg-slider-track" }, el("span", { class: "lg-slider-fill" })));
  const magnified = el("span", { class: "lg-slider-bed lg-slider-magnified", "aria-hidden": "true" },
    el("span", { class: "lg-slider-track" }, el("span", { class: "lg-slider-fill" })));
  const thumb = el("span", { class: "lg-slider-thumb", "aria-hidden": "true" },
    el("span", { class: "lg-thumb-face" }));
  const input = el("input", {
    type: "range", min, max, step, value: String(value),
    "aria-label": ariaLabel, disabled: disabled || undefined
  });

  const root = el("div", { class: "lg-slider" }, bed, magnified, thumb, input);
  const face = thumb.querySelector(".lg-thumb-face");
  const lens = createLens(thumb, magnified, { strength: 0.75, strengthProperty: "--lg-slider-bend", dispersion: 0.65, depth: 2, dome: 5, splay: 0.5 }, bed);

  const lift = createSpring(0, 2000, 80, amount => {
    const lifted = unit(amount);
    thumb.style.scale = String(0.6 + 0.4 * amount);
    root.style.setProperty("--lg-lift", String(lifted));
    face.style.opacity = String(1 - 0.85 * lifted);
    lens.setActive(amount > 0.01);
    lens.update();
  });

  const hold = () => { if (!input.disabled) lift.set(1); };
  const release = () => lift.set(0);
  const ends = ["pointerup", "pointercancel", "lostpointercapture", "blur"];
  input.addEventListener("pointerdown", hold);
  ends.forEach(t => input.addEventListener(t, release));
  window.addEventListener("pointerup", release);

  input.addEventListener("input", () => {
    const v = input.valueAsNumber;
    root.style.setProperty("--lg-progress", String(max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0));
    onValueChange?.(v);
    lens.update();
  });
  root.style.setProperty("--lg-progress", String(max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0));

  return {
    element: root,
    input,
    setValue(v) { input.value = String(v); input.dispatchEvent(new Event("input", { bubbles: true })); },
    getValue: () => input.valueAsNumber,
    setDisabled(next) { input.disabled = !!next; }
  };
}

/* ═══════════════════════════════════════════════════════════════
   SegmentedControl
   ═══════════════════════════════════════════════════════════════ */

/**
 * Glass segmented control. Returns { element, setValue, getValue }.
 * opts: {
 *   items: [{ value, label }]
 *   value: string
 *   onValueChange: fn(value)
 *   ariaLabel, disabled
 * }
 */
export function SegmentedControl(opts = {}) {
  const { items, value, onValueChange, ariaLabel } = opts;

  const glass = el("span", { class: "lg-glass lg-tab-bar-glass", "aria-hidden": "true" });
  const thumbEl = el("span", { class: "lg-segmented-thumb", "aria-hidden": "true" });
  const labels = el("span", { class: "lg-tab-labels", role: "none" });
  const lensed = el("span", { class: "lg-tab-labels lg-tab-lensed", "aria-hidden": "true" });
  const row = el("span", { class: "lg-tab-row" });
  const tint = el("span", { class: "lg-tab-tint", "aria-hidden": "true" }, row);
  const lens = el("span", { class: "lg-glass lg-tab-lens", "aria-hidden": "true" });

  items.forEach((item, index) => {
    const tab = el("button", {
      type: "button", role: "radio", class: "lg-tab",
      "data-selected": index === selectedIndex() ? "" : undefined,
      "aria-checked": index === selectedIndex() ? "true" : "false",
      tabindex: index === selectedIndex() ? "0" : "-1"
    }, el("span", { class: "lg-tab-text" }, item.label));
    labels.append(tab);
    lensed.append(el("span", { class: "lg-tab-copy", "data-selected": index === selectedIndex() ? "" : undefined }, el("span", { class: "lg-tab-text" }, item.label)));
    row.append(el("span", { class: "lg-tab-copy" }, el("span", { class: "lg-tab-text" }, item.label)));
  });

  const bar = el("div", {
    role: "radiogroup",
    class: "lg-segmented",
    "aria-label": ariaLabel,
    "data-ready": ""
  }, glass, thumbEl, labels, lensed, tint, lens);
  bar.style.setProperty("--lg-index", String(Math.max(selectedIndex(), 0)));

  function selectedIndex() { return Math.max(0, items.findIndex(i => i.value === value)); }

  useRefraction(glass);
  useRefraction(lens, true, false);

  const controller = attachSegments({ bar, glass, thumb: thumbEl, labels, lensed, lens, tint, row }, SEGMENT_LENS_OPTS, false, index => {
    if (items[index]) onValueChange?.(items[index].value);
  });
  controller.setActive(selectedIndex());

  return {
    element: bar,
    setValue(next) {
      const i = items.findIndex(it => it.value === next);
      if (i < 0) return;
      bar.querySelectorAll(".lg-tab").forEach((t, idx) => {
        t.toggleAttribute("data-selected", idx === i);
        t.setAttribute("aria-checked", idx === i ? "true" : "false");
        t.tabIndex = idx === i ? 0 : -1;
      });
      bar.querySelectorAll(".lg-tab-copy").forEach((c, idx) => c.toggleAttribute("data-selected", idx === i));
      bar.style.setProperty("--lg-index", String(Math.max(i, 0)));
      controller.setActive(i);
    },
    destroy: controller.destroy
  };
}

const SEGMENT_LENS_OPTS = { strength: 0.3, strengthProperty: "--lg-segment-bend", dispersion: 0.1, depth: 2.5, dome: 0, splay: 1 };

/* ═══════════════════════════════════════════════════════════════
   TabBar
   ═══════════════════════════════════════════════════════════════ */

/**
 * Glass tab bar. Returns { element, setValue }.
 * opts: {
 *   items: [{ value, label, icon?: string, href? }]
 *   value: string
 *   onValueChange: fn(value)
 *   ariaLabel, icons: boolean
 * }
 */
export function TabBar(opts = {}) {
  const { items, value, onValueChange, ariaLabel, icons } = opts;

  const glass = el("span", { class: "lg-glass lg-tab-bar-glass", "aria-hidden": "true" });
  const labels = el("span", { class: "lg-tab-labels", role: "none" });
  const lensed = el("span", { class: "lg-tab-labels lg-tab-lensed", "aria-hidden": "true" });
  const row = el("span", { class: "lg-tab-row" });
  const tint = el("span", { class: "lg-tab-tint", "aria-hidden": "true" }, row);
  const lens = el("span", { class: "lg-glass lg-tab-lens", "aria-hidden": "true" });

  const selected = Math.max(0, items.findIndex(i => i.value === value));
  items.forEach((item, index) => {
    const content = () => {
      const parts = [];
      if (icons && item.icon) parts.push(el("span", { class: "lg-tab-icon", "aria-hidden": "true" }, parse(item.icon)));
      parts.push(el("span", { class: icons && item.icon ? "lg-tab-label" : "lg-tab-text" }, item.label));
      return parts;
    };
    const tab = item.href
      ? el("a", { href: item.href, class: "lg-tab", "aria-current": index === selected ? "page" : undefined },
          el("span", { class: "lg-tab-face" }, content()))
      : el("button", { type: "button", role: "tab", class: "lg-tab",
          "data-selected": index === selected ? "" : undefined,
          "aria-selected": index === selected ? "true" : "false",
          tabindex: index === selected ? "0" : "-1" },
          el("span", { class: "lg-tab-face" }, content()));
    labels.append(tab);
    lensed.append(el("span", { class: "lg-tab-copy", "data-selected": index === selected ? "" : undefined }, content()));
    row.append(el("span", { class: "lg-tab-copy" }, content()));
  });

  const bar = el("div", {
    role: "navigation",
    class: "lg-tab-bar",
    "aria-label": ariaLabel,
    "data-ready": "",
    "data-icons": icons ? "" : undefined
  }, glass, labels, lensed, tint, lens);
  bar.style.setProperty("--lg-index", String(selected));

  useRefraction(glass);
  const controller = attachSegments({ bar, glass, thumb: null, labels, lensed, lens, tint, row }, TAB_LENS_OPTS, true, index => {
    if (items[index]) onValueChange?.(items[index].value);
  });
  controller.setActive(selected);
  useRefraction(lens, true, true);

  return {
    element: bar,
    setValue(next) {
      const i = items.findIndex(it => it.value === next);
      if (i < 0) return;
      bar.querySelectorAll(".lg-tab").forEach((t, idx) => {
        t.toggleAttribute("data-selected", idx === i);
        if (t.tagName === "BUTTON") {
          t.setAttribute("aria-selected", idx === i ? "true" : "false");
          t.tabIndex = idx === i ? 0 : -1;
        } else t.toggleAttribute("aria-current", idx === i);
      });
      bar.querySelectorAll(".lg-tab-copy").forEach((c, idx) => c.toggleAttribute("data-selected", idx === i));
      bar.style.setProperty("--lg-index", String(i));
      controller.setActive(i);
    },
    destroy: controller.destroy
  };
}

const TAB_LENS_OPTS = { strength: 0.2, strengthProperty: "--lg-tab-bend", dispersion: 2, dispersionProperty: "--lg-tab-dispersion", depth: 4, dome: 0, splay: 1, ink: true, blur: 2 };

/* ═══════════════════════════════════════════════════════════════
   Menu
   ═══════════════════════════════════════════════════════════════ */

/**
 * Glass menu with morphing glass surface. Returns { element }.
 * opts: {
 *   items: [{ label, icon?, onSelect?, destructive?, disabled? } | "separator"]
 *   ariaLabel, icon (default ellipsis), align: "start" | "end"
 * }
 */
export function Menu(opts = {}) {
  const { items, ariaLabel, icon, align = "end" } = opts;
  const iconMarkup = icon ?? GLISSE_ICONS.ellipsis;

  const wrapper = el("div", { class: "lg-menu" });
  const trigger = Button({
    icon: iconMarkup,
    ariaLabel,
    onClick: () => (wrapper.querySelector(".lg-menu-card") ? closeMenu() : openMenu())
  });
  wrapper.append(trigger);
  return { element: wrapper };

  function openMenu() {
    const card = el("div", { role: "menu", "aria-label": ariaLabel, class: "lg-menu-card", "data-align": align });
    const surface = el("span", { class: "lg-menu-surface", "aria-hidden": "true" });
    const glyph = el("span", { class: "lg-menu-glyph", "aria-hidden": "true" }, parse(iconMarkup));
    const content = el("div", { role: "none", class: "lg-menu-content" });
    const plate = el("span", { class: "lg-menu-plate", "aria-hidden": "true" });
    content.append(plate);

    items.forEach((item, index) => {
      if (item === "separator") { content.append(el("div", { role: "separator", class: "lg-menu-separator" })); return; }
      const rowEl = el("button", {
        type: "button", role: "menuitem", class: "lg-menu-item",
        "data-index": index,
        "data-destructive": item.destructive ? "" : undefined,
        disabled: item.disabled || undefined
      });
      if (item.icon) rowEl.append(typeof item.icon === "string" ? parse(item.icon) : item.icon);
      rowEl.append(el("span", {}, item.label));
      content.append(rowEl);
    });

    card.append(surface, glyph, content);
    wrapper.append(card);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "true");

    const from = { width: trigger.offsetWidth, height: trigger.offsetHeight };
    const to = { width: card.offsetWidth, height: card.offsetHeight };
    const radius = parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 16;
    const trailing = align !== "start";
    const origin = { x: trailing ? to.width - from.width / 2 : from.width / 2, y: from.height / 2 };
    content.style.transformOrigin = `${origin.x}px ${origin.y}px`;
    glyph.style.width = `${from.width}px`;
    glyph.style.height = `${from.height}px`;
    let leaving = false;

    const shape = createSpring(0, 600, 46, v => {
      const t = clamp(v, 0, 1);
      const settled = t === 1;
      const w = from.width + (to.width - from.width) * t;
      const h = from.height + (to.height - from.height) * t;
      const scale = 0.5 + 0.5 * t;
      const local = (edge, centre) => centre + (edge - centre) / scale;
      const left = local(trailing ? to.width - w : 0, origin.x);
      const right = local(trailing ? to.width : w, origin.x);
      const bottom = local(h, origin.y);
      const top = local(0, origin.y);
      surface.style.width = settled ? "" : `${w}px`;
      surface.style.height = settled ? "" : `${h}px`;
      surface.style.opacity = String(clamp(t / 0.2));
      trigger.style.opacity = t === 0 ? "" : String(1 - clamp(t / 0.2));
      const drift = 0.3 * t;
      const dx = ((trailing ? to.width - w / 2 : w / 2) - origin.x) * drift;
      const dy = (h / 2 - origin.y) * drift;
      glyph.style.opacity = String(1 - clamp(t / 0.45));
      glyph.style.transform = `translate(${dx}px, ${dy}px) scale(${1 + 0.6 * t})`;
      glyph.style.filter = `blur(${8 * t}px)`;
      content.style.opacity = String(leaving ? clamp((t - 0.55) / 0.45) : clamp((t - 0.15) / 0.6));
      content.style.transform = settled ? "" : `scale(${scale})`;
      content.style.filter = settled ? "" : `blur(${6 * (1 - t)}px)`;
      content.style.clipPath = settled ? "" : `inset(${top}px ${to.width - right}px ${to.height - bottom}px ${left}px round ${radius / scale}px)`;
      if (leaving && v === 0) closeNow();
    });
    const morph = { ...shape, set(target, instant) { leaving = target === 0; shape.tune(leaving ? 900 : 600, leaving ? 57 : 46); shape.set(target, instant); } };
    shape.paint();
    morph.set(1);
    card.querySelectorAll(".lg-menu-item").forEach(r => useRefraction(r));

    const offset = { scale: 1, x: 0, y: 0 };
    const paint = () => { card.style.scale = String(offset.scale); card.style.translate = `${offset.x}px ${offset.y}px`; };
    const scaleSpring = createSpring(1, 650, 36, v => { offset.scale = v; paint(); });
    const xSpring = createSpring(0, 600, 30, v => { offset.x = v; paint(); });
    const ySpring = createSpring(0, 600, 30, v => { offset.y = v; paint(); });

    let gesture = null, current = null, suppressUntil = 0;
    const rows = () => [...card.querySelectorAll(".lg-menu-item")].filter(r => !r.disabled);
    rows()[0]?.focus({ preventScroll: true });

    const highlight = rowEl => {
      if (current === rowEl) return;
      const first = !current;
      current = rowEl;
      if (!rowEl) { delete card.dataset.scrubbing; plate.style.opacity = "0"; return; }
      card.dataset.scrubbing = "";
      plate.style.width = `${rowEl.offsetWidth}px`;
      plate.style.height = `${rowEl.offsetHeight}px`;
      if (first) plate.style.transition = "none";
      plate.style.transform = `translate(${rowEl.offsetLeft}px, ${rowEl.offsetTop}px)`;
      plate.style.opacity = "1";
      if (first) { void plate.offsetWidth; plate.style.transition = ""; }
    };
    const rowAt = (cx, cy) => {
      const r = document.elementFromPoint(cx, cy)?.closest(".lg-menu-item");
      return r && !r.disabled && card.contains(r) ? r : null;
    };

    const close = (restoreFocus = true) => {
      card.dataset.phase = "leaving";
      morph.set(0);
      if (restoreFocus) trigger.focus({ preventScroll: true });
    };
    const closeNow = () => { card.remove(); trigger.setAttribute("aria-expanded", "false"); };
    wrapper._closeMenu = close;

    card.addEventListener("pointerdown", e => {
      if (!e.isPrimary || e.button !== 0) return;
      gesture = { id: e.pointerId, x: e.clientX, y: e.clientY };
      card.setPointerCapture(e.pointerId);
      card.dataset.pressed = "";
      scaleSpring.set(1 + 5 / Math.max(card.offsetWidth, card.offsetHeight, 200));
      highlight(rowAt(e.clientX, e.clientY));
    });
    card.addEventListener("pointermove", e => {
      if (!gesture) {
        const r = e.pointerType === "mouse" ? rowAt(e.clientX, e.clientY) : null;
        if (r) highlight(r);
        return;
      }
      if (e.pointerId !== gesture.id) return;
      highlight(rowAt(e.clientX, e.clientY));
      xSpring.set(Math.sign(e.clientX - gesture.x) * 7 * (1 - Math.exp(-Math.abs(e.clientX - gesture.x) * 0.12 / 7)), true);
      ySpring.set(Math.sign(e.clientY - gesture.y) * 7 * (1 - Math.exp(-Math.abs(e.clientY - gesture.y) * 0.12 / 7)), true);
    });
    card.addEventListener("pointerleave", e => { if (!gesture && e.pointerType === "mouse") highlight(null); });
    card.addEventListener("pointerup", e => {
      if (e.pointerId !== gesture?.id) return;
      const chosen = e.type === "pointerup" ? rowAt(e.clientX, e.clientY) : null;
      highlight(null); gesture = null;
      delete card.dataset.pressed;
      scaleSpring.set(1); xSpring.set(0); ySpring.set(0);
      suppressUntil = performance.now() + 500;
      chosen?.click();
    });
    card.addEventListener("click", e => {
      const rowEl = e.target.closest(".lg-menu-item");
      if (!rowEl || (e.detail !== 0 && performance.now() < suppressUntil)) return;
      // A disabled row must never run its action, even where a synthetic event
      // (or an older browser) delivers one.
      const item = items[Number(rowEl.dataset.index)];
      if (!item || item === "separator" || rowEl.disabled) return;
      close();
      item.onSelect?.();
    });
    card.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") close(false);
      else if (["ArrowDown","ArrowUp","Home","End"].includes(e.key)) {
        e.preventDefault();
        if (!gesture) highlight(null);
        const list = rows();
        const idx = list.indexOf(document.activeElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (idx + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
      }
    });
    const outside = e => { if (!card.contains(e.target) && !trigger.contains(e.target)) close(false); };
    document.addEventListener("pointerdown", outside, true);
    trigger._outsideHandler = outside;
  }

  function closeMenu() { wrapper._closeMenu?.(); }
}

/* ═══════════════════════════════════════════════════════════════
   Segments controller (from internal/segments.tsx)
   ═══════════════════════════════════════════════════════════════ */

const SEG_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End"];
const REST = [1024, 58.9, 676, 47.8];
const UNDER = 0.5;
const DRAG = [2500, 94, 576, 44.2];

function attachSegments({ bar, glass, thumb: thumbEl, labels, lensed, lens, tint, row }, options, bendsBackdrop, select) {
  const tabs = [...bar.querySelectorAll(".lg-tab")];
  let slot = 0, width = 0, height = 0, inset = 0, padding = 0, growX = 16, growY = 12;
  let active = -1, shown = false, settleFrame = 0;
  let gesture = null;
  const state = { x: 0, lift: 0 };
  const refraction = createLens(lens, lensed, options, labels);
  const backdrop = bendsBackdrop && refractsBackdrop() ? createBackdropLens(lens, options) : null;
  let lensing = false;

  const mark = () => bar.toggleAttribute("data-away", active < 0 || Math.abs(state.x - active * slot) > 0.5);

  const measure = () => {
    const style = getComputedStyle(bar);
    padding = parseFloat(style.paddingLeft) || 0;
    slot = (bar.clientWidth - padding - (parseFloat(style.paddingRight) || 0)) / tabs.length;
    inset = parseFloat(style.getPropertyValue("--lg-thumb-inset")) || 0;
    width = slot - 2 * inset;
    height = lens.offsetHeight;
    growX = parseFloat(style.getPropertyValue("--lg-lens-grow-x")) || 0;
    growY = parseFloat(style.getPropertyValue("--lg-lens-grow-y")) || 0;
  };

  const paint = () => {
    const { x, lift } = state;
    const sx = 1 + (growX / width) * lift;
    const sy = 1 + (growY / height) * lift;
    const transform = `translateX(${x}px) scale(${sx}, ${sy})`;
    lens.style.transform = tint.style.transform = transform;
    if (thumbEl) thumbEl.style.transform = transform;
    lens.style.setProperty("--lg-lift", String(clamp(lift, 0, 1)));
    lens.style.setProperty("--lg-lift-y", String(sy));
    row.style.transform = `scale(${1 / sx}, ${1 / sy}) translate(${-x + (sx - 1) * (inset + width / 2)}px, ${(sy - 1) * (inset + height / 2)}px)`;
    if (!gesture && lift < 0.01) delete bar.dataset.refracting;
    mark();
    if (lift > 0.01 !== lensing) { lensing = lift > 0.01; bar.toggleAttribute("data-lensing", lensing); refraction.setActive(lensing); }
    const amount = clamp(lift, 0, 1);
    const under = clamp((lift - UNDER) / (1 - UNDER), 0, 1);
    lens.style.setProperty("--lg-rest", String(clamp(1 - lift / UNDER, 0, 1)));
    lens.style.setProperty("--lg-under", String(under));
    bar.toggleAttribute("data-under", lift > UNDER);
    refraction.update(amount);
    backdrop?.update(under);
  };

  const x = createSpring(0, REST[0], REST[1], v => { state.x = v; paint(); });
  const lift = createSpring(0, REST[2], REST[3], v => { state.lift = v; paint(); });

  const move = (target, lifted, instant = false) => {
    const [ss, sd, ls, ld] = gesture ? DRAG : REST;
    x.tune(ss, sd); lift.tune(ls, ld);
    x.set(target, instant); lift.set(lifted ? 1 : 0, instant);
  };

  const settle = (instant = false) => {
    mark();
    if (gesture) return;
    const show = active >= 0;
    if (show) delete bar.dataset.hidden; else bar.dataset.hidden = "";
    if (show) move(active * slot, false, instant || !shown);
    shown = show;
  };

  const position = e => clamp(gesture.anchor + e.clientX - gesture.x, 0, slot * (tabs.length - 1));
  const light = (e, box) => {
    glass.style.setProperty("--lg-x", `${clamp(((e.clientX - box.left) / box.width) * 100, 0, 100)}%`);
    lens.style.setProperty("--lg-x", `${clamp(((e.clientX - box.left - padding - inset - state.x) / width) * 100, 0, 100)}%`);
  };
  const release = () => {
    const old = gesture;
    gesture = null;
    delete bar.dataset.lifted;
    delete lens.dataset.pressed;
    if (old && bar.hasPointerCapture(old.id)) bar.releasePointerCapture(old.id);
    return old;
  };
  let suppressClick = false;

  bar.addEventListener("pointerdown", e => {
    const tab = e.target.closest(".lg-tab");
    if (!e.isPrimary || e.button !== 0 || gesture || !tab) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    cancelAnimationFrame(settleFrame); settleFrame = 0;
    measure();
    bar.toggleAttribute("data-light", parseFloat(getComputedStyle(lens).getPropertyValue("--lg-lens-shine")) < 0);
    backdrop?.refit();
    const box = bar.getBoundingClientRect();
    gesture = { id: e.pointerId, x: e.clientX, anchor: tabs.indexOf(tab) * slot, moved: false, box, at: performance.now() };
    suppressClick = false;
    bar.dataset.lifted = ""; bar.dataset.refracting = "";
    delete bar.dataset.hidden;
    lens.dataset.pressed = "";
    light(e, box);
    move(gesture.anchor, true, !shown);
    shown = true;
  });
  window.addEventListener("pointermove", e => {
    if (e.pointerId !== gesture?.id) return;
    if (!gesture.moved && Math.abs(e.clientX - gesture.x) > 6) { gesture.moved = true; bar.setPointerCapture(e.pointerId); }
    if (gesture.moved) move(position(e), true);
    light(e, gesture.box);
  });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  bar.addEventListener("lostpointercapture", end);
  function end(e) {
    if (e.pointerId !== gesture?.id) return;
    if (e.type === "lostpointercapture" && e.target !== bar) return;
    const index = Math.round(position(e) / slot);
    const released = release();
    const { moved, box } = released;
    const near = e.clientY >= box.top - 24 && e.clientY <= box.bottom + 24;
    if (e.type === "pointerup" && (moved || near)) {
      suppressClick = true;
      settleFrame = requestAnimationFrame(() => { settleFrame = 0; settle(); });
      tabs[index]?.click();
    } else { suppressClick = moved; settle(); }
  }
  bar.addEventListener("touchmove", e => { if (gesture && e.cancelable && HOLD(gesture.at, gesture.moved)) e.preventDefault(); }, { passive: false });
  bar.addEventListener("click", e => {
    if (e.isTrusted && suppressClick && e.detail !== 0) { suppressClick = false; e.preventDefault(); return; }
    const tab = e.target.closest(".lg-tab");
    if (!tab || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const index = tabs.indexOf(tab);
    if (tab instanceof HTMLAnchorElement) { active = index; settle(); }
    select(index);
  }, true);
  bar.addEventListener("keydown", e => {
    const tab = e.target.closest(".lg-tab");
    if (!tab || tab instanceof HTMLAnchorElement || !SEG_KEYS.includes(e.key)) return;
    e.preventDefault();
    const current = tabs.indexOf(tab);
    const index = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (current + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    select(index);
    tabs[index]?.focus();
  });
  const reset = () => { cancelAnimationFrame(settleFrame); settleFrame = 0; release(); settle(true); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  window.addEventListener("blur", reset);
  const observer = new ResizeObserver(() => { measure(); if (!gesture) settle(true); });

  measure();
  observer.observe(bar);

  return {
    setActive(index) { cancelAnimationFrame(settleFrame); settleFrame = 0; active = index; settle(); },
    destroy() {
      cancelAnimationFrame(settleFrame);
      x.stop(); lift.stop(); refraction.destroy(); backdrop?.destroy();
      observer.disconnect();
      for (const k of ["ready","hidden","lifted","refracting","lensing","away","light","under"]) delete bar.dataset[k];
    }
  };
}

/* ═══════════════════════════════════════════════════════════════
   Press feedback (from internal/press.ts)
   ═══════════════════════════════════════════════════════════════ */
const POINTER_FEEL = { grow: 6, press: [417.6, 29.2], release: [230, 23.7] };
const TOUCH_FEEL = { grow: 15, press: [515, 27.3], release: [250, 11.8] };

function applyPressFeedback(el) {
  const value = [1, 1, 0, 0];
  const paint = () => { el.style.scale = `${value[0]} ${value[1]}`; el.style.translate = `${value[2]}px ${value[3]}px`; };
  const springs = value.map((initial, i) => createSpring(initial, ...POINTER_FEEL.release, next => { value[i] = next; paint(); }));
  let pointer = null;

  const target = (next, [stiffness, damping]) => {
    springs.forEach((s, i) => { s.tune(stiffness, damping); s.set(next[i] ?? 0); });
  };
  const track = e => {
    if (!pointer) return;
    const { box, feel } = pointer;
    el.style.setProperty("--lg-x", `${((e.clientX - box.left) / box.width) * 100}%`);
    el.style.setProperty("--lg-y", `${((e.clientY - box.top) / box.height) * 100}%`);
    const { width, height } = box;
    const base = 1 + feel.grow / Math.max(width, height);
    const aspect = width / height;
    const dx = (e.clientX - pointer.x) / aspect;
    const dy = e.clientY - pointer.y;
    const len = Math.hypot(dx, dy);
    if (!len) return target([base, base, 0, 0], feel.press);
    const nx = dx / len, ny = dy / len;
    const rubber = 1 - 1 / (1 + len / height / (5 * aspect));
    const stretch = 1 + (6 / height) * rubber * Math.abs(Math.abs(nx) - Math.abs(ny));
    const horizontal = Math.abs(nx) > Math.abs(ny);
    target([base * (horizontal ? stretch : 1 / stretch), base * (horizontal ? 1 / stretch : stretch), nx * 8 * rubber, ny * 8 * rubber], feel.press);
  };
  const move = e => { if (e.pointerId === pointer?.id) track(e); };
  const endFn = e => {
    if (e && e.pointerId !== pointer?.id) return;
    const feel = pointer?.feel ?? POINTER_FEEL;
    pointer = null;
    delete el.dataset.pressed;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", endFn);
    window.removeEventListener("pointercancel", endFn);
    target([1, 1, 0, 0], feel.release);
  };
  el.addEventListener("pointerdown", e => {
    if (!e.isPrimary || e.button !== 0 || pointer || el.matches(":disabled")) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, box: el.getBoundingClientRect(), feel: e.pointerType === "mouse" ? POINTER_FEEL : TOUCH_FEEL };
    el.dataset.pressed = "";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", endFn);
    window.addEventListener("pointercancel", endFn);
    track(e);
  });
  window.addEventListener("blur", endFn);
}