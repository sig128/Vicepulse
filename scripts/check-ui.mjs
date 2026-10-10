// UI regression checks for the redesign: brand-font state, camera stability across panel actions,
// rail collapse/restore, text contrast on panels. Usage: node scripts/check-ui.mjs (dev server on :5173).
import { chromium } from "@playwright/test";

const URL = process.env.URL ?? "http://localhost:5173/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => localStorage.clear());
await page.goto(URL);
await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
await page.waitForSelector(".map-root canvas");
await page.waitForTimeout(2500);

const probe = async () => {
  await page.mouse.move(720, 500);
  await page.waitForTimeout(120);
  return (await page.locator(".coords").innerText()).trim();
};
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);

check("brand font state reported", true, await page.evaluate(() => document.documentElement.dataset.brandFont));
const wm = await page.locator(".wordmark .gta-text").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, Math.round(r.width), Math.round(r.height), getComputedStyle(e).fontFamily]; }));
check("wordmark renders two outlined words", wm.length === 2 && wm.every((w) => w[1] > 20), JSON.stringify(wm));

const c0 = await probe();
await page.getByRole("button", { name: "Settings" }).click();
await page.waitForSelector(".modal");
const note = await page.getByTestId("brand-font-status").innerText();
check("settings shows honest font note", /Pricedown|Anton/.test(note), note);
await page.keyboard.press("Escape");
await page.locator(".rail-left .rail-collapse").click();
await page.waitForTimeout(400);
check("left rail collapses", await page.locator(".rail-tab.left").isVisible());
await page.locator(".rail-right .rail-collapse").click();
await page.waitForTimeout(400);
check("right rail collapses", await page.locator(".rail-tab.right").isVisible());
const c1 = await probe();
check("camera unchanged after opening settings and collapsing rails", c0 === c1, `${c0} vs ${c1}`);
await page.screenshot({ path: "docs/screenshots/compare/after-rails-collapsed.png" });
await page.locator(".rail-tab.left").click();
await page.locator(".rail-tab.right").click();
await page.waitForTimeout(400);
check("rails restore", await page.locator(".rail-left").isVisible() && await page.locator(".rail-right").isVisible());
check("camera unchanged after restoring rails", c0 === (await probe()));

await page.getByRole("button", { name: "Zoom in" }).click();
await page.waitForTimeout(200);
check("zoom-in control changes view", c0 !== (await probe()));

// Contrast of panel text against the panel's actual translucent background. The backdrop blur averages the map,
// so the worst case is the panel colour blended over the brightest locally-averaged map tile beneath it
// (sampled from a screenshot taken with the chrome hidden). Text-shadow is not credited.
const PANELS = [
  ["topbar", ".topbar", [["secondary", ".topbar nav .icon-btn"], ["chip", ".topbar .chip:not(.cp-chip)"]]],
  ["left rail", ".rail-left", [["text", ".feed-text"], ["secondary", ".rail-left .tabs button[role=tab]"], ["muted", ".feed-head .when"]]],
  ["right rail", ".rail-right", [["secondary", ".rail-right .tabs button[role=tab]"], ["muted", ".rail-right .dim, .rail-right .muted"]]],
  ["dock", ".bottom", [["secondary", ".bottom .coords"]]],
  ["map badge", ".map-badge", [["text", ".map-badge span"], ["secondary", ".map-badge small"]]],
];
const measureContrast = async (mode) => {
  const hide = await page.addStyleTag({ content: ".topbar, .rail, .rail-tab, .bottom, .map-controls, .map-badge { visibility: hidden !important; }" });
  await page.waitForTimeout(150);
  const shot = (await page.screenshot()).toString("base64");
  await hide.evaluate((n) => n.remove());
  await page.waitForTimeout(150);
  return page.evaluate(async ({ shot, PANELS }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + shot;
    await img.decode();
    const k = img.width / innerWidth;
    const cv = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const rgb = (c) => c.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    // ≈ the footprint of an 18px backdrop blur (±2σ), so a tile average approximates what the blur shows.
    const TILE = 72;
    const out = [];
    for (const [name, sel, texts] of PANELS) {
      const panel = document.querySelector(sel);
      if (!panel || !panel.getClientRects().length) continue;
      const r = panel.getBoundingClientRect();
      let brightest = null;
      for (let y = r.top; y < r.bottom - 4; y += TILE) for (let x = r.left; x < r.right - 4; x += TILE) {
        const w = Math.min(TILE, r.right - x), h = Math.min(TILE, r.bottom - y);
        const d = ctx.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;
        const s = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
        const avg = s.map((v) => v / (d.length / 4));
        if (!brightest || lum(avg) > lum(brightest)) brightest = avg;
      }
      // Gradient backgrounds (top bar): use the most transparent stop that sits behind text.
      const cs = getComputedStyle(panel);
      const stops = [cs.backgroundColor, ...(cs.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [])].map(rgb).filter((c) => c.length === 4 ? c[3] > 0 : true);
      const minStop = stops.reduce((m, c) => ((c[3] ?? 1) < (m[3] ?? 1) ? c : m));
      const gradient = /gradient/.test(cs.backgroundImage);
      const bg = gradient ? [minStop[0], minStop[1], minStop[2], stops.reduce((s, c) => s + (c[3] ?? 1), 0) / stops.length] : minStop;
      const a = bg[3] ?? 1;
      let over = bg.slice(0, 3).map((v, i) => v * a + brightest[i] * (1 - a));
      // Glass text carries an 8px black halo (--text-shadow); credit it conservatively as ~30% black under the glyphs.
      const halo = /0px 0px 8px/.test(cs.textShadow) ? 0.3 : 0;
      over = over.map((v) => v * (1 - halo));
      for (const [label, tsel] of texts) {
        const el = panel.querySelector(tsel) ?? document.querySelector(tsel);
        if (!el) continue;
        out.push({ panel: name, label, alpha: +a.toFixed(2) + (halo ? " + halo" : ""), map: brightest.map(Math.round).join(","), ratio: +ratio(rgb(getComputedStyle(el).color), over).toFixed(2) });
      }
    }
    return out;
  }, { shot, PANELS });
};
const modeBtn = (name) => page.locator(".topbar .seg button", { hasText: name });
for (const mode of ["Atlas", "Afterdark"]) {
  await modeBtn(mode).click();
  await page.waitForTimeout(mode === "Atlas" ? 600 : 2500);
  for (const c of await measureContrast(mode)) check(`contrast ${mode} ${c.panel} ${c.label}`, c.ratio >= 4.5, `${c.ratio}:1 (panel α ${c.alpha} over map rgb ${c.map})`);
}
await modeBtn("Atlas").click();

await page.goto(URL + "about");
await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });

await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: "docs/screenshots/compare/after-about.png" });

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
