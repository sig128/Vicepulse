import { useEffect, useRef, useState } from "react";
import { useReadiness } from "../lib/readiness.ts";
import { useStore } from "../lib/store.ts";
import { prefersReducedMotion } from "../map/geo.ts";

const FADE_MS = 400;
const EXPAND_MS = 600;
const SHIMMER_MS = 2400;
/** Minimum time on screen, counted from navigation start (time spent loading counts): one shimmer sweep plus a beat. */
export const MIN_ENTRANCE_MS = 2800;
const MIN_ENTRANCE_REDUCED_MS = 1200;

const MESSAGES: Record<string, string> = {
  overview: "The base map image couldn't be loaded.",
  view: "Detailed map tiles couldn't be loaded.",
  markers: "The marker atlas couldn't be loaded.",
};

/**
 * Entrance overlay. Markup and base styles mirror the static boot copy in index.html, so React taking over is invisible.
 */
export function Entrance() {
  const phase = useReadiness((s) => s.phase);
  const errors = useReadiness((s) => s.errors);
  const dismissed = useReadiness((s) => s.dismissed);
  const retry = useReadiness((s) => s.retry);
  const dismiss = useReadiness((s) => s.dismiss);
  const reduced = useStore((s) => s.settings.motion === "reduce" || (s.settings.motion === "system" && prefersReducedMotion()));
  const minMs = reduced ? MIN_ENTRANCE_REDUCED_MS : MIN_ENTRANCE_MS;
  const [held, setHeld] = useState(() => performance.now() < minMs);
  useEffect(() => {
    const left = minMs - performance.now();
    if (left <= 0) { setHeld(false); return; }
    const t = setTimeout(() => setHeld(false), left);
    return () => clearTimeout(t);
  }, [minMs]);
  // Continue reveals immediately; otherwise wait for real readiness and the minimum hold.
  const open = !dismissed && (phase !== "ready" || held);
  const [mounted, setMounted] = useState(true);
  const action = useRef<HTMLButtonElement>(null);
  // Continue the boot copy's shimmer phase instead of restarting the sweep.
  const [delay] = useState(() => `-${Math.round(performance.now() % SHIMMER_MS)}ms`);

  // Ready (or Continue): expand the clip frame to the viewport edges while the overlay fades.
  useEffect(() => {
    if (open) return;
    const root = document.documentElement;
    root.classList.remove("booting");
    if (reduced) { setMounted(false); return; }
    root.classList.add("revealing");
    const fade = setTimeout(() => setMounted(false), FADE_MS + 40);
    const settle = setTimeout(() => root.classList.remove("revealing"), EXPAND_MS + 60);
    return () => { clearTimeout(fade); clearTimeout(settle); root.classList.remove("revealing"); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const halted = phase === "error" || phase === "slow";
  useEffect(() => { if (halted) action.current?.focus(); }, [halted]);

  if (!mounted) return null;
  const detail = Object.keys(errors).map((k) => MESSAGES[k] ?? errors[k as keyof typeof errors]).join(" ");
  return (
    <div className={`entrance${open ? "" : " leaving"}${halted ? " halted" : ""}`} role="status" aria-live="polite" aria-hidden={!open} data-phase={phase} data-testid="entrance" style={{ "--shimmer-delay": delay } as React.CSSProperties}>
      <span className="vh">{phase === "error" ? "VICEPULSE didn't load" : phase === "slow" ? "Still loading VICEPULSE" : "Loading VICEPULSE"}</span>
      <p className="wm" data-text="VICEPULSE" aria-hidden="true">VICEPULSE</p>
      {halted && (
        <div className="entrance-help">
          <p>{phase === "error" ? detail || "Something went wrong while loading the map." : "This is taking longer than usual. The map server may be slow or unreachable."}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button ref={action} className="btn primary" onClick={retry}>Retry</button>
            <button className="btn" onClick={dismiss}>Continue to the site</button>
          </div>
        </div>
      )}
    </div>
  );
}
