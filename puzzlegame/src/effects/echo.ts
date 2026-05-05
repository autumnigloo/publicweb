import * as THREE from "three";

const MAX_PULSES = 4;

/**
 * Echo material: surfaces are nearly black by default, and light up briefly
 * as a spherical sonar wavefront passes through them.
 *
 * Up to MAX_PULSES concurrent pulses. Each pulse has an origin and a start
 * time; the wave radius grows as `speed * (now - start)` and the surface
 * brightness peaks at the wavefront, falling off behind it.
 */
export class EchoEffect {
  readonly material: THREE.ShaderMaterial;
  private pulseOrigins: THREE.Vector3[] = [];
  private pulseStarts: number[] = [];
  private pulseColors: THREE.Color[] = [];
  private nextSlot = 0;
  private startTime = performance.now() / 1000;

  constructor(opts: {
    baseColor?: THREE.Color;
    glowColor?: THREE.Color;
    speed?: number;
    width?: number;
    fade?: number;
  } = {}) {
    const baseColor = opts.baseColor ?? new THREE.Color(0x05060a);
    const glowColor = opts.glowColor ?? new THREE.Color(0x6cf3ff);
    const speed = opts.speed ?? 9.0;
    const width = opts.width ?? 1.4;
    const fade = opts.fade ?? 0.45;

    for (let i = 0; i < MAX_PULSES; i++) {
      this.pulseOrigins.push(new THREE.Vector3(0, -9999, 0));
      this.pulseStarts.push(-1000);
      this.pulseColors.push(glowColor.clone());
    }

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBaseColor: { value: baseColor },
        uPulseOrigins: { value: this.pulseOrigins },
        uPulseStarts: { value: this.pulseStarts.slice() },
        uPulseColors: { value: this.pulseColors },
        uPulseSpeed: { value: speed },
        uPulseWidth: { value: width },
        uPulseFade: { value: fade },
        uPlayerPos: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3  uBaseColor;
        uniform vec3  uPulseOrigins[${MAX_PULSES}];
        uniform float uPulseStarts[${MAX_PULSES}];
        uniform vec3  uPulseColors[${MAX_PULSES}];
        uniform float uPulseSpeed;
        uniform float uPulseWidth;
        uniform float uPulseFade;
        uniform vec3  uPlayerPos;

        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 col = uBaseColor;

          // Tiny self-glow around the player so they're not 100% blind.
          float playerDist = distance(vWorldPos, uPlayerPos);
          float selfGlow = exp(-playerDist * 0.55) * 0.10;
          col += vec3(0.45, 0.55, 0.75) * selfGlow;

          for (int i = 0; i < ${MAX_PULSES}; i++) {
            float age = uTime - uPulseStarts[i];
            if (age < 0.0 || age > 8.0) continue;

            float radius = age * uPulseSpeed;
            float d = distance(vWorldPos, uPulseOrigins[i]);

            // Distance from the spherical wavefront.
            float front = abs(d - radius);
            // Sharp band exactly at the wavefront.
            float band = exp(-front * front / (uPulseWidth * uPulseWidth));

            // Trailing memory: surfaces stay faintly lit after the wave passed.
            float trail = 0.0;
            if (d < radius) {
              float since = (radius - d) / uPulseSpeed; // seconds since hit
              trail = exp(-since / uPulseFade) * 0.55;
            }

            // Distance falloff overall.
            float falloff = 1.0 / (1.0 + 0.04 * d * d);

            // A bit of normal facing factor so corners read as corners.
            float facing = 0.35 + 0.65 * abs(dot(normalize(vNormal), normalize(vWorldPos - uPulseOrigins[i])));

            col += uPulseColors[i] * (band + trail) * falloff * facing;
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }

  /** Emit a pulse from world-space `origin`. */
  pulse(origin: THREE.Vector3, color?: THREE.Color) {
    const slot = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % MAX_PULSES;
    this.pulseOrigins[slot].copy(origin);
    this.pulseStarts[slot] = performance.now() / 1000 - this.startTime;
    if (color) this.pulseColors[slot].copy(color);
    // Make sure Three.js sees the array changes.
    (this.material.uniforms.uPulseStarts.value as number[])[slot] = this.pulseStarts[slot];
  }

  update(playerPos: THREE.Vector3) {
    const t = performance.now() / 1000 - this.startTime;
    this.material.uniforms.uTime.value = t;
    (this.material.uniforms.uPlayerPos.value as THREE.Vector3).copy(playerPos);
  }
}

/** Visible expanding wavefront sphere, faded over time. */
export class PulseWaveVisual {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private origin = new THREE.Vector3();
  private startTime = -1000;
  private speed: number;
  private maxRadius: number;

  constructor(opts: { speed?: number; maxRadius?: number; color?: THREE.Color } = {}) {
    this.speed = opts.speed ?? 9.0;
    this.maxRadius = opts.maxRadius ?? 30;
    const color = opts.color ?? new THREE.Color(0x6cf3ff);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: color },
        uAlpha: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -normalize(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float fres = pow(1.0 - abs(dot(vNormal, vView)), 2.5);
          gl_FragColor = vec4(uColor, fres * uAlpha);
        }
      `,
    });

    const geo = new THREE.SphereGeometry(1, 32, 16);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(0.001);
    this.mesh.visible = false;
  }

  pulse(origin: THREE.Vector3) {
    this.origin.copy(origin);
    this.startTime = performance.now() / 1000;
    this.mesh.visible = true;
  }

  update() {
    if (!this.mesh.visible) return;
    const age = performance.now() / 1000 - this.startTime;
    const radius = age * this.speed;
    if (radius > this.maxRadius) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.position.copy(this.origin);
    this.mesh.scale.setScalar(radius);
    const lifetime = this.maxRadius / this.speed;
    this.material.uniforms.uAlpha.value = Math.max(0, 1 - age / lifetime) * 0.55;
  }
}
