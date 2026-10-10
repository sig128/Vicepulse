// Captures the Atlas map at successive zoom steps around Vice City to review how clusters split.
// Usage: node scripts/zoom-steps.mjs <prefix>
import { chromium } from "@playwright/test";

const prefix = process.argv[2] ?? "zoom";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.addInitScript(() => { localStorage.clear(); localStorage.setItem("vicepulse.mode", "atlas"); localStorage.setItem("vicepulse.settings.v1", JSON.stringify({ layout: "map-focus" })); });
await page.goto(process.env.URL ?? "http://localhost:5173/");
await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 30000 });
await page.waitForTimeout(800);
await page.mouse.move(820, 430);
for (let step = 0; step < 7; step++) {
  await page.waitForTimeout(900);
  const n = await page.evaluate(() => ({ ppu: (window).__vpView?.ppu }));
  await page.screenshot({ path: `docs/screenshots/compare/${prefix}-${step}.png` });
  console.log(step, JSON.stringify(n));
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(50); }
}
await browser.close();
