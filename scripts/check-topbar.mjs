// Measures whether the desktop top bar fits at common widths in both languages. Needs `pnpm dev` running.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
for (const [w, lang] of [[1920, "en"], [1440, "en"], [1440, "de"], [1366, "de"], [1280, "en"], [1280, "de"], [1180, "de"], [1120, "en"]]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.addInitScript((l) => localStorage.setItem("vicepulse.settings.v1", JSON.stringify({ lang: l })), lang);
  await p.goto("http://localhost:5173/");
  await p.waitForSelector("[data-testid=entrance]", { state: "detached", timeout: 20000 });
  await p.waitForSelector(".chip.live");
  const r = await p.evaluate(() => {
    const nav = document.querySelector(".topbar nav");
    const navR = nav.getBoundingClientRect();
    const last = [...nav.querySelectorAll("button")].at(-1).getBoundingClientRect();
    return {
      lang: document.documentElement.lang,
      navVisible: getComputedStyle(nav).display !== "none",
      navClipped: last.right > navR.right + 0.5,
      deficit: Math.round(Math.max(0, last.right - navR.right)),
      searchWidth: Math.round(document.querySelector(".search-btn").getBoundingClientRect().width),
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      searchStyle: (({ flexShrink, flexBasis, minWidth }) => `${flexShrink}/${flexBasis}/${minWidth}`)(getComputedStyle(document.querySelector(".search-btn"))),
      navStyle: getComputedStyle(nav).flexShrink,
    };
  });
  console.log(w, JSON.stringify(r));
  await p.close();
}
await b.close();
