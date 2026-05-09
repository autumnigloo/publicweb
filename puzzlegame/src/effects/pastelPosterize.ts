import * as THREE from "three";

/**
 * Pastel posterize post-process. Quantizes the rendered scene into a small
 * number of luminance bands, biases the palette toward soft creamy pastels,
 * and adds a faint paper-grain. Used by Gravity Cubes for its low-poly
 * Moebius/Tintin look.
 */
export function createPastelPosterizeMaterial(opts: {
  bands?: number;
  warmth?: number;
} = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uBands: { value: opts.bands ?? 5 },
      uWarmth: { value: opts.warmth ?? 0.18 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uBands;
      uniform float uWarmth;
      varying vec2 vUv;

      // Cheap hash for paper grain.
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;

        // Lift blacks toward a warm cream so nothing reads as pure black.
        c = mix(vec3(0.94, 0.91, 0.86), c, 0.86);

        // Posterize per-channel with a soft falloff so bands don't flicker.
        float b = max(2.0, uBands);
        vec3 q = floor(c * b + 0.5) / b;
        c = mix(c, q, 0.78);

        // Warm pastel tint — gently push reds + greens, pull blues.
        c.r += uWarmth * 0.10;
        c.g += uWarmth * 0.06;
        c.b -= uWarmth * 0.05;

        // Tiny paper grain.
        float g = hash(floor(vUv * 1024.0) + floor(uTime * 12.0));
        c += (g - 0.5) * 0.025;

        // Soft vignette.
        vec2 d = vUv - 0.5;
        float vig = 1.0 - smoothstep(0.40, 0.95, length(d));
        c *= mix(0.78, 1.0, vig);

        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    `,
  });
}
