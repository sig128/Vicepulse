// About hero (stacked wordmark), a top-bar close-up and display-type checks. Needs `pnpm dev` running.
//   node scripts/type-shots.mjs   → docs/screenshots/compare/type-*.png
import fs from "node:fs";
import { chromium } from "@playwright/test";

const out = "docs/screenshots/compare";
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.VP_URL ?? "http://localhost:5173/";
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
const errors = [];
let failed = 0;
const check = (ok, name, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };

function lum(hex) {
  const c = hex.replace("#", "").match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b2) => { const [x, y] = [lum(a), lum(b2)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

async function open(viewport, dpr) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(BASE);
  await p.locator("[data-testid=entrance]").waitFor({ state: "detached", timeout: 30_000 });
  await p.waitForTimeout(500);
  return p;
}

// Display type: no faux bold requested anywhere.
const d = await open({ width: 1440, height: 900 }, 2);
const type = await d.evaluate(() => [...document.querySelectorAll(".gta-text, .h-display")].map((el) => {
  const cs = getComputedStyle(el);
  return { t: el.textContent, w: cs.fontWeight, syn: cs.fontSynthesis || cs.fontSynthesisWeight };
}));
check(type.length > 0 && type.every((x) => x.w === "400"), "display text requested at weight 400", JSON.stringify(type.slice(0, 3)));
check(type.every((x) => /none/.test(x.syn)), "font-synthesis none on display text");

const ctl = await d.evaluate(() => {
  const seg = document.querySelector('.seg button[aria-pressed="true"]');
  const s = getComputedStyle(seg);
  return { segColor: s.color, segBg: s.backgroundImage.slice(0, 80) };
});
check(ctl.segColor === "rgb(9, 6, 14)", "active seg uses dark ink", JSON.stringify(ctl));
for (const stop of ["#E963C7", "#F4717C", "#FFDF80"]) {
  const r = ratio("#09060E", stop);
  check(r >= 4.5, `dark ink on ${stop} (primary button / active seg fill)`, `${r.toFixed(2)}:1`);
}
for (const stop of ["#F976B0", "#F7A35C", "#7884F7", "#B1A1E8", "#5FE3A1"]) {
  const r = ratio("#09060E", stop);
  check(r >= 4.5, `dark ink on ${stop} (badge / avatar)`, `${r.toFixed(2)}:1`);
}
check(ratio("#FFF8F2", "#F976B0") < 4.5, "light text on pink would fail, so ink is required", `${ratio("#FFF8F2", "#F976B0").toFixed(2)}:1`);

await d.screenshot({ path: `${out}/type-topbar.png`, clip: { x: 0, y: 0, width: 520, height: 64 } });
await d.getByRole("button", { name: "About" }).click();
await d.waitForTimeout(500);
await d.screenshot({ path: `${out}/type-about.png` });
const hero = await d.evaluate(() => {
  const h = document.querySelector(".about h1").getBoundingClientRect();
  const [v, p] = [...document.querySelectorAll(".about h1 .gta-text")].map((el) => el.getBoundingClientRect());
  return { vTop: v.top, pTop: p.top, vW: v.width, pW: p.width, hL: h.left, hR: h.right };
});
check(hero.vTop < hero.pTop, "About hero stacks VICE over PULSE", JSON.stringify(hero));

const m = await open({ width: 390, height: 844 }, 3);
await m.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "About")?.click());
await m.waitForTimeout(500);
const mh = await m.evaluate(() => {
  const els = [...document.querySelectorAll(".about h1 .gta-text")];
  if (!els.length) return null;
  const r = els.map((el) => el.getBoundingClientRect());
  return { minL: Math.min(...r.map((x) => x.left)), maxR: Math.max(...r.map((x) => x.right)), vw: innerWidth };
});
if (mh) {
  check(mh.minL >= 0 && mh.maxR <= mh.vw, "stacked hero not clipped at 390px", JSON.stringify(mh));
  await m.screenshot({ path: `${out}/type-about-mobile.png` });
} else console.log("SKIP  mobile About (no About entry point in the mobile nav)");

check(errors.length === 0, "no console errors", errors.join(" | "));
await b.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
