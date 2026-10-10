import { useEffect, useRef } from "react";
import { formatDistance, gameDistance } from "@vicepulse/shared";
import { atlasIndex, useStore } from "../lib/store.ts";
import { CROP_GAME, gameToScreen, view } from "./geo.ts";
import { clusterColor, clusterRadius, markers } from "./markers.ts";
import { actorDisplay, ACTOR_COLORS } from "./Overlays3D.tsx";
import type { XY } from "../lib/types.ts";

export const labelExtras = { finderGuess: null as XY | null, finderAnswer: null as XY | null };

const FONT_SANS = "Inter, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

export function LabelLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = view.width, H = view.height;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!view.camera) return;
      const s = useStore.getState();
      const afterdark = s.mode === "afterdark";

      // Grid labels along the screen edges
      if (s.layers.grid) {
        ctx.font = `10px ${FONT_MONO}`;
        ctx.fillStyle = "rgba(120,132,247,0.75)";
        const step = view.ppu > 0.12 ? 1000 : 2000;
        for (let x = Math.ceil(CROP_GAME.minX / step) * step; x <= CROP_GAME.maxX; x += step) {
          const [sx, , ok] = gameToScreen(x, -view.target.y * 100);
          if (ok && sx > 30 && sx < W - 30) ctx.fillText(`${x}`, sx + 3, 14);
        }
        for (let y = Math.ceil(CROP_GAME.minY / step) * step; y <= CROP_GAME.maxY; y += step) {
          const [, sy, ok] = gameToScreen(view.target.x * 100, y);
          if (ok && sy > 20 && sy < H - 10) ctx.fillText(`${y}`, 6, sy - 3);
        }
      }

      // Clusters
      for (const cl of markers.clusters) {
        const [sx, sy, ok] = gameToScreen(cl.x, cl.y);
        if (!ok || sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
        const r = clusterRadius(cl.count);
        const col = clusterColor(cl.count);
        const hover = markers.hoverCluster === cl;
        // Halo
        const halo = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r + (hover ? 14 : 10));
        halo.addColorStop(0, hexA(col, afterdark ? 0.5 : 0.38));
        halo.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(sx, sy, r + (hover ? 14 : 10), 0, Math.PI * 2); ctx.fill();
        // Body: lit from the centre
        const body = ctx.createRadialGradient(sx - r * 0.25, sy - r * 0.3, 0, sx, sy, r);
        body.addColorStop(0, mixWhite(col, 0.35));
        body.addColorStop(0.7, col);
        body.addColorStop(1, mixBlack(col, 0.18));
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,248,242,0.92)"; ctx.stroke();
        // Segmented outer ring
        ctx.lineWidth = 1; ctx.strokeStyle = hexA(col, hover ? 0.95 : 0.6);
        for (let k = 0; k < 4; k++) {
          const a0 = (k * Math.PI) / 2 + 0.35;
          ctx.beginPath(); ctx.arc(sx, sy, r + 3.5, a0, a0 + 0.9); ctx.stroke();
        }
        ctx.font = `700 ${cl.count > 99 ? 9.5 : 10.5}px ${FONT_SANS}`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineJoin = "round"; ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(9,6,14,0.45)";
        ctx.strokeText(String(cl.count), sx, sy + 0.5);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(String(cl.count), sx, sy + 0.5);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      }

      // Selected marker label
      const sel = s.selectedId ? atlasIndex.get(s.selectedId) : null;
      if (sel && sel.x != null && sel.y != null) {
        const [sx, sy, ok] = gameToScreen(sel.x, sel.y);
        if (ok) pill(ctx, `${sel.id} · ${sel.label}`, sx + 14, sy - 14, afterdark, "#FFF8F2");
      }

      // Hover tooltip
      if (markers.hoverIndex >= 0 && markers.rows[markers.hoverIndex] && markers.rows[markers.hoverIndex].id !== s.selectedId) {
        const r = markers.rows[markers.hoverIndex];
        const [sx, sy, ok] = gameToScreen(r.x!, r.y!);
        if (ok) pill(ctx, `${r.id} · ${r.label}`, sx + 12, sy - 10, afterdark, "#CBBFD8");
      }

      // Agents
      const me = s.me;
      const v = me ? s.views[me.sessionWorldId] : undefined;
      if (v && s.layers.actors) {
        const driverId = v.mission?.driverId;
        const isImportant = (id: string) => id === "wren" || id === driverId || id === "tamsin" || id === "dade";
        const ordered = [...v.actors].sort((a, b) => Number(isImportant(b.id)) - Number(isImportant(a.id)));
        // Greedy collision avoidance: actors sharing a spot get stacked labels instead of overprinting.
        const placed: [number, number, number, number][] = [];
        const hits = (x: number, y: number, w: number, h: number) => placed.some(([px, py, pw, ph]) => x < px + pw && x + w > px && y < py + ph && y + h > py);
        ctx.lineJoin = "round";
        for (const a of ordered) {
          const p = actorDisplay.get(a.id) ?? a.pos;
          const [sx, sy, ok] = gameToScreen(p[0], p[1]);
          if (!ok || sx < -50 || sx > W + 50 || sy < -30 || sy > H + 30) continue;
          const important = isImportant(a.id);
          if (!important && view.ppu < 0.06) continue;
          const text = a.id === "wren" ? "WREN · you" : a.name.split(" ")[0].toUpperCase();
          const sub = important && a.moving ? a.task : "";
          ctx.font = `700 11px ${FONT_SANS}`;
          const w = Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width * 0.92 : 0) + 4;
          const h = sub ? 28 : 15;
          const dy = [0, 15, -15, 30, -30].find((d) => !hits(sx + 8, sy - 8 + d, w, h));
          if (dy === undefined && !important) continue;
          const y = sy + 4 + (dy ?? 0);
          placed.push([sx + 8, sy - 8 + (dy ?? 0), w, h]);
          ctx.strokeStyle = "rgba(9,6,14,0.92)"; ctx.lineWidth = 3;
          ctx.strokeText(text, sx + 10, y);
          ctx.fillStyle = ACTOR_COLORS[a.id] ?? "#FFF8F2";
          ctx.fillText(text, sx + 10, y);
          if (sub) {
            ctx.font = `500 10px ${FONT_SANS}`;
            ctx.strokeText(sub, sx + 10, y + 13);
            ctx.fillStyle = "#CBBFD8"; ctx.fillText(sub, sx + 10, y + 13);
          }
        }
      }

      // Measure
      const m = s.measure;
      if (m.length) {
        let total = 0;
        const pts = m.map((p) => gameToScreen(p[0], p[1]));
        if (pts.length > 1 && pts.every((p) => p[2])) {
          ctx.save();
          ctx.lineJoin = "round"; ctx.lineCap = "round";
          ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.strokeStyle = "rgba(16,11,27,0.85)"; ctx.lineWidth = 6; ctx.stroke();
          ctx.setLineDash([9, 6]); ctx.strokeStyle = "#F7A35C"; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.restore();
        }
        m.forEach((p, i) => {
          if (i > 0) total += gameDistance(m[i - 1], p);
          const [sx, sy, ok] = gameToScreen(p[0], p[1]);
          if (!ok) return;
          ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fillStyle = "#F7A35C"; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = "#09060E"; ctx.stroke();
          if (i > 0) pill(ctx, formatDistance(total, s.settings.units), sx + 8, sy - 8, true, "#F7A35C");
        });
      }

      // Marker Finder pins
      for (const [p, col, label] of [[labelExtras.finderGuess, "#7884F7", "Your guess"], [labelExtras.finderAnswer, "#F976B0", "Answer"]] as const) {
        if (!p) continue;
        const [sx, sy, ok] = gameToScreen(p[0], p[1]);
        if (!ok) continue;
        ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#09060E"; ctx.stroke();
        pill(ctx, label, sx + 10, sy - 10, true, col);
      }
      if (labelExtras.finderGuess && labelExtras.finderAnswer) {
        const [ax, ay] = gameToScreen(...labelExtras.finderGuess), [bx, by] = gameToScreen(...labelExtras.finderAnswer);
        ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(255,248,242,0.8)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="label-layer" aria-hidden="true" />;
}

const rgbOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hexA = (hex: string, a: number) => `rgba(${rgbOf(hex).join(",")},${a})`;
const mixWhite = (hex: string, k: number) => `rgb(${rgbOf(hex).map((v) => Math.round(v + (255 - v) * k)).join(",")})`;
const mixBlack = (hex: string, k: number) => `rgb(${rgbOf(hex).map((v) => Math.round(v * (1 - k))).join(",")})`;

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, dark: boolean, color: string) {
  ctx.font = `500 11px ${FONT_SANS}`;
  const t = text.length > 64 ? text.slice(0, 62) + "…" : text;
  const w = ctx.measureText(t).width + 12;
  ctx.fillStyle = dark ? "rgba(16,11,27,0.86)" : "rgba(255,248,242,0.94)";
  ctx.beginPath();
  ctx.roundRect(x, y - 13, w, 19, 5);
  ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = dark ? "rgba(249,118,176,0.45)" : "rgba(9,6,14,0.35)"; ctx.stroke();
  ctx.fillStyle = dark ? color : "#09060E";
  ctx.fillText(t, x + 6, y + 1);
}
