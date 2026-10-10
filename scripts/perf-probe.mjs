// Frame-time probe while panning/zooming (headless Chromium, 1440×900 @2x). Headless uses a software or
// shared GPU path, so absolute numbers are pessimistic; use it to compare builds, not as a device benchmark.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(process.env.URL ?? "http://localhost:5173/");
await page.waitForSelector(".map-root canvas");
await page.waitForTimeout(2500);

for (const mode of ["Afterdark", "Atlas"]) {
  await page.getByRole("button", { name: mode, exact: true }).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__ft = [];
    let last = performance.now();
    const loop = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length < 2000) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.mouse.move(720, 450);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -240), await page.waitForTimeout(60);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(720 - i * 6, 450 - i * 2), await page.waitForTimeout(16);
  await page.mouse.up();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 240), await page.waitForTimeout(60);
  const stats = await page.evaluate(() => {
    const f = window.__ft.slice(5).sort((a, b) => a - b);
    const info = window.__vpDebug?.gl?.info;
    return { frames: f.length, medianMs: +f[f.length >> 1].toFixed(1), p95Ms: +f[Math.floor(f.length * 0.95)].toFixed(1), textures: info?.memory.textures, drawCalls: info?.render.calls, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6) };
  });
  console.log(mode, JSON.stringify(stats));
}
await browser.close();
