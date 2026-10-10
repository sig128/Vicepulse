import { useEffect, useState } from "react";
import type { AtlasBundle, SourceRecord } from "@vicepulse/shared";
import { atlasIndex, type AtlasRow } from "./store.ts";
import { api } from "./api.ts";
import { useReadiness } from "./readiness.ts";

export interface AtlasData { datasets: string[]; rows: AtlasRow[]; generatedAt: string }

let promise: Promise<AtlasData> | null = null;

export function loadAtlas(): Promise<AtlasData> {
  promise ??= fetch("/generated/atlas.json", { signal: AbortSignal.timeout(20_000) })
    .then((r) => { if (!r.ok) throw new Error("Atlas bundle missing — run pnpm data:prepare"); return r.json() as Promise<AtlasBundle>; })
    .then((b) => {
      const rows: AtlasRow[] = b.records.map((r) => ({
        id: r[0], ds: r[1], label: r[2], category: r[3], tags: r[4], x: r[5], y: r[6], rw: !!r[7], photo: !!r[8], fov: r[9] || null, color: r[10],
      }));
      for (const row of rows) atlasIndex.set(row.id, row);
      return { datasets: b.datasets, rows, generatedAt: b.generatedAt };
    });
  promise.catch(() => { promise = null; });
  return promise;
}

export function useAtlas() {
  const [data, setData] = useState<AtlasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useReadiness((s) => s.attempt);
  useEffect(() => {
    let live = true;
    setError(null);
    loadAtlas().then(
      (d) => { if (live) setData(d); useReadiness.getState().mark("markers"); },
      (e) => { const msg = String(e.message ?? e); if (live) setError(msg); useReadiness.getState().fail("markers", msg); },
    );
    return () => { live = false; };
  }, [attempt]);
  return { data, error };
}

const recordCache = new Map<string, Promise<SourceRecord>>();
export function fetchRecord(id: string) {
  if (!recordCache.has(id)) {
    const p = api<SourceRecord>(`/api/atlas/records/${encodeURIComponent(id)}`);
    p.catch(() => recordCache.delete(id));
    recordCache.set(id, p);
  }
  return recordCache.get(id)!;
}

export function useRecord(id: string | null) {
  const [state, setState] = useState<{ rec: SourceRecord | null; error: string | null; loading: boolean }>({ rec: null, error: null, loading: false });
  useEffect(() => {
    if (!id) { setState({ rec: null, error: null, loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchRecord(id).then((rec) => live && setState({ rec, error: null, loading: false }), (e) => live && setState({ rec: null, error: e.message, loading: false }));
    return () => { live = false; };
  }, [id]);
  return state;
}

export const CATEGORY_COLORS: Record<string, string> = {
  hotel: "#F7A35C", residential: "#CBBFD8", landmark: "#7884F7", shop: "#F976B0", restaurant: "#F4717C", default: "#A898BC",
};

/** Formats GTADB unix-second edit stamps; the raw value is always shown alongside. */
export function formatEdited(v: number | string, lang: string) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v * 1000));
}
