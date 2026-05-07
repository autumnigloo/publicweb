import * as THREE from "three";

/**
 * Time-flow wall material: high-contrast black panel with horizontal white
 * tick-lines that scroll vertically. The scroll *rate* is driven by the
 * level's `uTimeScale` uniform, so when the player freezes, the walls
 * visibly stop. Doubles as a clean monochrome aesthetic for Level 3.
 */
export function createTimeFlowMaterial(opts: {
  tickSpacing?: number;
  tickWidth?: number;
  scrollSpeed?: number;
  base?: THREE.Color;
  tick?: THREE.Color;
} = {}): THREE.ShaderMaterial {
  const tickSpacing = opts.tickSpacing ?? 0.18;
  const tickWidth = opts.tickWidth ?? 0.012;
  const scrollSpeed = opts.scrollSpeed ?? 0.55;
  const base = opts.base ?? new THREE.Color(0x050608);
  const tick = opts.tick ?? new THREE.Color(0xf0f4ff);

  return new THREE.ShaderMaterial({
    uniforms: {
      uWorldTime: { value: 0 },
      uTimeScale: { value: 1 },
      uTickSpacing: { value: tickSpacing },
      uTickWidth: { value: tickWidth },
      uScrollSpeed: { value: scrollSpeed },
      uBase: { value: base },
      uTick: { value: tick },
      uPlayerY: { value: 1.6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uWorldTime;
      uniform float uTimeScale;
      uniform float uTickSpacing;
      uniform float uTickWidth;
      uniform float uScrollSpeed;
      uniform vec3  uBase;
      uniform vec3  uTick;
      uniform float uPlayerY;

      varying vec3 vWorldPos;

      void main() {
        // Use y in world-space, scrolled by world-time.
        float y = vWorldPos.y - uWorldTime * uScrollSpeed;
        float r = mod(y, uTickSpacing);
        // distance from nearest tick edge
        float d = min(r, uTickSpacing - r);
        float line = smoothstep(uTickWidth, 0.0, d);

        // Make every 5th tick a fat band so motion is unmistakable.
        float idx = floor(y / uTickSpacing);
        float major = step(4.5, mod(idx, 5.0));
        line = max(line, smoothstep(uTickWidth * 2.5, 0.0, d) * major * 0.85);

        // Speed-tinted ticks: pure white at high time-scale, dimmer when frozen.
        float speedTint = mix(0.35, 1.0, clamp(uTimeScale, 0.0, 1.0));

        // Subtle eye-level glow so corridor doesn't disappear in pure black.
        float eye = exp(-abs(vWorldPos.y - uPlayerY) * 0.6) * 0.04;

        vec3 col = uBase + uTick * line * speedTint + vec3(0.7, 0.78, 1.0) * eye;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
