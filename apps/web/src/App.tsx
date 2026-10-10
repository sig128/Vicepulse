import { useEffect, useRef } from "react";
import { useStore } from "./lib/store.ts";
import { bootstrap } from "./lib/realtime.ts";
import { api, put } from "./lib/api.ts";
import { loadAtlas } from "./lib/atlas.ts";
import type { Shape } from "./lib/types.ts";
import { MapView } from "./map/MapView.tsx";
import { TopBar, BottomStrip, MapControls, RailTabs } from "./ui/Bars.tsx";
import { LeftRail } from "./ui/LeftRail.tsx";
import { Dossier } from "./ui/Dossier.tsx";
import { MobileNav } from "./ui/Mobile.tsx";
import { Entrance } from "./ui/Entrance.tsx";
import { useReadiness } from "./lib/readiness.ts";
import { Finder } from "./ui/Finder.tsx";
import { About, CommandPalette, Evidence, MarkerBrowser, MediaLibrary, RealWorld, Rewards, SettingsPanel, Sources } from "./ui/Overlays.tsx";

export function App() {
  const settings = useStore((s) => s.settings);
  const overlay = useStore((s) => s.overlay);
  const setOverlay = useStore((s) => s.setOverlay);
  const toast = useStore((s) => s.toast);
  const shapes = useStore((s) => s.shapes);
  const loaded = useRef(false);
  const booting = useReadiness((s) => s.phase !== "ready" && !s.dismissed);

  useEffect(() => { useReadiness.getState().mark("ui"); }, []);

  useEffect(() => {
    if (location.pathname === "/about") setOverlay("about");
    // Deep link: ?marker=ID selects the record once the atlas is loaded; survives refresh because select() keeps the URL in sync.
    const id = new URL(location.href).searchParams.get("marker");
    loadAtlas().then(() => {
      if (id) useStore.getState().select(id, { fly: true });
    }).catch(() => {});
    // Session-scoped requests wait for bootstrap: parallel cookieless requests would each mint a guest session.
    bootstrap()
      .then(() => api<{ shapes: any[] }>("/api/annotations"))
      .then((r) => useStore.getState().loadShapes(r.shapes.map(({ tool, ...s }) => ({ kind: tool, ...s }) as Shape)))
      .catch(() => useStore.getState().notify("Can't reach the VICEPULSE server. The atlas still works; the city will reconnect.", "warn"))
      .finally(() => { loaded.current = true; });
  }, []);

  // Persist drawings (debounced). Annotations live in game coordinates, so both modes share them.
  useEffect(() => {
    if (!loaded.current) return;
    const h = setTimeout(() => {
      put("/api/annotations", { shapes: shapes.map(({ kind, ...s }) => ({ tool: kind, ...s })) }).catch(() => useStore.getState().notify("Drawing not saved — will retry on next change.", "warn"));
    }, 700);
    return () => clearTimeout(h);
  }, [shapes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); s.setOverlay(s.overlay === "palette" ? null : "palette"); return; }
      if (e.key === "Escape") {
        if (s.overlay) { s.setOverlay(null); return; }
        if (s.mobileSheet) { s.setMobileSheet(null); return; }
        if (s.tool !== "none") { s.setTool("none"); return; }
        if (s.selectedId) { s.select(null); return; }
      }
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]");
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && s.tool === "draw") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const reduce = settings.motion === "reduce";
  const swapped = settings.layout === "swapped";
  const westCollapsed = swapped ? settings.rightCollapsed : settings.leftCollapsed;
  const eastCollapsed = swapped ? settings.leftCollapsed : settings.rightCollapsed;
  const cls = [
    `theme-${settings.theme}`, `accent-${settings.accent}`, `layout-${settings.layout}`, settings.glass ? "" : "no-glass", reduce ? "reduce-motion" : "",
    settings.leftCollapsed ? "left-collapsed" : "", settings.rightCollapsed ? "right-collapsed" : "",
    westCollapsed ? "west-collapsed" : "", eastCollapsed ? "east-collapsed" : "",
  ].join(" ");
  useEffect(() => { document.documentElement.lang = settings.lang; }, [settings.lang]);
  const close = () => setOverlay(null);

  return (
    <div className={`app ${cls}`} aria-busy={booting}>
      <MapView />
      <TopBar />
      <LeftRail />
      <Dossier />
      <BottomStrip />
      <MapControls />
      <RailTabs />
      <MobileNav />
      {overlay === "finder" && <Finder onClose={close} />}
      {overlay === "browser" && <MarkerBrowser onClose={close} />}
      {overlay === "media" && <MediaLibrary onClose={close} />}
      {overlay === "sources" && <Sources onClose={close} />}
      {overlay === "rewards" && <Rewards onClose={close} />}
      {overlay === "settings" && <SettingsPanel onClose={close} />}
      {overlay === "palette" && <CommandPalette onClose={close} />}
      {overlay === "evidence" && <Evidence onClose={close} />}
      {overlay === "realworld" && <RealWorld onClose={close} />}
      {overlay === "about" && <About onClose={() => { close(); if (location.pathname === "/about") history.replaceState(null, "", "/" + location.search); }} />}
      {toast && <div key={toast.id} className={`toast ${toast.tone}`} role="status">{toast.text}</div>}
      <Entrance />
    </div>
  );
}
