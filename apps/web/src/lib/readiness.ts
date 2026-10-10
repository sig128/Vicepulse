import { create } from "zustand";

/**
 * Initial-entry readiness. Each signal is reported by the code that does the work:
 *  ui       — App mounted
 *  fonts    — Inter + display font loaded, or the deliberate fallback settled
 *  overview — base raster texture decoded (WebGL useLoader / 2D Image)
 *  view     — every fine-tier tile of the first stable view settled (loaded or failed; coarser levels cover misses)
 *  markers  — atlas bundle parsed
 * Off-screen tiles, realtime and other background requests are deliberately not waited for.
 */
export type Signal = "ui" | "fonts" | "overview" | "view" | "markers";
const REQUIRED: Signal[] = ["ui", "fonts", "overview", "view", "markers"];
export const SLOW_AFTER_MS = 12_000;

type Phase = "loading" | "slow" | "error" | "ready";

interface Readiness {
  done: Partial<Record<Signal, true>>;
  errors: Partial<Record<Signal, string>>;
  phase: Phase;
  /** Bumped by Retry; loaders that failed re-run when it changes. */
  attempt: number;
  /** User chose to continue with a partially loaded map. */
  dismissed: boolean;
  mark(s: Signal): void;
  fail(s: Signal, message: string): void;
  retry(): void;
  dismiss(): void;
}

const phaseOf = (done: Readiness["done"], errors: Readiness["errors"], slow: boolean): Phase =>
  REQUIRED.every((s) => done[s]) ? "ready" : Object.keys(errors).length ? "error" : slow ? "slow" : "loading";

let slowTimer: ReturnType<typeof setTimeout> | undefined;
const armSlowTimer = () => {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    const s = useReadiness.getState();
    if (s.phase === "loading") useReadiness.setState({ phase: "slow" });
  }, SLOW_AFTER_MS);
};

export const useReadiness = create<Readiness>((set, get) => ({
  done: {},
  errors: {},
  phase: "loading",
  attempt: 0,
  dismissed: false,
  mark(s) {
    if (get().done[s]) return;
    const done = { ...get().done, [s]: true as const };
    const { [s]: _cleared, ...errors } = get().errors;
    const phase = phaseOf(done, errors, get().phase === "slow");
    if (phase === "ready") clearTimeout(slowTimer);
    set({ done, errors, phase });
  },
  fail(s, message) {
    if (get().done[s] || get().errors[s] === message) return;
    const errors = { ...get().errors, [s]: message };
    set({ errors, phase: phaseOf(get().done, errors, false) });
  },
  retry() {
    set({ errors: {}, phase: "loading", attempt: get().attempt + 1 });
    armSlowTimer();
  },
  dismiss() { clearTimeout(slowTimer); set({ dismissed: true }); },
}));

armSlowTimer();

/** Resolve once fonts are usable: the brand-font probe has settled and the text faces are loaded (or failed). */
export function watchFonts(brand: Promise<unknown>) {
  const faces = ["400 14px Inter", "600 14px Inter", "700 14px Inter", "400 32px Anton"].map((f) => document.fonts?.load(f) ?? Promise.resolve());
  // A font server that never answers must not hold the page: after 4 s the CSS fallback stack is the deliberate choice.
  const cap = new Promise((r) => setTimeout(r, 4000));
  Promise.race([Promise.allSettled([brand, ...faces]), cap]).then(() => {
    document.documentElement.classList.add("vp-fonts");
    useReadiness.getState().mark("fonts");
  });
}
