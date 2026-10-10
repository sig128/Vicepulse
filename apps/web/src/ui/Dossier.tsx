import { useState } from "react";
import { DATASET_LABELS, DATASET_COLORS, REWARD_UNIT_LABEL, type SourceRecord } from "@vicepulse/shared";
import { useStore } from "../lib/store.ts";
import { useT } from "../lib/i18n.ts";
import { formatEdited, useRecord } from "../lib/atlas.ts";
import { demoAdvance, demoRestart, missionCommand } from "../lib/actions.ts";
import type { MissionView } from "../lib/types.ts";
import { RailCollapse } from "./Bars.tsx";

export function Dossier() {
  const t = useT();
  const tab = useStore((s) => s.dossierTab);
  const setTab = useStore((s) => s.setDossierTab);
  const selectedId = useStore((s) => s.selectedId);
  const me = useStore((s) => s.me);
  const stage = useStore((s) => (me ? s.views[me.sessionWorldId]?.mission?.stage : undefined));
  return (
    <aside className="rail rail-right glass" aria-label={t("Dossier")}>
      <div className="rail-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "record"} onClick={() => setTab("record")}>{t("Record")}{selectedId && <span className="count">{selectedId}</span>}</button>
          <button role="tab" aria-selected={tab === "mission"} onClick={() => setTab("mission")}>{t("Mission")}{stage === "complication" && <span className="count" style={{ color: "var(--warn)" }}>!</span>}</button>
        </div>
        <RailCollapse side="right" />
      </div>
      <div className="rail-body" role="tabpanel">
        {tab === "record" ? <RecordDetail id={selectedId} /> : <MissionPanel />}
      </div>
    </aside>
  );
}

export function RecordDetail({ id }: { id: string | null }) {
  const t = useT();
  const { rec, error, loading } = useRecord(id);
  const lang = useStore((s) => s.settings.lang);
  const flyTo = useStore((s) => s.flyTo);
  const select = useStore((s) => s.select);
  const setOverlay = useStore((s) => s.setOverlay);
  const scenario = useStore((s) => s.scenario);
  if (!id) return <div className="empty">{t("No marker selected")}.<br />{t("Select a marker on the map or press")} <kbd>⌘K</kbd>.</div>;
  if (loading && !rec) return <div className="empty">Loading {id}…</div>;
  if (error || !rec) return <div className="empty">Couldn't load {id}: {error}<br /><button className="btn" style={{ marginTop: 10 }} onClick={() => select(null)}>Clear</button></div>;
  const storyPlace = scenario?.places.find((p) => p.sourceRecordId === rec.id) ?? scenario?.nodes.find((n) => n.sourceRecordId === rec.id);
  const photos = rec.media.filter((m) => m.localUrl && (m.kind === "game_photo" || m.kind === "real_world_photo"));
  const others = rec.media.filter((m) => !photos.includes(m));
  const solUrl = `https://map.stateofleonida.net/?marker=${encodeURIComponent(rec.id)}`;
  const ll = rec.realWorld?.latLon;
  return (
    <article className="stack" aria-labelledby="rec-title">
      <div className="row" style={{ gap: 6 }}>
        <span className="dot" style={{ background: DATASET_COLORS[rec.dataset] }} />
        <span className="mono dim">{DATASET_LABELS[rec.dataset]}</span>
        <span className="mono" style={{ marginLeft: "auto", color: "var(--accent)" }}>{rec.id}</span>
      </div>
      <h2 id="rec-title" className="h-display">{rec.label}</h2>
      <div className="row" style={{ gap: 4 }}>
        <span className="tag">{rec.category}</span>
        {rec.tags.map((tg) => <span key={tg} className={`tag ${tg.toLowerCase() === rec.id.toLowerCase() ? "hl" : ""}`}>{tg}</span>)}
      </div>
      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((m) => (
            <figure key={m.kind} style={{ margin: 0 }}>
              <img className="photo" src={m.localUrl!} alt={`${m.kind === "game_photo" ? "In-game" : "Real-world"} reference photo for ${rec.id}`} loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />
              <figcaption className="photo-cap">{m.kind === "game_photo" ? "In-game" : "Real world"} · {m.width}×{m.height}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {storyPlace && <p className="notice accent">In tonight's story this spot is used as <b>{"name" in storyPlace ? storyPlace.name : storyPlace.id}</b> (a fictional VICEPULSE name). The atlas record itself is unchanged.</p>}
      <dl className="kv">
        <dt>{t("Game coordinates")}</dt>
        <dd className="mono">{rec.game ? <button className="icon-btn" style={{ padding: 0 }} onClick={() => flyTo(rec.game![0], rec.game![1], 1400)}>{rec.game[0].toFixed(2)}, {rec.game[1].toFixed(2)} ↗</button> : "none supplied"}</dd>
        {rec.realWorld?.address && <><dt>{t("Real-world reference")}</dt><dd>{rec.realWorld.address}</dd></>}
        {ll && <><dt>Lat / lon</dt><dd className="mono">{ll[0].toFixed(6)}, {ll[1].toFixed(6)}</dd></>}
        {rec.editedRaw && <><dt>{t("Edited")}</dt><dd><EditedStamps raw={rec.editedRaw} lang={lang} /></dd></>}
        {rec.fov && <><dt>{t("Field of view")}</dt><dd className="mono">heading {rec.fov.headingDeg}° · angle {rec.fov.angleDeg}° · range {rec.fov.range}</dd></>}
        <dt>{t("Evidence")}</dt><dd>{rec.evidenceStatus.replaceAll("_", " ")}</dd>
        <dt>{t("Placement")}</dt><dd>{rec.placementStatus.replaceAll("_", " ")}</dd>
      </dl>
      {rec.description && <p style={{ margin: 0, fontSize: 13 }}>{rec.description}</p>}
      {others.length > 0 && (
        <>
          <h3 className="h-sec">{t("Media")}</h3>
          {others.map((m, i) => (
            <div key={i} className="row" style={{ fontSize: 12 }}>
              <span className={`status ${m.status}`}>{m.status.replaceAll("_", " ")}</span>
              <span>{m.kind.replaceAll("_", " ")}</span>
              {m.sourceUrl && <a href={m.sourceUrl} target="_blank" rel="noreferrer noopener">source ↗</a>}
            </div>
          ))}
        </>
      )}
      <div className="row">
        <a className="btn" href={solUrl} target="_blank" rel="noreferrer noopener">{t("Open in State of Leonida")} ↗</a>
        {ll && <button className="btn" onClick={() => setOverlay("realworld")}>{t("Real-world view")}</button>}
        {ll && <a className="btn" href={`https://earth.google.com/web/@${ll[0]},${ll[1]},0a,1000d,35y,0h,0t,0r`} target="_blank" rel="noreferrer noopener">{t("Open in Google Earth")} ↗</a>}
      </div>
      <h3 className="h-sec">Provenance</h3>
      <p className="dim" style={{ margin: 0, fontSize: 12 }}>{rec.attribution}</p>
      <a href={rec.sourceUrl} target="_blank" rel="noreferrer noopener" className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{rec.sourceUrl}</a>
      <button className="btn" onClick={() => setOverlay("evidence")}>Suggest a correction or evidence</button>
    </article>
  );
}

function EditedStamps({ raw, lang }: { raw: SourceRecord["editedRaw"]; lang: string }) {
  const labels = ["record", "in-game photo", "real-world photo"];
  return (
    <div className="stack" style={{ gap: 2 }}>
      {raw!.map((v, i) => (
        <span key={i} style={{ fontSize: 12 }}>
          <span className="dim">{labels[i] ?? `#${i}`}:</span> {formatEdited(v, lang) ?? "—"} <span className="mono dim">({String(v)})</span>
        </span>
      ))}
    </div>
  );
}

const STAGES: { id: MissionView["stage"][]; label: string }[] = [
  { id: ["lead", "investigating"], label: "Lead" },
  { id: ["offer"], label: "Offer" },
  { id: ["pickup", "delivery"], label: "Move" },
  { id: ["complication"], label: "Heat" },
  { id: ["resolved", "declined"], label: "Outcome" },
];

export function Stepper({ stage, compact }: { stage: MissionView["stage"] | undefined; compact?: boolean }) {
  const idx = stage ? STAGES.findIndex((s) => s.id.includes(stage)) : -1;
  return (
    <div className="stepper" aria-label={`Mission stage: ${stage ?? "none"}`}>
      {STAGES.map((s, i) => (
        <span key={s.label} style={{ display: "contents" }}>
          {i > 0 && <span className="bar" />}
          <span className={`st ${i < idx ? "done" : i === idx ? (stage === "complication" ? "alert" : "now") : ""}`}><i />{!compact && s.label}</span>
        </span>
      ))}
    </div>
  );
}

const OUTCOME_TEXT: Record<string, string> = {
  delivered: "Delivered on time. Dorian paid in full.",
  delivered_late: "Delivered, but late. Dorian paid less.",
  lost: "Tidewater took the coupe.",
  abandoned: "You abandoned the delivery.",
  declined: "You turned Mara down.",
};

export function MissionPanel() {
  const me = useStore((s) => s.me);
  const view = useStore((s) => (me ? s.views[me.sessionWorldId] : undefined));
  const [busy, setBusy] = useState(false);
  const m = view?.mission;
  if (!view) return <div className="empty">Connecting to your night…</div>;
  if (!m) return <div className="empty">No active mission.</div>;
  const run = async (cmd: Record<string, unknown>) => { setBusy(true); await missionCommand(cmd); setBusy(false); };
  const lead = view.leads.find((l) => l.status === "open" || l.status === "taken");
  const teaser = view.leads.find((l) => l.status === "teaser");
  const enabled = m.actions.filter((a) => a.enabled);
  const disabled = m.actions.filter((a) => !a.enabled);
  const c = m.complication;
  const sim = view.simRate;
  return (
    <div className="stack">
      <div className="row"><span className="mono dim">{m.id}</span><span className="clock" style={{ marginLeft: "auto", fontSize: 18 }}>{view.clock}</span></div>
      <h2 className="h-display">{m.contract.title}</h2>
      <Stepper stage={m.stage} />
      {m.stage === "lead" || m.stage === "investigating" ? (
        <p style={{ margin: 0 }}>{lead?.text ?? "Vega posted something worth a look."}</p>
      ) : (
        <p style={{ margin: 0 }}>{m.contract.objective}</p>
      )}
      {m.stage !== "lead" && m.stage !== "investigating" && (
        <dl className="kv">
          <dt>Pays</dt><dd>{m.contract.payout}</dd>
          <dt>Reward</dt><dd>{m.contract.reward.amount} {REWARD_UNIT_LABEL[m.contract.reward.unit] ?? m.contract.reward.unit} <span className="dim">· {m.contract.conditions}</span></dd>
          <dt>Driver</dt><dd>{m.driverId ? `${view.actors.find((a) => a.id === m.driverId)?.name} ($${m.contract.fees[m.driverId]})` : "not chosen"}</dd>
          <dt>Route</dt><dd>{m.route === "causeway" ? "Causeway + port tunnel (fast)" : "South port bridge (slower)"}</dd>
          {m.precautions.length > 0 && <><dt>Precautions</dt><dd>{m.precautions.join(", ").replace("sealed_route", "route sealed until pickup")}</dd></>}
        </dl>
      )}
      {m.knownRisks.length > 0 && (
        <>
          <h3 className="h-sec">Known risks</h3>
          {m.knownRisks.map((r) => <p key={r} className="notice warn" style={{ margin: 0 }}>{r}</p>)}
        </>
      )}
      {c && m.stage === "complication" && (
        <div className="countdown" role="alert">
          <span className="n">{Math.ceil(c.secondsLeft)}s</span>
          <div style={{ flex: 1 }}>
            <b>{c.type === "intercept" ? "Tidewater car blocking the route" : "VCPD checkpoint ahead"}</b>
            <div className="dim" style={{ fontSize: 12 }}>{c.type === "intercept" ? "Decide before they reach the driver." : "If you do nothing, the driver waits in line."}</div>
            <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${Math.max(0, Math.min(100, (c.secondsLeft * sim) / 150 * 100))}%` }} /></div>
          </div>
        </div>
      )}
      {m.outcome && (
        <div className={`notice ${m.outcome === "delivered" || m.outcome === "delivered_late" ? "accent" : "warn"}`}>
          <b>{OUTCOME_TEXT[m.outcome]}</b>
          {m.leakRevealed && <div style={{ marginTop: 4 }}>Afterwards you learn why: Nico sold your route to Cass Rourke to clear his debt.</div>}
          {m.demoAssisted && <div className="dim" style={{ marginTop: 4 }}>Demo-assisted run: any app points are marked non-transferable.</div>}
        </div>
      )}
      {teaser && (
        <div className="notice accent"><b>Next lead · {teaser.title}</b><div>{teaser.text}</div></div>
      )}
      {enabled.length > 0 && (
        <>
          <h3 className="h-sec">{m.stage === "complication" ? "Respond" : "Your move"}</h3>
          <div className="action-list">
            {enabled.map((a) => (
              <button key={a.key} className={`action ${a.key === "accept" ? "primary" : ""} ${m.stage === "complication" ? "alert" : ""}`} disabled={busy} onClick={() => run(a.command)}>
                <span className="lbl">{a.label}</span>
                {a.cost && <span className="cost">{a.cost}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {disabled.length > 0 && (
        <details>
          <summary className="dim" style={{ cursor: "pointer", fontSize: 12 }}>Unavailable ({disabled.length})</summary>
          <div className="action-list" style={{ marginTop: 6 }}>
            {disabled.map((a) => (
              <button key={a.key} className="action" disabled>
                <span className="lbl">{a.label}<span className="why">{a.reason}</span></span>
                {a.cost && <span className="cost">{a.cost}</span>}
              </button>
            ))}
          </div>
        </details>
      )}
      {(m.stage === "lead" || m.stage === "investigating") && <p className="dim" style={{ fontSize: 12 }}>Tip: Wren walks there in real time ({view.simRate}× city time). Watch the dashed blue path on the map.</p>}
      {me?.demoControls && (
        <>
          <h3 className="h-sec">Demo controls</h3>
          <div className="row">
            <button className="btn" onClick={() => demoAdvance(120)}>+2 min</button>
            <button className="btn" onClick={() => demoAdvance(600)}>+10 min</button>
            <button className="btn danger" onClick={demoRestart}>New night</button>
          </div>
          <p className="dim" style={{ fontSize: 11, margin: 0 }}>Skipping time marks the run demo-assisted. Demo runs never produce transferable rewards.</p>
        </>
      )}
    </div>
  );
}
