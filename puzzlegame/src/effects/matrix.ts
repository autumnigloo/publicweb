import * as THREE from "three";

/**
 * Procedural "Matrix rain" wall material. Pure fragment-shader implementation:
 * each column scrolls at its own speed, and "characters" are 5x7 pseudo-glyph
 * patterns that flicker over time. `direction` is +1 (down) or -1 (up).
 *
 * This level's puzzle relies on the direction: fake/passable walls flow
 * upward, real/solid walls flow downward.
 */
export function createMatrixMaterial(opts: {
  direction?: 1 | -1;
  cols?: number;
  rows?: number;
  speed?: number;
  tint?: THREE.Color;
} = {}): THREE.ShaderMaterial {
  const direction = opts.direction ?? 1;
  const cols = opts.cols ?? 8;
  const rows = opts.rows ?? 16;
  const speed = opts.speed ?? 1.0;
  const tint = opts.tint ?? new THREE.Color(0.0, 1.0, 0.35);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDirection: { value: direction },
      uCols: { value: cols },
      uRows: { value: rows },
      uSpeed: { value: speed },
      uTint: { value: tint },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDirection;
      uniform float uCols;
      uniform float uRows;
      uniform float uSpeed;
      uniform vec3  uTint;
      varying vec2 vUv;

      float hash1(float n) { return fract(sin(n) * 43758.5453); }
      float hash2(vec2 p)  { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float hash3(vec3 p)  { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

      void main() {
        // UV in character-cell space.
        vec2 cu = vec2(vUv.x * uCols, vUv.y * uRows);
        vec2 cellId = floor(cu);
        vec2 sub = fract(cu);

        // Per-column scroll.
        float col = cellId.x;
        float colSpeed = 1.6 + hash1(col * 1.37) * 2.4;
        float colOffset = hash1(col * 7.13 + 1.0) * 80.0;
        float headRow = mod(uTime * colSpeed * uSpeed * uDirection + colOffset, 60.0);

        // Distance from cell to the head, wrapping.
        float dist = mod(headRow - cellId.y * uDirection, 60.0);

        // Brightness profile: bright head, exponentially fading tail, dark elsewhere.
        float brightness;
        if (dist < 1.0)        brightness = 1.6;
        else if (dist < 14.0)  brightness = exp(-(dist - 1.0) * 0.32);
        else                   brightness = 0.0;

        // 5x7 pseudo-character pattern that changes a few times per second per cell.
        float charSeed = floor(uTime * 6.0 + hash2(cellId) * 100.0);
        vec2 pix = floor(sub * vec2(5.0, 7.0));
        // Borders dark — gives breathing space between glyphs.
        float pad = step(0.05, sub.x) * step(sub.x, 0.95) * step(0.05, sub.y) * step(sub.y, 0.95);
        float lit = step(0.55, hash3(vec3(pix, charSeed + cellId.x * 0.7 + cellId.y * 0.3))) * pad;

        // Mix head (white) with tail (tinted green/whatever).
        vec3 col_rgb = mix(uTint, vec3(0.95, 1.0, 0.95), step(1.4, brightness));
        vec3 finalCol = col_rgb * lit * brightness;

        // Add a faint background glow so the wall isn't pitch-black between characters.
        finalCol += uTint * 0.025;

        gl_FragColor = vec4(finalCol, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}
