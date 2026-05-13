import * as THREE from "three";

/**
 * Full-screen colour-invert post-process used by the Inverted Color level.
 * In "positive" polarity (uPolarity = 0) it's a near-passthrough with a faint
 * scanline tint. As uPolarity crossfades to 1 ("negative") the framebuffer is
 * inverted ( rgb -> 1 - rgb ), so light walls become dark, red things become
 * cyan, cyan things become red. A short additive flash + heavier scanlines
 * during the transition sell the "polarity flip" moment.
 *
 * Uniforms:
 *   tDiffuse  — scene render target
 *   uTime     — seconds
 *   uPolarity — 0 positive, 1 negative (lerp this from the level)
 *   uFlash    — 0..1, briefly spiked on flip
 */
export function createColorInvertMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uPolarity: { value: 0 },
      uFlash: { value: 0 },
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
      uniform float uPolarity;
      uniform float uFlash;
      varying vec2 vUv;

      void main() {
        vec3 src = texture2D(tDiffuse, vUv).rgb;

        // The headline effect — straight colour inversion crossfaded by uPolarity.
        vec3 inv  = vec3(1.0) - src;
        vec3 col  = mix(src, inv, uPolarity);

        // Heavy scanlines during flip; subtle in steady state. The scanlines
        // also nudge the eye that the framebuffer is being "processed", not
        // that the room itself somehow physically changed.
        float scan  = 0.92 + 0.08 * sin(vUv.y * 820.0 + uTime * 3.5);
        float scanMix = mix(0.25, 0.9, uFlash);
        col *= mix(1.0, scan, scanMix);

        // Additive white flash on transition — clears the eye and gives the
        // moment a satisfying "click".
        col += vec3(uFlash) * 0.55;

        // Mild vignette so the inverted (bright) corners don't blow out.
        vec2 d = vUv - 0.5;
        float vig = 1.0 - smoothstep(0.42, 1.0, length(d));
        col *= mix(0.78, 1.0, vig);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
