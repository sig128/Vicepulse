// Verifies the entrance frame + VICEPULSE shimmer loader and the expand-to-full-bleed reveal against the dev server (:5173).
// Network conditions are simulated with Playwright routing: a held overview (to observe the loader), a failing
// overview (error → Retry / Continue) and a hanging atlas request (slow state).
// Usage: PLAYWRIGHT_BROWSERS_PATH=... node scripts/check-entrance.mjs
import fs from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.URL ?? "http://localhost:5173/";
const OUT = "docs/screenshots/compare";
const OVERVIEW = "**/generated/yanis16-overview.png";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
// Hardware GL (macOS ANGLE/Metal): software GL in headless runs at ~3–5 fps and makes transition timing meaningless.
const browser = await chromium.launch(process.platform === "darwin" ? { args: ["--use-angle=metal", "--enable-gpu"] } : {});

async function open(viewport, dpr, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion: opts.reducedMotion ?? "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text()) && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.clear());
  return { ctx, page, errors };
}

/** Hold the overview PNG until release() so the loader stays up. */
async function hold(page) {
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route(OVERVIEW, async (route) => { await gate; await route.continue().catch(() => {}); });
  return () => release();
}

const state = (page) => page.evaluate(() => {
  const app = document.querySelector(".app"), ent = document.querySelector(".entrance"), wm = document.querySelector(".entrance .wm");
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
  // Glyph ink box (not the advance box): measure the rendered text with a Range.
  let ink = null;
  // The range includes the trailing letter-spacing after the last glyph; drop it to get the visible glyph run.
  if (wm?.firstChild) { const rg = document.createRange(); rg.selectNodeContents(wm); const b = rg.getBoundingClientRect(); const ls = parseFloat(getComputedStyle(wm).letterSpacing) || 0; const w = b.width - ls; ink = { x: b.x, w, cx: b.x + w / 2, cy: b.y + b.height / 2, size: parseFloat(getComputedStyle(wm).fontSize) }; }
  const cs = getComputedStyle(app);
  const after = wm && getComputedStyle(wm, "::after");
  const canvas = document.querySelector(".map-root canvas");
  const header = document.querySelector(".topbar");
  return {
    cls: document.documentElement.className, app: r(app), ent: r(ent), wm: r(wm), ink, clip: cs.clipPath, radius: cs.borderTopLeftRadius,
    shimmer: after && { name: after.animationName, display: after.display, content: after.content, shadow: after.textShadow, filter: after.filter },
    text: wm?.textContent, wmOpacity: wm && getComputedStyle(wm).opacity, wmFont: wm && getComputedStyle(wm).fontFamily,
    frameShadow: !!document.querySelector(".frame-shadow") || getComputedStyle(app).boxShadow !== "none",
    vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight,
    canvas: canvas && { cw: canvas.clientWidth, ch: canvas.clientHeight, w: canvas.width, h: canvas.height, dpr: devicePixelRatio },
    header: r(header),
  };
});

// Reads screenshot pixels by decoding the PNG in the page, so no image library is needed.
const pixels = (page, buf, pts) => page.evaluate(async ([b64, pts]) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  return pts.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]);
}, [buf.toString("base64"), pts]);
const SURROUND = [0xf5, 0xef, 0xe6];
const near = (px, ref, tol = 3) => px.every((v, i) => Math.abs(v - ref[i]) <= tol);
const isDark = (px) => Math.max(...px) < 60;

// Dispatched straight to the map element so it also works while the entrance overlay covers the map.
const probe = async (page, x, y) => {
  await page.evaluate(([x, y]) => document.querySelector(".map-root").dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true, pointerId: 1 })), [x, y]);
  await page.waitForTimeout(200);
  return (await page.locator(".coords").innerText().catch(() => "")).trim();
};

async function flow(label, viewport, dpr, expect) {
  const { ctx, page, errors } = await open(viewport, dpr);
  const release = await hold(page);
  await page.goto(BASE + (expect.deepLink ? "?marker=L588" : ""));
  await page.waitForSelector("[data-testid=entrance]");
  await page.waitForFunction(() => document.documentElement.classList.contains("vp-fonts"));
  await page.waitForTimeout(1100); // mid-sweep
  const s = await state(page);
  check(`${label}: framed while loading`, s.cls.includes("booting") && s.clip.includes(`inset(${expect.gap}px round ${expect.radius}px)`), s.clip);
  check(`${label}: no frame shadow element or box-shadow`, !s.frameShadow);
  {
    const dpr0 = dpr, g = expect.gap, r = expect.radius, W = s.vw, H = s.vh;
    const shot = await page.screenshot({ clip: { x: W - g - r - 40, y: H - g - r - 40, width: g + r + 40, height: g + r + 40 } });
    fs.writeFileSync(`${OUT}/frame-${label}-corner.png`, shot);
    const ox = W - g - r - 40, oy = H - g - r - 40, P = (x, y) => [(x - ox) * dpr0, (y - oy) * dpr0];
    const band = [];
    for (let i = 1; i < g; i += Math.max(1, Math.floor(g / 6))) {
      band.push(P(W - i, H - g - r - 20), P(W - g - r - 20, H - i), P(W - i, H - i)); // right band, bottom band, corner square
    }
    const k = r * (1 - Math.SQRT1_2) * 0.6; // inside the corner square but outside the rounded arc
    band.push(P(W - g - k, H - g - k), P(W - g + 1, H - g - r - 10), P(W - g - r - 10, H - g + 1));
    const px = await pixels(page, shot, band);
    const bad = px.filter((p) => !near(p, SURROUND));
    check(`${label}: surround is clean off-white right up to the frame edge (no grey band)`, bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 4)) : `${px.length} samples = #F5EFE6`);
  }
  check(`${label}: wordmark reads VICEPULSE`, s.text === "VICEPULSE" && s.shimmer.content === '"VICEPULSE"', `${s.text} / ${s.shimmer.content}`);
  check(`${label}: wordmark centred (ink box)`, Math.abs(s.ink.cx - s.ent.cx) <= 1 && Math.abs(s.wm.cy - s.ent.cy) <= 1, `Δx=${(s.ink.cx - s.ent.cx).toFixed(2)} Δy=${(s.wm.cy - s.ent.cy).toFixed(2)} (frame centre = viewport centre)`);
  const frameL = expect.gap, frameR = s.vw - expect.gap;
  check(`${label}: wordmark fits inside frame with padding, one line`, s.ink.x > frameL + 16 && s.ink.x + s.ink.w < frameR - 16 && s.wm.h < parseFloat(getComputedStyleFont(s)) * 1.6, `ink ${s.ink.x.toFixed(0)}–${(s.ink.x + s.ink.w).toFixed(0)} in ${frameL}–${frameR}, h=${s.wm.h.toFixed(0)}`);
  check(`${label}: no horizontal overflow`, s.docW <= s.vw, `${s.docW} vs ${s.vw}`);
  const share = s.ink.w / (s.vw - 2 * expect.gap);
  check(`${label}: logo-sized (${expect.share[0] * 100}–${expect.share[1] * 100}% of frame width)`, share >= expect.share[0] && share <= expect.share[1], `${s.ink.size}px font, ${(share * 100).toFixed(1)}% of frame`);
  check(`${label}: shimmer running, clipped layer has no shadow/filter`, s.shimmer.name === "vp-shimmer" && s.shimmer.shadow === "none" && s.shimmer.filter === "none");
  check(`${label}: font stack`, /Pricedown/.test(s.wmFont), s.wmFont);
  await page.screenshot({ path: `${OUT}/frame-${label}-loading.png` });
  await page.screenshot({ path: `${OUT}/loader-${label}-wordmark.png`, clip: { x: s.wm.x - 30, y: s.wm.y - 30, width: s.wm.w + 60, height: s.wm.h + 60 } });
  const before = expect.probe ? await probe(page, ...expect.probe) : null;

  release();
  await page.waitForFunction(() => document.documentElement.classList.contains("revealing"), null, { timeout: 20000 });
  const greys = [];
  let mid;
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(i === 0 ? 80 : 60);
    const shot = await page.screenshot();
    if (i === 0) mid = await state(page);
    fs.writeFileSync(`${OUT}/frame-${label}-mid-${i + 1}.png`, shot);
    const W = s.vw, H = s.vh, d = dpr;
    const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W - 3, H - 3], [W - 6, H - 2]].map(([x, y]) => [x * d, y * d]);
    for (const p of await pixels(page, shot, corners)) if (!near(p, SURROUND, 4) && !isDark(p)) greys.push(p);
  }
  check(`${label}: no grey at any corner mid-expansion`, greys.length === 0, greys.length ? JSON.stringify(greys.slice(0, 4)) : "4 frames × 6 corner pixels: off-white or frame only");
  check(`${label}: mid-transition frame expanding`, /inset\(/.test(mid.clip) && !mid.clip.includes(`${expect.gap}px round ${expect.radius}px`), mid.clip);
  await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 5000 });
  await page.waitForFunction(() => !document.documentElement.classList.contains("revealing"), null, { timeout: 3000 });
  await page.waitForTimeout(300);
  const f = await state(page);
  await page.screenshot({ path: `${OUT}/frame-${label}-final.png` });
  check(`${label}: final .app == viewport`, f.app.x === 0 && f.app.y === 0 && f.app.w === f.vw && f.app.h === f.vh, JSON.stringify(f.app));
  check(`${label}: final no clip/radius`, f.clip === "none" && f.radius === "0px", `${f.clip} / ${f.radius}`);
  check(`${label}: no scrollbars`, f.docW <= f.vw && f.docH <= f.vh, `${f.docW}×${f.docH} vs ${f.vw}×${f.vh}`);
  check(`${label}: header spans viewport`, Math.round(f.header.x) === 0 && Math.round(f.header.w) === f.vw, JSON.stringify(f.header));
  const expectDpr = Math.min(2, dpr);
  check(`${label}: canvas full size, not stretched`, f.canvas.cw === f.vw && f.canvas.ch === f.vh && Math.abs(f.canvas.w - f.canvas.cw * expectDpr) <= 1, JSON.stringify(f.canvas));
  check(`${label}: canvas size unchanged by reveal`, s.canvas && s.canvas.w === f.canvas.w && s.canvas.h === f.canvas.h, `${s.canvas?.w}×${s.canvas?.h} → ${f.canvas.w}×${f.canvas.h}`);
  check(`${label}: no shadow after reveal`, !f.frameShadow);
  const hit = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(".map-root, .rail, .sheet") != null);
  check(`${label}: clicks reach the app`, hit);
  if (expect.probe) { const after = await probe(page, ...expect.probe); check(`${label}: camera unchanged by reveal`, before === after && before !== "", `${before} → ${after}`); }
  if (expect.deepLink) check(`${label}: L588 deep link still selected`, new URL(page.url()).searchParams.get("marker") === "L588" && /L588/.test(await page.locator(".rail-right").innerText()));
  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}
function getComputedStyleFont(s) { return Math.min(72, Math.max(36, s.vw * 0.05 + 16)); }

await flow("desktop", { width: 1440, height: 900 }, 2, { gap: 24, radius: 56, probe: [720, 500], deepLink: true, share: [0.15, 0.4] });
await flow("mobile", { width: 390, height: 844 }, 3, { gap: 10, radius: 28, probe: [195, 500], share: [0.3, 0.8] });

// Failure: overview aborts → framed error with Retry; Retry recovers and expands.
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 1);
  await page.route(OVERVIEW, (route) => route.abort());
  await page.goto(BASE);
  await page.waitForSelector("[data-testid=entrance][data-phase=error]", { timeout: 15000 });
  const s = await state(page);
  check("failure: stays framed", s.cls.includes("booting"));
  check("failure: shimmer static", s.shimmer.display === "none" || s.shimmer.name === "none", `${s.shimmer.name}/${s.shimmer.display}`);
  const msg = await page.locator(".entrance-help p").innerText();
  check("failure: message + Retry focused", /couldn't be loaded/i.test(msg) && (await page.evaluate(() => document.activeElement?.textContent)) === "Retry", msg);
  await page.screenshot({ path: `${OUT}/frame-error.png` });
  await page.unroute(OVERVIEW);
  await page.getByRole("button", { name: "Retry" }).click();
  await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  await page.waitForTimeout(800);
  const f = await state(page);
  check("failure: Retry recovers and expands to full-bleed", f.clip === "none" && f.app.w === f.vw);
  await ctx.close();
}

// Failure → Continue: same expansion, interface usable.
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 1);
  await page.route(OVERVIEW, (route) => route.abort());
  await page.goto(BASE);
  await page.waitForSelector("[data-testid=entrance][data-phase=error]", { timeout: 15000 });
  await page.getByRole("button", { name: "Continue to the site" }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("revealing"), null, { timeout: 2000 });
  await page.waitForSelector("[data-testid=entrance]", { state: "detached" });
  await page.waitForTimeout(800);
  const f = await state(page);
  await page.getByRole("button", { name: "Settings" }).click();
  check("continue: expands and interface usable", f.clip === "none" && (await page.locator(".modal").isVisible()));
  await ctx.close();
}

// Slow: atlas hangs → slow message after the threshold, shimmer stops, Retry/Continue offered.
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 1);
  await page.route("**/generated/atlas.json", () => { /* never answer */ });
  await page.goto(BASE);
  await page.waitForSelector("[data-testid=entrance][data-phase=slow]", { timeout: 16000 });
  const s = await state(page);
  check("slow: message + Retry/Continue, shimmer static", (await page.locator(".entrance-help button").count()) === 2 && s.shimmer.display === "none");
  await page.screenshot({ path: `${OUT}/frame-slow.png` });
  await ctx.close();
}

// Reduced motion: static wordmark, instant full-bleed.
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 1, { reducedMotion: "reduce" });
  const release = await hold(page);
  await page.goto(BASE);
  await page.waitForSelector("[data-testid=entrance]");
  await page.waitForTimeout(400);
  const s = await state(page);
  check("reduced motion: wordmark static", s.shimmer.display === "none" || s.shimmer.name === "none", `${s.shimmer.name}/${s.shimmer.display}`);
  release();
  await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  const f = await state(page);
  check("reduced motion: instant full-bleed (no revealing phase)", !f.cls.includes("revealing") && !f.cls.includes("booting") && f.clip === "none", f.cls);
  await ctx.close();
}

// Hold timing: reveal starts at max(real readiness, MIN_ENTRANCE_MS = 2800 ms from navigation start).
async function revealTiming(opts = {}) {
  const { ctx, page } = await open({ width: 1440, height: 900 }, 1, opts);
  await page.addInitScript(() => {
    const poll = setInterval(() => {
      const c = document.documentElement?.classList;
      if (c && !c.contains("booting") && document.readyState !== "loading") { window.__revealAt = performance.now(); clearInterval(poll); }
    }, 5);
  });
  if (opts.holdMs) await page.route(OVERVIEW, async (route) => { await new Promise((r) => setTimeout(r, opts.holdMs)); await route.continue().catch(() => {}); });
  await page.goto(BASE);
  await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  const at = await page.evaluate(() => ({ reveal: Math.round(window.__revealAt), gone: Math.round(performance.now()) }));
  await ctx.close();
  return at;
}
{
  const fast = await revealTiming();
  check("hold: fast local load reveals at ≈2.8 s", fast.reveal >= 2800 && fast.reveal < 3300, `reveal started ${fast.reveal} ms after navigation, overlay removed by ${fast.gone} ms`);
  const slow = await revealTiming({ holdMs: 4000 });
  check("hold: slower-than-minimum load reveals right when ready (no extra wait)", slow.reveal >= 4000 && slow.reveal < 4800, `overview held 4000 ms → reveal ${slow.reveal} ms`);
  const rm = await revealTiming({ reducedMotion: "reduce" });
  check("hold: reduced motion uses the shorter 1.2 s minimum", rm.reveal >= 1200 && rm.reveal < 2600, `reveal ${rm.reveal} ms`);
}

console.log(results.join("\n"));
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
