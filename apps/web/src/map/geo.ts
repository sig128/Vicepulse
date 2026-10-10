import * as THREE from "three";
import { GTADB_OVERVIEW, GTADB_LEGEND_CLIP, overviewToGame } from "@vicepulse/shared";
import type { XY } from "../lib/types.ts";

/** Scene: x = gameX / 100, z = -gameY / 100 (north = -Z), ground at y = 0. */
export const S = 1 / 100;
export const toScene = (x: number, y: number, h = 0) => new THREE.Vector3(x * S, h, -y * S);
export const toGame = (v: THREE.Vector3): XY => [v.x / S, -v.z / S];

const crop = GTADB_OVERVIEW.crop;
const [cx0, cy0] = overviewToGame(crop.x, crop.y);
const [cx1, cy1] = overviewToGame(crop.x + crop.width, crop.y + crop.height);
/** Displayed geography in game units (legend column excluded). */
export const CROP_GAME = { minX: cx0, maxX: cx1, minY: cy1, maxY: cy0 };
export const CROP_CENTER: XY = [(cx0 + cx1) / 2, (cy0 + cy1) / 2];
export const LEGEND_CLIP = GTADB_LEGEND_CLIP;

/** Mutable camera/view state shared by the rig, LOD, picking and HTML overlays. */
export const view = {
  target: new THREE.Vector2(CROP_CENTER[0] * S, -CROP_CENTER[1] * S),
  span: 160, // visible world width at target, scene units
  tilt: 0.95, // radians from vertical (afterdark)
  heading: 0,
  width: 1, height: 1,
  camera: null as THREE.Camera | null,
  dom: null as HTMLElement | null,
  /** Screen pixels per game unit at the target. */
  get ppu() { return this.width / (this.span / S); },
};

const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();

export function screenToGround(px: number, py: number, camera = view.camera): THREE.Vector3 | null {
  if (!camera) return null;
  ndc.set((px / view.width) * 2 - 1, -(py / view.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(ground, hit) ? hit.clone() : null;
}

export function screenToGame(px: number, py: number): XY | null {
  const g = screenToGround(px, py);
  return g ? toGame(g) : null;
}

const tmp = new THREE.Vector3();
export function gameToScreen(x: number, y: number, h = 0): [number, number, boolean] {
  if (!view.camera) return [0, 0, false];
  tmp.set(x * S, h, -y * S).project(view.camera);
  return [(tmp.x + 1) * 0.5 * view.width, (1 - tmp.y) * 0.5 * view.height, tmp.z < 1 && tmp.z > -1];
}

export const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}
