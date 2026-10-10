// Captures the loader wordmark at several points of one shimmer cycle (overview held so the loader stays up).
import { chromium } from "@playwright/test";

const browser = await chromium.launch(process.platform === "darwin" ? { args: ["--use-angle=metal", "--enable-gpu"] } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.route("**/generated/yanis16-overview.png", () => { /* hold */ });
await page.goto(process.env.URL ?? "http://localhost:5173/");
await page.waitForFunction(() => document.documentElement.classList.contains("vp-fonts"));
await page.waitForTimeout(400);
const b = await page.locator(".entrance .wm").boundingBox();
const clip = { x: b.x - 24, y: b.y - 20, width: b.width + 48, height: b.height + 40 };
// Pin the sweep at fixed positions (the live sweep crosses the letters in ~0.5 s, too fast to sample reliably).
const pin = await page.addStyleTag({ content: "/* pin */" });
for (const [i, pos] of [["a", 62], ["b", 50], ["c", 38]]) {
  await pin.evaluate((el, pos) => { el.textContent = `.entrance .wm::after { animation: none !important; background-position: ${pos}% 0 !important; }`; }, pos);
  await page.waitForTimeout(80);
  await page.screenshot({ path: `docs/screenshots/compare/loader-shimmer-${i}.png`, clip });
}
await browser.close();
