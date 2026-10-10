// Captures a fixed set of map views for before/after comparison. Needs `pnpm dev` running.
//   node scripts/visual-shots.mjs <prefix>   → docs/screenshots/<prefix>-*.png
import fs from "node:fs";
import { chromium } from "@playwright/test";

const prefix = process.argv[2] ?? "shot";
const out = "docs/screenshots/compare";
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const errors = [];

async function page(viewport, dpr, mode) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: dpr, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await ctx.addInitScript((m) => localStorage.setItem("vicepulse.mode", m), mode);
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${prefix} ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`${prefix} pageerror ${e.message}`));
  p.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/tiles/sol-v16")) errors.push(`${prefix} ${r.status()} ${r.url()}`); });
  return { ctx, p };
}
const settle = (p, ms = 3500) => p.waitForTimeout(ms);
async function zoomIn(p, steps) {
  const box = await p.locator(".map-root").boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(120); }
}

for (const mode of ["atlas", "afterdark"]) {
  const { ctx, p } = await page({ width: 1440, height: 900 }, 2, mode);
  await p.goto("http://localhost:5173/?marker=L588");
  await p.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  await p.waitForSelector(".chip.live");
  await settle(p);
  await p.screenshot({ path: `${out}/${prefix}-${mode}-l588.png` });
  await zoomIn(p, 12);
  await settle(p, 5000);
  await p.screenshot({ path: `${out}/${prefix}-${mode}-deep.png`, clip: { x: 420, y: 200, width: 600, height: 450 } });
  await p.goto("http://localhost:5173/");
  await p.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  await p.waitForSelector(".chip.live");
  await settle(p);
  await p.screenshot({ path: `${out}/${prefix}-${mode}-overview.png` });
  await ctx.close();
}
{
  const { ctx, p } = await page({ width: 390, height: 844 }, 3, "atlas");
  await p.goto("http://localhost:5173/?marker=L588");
  await p.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  await p.waitForSelector(".chip.live");
  await settle(p);
  await p.screenshot({ path: `${out}/${prefix}-mobile.png` });
  await ctx.close();
}
await b.close();
console.log(errors.length ? errors.join("\n") : "no console errors or failed requests");
