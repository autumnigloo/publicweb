import * as THREE from "three";

/**
 * Full-screen chromatic-aberration post-process material. Set its `tDiffuse`
 * uniform to the rendered scene texture and draw it on a fullscreen quad with
 * an orthographic camera (see main.ts post pipeline).
 *
 * `uStrength` is the radial RGB-split amount; `uPolarize` (0..1) tilts the
 * world toward a desaturated mirror-blue and lightly inverts the split — used
 * by the Mirror Maze ability so the player can briefly "see clearly".
 */
export function createChromaticAberrationMaterial(opts: {
  strength?: number;
} = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uStrength: { value: opts.strength ?? 0.014 },
      uPolarize: { value: 0 },
      uTime: { value: 0 },
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
      uniform float uStrength;
      uniform float uPolarize;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        vec2 dir = vUv - 0.5;
        float dist = length(dir);

        // Subtle wobble so the world feels uneasy / mirrored.
        float wobble = 1.0 + 0.18 * sin(uTime * 1.3 + dist * 18.0);
        float strength = uStrength * mix(1.0, 0.25, uPolarize);
        vec2 off = dir * dist * strength * wobble;

        // While polarizing, flip the split direction so it pulses inverted —
        // gives the ability a clearly different visual signature.
        float sign = mix(1.0, -1.0, uPolarize);

        float r = texture2D(tDiffuse, vUv + off * 1.4 * sign).r;
        float g = texture2D(tDiffuse, vUv).g;
        float b = texture2D(tDiffuse, vUv - off * 1.4 * sign).b;

        vec3 col = vec3(r, g, b);

        // Vignette toward the corners — heavier when polarized, like staring
        // through cold glass.
        float vig = 1.0 - smoothstep(0.35, 0.95, dist);
        col *= mix(0.65, 1.0, vig);

        // Polarize: desaturate + cool blue lift so the trick mirrors stand
        // out from the truth.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 cool = vec3(lum) * vec3(0.85, 0.95, 1.15);
        col = mix(col, cool, uPolarize * 0.6);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
