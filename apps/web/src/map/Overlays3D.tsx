import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { headingVector } from "@vicepulse/shared";
import { atlasIndex, useStore } from "../lib/store.ts";
import type { Shape, XY, WorldView } from "../lib/types.ts";
import { CROP_GAME, S, toScene, view } from "./geo.ts";

const H = 0.03;
const v3 = (p: XY, h = H) => new THREE.Vector3(p[0] * S, h, -p[1] * S);

export function shapePoints(s: Shape): XY[] {
  if (s.kind === "rect") {
    const [[x0, y0], [x1, y1]] = s.points;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  }
  if (s.kind === "circle") {
    const [[cx, cy], [ex, ey]] = s.points;
    const r = Math.hypot(ex - cx, ey - cy);
    return Array.from({ length: 65 }, (_, i) => { const a = (i / 64) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as XY; });
  }
  return s.points;
}

export function Grid() {
  const geom = useMemo(() => {
    const pts: number[] = [];
    const step = 1000;
    for (let x = Math.ceil(CROP_GAME.minX / step) * step; x <= CROP_GAME.maxX; x += step) pts.push(x * S, H, -CROP_GAME.minY * S, x * S, H, -CROP_GAME.maxY * S);
    for (let y = Math.ceil(CROP_GAME.minY / step) * step; y <= CROP_GAME.maxY; y += step) pts.push(CROP_GAME.minX * S, H, -y * S, CROP_GAME.maxX * S, H, -y * S);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geom} renderOrder={12}>
      <lineBasicMaterial color="#7884F7" transparent opacity={0.22} depthTest={false} />
    </lineSegments>
  );
}

export function Shapes({ shapes, draft }: { shapes: Shape[]; draft: Shape | null }) {
  const all = draft ? [...shapes, draft] : shapes;
  return (
    <group renderOrder={30}>
      {all.map((s, i) => {
        const pts = shapePoints(s);
        if (pts.length < 2) return null;
        return <Line key={i} points={pts.map((p) => v3(p, H + 0.002 * i))} color={s.color} lineWidth={s.width} transparent opacity={s.opacity} depthTest={false} renderOrder={30} />;
      })}
    </group>
  );
}

export function FovCone({ id }: { id: string | null }) {
  const row = id ? atlasIndex.get(id) : null;
  const geom = useMemo(() => {
    if (!row?.fov || row.x == null || row.y == null) return null;
    const [heading, angle, range] = row.fov;
    const pts = [row.x * S, H, -row.y * S];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const [dx, dy] = headingVector(heading - angle / 2 + (angle * i) / steps);
      pts.push((row.x + dx * range) * S, H, -(row.y + dy * range) * S);
    }
    const idx: number[] = [];
    for (let i = 1; i <= steps; i++) idx.push(0, i, i + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    return g;
  }, [row]);
  if (!geom) return null;
  return (
    <mesh geometry={geom} renderOrder={18}>
      <meshBasicMaterial color="#F7A35C" transparent opacity={0.22} depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Displayed (interpolated) actor positions, read by the label layer. */
export const actorDisplay = new Map<string, XY>();

export const ACTOR_COLORS: Record<string, string> = {
  wren: "#7884F7", nico: "#F7A35C", jules: "#F7A35C", tamsin: "#F4717C", rourke: "#F4717C", dade: "#FFDF80",
  mara: "#E963C7", vega: "#E963C7", dorian: "#B1A1E8", ines: "#5FE3A1", bo: "#CBBFD8", priya: "#CBBFD8",
};

export function stepActorDisplay(v: WorldView | undefined, dt: number, reduced: boolean) {
  if (!v) return;
  const k = reduced ? 1 : 1 - Math.exp(-dt * 3.5);
  for (const a of v.actors) {
    const cur = actorDisplay.get(a.id);
    if (!cur || Math.hypot(cur[0] - a.pos[0], cur[1] - a.pos[1]) > 1500) actorDisplay.set(a.id, [a.pos[0], a.pos[1]]);
    else actorDisplay.set(a.id, [cur[0] + (a.pos[0] - cur[0]) * k, cur[1] + (a.pos[1] - cur[1]) * k]);
  }
}

export function Actors({ worldId, reduced }: { worldId: string | undefined; reduced: boolean }) {
  const v = useStore((s) => (worldId ? s.views[worldId] : undefined));
  const group = useRef<THREE.Group>(null!);
  const disc = useMemo(() => new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), []);
  const ring = useMemo(() => new THREE.RingGeometry(1.25, 1.6, 32).rotateX(-Math.PI / 2), []);
  useFrame((_, dt) => {
    stepActorDisplay(v, dt, reduced);
    const s = view.span * 0.0042;
    group.current?.children.forEach((child) => {
      const id = child.userData.id as string;
      const p = actorDisplay.get(id);
      if (p) child.position.set(p[0] * S, 0.06, -p[1] * S);
      child.scale.setScalar(s * (id === "wren" ? 1.35 : 1));
    });
  });
  if (!v) return null;
  return (
    <group ref={group}>
      {v.actors.map((a) => (
        <group key={a.id} userData={{ id: a.id }}>
          <mesh geometry={disc} renderOrder={50}><meshBasicMaterial color={ACTOR_COLORS[a.id] ?? "#FFF8F2"} depthTest={false} /></mesh>
          <mesh geometry={ring} renderOrder={50}><meshBasicMaterial color="#09060E" transparent opacity={0.85} depthTest={false} /></mesh>
        </group>
      ))}
    </group>
  );
}

export function Routes({ worldId, showGraph }: { worldId: string | undefined; showGraph: boolean }) {
  const scenario = useStore((s) => s.scenario);
  const mission = useStore((s) => (worldId ? s.views[worldId]?.mission : null));
  const actors = useStore((s) => (worldId ? s.views[worldId]?.actors : undefined));
  const nodes = useMemo(() => new Map(scenario?.nodes.map((n) => [n.id, n.game]) ?? []), [scenario]);
  const edges = useMemo(() => scenario?.edges.map((e) => [nodes.get(e.from)!, nodes.get(e.to)!, e.crossing] as const).filter((e) => e[0] && e[1]) ?? [], [scenario, nodes]);
  const wren = actors?.find((a) => a.id === "wren");
  const driver = mission?.driverId ? actors?.find((a) => a.id === mission.driverId) : null;
  const missionRoute = mission && ["offer", "pickup", "delivery", "complication"].includes(mission.stage) ? mission.routeNodes.map((n) => nodes.get(n)!).filter(Boolean) : null;
  const travel = (a: typeof wren) => (a?.route ? a.route.nodes.slice(a.route.seg).map((n) => nodes.get(n)!).filter(Boolean) : null);
  const wrenPath = travel(wren);
  const driverPath = travel(driver ?? undefined);
  return (
    <group>
      {showGraph && edges.map(([a, b, crossing], i) => (
        <Line key={i} points={[v3(a, 0.035), v3(b, 0.035)]} color={crossing === "land" ? "#CBBFD8" : "#7884F7"} lineWidth={1} transparent opacity={0.28} dashed={crossing !== "land"} dashSize={0.4} gapSize={0.3} depthTest={false} renderOrder={25} />
      ))}
      {missionRoute && missionRoute.length > 1 && <Line points={missionRoute.map((p) => v3(p, 0.04))} color="#F976B0" lineWidth={3} transparent opacity={0.7} depthTest={false} renderOrder={26} />}
      {wrenPath && wrenPath.length > 0 && wren && <Line points={[v3(wren.pos, 0.045), ...wrenPath.map((p) => v3(p, 0.045))]} color="#7884F7" lineWidth={2} dashed dashSize={0.5} gapSize={0.3} depthTest={false} renderOrder={27} />}
      {driverPath && driverPath.length > 0 && driver && <Line points={[v3(driver.pos, 0.045), ...driverPath.map((p) => v3(p, 0.045))]} color="#F7A35C" lineWidth={2.5} depthTest={false} renderOrder={27} />}
    </group>
  );
}

export function MissionRings({ worldId, reduced }: { worldId: string | undefined; reduced: boolean }) {
  const scenario = useStore((s) => s.scenario);
  const mission = useStore((s) => (worldId ? s.views[worldId]?.mission : null));
  const group = useRef<THREE.Group>(null!);
  const geo = useMemo(() => new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2), []);
  const rings = useMemo(() => {
    if (!scenario || !mission) return [];
    const node = (id: string) => scenario.nodes.find((n) => n.id === id)?.game;
    const out: { at: XY; color: string }[] = [];
    if (["lead", "investigating", "offer", "pickup"].includes(mission.stage)) { const p = node("velvet"); if (p) out.push({ at: p, color: "#F976B0" }); }
    if (["offer", "pickup", "delivery", "complication"].includes(mission.stage)) { const p = node("port_berth"); if (p) out.push({ at: p, color: "#F7A35C" }); }
    if (mission.complication) { const p = node(mission.complication.node); if (p) out.push({ at: p, color: "#FF5D55" }); }
    return out;
  }, [scenario, mission]);
  useFrame(({ clock }) => {
    const base = view.span * 0.012;
    group.current?.children.forEach((c, i) => {
      const t = reduced ? 0.5 : (clock.elapsedTime * 0.6 + i * 0.33) % 1;
      c.scale.setScalar(base * (1 + t * 1.6));
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = reduced ? 0.8 : 1 - t;
    });
  });
  return (
    <group ref={group}>
      {rings.map((r, i) => (
        <mesh key={i} geometry={geo} position={toScene(r.at[0], r.at[1], 0.05)} renderOrder={45}>
          <meshBasicMaterial color={r.color} transparent depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}
