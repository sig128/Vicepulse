import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useStore } from "../lib/store.ts";
import { markers } from "./markers.ts";
import { CROP_GAME, S } from "./geo.ts";

const W = 192;
const H = Math.round((W * (CROP_GAME.maxY - CROP_GAME.minY)) / (CROP_GAME.maxX - CROP_GAME.minX));

/** Kernel density of the currently filtered markers. Labelled "marker density", not activity. */
export function densityGrid(): Float32Array {
  const grid = new Float32Array(W * H);
  const sx = W / (CROP_GAME.maxX - CROP_GAME.minX), sy = H / (CROP_GAME.maxY - CROP_GAME.minY);
  markers.rows.forEach((r, i) => {
    if (!markers.visible[i]) return;
    const gx = Math.floor((r.x! - CROP_GAME.minX) * sx), gy = Math.floor((CROP_GAME.maxY - r.y!) * sy);
    if (gx >= 0 && gy >= 0 && gx < W && gy < H) grid[gy * W + gx] += 1;
  });
  // Separable gaussian blur, sigma ≈ 2 cells.
  const k = [0.05, 0.12, 0.2, 0.26, 0.2, 0.12, 0.05];
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = -3; j <= 3; j++) { const xx = x + j; if (xx >= 0 && xx < W) s += grid[y * W + xx] * k[j + 3]; }
    tmp[y * W + x] = s;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = -3; j <= 3; j++) { const yy = y + j; if (yy >= 0 && yy < H) s += tmp[yy * W + x] * k[j + 3]; }
    grid[y * W + x] = s;
  }
  return grid;
}

export function Heatmap() {
  const filterKey = useStore((s) => `${s.layers.datasets.join("")}|${s.filter.q}|${s.filter.category}`);
  const { mesh, tex } = useMemo(() => {
    const data = new Uint8Array(W * H * 4);
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.flipY = false;
    const g = new THREE.PlaneGeometry((CROP_GAME.maxX - CROP_GAME.minX) * S, (CROP_GAME.maxY - CROP_GAME.minY) * S).rotateX(-Math.PI / 2);
    g.translate(((CROP_GAME.minX + CROP_GAME.maxX) / 2) * S, 0.01, (-(CROP_GAME.minY + CROP_GAME.maxY) / 2) * S);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { map: { value: tex } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main(){ float v = texture2D(map, vec2(vUv.x, 1.0 - vUv.y)).r;
          vec3 c = mix(vec3(0.286,0.918,0.961), vec3(1.0,0.31,0.675), smoothstep(0.25,0.6,v));
          c = mix(c, vec3(0.961,0.784,0.471), smoothstep(0.65,0.95,v));
          gl_FragColor = vec4(c * smoothstep(0.02, 0.35, v), smoothstep(0.02, 0.5, v) * 0.85); }`,
    });
    return { mesh: new THREE.Mesh(g, m), tex };
  }, []);

  useEffect(() => {
    const grid = densityGrid();
    let max = 0;
    for (const v of grid) max = Math.max(max, v);
    const data = tex.image.data as Uint8Array;
    for (let i = 0; i < grid.length; i++) {
      const v = max > 0 ? Math.sqrt(grid[i] / max) : 0;
      data[i * 4] = Math.round(v * 255); data[i * 4 + 3] = 255;
    }
    tex.needsUpdate = true;
  }, [filterKey, tex]);

  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); tex.dispose(); }, [mesh, tex]);
  return <primitive object={mesh} renderOrder={15} />;
}
