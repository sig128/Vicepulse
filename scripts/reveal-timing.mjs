// Frame gaps and clip-path samples during the entrance reveal (desktop 1440×900 @2x).
import { chromium } from "@playwright/test";

const browser = await chromium.launch(process.env.GPU ? { args: ["--use-angle=metal", "--enable-gpu"] } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  window.__rev = [];
  const poll = setInterval(() => {
    if (!document.documentElement?.classList.contains("revealing") || window.__revStart) return;
    clearInterval(poll);
    window.__revStart = performance.now();
    let last = window.__revStart;
    const loop = (t) => {
      window.__rev.push({ t: Math.round(t - window.__revStart), gap: Math.round(t - last), clip: getComputedStyle(document.querySelector(".app")).clipPath });
      last = t;
      if (t - window.__revStart < 800) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, 4);
});
let release; const gate = new Promise((r) => (release = r));
await page.route("**/generated/yanis16-overview.png", async (route) => { await gate; await route.continue(); });
await page.goto((process.env.URL ?? "http://localhost:5173/") + (process.env.Q ?? ""));
await page.waitForTimeout(2500);
release();
await page.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
await page.waitForTimeout(900);
const rev = await page.evaluate(() => window.__rev);
console.log("frames", rev.length, "max gap", Math.max(...rev.map((r) => r.gap)), "ms");
for (const r of rev.filter((_, i) => i % 4 === 0 || rev[i].gap > 40)) console.log(r.t, r.gap, r.clip);
await browser.close();
