// Screenshots of the translucent chrome. Usage: node scripts/shots-glass.mjs (dev server on :5173).
import { chromium } from "@playwright/test";

const URL = process.env.URL ?? "http://localhost:5173/";
const OUT = "docs/screenshots/compare";
const b = await chromium.launch();
const errors = [];
const open = async (viewport, scale) => {
  const p = await b.newPage({ viewport, deviceScaleFactor: scale });
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => localStorage.clear());
  await p.goto(URL);
  await p.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  await p.waitForSelector(".map-root canvas");
  await p.waitForTimeout(2500);
  return p;
};

const d = await open({ width: 1440, height: 900 }, 2);
await d.locator(".topbar .seg button", { hasText: "Atlas" }).click();
await d.waitForTimeout(2500);
await d.screenshot({ path: `${OUT}/ui-glass-atlas.png` });
await d.locator(".topbar .seg button", { hasText: "Afterdark" }).click();
await d.waitForTimeout(2500);
await d.screenshot({ path: `${OUT}/ui-glass-afterdark.png` });
await d.locator(".topbar .seg button", { hasText: "Atlas" }).click();
await d.waitForTimeout(800);
await d.getByRole("button", { name: "Settings" }).click();
await d.waitForSelector(".modal");
await d.waitForTimeout(400);
await d.screenshot({ path: `${OUT}/ui-glass-settings.png` });
await d.keyboard.press("Escape");
await d.goto(URL + "about");
await d.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
await d.waitForTimeout(1200);
await d.screenshot({ path: `${OUT}/ui-glass-about.png` });

const m = await open({ width: 390, height: 844 }, 3);
await m.screenshot({ path: `${OUT}/ui-glass-mobile.png` });
const navBtn = m.locator(".mobile-nav button").first();
if (await navBtn.count()) { await navBtn.click(); await m.waitForTimeout(500); await m.screenshot({ path: `${OUT}/ui-glass-mobile-sheet.png` }); }

console.log(errors.length ? "console errors: " + errors.slice(0, 3).join(" | ") : "no console errors");
await b.close();
