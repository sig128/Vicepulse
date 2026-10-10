import { useEffect, useState } from "react";
import { formatDistance } from "@vicepulse/shared";
import { useStore } from "../lib/store.ts";
import { api, post, ApiError } from "../lib/api.ts";
import { labelExtras } from "../map/LabelLayer.tsx";
import { rig } from "../map/rig.ts";
import type { XY } from "../lib/types.ts";

type Round = { roundId: string; image: string };
type Result = { distance: number; score: number; answer: { id: string; label: string; game: XY }; finished: boolean; total: number; reward: { created: boolean; reason?: string } | null };

export function Finder({ onClose }: { onClose(): void }) {
  const units = useStore((s) => s.settings.units);
  const setFinderPick = useStore((s) => s.setFinderPick);
  const notify = useStore((s) => s.notify);
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [i, setI] = useState(0);
  const [guess, setGuess] = useState<XY | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [board, setBoard] = useState<{ name: string; score: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const loadBoard = () => api("/api/finder/leaderboard").then((r) => setBoard(r.leaderboard)).catch(() => {});
  useEffect(() => { loadBoard(); return () => { setFinderPick(null); labelExtras.finderGuess = null; labelExtras.finderAnswer = null; }; }, []);
  useEffect(() => {
    if (rounds && !result) setFinderPick((p) => { setGuess(p); labelExtras.finderGuess = p; });
    else setFinderPick(null);
  }, [rounds, result, i]);

  const start = async () => {
    setErr(null);
    useStore.getState().setTool("none");
    try {
      const g = await post<{ gameId: string; rounds: Round[] }>("/api/finder/games");
      setRounds(g.rounds); setI(0); setScores([]); setResult(null); setGuess(null);
      labelExtras.finderGuess = null; labelExtras.finderAnswer = null;
      rig.fitCrop();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Couldn't start a game"); }
  };
  const submit = async () => {
    if (!rounds || !guess) return;
    try {
      const r = await post<Result>("/api/finder/guess", { roundId: rounds[i].roundId, x: guess[0], y: guess[1] });
      setResult(r); setScores((s) => [...s, r.score]);
      labelExtras.finderAnswer = r.answer.game;
      const [ax, ay] = r.answer.game;
      rig.flyTo((ax + guess[0]) / 2, (ay + guess[1]) / 2, Math.max(1500, Math.hypot(ax - guess[0], ay - guess[1]) * 1.8));
      if (r.finished) {
        loadBoard();
        if (r.reward?.created) notify("Marker Finder points added to your ledger.", "good");
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Guess failed"); }
  };
  const next = () => { setI(i + 1); setResult(null); setGuess(null); labelExtras.finderGuess = null; labelExtras.finderAnswer = null; rig.fitCrop(); };

  return (
    <section className="finder-float glass" aria-label="Marker Finder">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="h-display" style={{ fontSize: 18, flex: 1 }}>Marker Finder</h2>
        {rounds && <span className="mono dim">Round {Math.min(i + 1, rounds.length)}/{rounds.length}</span>}
        <button className="close" onClick={onClose}>Esc</button>
      </div>
      {!rounds && (
        <div className="stack">
          <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>Five in-game photos from the GTADB landmark set. Click where you think each was taken. Scores are checked on the server; the leaderboard lists VICEPULSE players only.</p>
          <button className="btn primary" onClick={start}>Start game</button>
        </div>
      )}
      {rounds && i < rounds.length && (
        <div className="finder-stage">
          <img src={rounds[i].image} alt="Where was this photo taken?" />
          {!result ? (
            <>
              <p className="dim" style={{ margin: 0, fontSize: 12 }}>{guess ? `Guess at ${guess[0].toFixed(0)}, ${guess[1].toFixed(0)}. Click again to move it.` : "Click the map to place your guess."}</p>
              <button className="btn primary" disabled={!guess} onClick={submit}>Lock in guess</button>
            </>
          ) : (
            <>
              <div className="row"><span className="big-num">{result.score}</span><span className="dim">{formatDistance(result.distance, units)} away</span></div>
              <p style={{ margin: 0, fontSize: 12.5 }}><span className="mono">{result.answer.id}</span> · {result.answer.label}</p>
              {!result.finished ? <button className="btn primary" onClick={next}>Next round</button> : (
                <div className="stack">
                  <p style={{ margin: 0 }}>Final score <b>{result.total}</b>{result.reward?.created ? " · app points added" : result.reward?.reason === "per_user_limit" ? " · points cap reached" : ""}</p>
                  <button className="btn primary" onClick={start}>Play again</button>
                </div>
              )}
            </>
          )}
          {scores.length > 0 && <div className="mono dim" style={{ fontSize: 11 }}>{scores.join(" · ")}</div>}
        </div>
      )}
      {err && <p className="notice warn">{err}</p>}
      {board.length > 0 && (
        <details style={{ marginTop: 8 }} open={!rounds}>
          <summary className="dim" style={{ cursor: "pointer", fontSize: 12 }}>Leaderboard</summary>
          <table className="data" style={{ marginTop: 4 }}><tbody>{board.map((b, k) => <tr key={k}><td className="num">{k + 1}</td><td>{b.name}</td><td className="num">{b.score}</td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}
