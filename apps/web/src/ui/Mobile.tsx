import { useStore } from "../lib/store.ts";
import { useT } from "../lib/i18n.ts";
import { Icon } from "./icons.tsx";
import { Feed, Crew } from "./LeftRail.tsx";
import { MissionPanel, RecordDetail } from "./Dossier.tsx";

export function MobileNav() {
  const t = useT();
  const sheet = useStore((s) => s.mobileSheet);
  const setSheet = useStore((s) => s.setMobileSheet);
  const selectedId = useStore((s) => s.selectedId);
  const setOverlay = useStore((s) => s.setOverlay);
  const items = [["feed", "Feed", Icon.feed], ["mission", "Mission", Icon.mission], ["atlas", selectedId ? "Record" : "Atlas", Icon.atlas], ["more", "More", Icon.more]] as const;
  return (
    <>
      {sheet && <Sheet />}
      <nav className="mobile-nav" aria-label="Sections">
        {items.map(([k, label, I]) => (
          <button key={k} aria-pressed={sheet === k} onClick={() => { setOverlay(null); setSheet(sheet === k ? null : k); }}>
            <I />{t(label)}
          </button>
        ))}
      </nav>
    </>
  );
}

function Sheet() {
  const t = useT();
  const sheet = useStore((s) => s.mobileSheet);
  const selectedId = useStore((s) => s.selectedId);
  const setOverlay = useStore((s) => s.setOverlay);
  const setSheet = useStore((s) => s.setMobileSheet);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const open = (o: Parameters<typeof setOverlay>[0]) => { setSheet(null); setOverlay(o); };
  return (
    <section className="sheet glass" role="dialog" aria-label={sheet ?? ""}>
      <div className="grip" />
      <div className="rail-body">
        {sheet === "feed" && <Feed />}
        {sheet === "mission" && <><MissionPanel /><h3 className="h-sec">Wren</h3><Crew /></>}
        {sheet === "atlas" && (selectedId ? <RecordDetail id={selectedId} /> : (
          <div className="stack">
            <button className="btn block" onClick={() => open("palette")}>{t("Search")}</button>
            <button className="btn block" onClick={() => open("browser")}>{t("Markers")}</button>
          </div>
        ))}
        {sheet === "more" && (
          <div className="stack">
            <div className="seg" role="group" aria-label="Map mode" style={{ alignSelf: "flex-start" }}>
              <button aria-pressed={mode === "atlas"} onClick={() => setMode("atlas")}>{t("Atlas")}</button>
              <button aria-pressed={mode === "afterdark"} onClick={() => setMode("afterdark")}>{t("Afterdark")}</button>
            </div>
            {([["media", "Media"], ["finder", "Marker Finder"], ["sources", "Sources"], ["rewards", "Rewards"], ["settings", "Settings"], ["about", "About"]] as const).map(([k, l]) => (
              <button key={k} className="btn block" onClick={() => open(k)}>{t(l)}</button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
