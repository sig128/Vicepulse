/**
 * Pricedown Black (Typodermic) for the wordmark and a few display headings.
 * It is a commercial font and is not bundled: drop the licensed webfont at
 *   apps/web/src/assets/fonts/pricedown-black.woff2   (or .woff / .otf / .ttf)
 * A copy installed on the viewer's system is also used. Without either, display text falls
 * back to Anton and <html data-brand-font="fallback"> says so — nothing claims to be Pricedown.
 */
const files = import.meta.glob("../assets/fonts/pricedown-black.{woff2,woff,otf,ttf}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const FORMAT: Record<string, string> = { woff2: "woff2", woff: "woff", otf: "opentype", ttf: "truetype" };

export type BrandFontState = "pricedown-file" | "pricedown-local" | "fallback";

export async function loadBrandFont(): Promise<BrandFontState> {
  const root = document.documentElement;
  const url = Object.entries(files).sort(([a], [b]) => (a.endsWith("woff2") ? -1 : b.endsWith("woff2") ? 1 : 0))[0];
  const sources = [
    ...(url ? [`url(${url[1]}) format("${FORMAT[url[0].split(".").pop()!]}")`] : []),
    'local("Pricedown Black")', 'local("Pricedown Bl")', 'local("PricedownBl-Regular")', 'local("Pricedown")',
  ];
  let state: BrandFontState = "fallback";
  for (const src of sources) {
    try {
      const face = new FontFace("Pricedown", src, { weight: "400 900", style: "normal", display: "swap" });
      await face.load();
      document.fonts.add(face);
      state = src.startsWith("url") ? "pricedown-file" : "pricedown-local";
      break;
    } catch { /* source not available; try the next */ }
  }
  root.dataset.brandFont = state;
  return state;
}
