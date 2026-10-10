import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useStore } from "../lib/store.ts";
import { markers, markerColor, updateClusters, applyFilter, forceRecluster } from "./markers.ts";
import { S, view } from "./geo.ts";
import { rasterGlobals } from "./rasterMaterial.ts";

const vertex = /* glsl */ `
  attribute vec3 aColorA;
  attribute vec3 aColorB;
  attribute float aState; // 0 hidden, 1 normal, 2 hovered, 3 selected
  uniform float uMode;
  uniform float uDpr;
  uniform float uScale;
  varying vec3 vColor;
  varying float vState;
  void main() {
    vColor = mix(aColorA, aColorB, uMode);
    vState = aState;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Zero-sized points are undefined on some GPU backends (they corrupted later instanced line draws on ANGLE/Metal), so hidden points are clipped instead.
    if (aState < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return; }
    // Core diameter in CSS px; the sprite is 2.8× larger to leave room for the halo (K in the fragment shader).
    float core = aState > 2.5 ? 11.0 : (aState > 1.5 ? 9.0 : 6.0 * uScale);
    gl_PointSize = core * 2.8 * uDpr;
  }
`;

const fragment = /* glsl */ `
  uniform float uMode;
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vColor;
  varying float vState;
  const float K = 1.0 / 2.8; // core radius in sprite units
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float hovered = step(1.5, vState) * (1.0 - step(2.5, vState));
    float selected = step(2.5, vState);
    float disc = 1.0 - smoothstep(K * 0.74, K * 0.84, r);
    float rim = smoothstep(K * 0.74, K * 0.84, r) * (1.0 - smoothstep(K * 0.98, K * 1.08, r));
    float hot = 1.0 - smoothstep(0.0, K * 0.5, r);
    // Thin dark rim keeps dots legible on the bright Atlas raster; Afterdark gets a light rim instead.
    vec3 rimCol = mix(vec3(0.035, 0.025, 0.06), mix(vColor, vec3(1.0), 0.3), uMode);
    float rimA = mix(0.8, 0.9, uMode);
    if (selected > 0.5) { rimCol = vec3(1.0, 0.973, 0.949); rimA = 1.0; }
    vec3 rgb = mix(vColor, vec3(1.0), hot * 0.38);
    rgb = mix(rgb, rimCol, rim * (1.0 - disc));
    float a = max(disc, rim * rimA);
    float halo = pow(clamp(1.0 - (r - K) / (1.0 - K), 0.0, 1.0), 2.6) * (mix(0.32, 0.55, uMode) + hovered * 0.25 + selected * 0.2);
    if (selected > 0.5) {
      float t = fract(uTime * 0.7) * uMotion;
      float rp = K * 1.2 + (1.0 - K * 1.2) * t;
      float ping = (1.0 - smoothstep(0.0, 0.05, abs(r - rp))) * (1.0 - t) * uMotion;
      halo = max(halo, ping * 0.9);
    }
    float g = halo * (1.0 - a);
    rgb = (rgb * a + vColor * g) / max(a + g, 1e-4);
    gl_FragColor = vec4(rgb, clamp(a + g, 0.0, 1.0));
  }
`;

export function MarkerPoints({ reduced = false }: { reduced?: boolean }) {
  const mode = useStore((s) => s.mode);
  const selectedId = useStore((s) => s.selectedId);
  const layers = useStore((s) => s.layers);
  const filter = useStore((s) => s.filter);
  const hoverRef = useRef<number>(-1);
  const lastVersion = useRef(-1);

  const { geometry, material, state } = useMemo(() => {
    const n = markers.rows.length;
    const pos = new Float32Array(n * 3), ca = new Float32Array(n * 3), cb = new Float32Array(n * 3), st = new Float32Array(n);
    const c = new THREE.Color();
    markers.rows.forEach((r, i) => {
      pos.set([r.x! * S, 0.02, -r.y! * S], i * 3);
      c.set(markerColor(r, "atlas")); ca.set([c.r, c.g, c.b], i * 3);
      c.set(markerColor(r, "afterdark")); cb.set([c.r, c.g, c.b], i * 3);
      st[i] = 1;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColorA", new THREE.BufferAttribute(ca, 3));
    g.setAttribute("aColorB", new THREE.BufferAttribute(cb, 3));
    const sa = new THREE.BufferAttribute(st, 1);
    sa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aState", sa);
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uMode: { value: 1 }, uDpr: { value: Math.min(2, window.devicePixelRatio || 1) }, uTime: { value: 0 }, uScale: { value: 1 }, uMotion: { value: 1 } },
    });
    return { geometry: g, material: m, state: sa };
  }, [markers.rows.length]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useEffect(() => { applyFilter(layers, filter); }, [layers, filter]);
  useEffect(() => { forceRecluster(); }, [selectedId, layers.clusters]);

  useFrame(({ clock }) => {
    material.uniforms.uMode.value = rasterGlobals.mode;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uMotion.value = reduced ? 0 : 1;
    material.uniforms.uScale.value = 1 + Math.min(1, Math.max(0, (view.ppu - 0.4) / 1.6)) * 0.35;
    updateClusters(layers.clusters, selectedId);
    const hovered = markers.hoverIndex;
    if (markers.version === lastVersion.current && hovered === hoverRef.current) return;
    lastVersion.current = markers.version;
    hoverRef.current = hovered;
    const arr = state.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      const r = markers.rows[i];
      arr[i] = r.id === selectedId ? 3 : !markers.visible[i] || markers.clustered[i] ? 0 : i === hovered ? 2 : 1;
    }
    state.needsUpdate = true;
  });

  void mode;
  return <points geometry={geometry} material={material} renderOrder={20} frustumCulled={false} />;
}
