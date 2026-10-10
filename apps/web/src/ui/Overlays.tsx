import { useEffect, useMemo, useRef, useState } from "react";
import { DATASET_COLORS, DATASET_LABELS, REWARD_UNIT_LABEL } from "@vicepulse/shared";
import { useStore, type Settings } from "../lib/store.ts";
import { useT } from "../lib/i18n.ts";
import { api, post, ApiError } from "../lib/api.ts";
import { loadAtlas, useAtlas, useRecord, type AtlasData } from "../lib/atlas.ts";
import { matches } from "../map/markers.ts";
import { rig } from "../map/rig.ts";
import { agentCommand, missionCommand, demoRestart } from "../lib/actions.ts";
import type { BrandFontState } from "../lib/brandFont.ts";
import { Wordmark } from "./Bars.tsx";

export function Modal({ title, onClose, size = "", children, labelledBy }: { title: React.ReactNode; onClose(): void; size?: "" | "narrow" | "wide"; children: React.ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("input, button, select, [tabindex]")?.focus(); }, []);
  return (
    <div className="overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal glass ${size}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? "modal-title"}>
        <div className="modal-head">
          <h2 id={labelledBy ?? "modal-title"} className="h-display">{title}</h2>
          <button className="close" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- marker browser
export function MarkerBrowser({ onClose }: { onClose(): void }) {
  const t = useT();
  const { data } = useAtlas();
  const layers = useStore((s) => s.layers);
  const toggle = useStore((s) => s.toggleDataset);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const select = useStore((s) => s.select);
  const [limit, setLimit] = useState(200);
  const [noCoords, setNoCoords] = useState(false);
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => layers.datasets[r.ds] !== false && (!filter.category || r.category === filter.category) && matches(r, filter.q) && (!noCoords || r.x == null)), [data, layers.datasets, filter, noCoords]);
  const categories = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.category))].sort(), [data]);
  const counts = useMemo(() => data?.datasets.map((_, i) => data.rows.filter((r) => r.ds === i).length) ?? [], [data]);
  return (
    <Modal title={t("Markers")} onClose={onClose} size="wide">
      <input className="input" placeholder="Search ID (L588), label, tag…" value={filter.q} onChange={(e) => setFilter({ q: e.target.value })} aria-label={t("Search")} />
      <div className="filters">
        {data?.datasets.map((d, i) => (
          <button key={d} className="toggle" aria-pressed={layers.datasets[i] !== false} onClick={() => toggle(i)}>
            <span className="dot" style={{ background: DATASET_COLORS[d] }} />{DATASET_LABELS[d]} <span className="dim">{counts[i]}</span>
          </button>
        ))}
        <select className="input" style={{ width: "auto" }} value={filter.category ?? ""} onChange={(e) => setFilter({ category: e.target.value || null })} aria-label={t("Category")}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="toggle" aria-pressed={noCoords} onClick={() => setNoCoords(!noCoords)}>No coordinates only</button>
      </div>
      <p className="dim" style={{ fontSize: 12, margin: "0 0 8px" }}>{rows.length.toLocaleString()} of {data?.rows.length.toLocaleString() ?? "…"} records. Filters also apply to the map.</p>
      <div className="list" role="listbox" aria-label="Records">
        {rows.slice(0, limit).map((r) => (
          <button key={r.id} className="list-item" role="option" aria-selected={false} onClick={() => { select(r.id, { fly: true }); onClose(); }}>
            <span className="dot" style={{ background: DATASET_COLORS[data!.datasets[r.ds]] }} />
            <span className="id">{r.id}</span>
            <span className="lbl">{r.label}</span>
            <span className="dim" style={{ fontSize: 11 }}>{r.category}</span>
            {r.x == null && <span className="status unavailable">no coordinates</span>}
            {r.photo && <span className="dim" style={{ fontSize: 11 }}>photo</span>}
          </button>
        ))}
      </div>
      {rows.length > limit && <button className="btn block" style={{ marginTop: 8 }} onClick={() => setLimit(limit + 400)}>Show more</button>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------- media library
type MediaItem = { recordId: string; label: string; dataset: string; kind: string; localUrl: string | null; sourceUrl: string | null; status: string; rightsNote: string };
export function MediaLibrary({ onClose }: { onClose(): void }) {
  const t = useT();
  const select = useStore((s) => s.select);
  const [tab, setTab] = useState<"photos" | "source" | "official">("photos");
  const [page, setPage] = useState(0);
  const [res, setRes] = useState<{ total: number; counts: Record<string, number>; items: MediaItem[] } | null>(null);
  const [coverage, setCoverage] = useState<any>(null);
  useEffect(() => { fetch("/generated/coverage.json").then((r) => r.json()).then(setCoverage).catch(() => {}); }, []);
  useEffect(() => {
    if (tab === "official") return;
    const q = tab === "photos" ? "dataset=gtadb_landmarks" : "";
    api(`/api/atlas/media?${q}&offset=${page * 60}&limit=60`).then((r) => setRes(tab === "source" ? { ...r, items: r.items.filter((i: MediaItem) => i.dataset !== "gtadb_landmarks") } : r)).catch(() => setRes(null));
  }, [tab, page]);
  const media = coverage?.reconciliation?.media;
  return (
    <Modal title={t("Media")} onClose={onClose} size="wide">
      <div className="filters">
        <button className="toggle" aria-pressed={tab === "photos"} onClick={() => { setTab("photos"); setPage(0); }}>Landmark photos</button>
        <button className="toggle" aria-pressed={tab === "source"} onClick={() => { setTab("source"); setPage(0); }}>Screenshot, trailer & leak media</button>
        <button className="toggle" aria-pressed={tab === "official"} onClick={() => setTab("official")}>Official archives</button>
      </div>
      {tab !== "official" && res && (
        <>
          <p className="dim" style={{ fontSize: 12 }}>
            {res.total.toLocaleString()} media references · {Object.entries(res.counts).map(([k, v]) => `${v} ${k.replaceAll("_", " ")}`).join(" · ")}.
            {tab === "photos" ? " GTADB photos are CC BY 4.0, served through our cache from a pinned GitHub commit." : " State of Leonida media are linked to their source; we don't redistribute them without permission."}
          </p>
          <div className="media-grid">
            {res.items.map((m, i) => (
              <button key={`${m.recordId}-${m.kind}-${i}`} className="media-card" onClick={() => { select(m.recordId, { fly: true }); onClose(); }}>
                <div className="ph">{m.localUrl ? <img src={m.localUrl} alt={`${m.recordId} ${m.kind}`} loading="lazy" /> : <span className={`status ${m.status}`}>{m.status.replaceAll("_", " ")}</span>}</div>
                <div className="cap"><span className="mono">{m.recordId}</span> · {m.kind.replaceAll("_", " ")}<div className="dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</div></div>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: "center" }}>
            <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="mono dim">{page + 1} / {Math.max(1, Math.ceil((tab === "photos" ? res.total : res.total) / 60))}</span>
            <button className="btn" disabled={(page + 1) * 60 >= res.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
      {tab === "official" && (
        <div className="stack">
          {media?.sourceScreenshotsTabEntries && (
            <p className="notice">
              The source's Media tab lists <b>{media.sourceScreenshotsTabEntries.observed ?? 166}</b> screenshot entries. These are distinct from its 47 screenshot map pins.
              The full listing comes from an endpoint disallowed for crawlers, so it is marked <span className="status pending_permission">pending permission</span>; we link instead of copying.
            </p>
          )}
          <table className="data">
            <thead><tr><th>Archive</th><th>Items</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(media?.officialArchives ?? []).map((a: any) => (
                <tr key={a.url}><td>{a.label}</td><td className="num">{a.listed_count ?? "—"}</td><td><span className={`status ${a.status}`}>{a.status}</span></td><td><a href={a.url} target="_blank" rel="noreferrer noopener">Official download ↗</a></td></tr>
              ))}
            </tbody>
          </table>
          <p className="dim" style={{ fontSize: 12 }}>Official media belongs to its owner. VICEPULSE links to the publisher's own downloads and does not rehost them.</p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------- sources & provenance
export function Sources({ onClose }: { onClose(): void }) {
  const [d, setD] = useState<any>(null);
  const layers = useStore((s) => s.layers);
  const setLayers = useStore((s) => s.setLayers);
  useEffect(() => { api("/api/sources").then(setD).catch(() => setD({ error: true })); }, []);
  if (!d) return <Modal title="Sources" onClose={onClose} size="wide"><div className="empty">Loading…</div></Modal>;
  const cov = d.coverage, rec = cov?.reconciliation, maps = d.maps;
  return (
    <Modal title="Sources & provenance" onClose={onClose} size="wide">
      <p className="notice accent" style={{ marginTop: 0 }}>
        VICEPULSE is an unofficial fan project and is not affiliated with Rockstar Games or Take-Two. Locations are community estimates; the map is a reconstruction, not official geography.
        Primary reference: <a href="https://map.stateofleonida.net/?marker=L588" target="_blank" rel="noreferrer noopener">State of Leonida</a>. Landmark data and tiles: <a href="https://map.gtadb.org" target="_blank" rel="noreferrer noopener">GTADB</a> (CC BY 4.0).
      </p>
      {rec && (
        <>
          <h3 className="h-sec">Count reconciliation</h3>
          <table className="data">
            <tbody>
              <tr><td>Database overview total (observed)</td><td className="num">{rec.observedSnapshot.databaseOverviewTotal}</td><td>{rec.matches.databaseOverview ? <span className="good">reproduced</span> : <span className="warn">mismatch</span>}</td></tr>
              <tr><td>Rendered markers (observed)</td><td className="num">{rec.observedSnapshot.renderedMarkerTotal}</td><td>{rec.matches.renderedTotal ? <span className="good">reproduced</span> : <span className="warn">mismatch</span>}</td></tr>
              <tr><td>Imported records</td><td className="num">{rec.imported.total}</td><td>{rec.imported.landmarks} landmarks + {rec.imported.nonLandmarkSourceRecords} other</td></tr>
            </tbody>
          </table>
          <p style={{ fontSize: 13 }}><b>The missing 60:</b> {rec.explanation.renderedLayer}</p>
          <p className="dim" style={{ fontSize: 12 }}>{rec.explanation.confidence}</p>
          <p className="dim" style={{ fontSize: 12 }}>{rec.explanation.ourHandling}</p>
          <details><summary className="dim" style={{ cursor: "pointer" }}>IDs with no coordinates ({rec.explanation.missingSixtyIds.length})</summary><p className="mono" style={{ fontSize: 11 }}>{rec.explanation.missingSixtyIds.join(" ")}</p></details>
        </>
      )}
      {cov && (
        <>
          <h3 className="h-sec">Datasets</h3>
          <table className="data">
            <thead><tr><th>Dataset</th><th>Records</th><th>On map</th><th>Real-world</th><th>Media</th><th>FOV</th></tr></thead>
            <tbody>
              {Object.entries(cov.datasets).map(([k, v]: [string, any]) => (
                <tr key={k}><td><span className="dot" style={{ display: "inline-block", marginRight: 6, background: DATASET_COLORS[k] }} />{DATASET_LABELS[k] ?? k}</td><td className="num">{v.raw}</td><td className="num">{v.renderableOnGameMap}</td><td className="num">{v.realWorldCoordinates}</td><td className="num">{v.mediaAssociations}</td><td className="num">{v.fovObservations}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="dim" style={{ fontSize: 12 }}>{rec?.elScreenshots?.note}</p>
          <h3 className="h-sec">Assets & acquisition status</h3>
          <table className="data">
            <thead><tr><th>Asset</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>{cov.assets.map((a: any) => <tr key={a.id}><td className="mono">{a.id}</td><td><span className={`status ${a.status}`}>{a.status.replaceAll("_", " ")}</span></td><td style={{ fontSize: 12 }}>{a.reason}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {maps && (
        <>
          <h3 className="h-sec">Map revisions</h3>
          <p style={{ fontSize: 13 }}>
            Rendered: <b>{maps.renderedBasemap.id}</b> (artwork label “{maps.renderedBasemap.artworkLabel}”) at commit <span className="mono">{maps.renderedBasemap.commit.slice(0, 10)}</span>. {maps.renderedBasemap.labelMismatch}
          </p>
          <p style={{ fontSize: 13 }}>Primary reference revision: <b>{maps.primaryReference.activeRevision.layer} {maps.primaryReference.activeRevision.version}</b> ({maps.primaryReference.activeRevision.date}). {maps.registrationAgainstPrimary.interpretation}</p>
          <div className="row">
            <button className="toggle" aria-pressed={layers.sol} onClick={() => setLayers({ sol: !layers.sol })}>Overlay State of Leonida v16.0 (local cache)</button>
            <span className="dim" style={{ fontSize: 12 }}>{d.stateOfLeonida.cached ? "Cached locally for comparison only; not redistributed." : "Not cached in this install (run pnpm data:fetch-sol)."}</span>
          </div>
          <table className="data" style={{ marginTop: 8 }}>
            <thead><tr><th>Source layer</th><th>Versions</th><th>Status</th></tr></thead>
            <tbody>{Object.values(maps.sourceLayers).map((l: any) => <tr key={l.layer}><td>{l.layer}</td><td style={{ fontSize: 12 }}>{l.versions.map((v: any) => v.id).join(", ")}</td><td><span className={`status ${l.versions[0]?.assetStatus}`}>{l.versions[0]?.assetStatus}</span></td></tr>)}</tbody>
          </table>
          <h3 className="h-sec">Historical comparison layers</h3>
          <table className="data">
            <thead><tr><th>Layer</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>{maps.historicalComparisons.map((h: any) => <tr key={h.id}><td>{h.name}</td><td><span className={`status ${h.assetStatus}`}>{h.assetStatus.replaceAll("_", " ")}</span></td><td style={{ fontSize: 12 }}>{h.scaleAssumption} Drop a licensed file at <span className="mono">{h.localSlot}</span>.</td></tr>)}</tbody>
          </table>
        </>
      )}
      <h3 className="h-sec">How we adapted the sources</h3>
      <ul style={{ fontSize: 13, paddingLeft: 18 }}>{d.adaptations.map((a: string) => <li key={a}>{a}</li>)}</ul>
      {d.stateOfLeonida.credits && (
        <>
          <h3 className="h-sec">Primary-source credits</h3>
          {d.stateOfLeonida.credits.sections.map((s: any) => <p key={s.title} style={{ fontSize: 12.5, margin: "0 0 6px" }}><b>{s.title}:</b> {s.members.map((m: any) => m.name).join(", ")}</p>)}
        </>
      )}
      {d.stateOfLeonida.changelog && (
        <>
          <h3 className="h-sec">Source changelog (latest)</h3>
          <table className="data"><tbody>{d.stateOfLeonida.changelog.slice(0, 12).map((c: any, i: number) => <tr key={i}><td className="mono">{c.date}</td><td>{c.type}</td><td>{c.title}</td><td className="mono">{c.id}</td></tr>)}</tbody></table>
        </>
      )}
      <p className="dim" style={{ fontSize: 12 }}>Tile cache: on-demand {d.upstream.onDemand ? "enabled" : "disabled"}, {d.upstream.spentToday}/{d.upstream.budget} upstream requests today.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------- rewards
export function Rewards({ onClose }: { onClose(): void }) {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api("/api/rewards").then(setD).catch(() => setD({ error: true }));
  useEffect(() => { load(); }, []);
  const claim = async (id: string) => {
    try { await post(`/api/rewards/${id}/claim`); setMsg("Claimed."); load(); } catch (e) { setMsg(e instanceof ApiError ? e.message : "Failed"); }
  };
  return (
    <Modal title="Rewards" onClose={onClose}>
      {!d ? <div className="empty">Loading…</div> : d.error ? <div className="empty">Couldn't load your ledger.</div> : (
        <div className="stack">
          <div className="row" style={{ gap: 24 }}>
            <div><div className="big-num">{d.totals.earned}</div><div className="dim">{d.unitLabel} earned</div></div>
            <div><div className="big-num" style={{ color: "var(--text-2)" }}>{d.totals.claimed}</div><div className="dim">settled</div></div>
          </div>
          <p className="notice">{d.note}</p>
          <p className="notice warn">{d.settlement.description}</p>
          {msg && <p className="notice accent">{msg}</p>}
          <h3 className="h-sec">Ledger</h3>
          {!d.entries.length && <div className="dim">No entries yet. Deliver the coupe in The Night Shift, finish a Marker Finder game, or get a correction approved.</div>}
          <table className="data">
            <tbody>
              {d.entries.map((e: any) => (
                <tr key={e.id}>
                  <td className="num" style={{ color: "var(--accent)" }}>+{e.amount}</td>
                  <td>{e.reason}<div className="dim" style={{ fontSize: 11 }}>{e.campaign_name} · {new Date(e.created_at).toLocaleString()}{e.meta?.demoAssisted ? " · demo-assisted (non-transferable)" : ""}</div>
                    {e.why && <div className="dim mono" style={{ fontSize: 11 }}>why: event #{e.why.sequence} {e.why.type} ({e.why.payload?.outcome ?? ""})</div>}</td>
                  <td>{d.settlement.enabled && !e.settlement_state && <button className="btn" onClick={() => claim(e.id)} disabled={e.meta?.demoAssisted}>Claim</button>}{e.settlement_state && <span className="status">{e.settlement_state}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="h-sec">Campaigns</h3>
          <table className="data">
            <thead><tr><th>Campaign</th><th>Per guest</th><th>Issued / allocation</th></tr></thead>
            <tbody>{d.campaigns.map((c: any) => <tr key={c.id}><td>{c.name}<div className="dim" style={{ fontSize: 11 }}>{c.rule}</div></td><td className="num">{c.per_user_limit}</td><td className="num">{c.issued.toLocaleString()} / {c.allocation_total.toLocaleString()}</td></tr>)}</tbody>
          </table>
          <p className="dim" style={{ fontSize: 11 }}>Unit: {REWARD_UNIT_LABEL[d.unit] ?? d.unit}. No market, no price, no token. External payouts are disabled.</p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------- evidence
export function Evidence({ onClose }: { onClose(): void }) {
  const selectedId = useStore((s) => s.selectedId);
  const notify = useStore((s) => s.notify);
  const [kind, setKind] = useState<"mapping_correction" | "evidence_link" | "external_gameplay">("mapping_correction");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mine, setMine] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api("/api/evidence").then((r) => setMine(r.submissions)).catch(() => {});
  useEffect(() => { load(); }, []);
  const submit = async () => {
    setErr(null);
    let imageBase64: string | undefined;
    if (file) {
      if (file.size > 1_500_000) { setErr("Image must be under 1.5 MB."); return; }
      const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
      imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    }
    try {
      const r = await post("/api/evidence", { kind, recordId: selectedId, note, url: url || null, proposedGame: null, imageBase64 });
      notify(r.note, "good"); setNote(""); setUrl(""); setFile(null); load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed"); }
  };
  return (
    <Modal title="Submit evidence" onClose={onClose} size="narrow">
      <div className="stack">
        <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>Submissions go through review: submitted → under review → approved / rejected → reward eligible. Links must point to a vetted source; we never fetch arbitrary URLs.</p>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Kind">
          <option value="mapping_correction">Mapping correction{selectedId ? ` for ${selectedId}` : ""}</option>
          <option value="evidence_link">Evidence link</option>
          <option value="external_gameplay">External gameplay proof (rewards disabled)</option>
        </select>
        <textarea className="input" rows={4} placeholder="What's wrong or what does this show?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        <input className="input" placeholder="https://… (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Image" />
        {kind === "external_gameplay" && <p className="notice warn" style={{ margin: 0 }}>Rewards for external GTA VI gameplay are disabled. No authorised verification exists, and screenshots alone aren't proof.</p>}
        {err && <p className="notice warn" style={{ margin: 0 }}>{err}</p>}
        <button className="btn primary" onClick={submit} disabled={note.trim().length < 4}>Submit for review</button>
        {mine.length > 0 && (
          <>
            <h3 className="h-sec">Your submissions</h3>
            <table className="data"><tbody>{mine.map((m) => <tr key={m.id}><td className="mono">{m.record_id ?? "—"}</td><td>{m.kind.replaceAll("_", " ")}</td><td><span className="status">{m.state.replaceAll("_", " ")}</span></td></tr>)}</tbody></table>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------- real-world view
export function RealWorld({ onClose }: { onClose(): void }) {
  const t = useT();
  const id = useStore((s) => s.selectedId);
  const { rec } = useRecord(id);
  const ll = rec?.realWorld?.latLon;
  const d = 0.004;
  return (
    <Modal title={t("Real-world view")} onClose={onClose}>
      {!ll ? <div className="empty">This record has no real-world reference.</div> : (
        <div className="stack">
          <p className="notice" style={{ margin: 0 }}>A separate coordinate space. The real-world reference is the community's guess at what inspired this spot. It is never projected onto the game map.</p>
          <div className="row"><span className="mono">{rec!.id}</span><span>{rec!.realWorld!.address}</span></div>
          <iframe title="OpenStreetMap" style={{ width: "100%", height: 380, border: "1px solid var(--line)", borderRadius: 10 }} loading="lazy" referrerPolicy="no-referrer"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${ll[1] - d},${ll[0] - d},${ll[1] + d},${ll[0] + d}&layer=mapnik&marker=${ll[0]},${ll[1]}`} />
          <div className="row">
            <a className="btn" href={`https://www.openstreetmap.org/?mlat=${ll[0]}&mlon=${ll[1]}#map=17/${ll[0]}/${ll[1]}`} target="_blank" rel="noreferrer noopener">OpenStreetMap ↗</a>
            <a className="btn" href={`https://earth.google.com/web/@${ll[0]},${ll[1]},0a,1000d,35y,0h,0t,0r`} target="_blank" rel="noreferrer noopener">{t("Open in Google Earth")} ↗</a>
          </div>
          <p className="dim" style={{ fontSize: 11, margin: 0 }}>Map data © OpenStreetMap contributors.</p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------- settings
const BRAND_FONT_NOTE: Record<BrandFontState, string> = {
  "pricedown-file": "Display font: Pricedown Black, loaded from the bundled licensed file.",
  "pricedown-local": "Display font: Pricedown Black, from a copy installed on this device.",
  fallback: "Display font: Anton (fallback). Pricedown Black is not bundled because it needs a licence; the wordmark switches to it once the licensed file is added.",
};

export function SettingsPanel({ onClose }: { onClose(): void }) {
  const t = useT();
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const opt = <K extends keyof Settings>(k: K, label: string, values: [Settings[K], string][]) => (
    <>
      <span className="muted">{t(label)}</span>
      <div className="seg" role="group" aria-label={t(label)} style={{ flexWrap: "wrap" }}>
        {values.map(([v, l]) => <button key={String(v)} aria-pressed={s[k] === v} onClick={() => set({ [k]: v } as Partial<Settings>)}>{l}</button>)}
      </div>
    </>
  );
  return (
    <Modal title={t("Settings")} onClose={onClose} size="narrow">
      <div className="settings-grid">
        {opt("lang", "Language", [["en", "English"], ["de", "Deutsch"]])}
        {opt("units", "Units", [["metric", "km / m"], ["imperial", "mi / ft"]])}
        {opt("theme", "Theme", [["night", "Night"], ["dusk", "Dusk"], ["contrast", "High contrast"]])}
        {opt("accent", "Accent", [["pink", "Vice pink"], ["sunset", "Sunset"], ["blue", "Ocean blue"]])}
        {opt("glass", "Glass", [[true, "On"], [false, "Solid"]])}
        {opt("background", "Background", [["deep", "Deep"], ["ink", "Ink"], ["grid", "Grid"]])}
        {opt("layout", "Panel layout", [["default", "Feed left"], ["swapped", "Feed right"], ["map-focus", "Map only"]])}
        {opt("motion", "Motion", [["system", "System"], ["reduce", "Reduced"], ["full", "Full"]])}
        {opt("renderer", "Renderer", [["auto", "WebGL"], ["2d", "2D fallback"]])}
      </div>
      <p className="dim" style={{ fontSize: 12, marginTop: 16 }}>Distances use the community convention 1 game unit ≈ 1 metre. Settings are stored in this browser only.</p>
      <p className="dim" style={{ fontSize: 12 }} data-testid="brand-font-status">{BRAND_FONT_NOTE[(document.documentElement.dataset.brandFont as BrandFontState) ?? "fallback"] ?? BRAND_FONT_NOTE.fallback}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------- command palette
type Cmd = { kind: string; label: string; hint?: string; run(): void };
export function CommandPalette({ onClose }: { onClose(): void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const st = useStore.getState();
  const me = useStore((s) => s.me);
  const view = useStore((s) => (me ? s.views[me.sessionWorldId] : undefined));
  const scenario = useStore((s) => s.scenario);
  useEffect(() => { loadAtlas().then(setAtlas); }, []);
  const commands = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      { kind: "Map", label: "Switch to Atlas", run: () => st.setMode("atlas") },
      { kind: "Map", label: "Switch to Afterdark", run: () => st.setMode("afterdark") },
      { kind: "Map", label: "Fit whole map", run: () => rig.fitCrop() },
      { kind: "Tool", label: "Measure distance", run: () => st.setTool("measure") },
      { kind: "Tool", label: "Draw on the map", run: () => st.setTool("draw") },
      { kind: "Layer", label: "Toggle marker density", run: () => st.setLayers({ heat: !useStore.getState().layers.heat }) },
      { kind: "Layer", label: "Toggle grid", run: () => st.setLayers({ grid: !useStore.getState().layers.grid }) },
      { kind: "Layer", label: "Toggle clusters", run: () => st.setLayers({ clusters: !useStore.getState().layers.clusters }) },
      { kind: "Open", label: "Marker browser", run: () => st.setOverlay("browser") },
      { kind: "Open", label: "Media library", run: () => st.setOverlay("media") },
      { kind: "Open", label: "Marker Finder", run: () => st.setOverlay("finder") },
      { kind: "Open", label: "Sources & provenance", run: () => st.setOverlay("sources") },
      { kind: "Open", label: "Rewards ledger", run: () => st.setOverlay("rewards") },
      { kind: "Open", label: "Settings", run: () => st.setOverlay("settings") },
      { kind: "Open", label: "About VICEPULSE", run: () => st.setOverlay("about") },
      { kind: "Setting", label: "Language: English / Deutsch", run: () => st.setSettings({ lang: useStore.getState().settings.lang === "en" ? "de" : "en" }) },
      { kind: "Setting", label: "Units: metric / imperial", run: () => st.setSettings({ units: useStore.getState().settings.units === "metric" ? "imperial" : "metric" }) },
    ];
    for (const a of view?.mission?.actions.filter((x) => x.enabled) ?? []) base.unshift({ kind: "Mission", label: a.label, hint: a.cost, run: () => missionCommand(a.command) });
    for (const a of view?.agentActions.filter((x) => x.enabled && x.command !== "travel") ?? []) base.push({ kind: "Wren", label: a.label, run: () => agentCommand(a.target ? { command: a.command, actorId: a.target } : { command: a.command }) });
    for (const p of scenario?.places ?? []) {
      const n = scenario!.nodes.find((x) => x.id === p.node);
      if (n) base.push({ kind: "Place", label: p.name, hint: p.sourceRecordId ?? undefined, run: () => { st.flyTo(n.game[0], n.game[1], 1800); if (p.sourceRecordId) st.select(p.sourceRecordId); } });
    }
    if (me?.demoControls) base.push({ kind: "Demo", label: "Start a new night", run: demoRestart });
    return base;
  }, [view, scenario, me]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const cmds = commands.filter((c) => !s || c.label.toLowerCase().includes(s) || c.kind.toLowerCase().includes(s));
    const recs: Cmd[] = s.length >= 2 && atlas ? atlas.rows.filter((r) => matches(r, s)).slice(0, 30).map((r) => ({ kind: DATASET_LABELS[atlas.datasets[r.ds]]?.split(" ")[0] ?? "Record", label: `${r.id} · ${r.label}`, hint: r.x == null ? "no coordinates" : undefined, run: () => st.select(r.id, { fly: true }) })) : [];
    const exact = recs.findIndex((r) => r.label.toLowerCase().startsWith(s + " "));
    if (exact > 0) recs.unshift(...recs.splice(exact, 1));
    return [...recs, ...cmds].slice(0, 60);
  }, [q, commands, atlas]);
  useEffect(() => setIdx(0), [q]);
  const go = (c?: Cmd) => { if (!c) return; onClose(); c.run(); };
  return (
    <div className="overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal glass palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input className="input" autoFocus placeholder={t("Search markers, places, commands…")} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter") go(results[idx]);
          }} aria-activedescendant={`pc-${idx}`} role="combobox" aria-expanded="true" aria-controls="palette-list" />
        <div className="list" id="palette-list" role="listbox">
          {results.map((c, i) => (
            <button key={c.kind + c.label} id={`pc-${i}`} className="list-item" role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => go(c)}>
              <span className="kind">{c.kind}</span><span className="lbl">{c.label}</span>{c.hint && <span className="mono dim">{c.hint}</span>}
            </button>
          ))}
          {!results.length && <div className="empty">No matches.</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- about
export function About({ onClose }: { onClose(): void }) {
  return (
    <div className="about-wrap" role="dialog" aria-modal="true" aria-label="About VICEPULSE">
      <div className="about">
        <button className="close" style={{ position: "fixed", top: 18, right: 18, zIndex: 1 }} onClick={onClose}>Back to the map · Esc</button>
        <h1 aria-label="VICEPULSE"><Wordmark stacked /></h1>
        <p style={{ fontSize: 18, color: "var(--text)" }}>A community atlas of Leonida and a living city that remembers what you did there.</p>
        <h2>The atlas</h2>
        <p>Every pin comes from a public community source: GTADB's 3,100 landmarks (CC BY 4.0), and State of Leonida's screenshot, leak and trailer datasets. Where a source has no reusable licence, we link to it instead of copying it. The map is a fan reconstruction, not official geography. Atlas shows the artwork as published. Afterdark relights the same geometry at night.</p>
        <h2>The city</h2>
        <p>The Night Shift runs on our server, in real time. Vega posts what she actually sees. Mara offers a job. Nico is cheap but owes money to the wrong people. Jules is careful and costs more. What you choose changes what happens, and the feed can always tell you why. Each guest gets a private night; everyone shares the city's background chatter.</p>
        <h2>Points</h2>
        <p>Delivering the coupe, finishing a Marker Finder game or getting a correction approved earns <b>app points</b> in an append-only ledger. They are not money, not a token and not transferable. External payouts are switched off. Nothing in VICEPULSE reads GTA VI gameplay.</p>
        <h2>Not affiliated</h2>
        <p>VICEPULSE is an unofficial fan project. It is not affiliated with, endorsed by or connected to Rockstar Games or Take-Two Interactive. Grand Theft Auto and related marks belong to their owners. Characters and businesses in The Night Shift are fictional.</p>
        <p><button className="btn primary" onClick={onClose}>Open the map</button></p>
      </div>
    </div>
  );
}
