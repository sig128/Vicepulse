import * as THREE from "three";
import { CROP_GAME, S, screenToGround, toGame, view } from "./geo.ts";
import type { XY } from "../lib/types.ts";

export type RigMode = "atlas" | "afterdark";

export interface RigHandlers {
  click(px: number, py: number, e: PointerEvent): void;
  hover(game: XY | null, px: number, py: number): void;
  drawStart?(g: XY): boolean;
  drawMove?(g: XY): void;
  drawEnd?(): void;
}

const MAX_SPAN = 320;
/** Deepest zoom: the finest source level (z6) has 2 px per game unit, so cap at one source pixel per CSS pixel. */
export const MAX_PX_PER_GAME_UNIT = 2;
const minSpan = () => Math.max(0.5, (view.width / MAX_PX_PER_GAME_UNIT) * S);
const PERSPECTIVE_FOV = 38;
const DEFAULT_TILT = view.tilt;

/**
 * Owns camera state (target, span, tilt, heading) and pointer interaction for every renderer.
 * Pan is anchor-based: the ground point under the pointer stays under the pointer.
 */
export class Rig {
  mode: RigMode = "afterdark";
  camera: THREE.Camera | null = null;
  handlers: RigHandlers | null = null;
  reducedMotion = false;
  private el: HTMLElement | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: null | { kind: "pan" | "rotate" | "draw"; id: number; sx: number; sy: number; t: number; moved: boolean; anchor: THREE.Vector3 | null; tilt: number; heading: number } = null;
  private pinch: null | { d: number; span: number; mid: THREE.Vector3 | null } = null;
  private anim: null | { from: [number, number, number]; to: [number, number, number]; t0: number; dur: number } = null;
  private cleanup: (() => void) | null = null;

  attach(el: HTMLElement) {
    this.detach();
    this.el = el;
    view.dom = el;
    const opts = { passive: false } as AddEventListenerOptions;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const wheel = (e: WheelEvent) => this.onWheel(e);
    const leave = () => this.handlers?.hover(null, 0, 0);
    const ctx = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => this.onKey(e);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("wheel", wheel, opts);
    el.addEventListener("contextmenu", ctx);
    el.addEventListener("keydown", key);
    this.cleanup = () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", ctx);
      el.removeEventListener("keydown", key);
    };
  }

  detach() { this.cleanup?.(); this.cleanup = null; this.el = null; }

  resize(w: number, h: number) { view.width = Math.max(1, w); view.height = Math.max(1, h); this.sync(); }

  setCamera(cam: THREE.Camera) { this.camera = cam; view.camera = cam; this.sync(); }

  /** Apply view state to the current camera immediately. */
  sync() {
    const cam = this.camera;
    if (!cam) return;
    const aspect = view.width / view.height;
    const tx = view.target.x, tz = view.target.y;
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const c = cam as THREE.OrthographicCamera;
      c.left = -view.span / 2; c.right = view.span / 2;
      c.top = view.span / 2 / aspect; c.bottom = -view.span / 2 / aspect;
      c.near = 0.1; c.far = 5000; c.zoom = 1;
      c.position.set(tx, 1000, tz);
      c.up.set(0, 0, -1);
      c.lookAt(tx, 0, tz);
      c.updateProjectionMatrix();
    } else {
      const c = cam as THREE.PerspectiveCamera;
      c.fov = PERSPECTIVE_FOV; c.aspect = aspect;
      const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(PERSPECTIVE_FOV) / 2) * aspect);
      const d = view.span / 2 / Math.tan(hfov / 2);
      const st = Math.sin(view.tilt), ct = Math.cos(view.tilt);
      c.position.set(tx + st * Math.sin(view.heading) * d, ct * d, tz + st * Math.cos(view.heading) * d);
      c.up.set(0, 1, 0);
      c.lookAt(tx, 0, tz);
      c.near = Math.max(0.05, d * 0.02); c.far = d * 12;
      c.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  update(nowMs: number) {
    if (!this.anim) return;
    const k = Math.min(1, (nowMs - this.anim.t0) / this.anim.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const [fx, fz, fs] = this.anim.from, [tx, tz, ts] = this.anim.to;
    // Zoom out-then-in arc for long hops.
    const hop = Math.hypot(tx - fx, tz - fz);
    const arc = Math.sin(Math.PI * e) * Math.min(hop * 0.6, MAX_SPAN * 0.5);
    view.target.set(fx + (tx - fx) * e, fz + (tz - fz) * e);
    view.span = Math.max(minSpan(), fs + (ts - fs) * e + (hop > fs * 0.8 ? arc : 0));
    if (k >= 1) this.anim = null;
    this.sync();
  }

  flyTo(gx: number, gy: number, spanGame?: number) {
    const to: [number, number, number] = [gx * S, -gy * S, spanGame ? Math.min(MAX_SPAN, Math.max(minSpan(), spanGame * S)) : view.span];
    if (this.reducedMotion) {
      view.target.set(to[0], to[1]); view.span = to[2]; this.anim = null; this.sync(); return;
    }
    this.anim = { from: [view.target.x, view.target.y, view.span], to, t0: performance.now(), dur: 900 };
  }

  fitCrop() {
    const w = (CROP_GAME.maxX - CROP_GAME.minX) * S, h = (CROP_GAME.maxY - CROP_GAME.minY) * S;
    const aspect = view.width / view.height;
    view.span = Math.min(MAX_SPAN, Math.max(w, h * aspect) * (this.mode === "afterdark" ? 0.62 : 0.92));
    view.target.set(((CROP_GAME.minX + CROP_GAME.maxX) / 2) * S, (-(CROP_GAME.minY + CROP_GAME.maxY) / 2) * S + (this.mode === "afterdark" ? h * 0.04 : 0));
    this.anim = null;
    this.sync();
  }

  get atMaxZoom() { return view.span <= minSpan() * 1.001; }
  get atMinZoom() { return view.span >= MAX_SPAN * 0.999; }

  /** Restore the default Afterdark orientation (north up, standard tilt) without moving the target. */
  resetOrientation() {
    view.tilt = DEFAULT_TILT;
    view.heading = 0;
    this.sync();
  }

  zoomBy(factor: number, px = view.width / 2, py = view.height / 2) {
    const before = screenToGround(px, py, this.camera);
    view.span = Math.min(MAX_SPAN, Math.max(minSpan(), view.span * factor));
    this.sync();
    const after = screenToGround(px, py, this.camera);
    if (before && after) { view.target.x += before.x - after.x; view.target.y += before.z - after.z; this.clamp(); this.sync(); }
  }

  private clamp() {
    const m = 4000 * S;
    view.target.x = Math.min(CROP_GAME.maxX * S + m, Math.max(CROP_GAME.minX * S - m, view.target.x));
    view.target.y = Math.min(-CROP_GAME.minY * S + m, Math.max(-CROP_GAME.maxY * S - m, view.target.y));
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.el!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent) {
    if (!this.el) return;
    this.el.focus({ preventScroll: true });
    this.anim = null;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers (tests, assistive tech) have no capture target */ }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), span: view.span, mid: screenToGround((a.x + b.x) / 2, (a.y + b.y) / 2, this.camera) };
      this.drag = null;
      return;
    }
    const rotate = this.mode === "afterdark" && (e.button === 2 || e.ctrlKey || e.altKey);
    let kind: "pan" | "rotate" | "draw" = rotate ? "rotate" : "pan";
    if (!rotate && e.button === 0 && this.handlers?.drawStart) {
      const g = screenToGround(p.x, p.y, this.camera);
      if (g && this.handlers.drawStart(toGame(g))) kind = "draw";
    }
    this.drag = { kind, id: e.pointerId, sx: p.x, sy: p.y, t: performance.now(), moved: false, anchor: screenToGround(p.x, p.y, this.camera), tilt: view.tilt, heading: view.heading };
  }

  private onMove(e: PointerEvent) {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      view.span = Math.min(MAX_SPAN, Math.max(minSpan(), this.pinch.span * (this.pinch.d / Math.max(1, d))));
      this.sync();
      const now = screenToGround((a.x + b.x) / 2, (a.y + b.y) / 2, this.camera);
      if (this.pinch.mid && now) { view.target.x += this.pinch.mid.x - now.x; view.target.y += this.pinch.mid.z - now.z; this.clamp(); this.sync(); }
      return;
    }
    const g = screenToGround(p.x, p.y, this.camera);
    this.handlers?.hover(g ? toGame(g) : null, p.x, p.y);
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(p.x - d.sx, p.y - d.sy) > 5) d.moved = true;
    if (d.kind === "draw") { if (g) this.handlers?.drawMove?.(toGame(g)); return; }
    if (d.kind === "rotate") {
      view.heading = d.heading - ((p.x - d.sx) / view.width) * Math.PI * 1.5;
      view.tilt = Math.min(1.2, Math.max(0.25, d.tilt + ((p.y - d.sy) / view.height) * 1.5));
      this.sync();
      return;
    }
    if (d.anchor && g && d.moved) {
      view.target.x += d.anchor.x - g.x;
      view.target.y += d.anchor.z - g.z;
      this.clamp();
      this.sync();
    }
  }

  private onUp(e: PointerEvent) {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (d.kind === "draw") { this.handlers?.drawEnd?.(); return; }
    if (!d.moved && e.type === "pointerup" && performance.now() - d.t < 600 && d.kind === "pan") this.handlers?.click(p.x, p.y, e);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.anim = null;
    const p = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomBy(Math.exp(delta * 0.0016), p.x, p.y);
  }

  private onKey(e: KeyboardEvent) {
    const step = view.span * 0.12;
    const k = e.key;
    if (k === "ArrowLeft") view.target.x -= step;
    else if (k === "ArrowRight") view.target.x += step;
    else if (k === "ArrowUp") view.target.y -= step;
    else if (k === "ArrowDown") view.target.y += step;
    else if (k === "+" || k === "=") return this.zoomBy(0.8);
    else if (k === "-" || k === "_") return this.zoomBy(1.25);
    else return;
    e.preventDefault();
    this.clamp();
    this.sync();
  }
}

export const rig = new Rig();
