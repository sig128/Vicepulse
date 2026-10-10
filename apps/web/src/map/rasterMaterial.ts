import * as THREE from "three";
import { LEGEND_CLIP } from "./geo.ts";

/**
 * One material for the overview and every LOD tile. uMode 0 = Atlas (source colours, untouched),
 * 1 = Afterdark (the same raster reclassified: dark land, deep water, emissive roads, glowing coast).
 * Geometry is identical in both modes; only colour changes.
 */
const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vGame;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vGame = vec2(w.x * 100.0, -w.z * 100.0);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uMode;
  uniform vec2 uTexel;
  uniform vec4 uUvRect;   // uv offset/scale (overview crop)
  uniform vec2 uClip;     // legend: discard where game x >= clip.x && y >= clip.y
  uniform float uOpacity;
  uniform float uAccent;  // 0 pink, 1 sunset, 2 blue (ACCENT_INDEX)
  varying vec2 vUv;
  varying vec2 vGame;

  float waterness(vec3 c) {
    return smoothstep(0.10, 0.22, c.b - max(c.r, c.g * 0.92));
  }

  void main() {
    if (vGame.x >= uClip.x && vGame.y >= uClip.y) discard;
    vec2 uv = uUvRect.xy + vUv * uUvRect.zw;
    vec3 c = texture2D(map, uv).rgb;
    if (uMode < 0.001) { gl_FragColor = vec4(c, uOpacity); return; }

    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float sat = mx - mn;
    float w = waterness(c);
    float road = smoothstep(0.83, 0.93, lum) * (1.0 - smoothstep(0.22, 0.36, sat)) * (1.0 - w);
    float yellow = clamp(((c.r + c.g) * 0.5 - c.b) * 3.0, 0.0, 1.0);
    float urban = (1.0 - smoothstep(0.06, 0.14, sat)) * smoothstep(0.62, 0.80, lum) * (1.0 - road);
    float sand = smoothstep(0.25, 0.4, sat) * smoothstep(0.82, 0.9, lum) * (1.0 - w);
    float label = smoothstep(0.25, 0.45, c.r - max(c.g, c.b));

    // Coastline: water classification of blurred (mip-biased) neighbours, so JPEG block noise
    // inside flat areas does not register as an edge.
    vec2 t = uTexel * 2.0;
    float wn = waterness(texture2D(map, uv + vec2(t.x, 0.0), 1.5).rgb) + waterness(texture2D(map, uv - vec2(t.x, 0.0), 1.5).rgb)
             + waterness(texture2D(map, uv + vec2(0.0, t.y), 1.5).rgb) + waterness(texture2D(map, uv - vec2(0.0, t.y), 1.5).rgb);
    float wc = waterness(texture2D(map, uv, 1.5).rgb);
    float edge = smoothstep(0.18, 0.6, abs(wn * 0.25 - wc));

    // Vice City night: violet land, indigo water, neon-pink streets, sunset-orange highways.
    vec3 pink = vec3(0.976, 0.463, 0.690), coral = vec3(0.957, 0.443, 0.486), orange = vec3(0.969, 0.639, 0.361), blue = vec3(0.471, 0.518, 0.969);
    vec3 accent = uAccent < 0.5 ? pink : (uAccent < 1.5 ? orange : blue);

    float shallow = clamp((c.g - 0.38) * 2.2, 0.0, 1.0);
    vec3 waterCol = mix(vec3(0.035, 0.030, 0.105), vec3(0.075, 0.085, 0.215), shallow);
    vec3 landCol = vec3(0.098, 0.068, 0.150) * (0.75 + lum * 0.5);
    vec3 col = mix(landCol, waterCol, w);
    col = mix(col, vec3(0.150, 0.100, 0.215), urban * 0.9);
    col = mix(col, vec3(0.225, 0.140, 0.150), sand * 0.7);
    vec3 roadCol = mix(mix(pink, coral, 0.35) * 0.82, mix(orange, vec3(1.0, 0.875, 0.502), 0.3), yellow);
    col = mix(col, roadCol, road);
    col = mix(col, mix(blue, accent, 0.35) * 1.15, edge * 0.55);
    col = mix(col, vec3(1.0, 0.973, 0.949) * 0.86, label * 0.7);

    vec3 outCol = mix(c, col, uMode);
    gl_FragColor = vec4(outCol, uOpacity);
  }
`;

export const ACCENT_INDEX = { pink: 0, sunset: 1, blue: 2 } as const;

export function createRasterMaterial(tex: THREE.Texture, uvRect = new THREE.Vector4(0, 0, 1, 1), opts: { transparent?: boolean } = {}) {
  const img = tex.image as { width?: number; height?: number } | undefined;
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: opts.transparent ?? false,
    depthWrite: false,
    uniforms: {
      map: { value: tex },
      uMode: { value: 1 },
      uTexel: { value: new THREE.Vector2(1 / (img?.width ?? 256), 1 / (img?.height ?? 256)) },
      uUvRect: { value: uvRect },
      uClip: { value: new THREE.Vector2(LEGEND_CLIP.minX, LEGEND_CLIP.minY) },
      uOpacity: { value: 1 },
      uAccent: { value: 0 },
    },
  });
}

/** Shared animated mode/accent so every raster material transitions together. */
export const rasterGlobals = { mode: 1, targetMode: 1, accent: 0, materials: new Set<THREE.ShaderMaterial>() };
