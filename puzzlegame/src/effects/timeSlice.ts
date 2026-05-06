import * as THREE from "three";

/**
 * Monochrome wall material for Time Slice level. Pure black-and-white pulse
 * grid that slowly drifts. Designed to feel "high contrast / film-noir" so
 * the magenta lasers pop against it.
 */
export function createMonochromeWallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
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
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      // Rotating per-axis grid lines + faint scanline shimmer.
      float gridLine(float x) {
        float f = abs(fract(x) - 0.5);
        return smoothstep(0.48, 0.5, f);
      }

      void main() {
        // Use whichever two axes the surface is most tangent to.
        vec3 n = abs(vNormal);
        vec2 uv;
        if (n.y > n.x && n.y > n.z) uv = vWorldPos.xz;
        else if (n.x > n.z)         uv = vWorldPos.yz;
        else                        uv = vWorldPos.xy;

        float g = max(gridLine(uv.x * 0.5), gridLine(uv.y * 0.5));
        float scan = 0.5 + 0.5 * sin(vWorldPos.y * 6.0 - uTime * 0.6);

        float v = 0.05 + g * 0.18 + scan * 0.04;
        gl_FragColor = vec4(vec3(v), 1.0);
      }
    `,
  });
}

/**
 * A laser "blade": thin vertical beam that slides across the X axis between
 * the corridor walls. Comes with a pool of trail copies that lag behind to
 * sell the motion-blur look without a real post-process pass.
 */
export class LaserBlade {
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  private trails: THREE.Mesh[] = [];
  private trailMat: THREE.ShaderMaterial;
  private mainMat: THREE.ShaderMaterial;

  // Sample buffer of past x positions; oldest first.
  private history: number[] = [];
  private historyMax = 16;
  private sampleAccum = 0;

  readonly z: number;
  readonly omega: number;
  readonly phaseOffset: number;
  readonly amplitude: number;

  // Last computed blade x (in local coords; the group is positioned at z).
  blade_x = 0;

  constructor(opts: {
    z: number;
    omega: number;
    phaseOffset: number;
    amplitude: number;
    height: number;
  }) {
    this.z = opts.z;
    this.omega = opts.omega;
    this.phaseOffset = opts.phaseOffset;
    this.amplitude = opts.amplitude;

    this.group = new THREE.Group();
    this.group.position.z = opts.z;

    this.mainMat = makeBladeMaterial(1.0);
    this.trailMat = makeBladeMaterial(0.45);

    const geo = new THREE.PlaneGeometry(0.18, opts.height);
    geo.rotateY(Math.PI / 2);

    this.mesh = new THREE.Mesh(geo, this.mainMat);
    this.mesh.position.y = opts.height / 2;
    this.group.add(this.mesh);

    for (let i = 0; i < this.historyMax; i++) {
      const t = new THREE.Mesh(geo, this.trailMat);
      t.position.y = opts.height / 2;
      t.visible = false;
      this.trails.push(t);
      this.group.add(t);
    }
  }

  update(dt: number, levelTime: number, scale: number) {
    this.mainMat.uniforms.uTime.value = levelTime;
    this.trailMat.uniforms.uTime.value = levelTime;

    this.blade_x = Math.sin(levelTime * this.omega + this.phaseOffset) * this.amplitude;
    this.mesh.position.x = this.blade_x;

    // Sample trails at a rate proportional to how fast level-time is moving.
    this.sampleAccum += dt * scale;
    if (this.sampleAccum > 0.04) {
      this.sampleAccum = 0;
      this.history.push(this.blade_x);
      if (this.history.length > this.historyMax) this.history.shift();
    }

    // Apply history to trail meshes; oldest = most faded.
    for (let i = 0; i < this.trails.length; i++) {
      const histIdx = this.history.length - 1 - i;
      const t = this.trails[i];
      if (histIdx >= 0) {
        t.visible = true;
        t.position.x = this.history[histIdx];
        const a = (1 - i / this.trails.length) * 0.55;
        (t.material as THREE.ShaderMaterial).uniforms.uAlpha.value = a;
      } else {
        t.visible = false;
      }
    }
  }
}

function makeBladeMaterial(alpha: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        // Vertical magenta beam with bright core, soft falloff to the edges.
        float dx = abs(vUv.x - 0.5);
        float core = smoothstep(0.5, 0.0, dx);
        float flicker = 0.85 + 0.15 * sin(vUv.y * 80.0 + uTime * 12.0);
        vec3 hot = vec3(1.0, 0.45, 0.85);
        gl_FragColor = vec4(hot * core * flicker, core * uAlpha);
      }
    `,
  });
}
