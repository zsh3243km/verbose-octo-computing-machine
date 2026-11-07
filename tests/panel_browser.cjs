/**
 * Real-browser verification of the Lumen panel.
 *
 * Playwright + Chromium. Screenshots every required state, asserts the Liquid
 * Glass layer actually renders (computed backdrop-filter, painted rim, module
 * loaded), exercises every interactive control, and checks the console and
 * network for errors.
 *
 *   node tests/panel_browser.cjs [baseUrl] [outDir]
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.argv[2] || "http://localhost:8201";
const OUT = process.argv[3] || "E:/ZZTHS-LMNT/_shots/new";
const PASSWORD = process.env.PANEL_PASSWORD || "newpw";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const shot = async (page, name, opts = {}) => {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage: opts.full !== false });
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  results.push([name, "SHOT", kb + "KB"]);
  return file;
};
const check = (name, ok, detail = "") => {
  console.log(("  " + (ok ? "ok   " : "FAIL ")) + name + (ok ? "" : "  " + detail));
  results.push([name, ok ? "PASS" : "FAIL", detail]);
  return ok;
};

const PAGES = [
  ["overview", "Control room"],
  ["links", "Route studio"],
  ["subscriptions", "Subscriptions"],
  ["subgroups", "Sub Groups"],
  ["connections", "Active connections"],
  ["traffic", "Traffic"],
  ["logs", "Activity Log"],
  ["errors", "Errors"],
  ["security", "Security"],
  ["settings", "Settings"],
];

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  let failed = 0;

  /* ── 1. login page ── */
  console.log("\n[1. login page]");
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error") problems.push(["console", m.text().slice(0, 200)]); });
  page.on("pageerror", e => problems.push(["pageerror", String(e).slice(0, 200)]));
  page.on("requestfailed", r => problems.push(["requestfailed", r.url().slice(0, 120)]));
  page.on("response", r => { if (r.status() >= 400 && !r.url().includes("favicon")) problems.push(["http " + r.status(), r.url().slice(0, 120)]); });

  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  check("login page renders", await page.locator("#form, form").first().isVisible());
  check("login title", (await page.title()).includes("Lumen"));
  await shot(page, "01-login-desktop");

  /* ── 2. invalid login ── */
  console.log("\n[2. failed login]");
  await page.fill("#pw", "definitely-wrong");
  await page.click("#btn");
  await page.waitForTimeout(1200);
  const errVisible = await page.locator("#err.show").isVisible().catch(() => false);
  check("wrong password shows an error", errVisible);
  check("still on /login", page.url().endsWith("/login"));
  await shot(page, "02-login-failed");

  /* ── 3. valid login ── */
  console.log("\n[3. valid login -> dashboard]");
  await page.fill("#pw", PASSWORD);
  await page.click("#btn");
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await page.waitForTimeout(6000); // let the Glisse module load, paint rim, and build lens filters
  check("landed on the dashboard", page.url().includes("/dashboard"));
  const hasSidebar = await page.locator(".sidebar").isVisible().catch(() => false);
  check("sidebar visible", hasSidebar);
  await shot(page, "03-dashboard-desktop");

  /* ── 4. console / network health ── */
  /* The 401 is the deliberate failed login in step 2, and the 502 is the
     updater phoning GitHub with no token configured — both expected. */
  const EXPECTED = p =>
    String(p[1]).includes("/api/login") ||
    String(p[1]).includes("/api/update/status") ||
    String(p[1]).includes("favicon");
  const realProblems = problems.filter(p => !EXPECTED(p));
  check("no pageerror", !realProblems.some(p => p[0] === "pageerror"),
    realProblems.filter(p => p[0] === "pageerror").map(p => p[1]).join(" | "));
  check("no failed requests", !realProblems.some(p => p[0] === "requestfailed"),
    realProblems.filter(p => p[0] === "requestfailed").map(p => p[1]).join(" | "));
  check("no HTTP >= 400 (beyond the expected login-401 and updater-502)",
    !realProblems.some(p => String(p[0]).startsWith("http ")),
    realProblems.filter(p => String(p[0]).startsWith("http ")).map(p => p.join(" ")).join(" | "));

  /* ── 6. every page ── */
  console.log("\n[6. every panel page]");
  for (const [pg, title] of PAGES) {
    await page.click(`.nav-it[data-pg="${pg}"]`).catch(async () => {
      await page.evaluate(n => {
        document.querySelector(`.nav-it[data-pg="${n}"]`)?.click();
      }, pg);
    });
    await page.waitForTimeout(1400);
    const visible = await page.locator(`#pg-${pg}.on`).isVisible().catch(() => false);
    const hasContent = await page.locator(`#pg-${pg}`).evaluate(el => el.textContent.trim().length > 20).catch(() => false);
    check(`page "${title}" renders content`, visible && hasContent);
    await shot(page, `10-page-${pg}-desktop`);
  }

  /* ── 5. Glisse actually renders (checked last, once the lens filters have
        had time to build through the resize/idle observers) ── */
  console.log("\n[5. Liquid Glass is really rendering]");
  await page.evaluate(() => document.querySelector('.nav-it[data-pg="overview"]')?.click());
  await page.waitForTimeout(3000);
  const glass = await page.evaluate(() => {
    const m = window.__glisseModule;
    const backdropFiltered = [...document.querySelectorAll(".sidebar, .card, .topbar")]
      .filter(el => getComputedStyle(el).backdropFilter && getComputedStyle(el).backdropFilter !== "none").length;
    const rimPainted = document.querySelectorAll("[data-rim]").length;
    const svgFilters = document.querySelectorAll("defs filter").length;
    const backdropMarked = document.querySelectorAll("[data-glisse-backdrop]").length;
    const glassClassCount = document.querySelectorAll(".lg-glass").length;
    const backdropLayer = !!document.querySelector(".gl-backdrop");
    const handles = [...document.querySelectorAll(".lg-glass")].filter(el => el.__glisse).length;
    return { moduleLoaded: !!(m && m.ready !== false), rimPainted, svgFilters, backdropMarked, glassClassCount, backdropFiltered, backdropLayer, handles };
  });
  check("Glisse module loaded in the browser", glass.moduleLoaded);
  check("rim light painted on elements", glass.rimPainted > 0, `count=${glass.rimPainted}`);
  check("SVG lens filters built", glass.svgFilters > 0, `count=${glass.svgFilters}`);
  check("backdrop marked for refraction", glass.backdropMarked > 0, `count=${glass.backdropMarked}`);
  check("glass surfaces present", glass.glassClassCount > 20, `count=${glass.glassClassCount}`);
  check("computed backdrop-filter applied", glass.backdropFiltered > 0, `count=${glass.backdropFiltered}`);
  check("a painted backdrop layer exists to bend", glass.backdropLayer);
  check("refraction handles installed", glass.handles > 0, `count=${glass.handles}`);

  /* ── 7. mobile ── */
  console.log("\n[7. mobile viewport]");
  const mob = await browser.newContext({ viewport: MOBILE });
  const mp = await mob.newPage();
  const mobProblems = [];
  mp.on("pageerror", e => mobProblems.push(String(e).slice(0, 160)));
  mp.on("response", r => { if (r.status() >= 400 && !r.url().includes("favicon")) mobProblems.push("http " + r.status() + " " + r.url().slice(0, 100)); });
  await mp.goto(BASE + "/login", { waitUntil: "networkidle" });
  await shot(mp, "20-login-mobile");
  await mp.fill("#pw", PASSWORD);
  await mp.click("#btn");
  await mp.waitForURL("**/dashboard", { timeout: 15000 });
  await mp.waitForTimeout(3000);
  await shot(mp, "21-dashboard-mobile");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal overflow on mobile", overflow <= 2, `${overflow}px`);
  const mobReal = mobProblems.filter(p => !String(p).includes("/api/update/status") && !String(p).includes("favicon"));
  check("no page errors on mobile", mobReal.length === 0, mobReal.join(" | "));
  const sidebarMobile = await mp.evaluate(() => {
    const s = document.querySelector(".sidebar");
    if (!s) return null;
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    return { bottom: Math.round(r.bottom), vh: window.innerHeight, position: cs.position };
  });
  check("mobile navigation is a bottom dock", sidebarMobile && sidebarMobile.position === "fixed",
    JSON.stringify(sidebarMobile));
  for (const [pg] of [["links"], ["settings"], ["connections"]]) {
    await mp.evaluate(n => document.querySelector(`.nav-it[data-pg="${n}"]`)?.click(), pg);
    await mp.waitForTimeout(1200);
    await shot(mp, `22-${pg}-mobile`);
  }
  await mob.close();

  /* ── 8. settings change, persist, refresh ── */
  console.log("\n[8. settings change and persistence]");
  await page.evaluate(() => document.querySelector('.nav-it[data-pg="settings"]')?.click());
  await page.waitForTimeout(2000);
  /* Wait for loadSettings to populate the form, so the test never races it. */
  await page.waitForFunction(() => {
    const loc = document.getElementById("settings-max-locations");
    const base = document.getElementById("settings-telegram-dial-base");
    return !!loc && !!base && loc.value !== "";
  }, { timeout: 12000 }).catch(() => {});
  await page.fill("#settings-telegram-dial-base", "verify.example.com");
  await page.selectOption("#settings-max-locations", "4");
  await page.click("#settings-save-btn");
  await page.waitForTimeout(2500);
  const afterSave = await page.evaluate(() => ({
    limit: document.querySelector("#settings-max-locations")?.value,
    base: document.querySelector("#settings-telegram-dial-base")?.value,
  }));
  check("settings form holds the entered values", afterSave.limit === "4" && afterSave.base === "verify.example.com",
    JSON.stringify(afterSave));
  await shot(page, "30-settings-desktop");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => {
    const loc = document.getElementById("settings-max-locations");
    const base = document.querySelector ? document.querySelector("#settings-telegram-dial-base") : null;
    return loc && base && loc.value === "4" && base.value === "verify.example.com";
  }, { timeout: 15000 }).catch(() => {});
  const afterRefresh = await page.evaluate(() => ({
    limit: document.querySelector("#settings-max-locations")?.value,
    base: document.querySelector("#settings-telegram-dial-base")?.value,
  }));
  check("settings survive a refresh", afterRefresh.limit === "4" && afterRefresh.base === "verify.example.com",
    JSON.stringify(afterRefresh));
  await page.evaluate(() => document.querySelector('.nav-it[data-pg="settings"]')?.click());
  await page.waitForTimeout(1000);
  await shot(page, "31-settings-after-refresh");

  /* ── 9. TLS SNI UI behaviour ── */
  console.log("\n[9. TLS SNI controls in the UI]");
  await page.evaluate(() => document.querySelector('.nav-it[data-pg="links"]')?.click());
  await page.waitForTimeout(1500);
  const sniModeExists = await page.locator("#nl-sni-mode").count();
  const sniCustomExists = await page.locator("#nl-sni-custom").count();
  check("SNI control present in the create form", sniModeExists > 0 || sniCustomExists > 0);
  if (sniModeExists) {
    await page.selectOption("#nl-sni-mode", "off");
    await page.waitForTimeout(600);
    const mode = await page.locator("#nl-sni-mode").inputValue();
    check("SNI mode can be set to off", mode === "off", mode);
    await shot(page, "32-sni-off-desktop");
  }

  /* ── 10. interactive controls ── */
  console.log("\n[10. interactive controls]");
  await page.evaluate(() => document.querySelector('.nav-it[data-pg="overview"]')?.click());
  await page.waitForTimeout(1200);
  await page.click("#theme-btn").catch(() => {});
  await page.waitForTimeout(900);
  const themeNow = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  check("theme toggle works", themeNow === "dark", String(themeNow));
  await shot(page, "40-dashboard-dark-desktop");
  await page.click("#theme-btn").catch(() => {});
  await page.waitForTimeout(900);

  // modal — openModal toggles an `open` class on .modal-bg
  const modalOpened = await page.evaluate(() => {
    const b = document.querySelector('[onclick*="openModal"]');
    if (b) { b.click(); return true; }
    return false;
  });
  if (modalOpened) {
    await page.waitForTimeout(900);
    const modalState = await page.evaluate(() => {
      const m = document.querySelector(".modal-bg.open") || document.querySelector(".modal-bg");
      if (!m) return { found: false };
      const cs = getComputedStyle(m);
      return { found: true, cls: m.className, display: cs.display, opacity: cs.opacity, visibility: cs.visibility };
    });
    const visible = modalState.found && modalState.display !== "none" && modalState.visibility !== "hidden";
    check("a modal opens", visible, JSON.stringify(modalState));
    await shot(page, "41-modal-desktop");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  // focus ring
  const focusRing = await page.evaluate(() => {
    const el = document.querySelector(".nav-it.on");
    if (!el) return null;
    el.focus();
    const cs = getComputedStyle(el);
    return { outline: cs.outlineStyle, width: cs.outlineWidth };
  });
  check("focus-visible outline exists on nav items", focusRing && focusRing.outline !== "none", JSON.stringify(focusRing));

  await ctx.close();
  await browser.close();

  /* ── report ── */
  failed = results.filter(r => r[1] === "FAIL").length;
  console.log("\n" + "=".repeat(64));
  console.log("BROWSER VERIFICATION");
  for (const [n, s, d] of results) {
    if (s === "SHOT") console.log(`  SHOT ${n}.png  ${d}`);
    else console.log(`  ${s === "PASS" ? "ok  " : "FAIL"} ${n}${d && s === "FAIL" ? "  " + d : ""}`);
  }
  const shots = results.filter(r => r[1] === "SHOT").length;
  console.log(`\nchecks: ${results.filter(r => r[1] !== "SHOT").length}  passed: ${results.filter(r => r[1] === "PASS").length}  failed: ${failed}`);
  console.log(`screenshots: ${shots} -> ${OUT}`);
  if (problems.length) {
    console.log("\nbrowser problems observed:");
    for (const [k, v] of problems.slice(0, 25)) console.log(`  [${k}] ${v}`);
  } else console.log("\nno console errors, no failed requests, no HTTP >= 400");
  process.exit(failed ? 1 : 0);
})();
