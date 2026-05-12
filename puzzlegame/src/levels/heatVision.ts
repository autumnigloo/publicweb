import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh, BoxWorld } from "../world";

/**
 * Heat Vision — a dim industrial room filled with a forest of vertical pillars.
 * Half of them are "cold" structural columns that physically block movement
 * and are clearly visible in normal vision. The other half are "heat bars":
 * lethal-to-touch glowing rods that are almost invisible in normal vision and
 * blaze bright orange in thermal vision.
 *
 * Ability: Thermal Lens (E) — toggles a thermal-camera post-process. In
 * thermal mode the cold pillars desaturate into a uniform dark purple, while
 * the heat bars saturate the red channel and bloom up the IR palette. The
 * tradeoff: thermal mode kills your ability to read the maze of cold pillars
 * cleanly, so you have to flip-flop between senses to plan a safe lane.
 *
 * Visual identity: IR-camera palette (deep purple → red → orange → yellow →
 * white) with scanline flicker when thermal is engaged. Normal mode uses a
 * cool industrial cyan-grey palette.
 */

const ROOM_W = 18;
const ROOM_D = 26;
const ROOM_H = 4;

const PILLAR_R = 0.55;
const HEAT_BAR_R = 0.22;
const HEAT_KILL_R = 0.65; // lethal radius from heat bar center (player rad 0.35)
const HEAT_BAR_H = 3.2;

const COLS = 5;
const ROWS = 5;
const COL_SPACING = 3.2;
const ROW_SPACING = 3.6;
const FIELD_Z0 = 4.6;

// 5x5 layout, near→far. '.' empty, 'C' cold pillar, 'H' heat bar.
// Tuned so the player must weave: a straight-ahead path always hits a bar or
// a pillar, but a snaking left-right-left lane through the empties is clear.
const LAYOUT = [
  "C.H.C",
  ".H.H.",
  "C.C.H",
  "H.H.C",
  "C.H..",
];

interface HeatBar {
  pos: THREE.Vector3;
  material: THREE.ShaderMaterial;
}

const HEAT_BAR_VS = /* glsl */ `
  varying vec2 vUv;
  varying float vY;
  void main() {
    vUv = uv;
    vY = position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HEAT_BAR_FS = /* glsl */ `
  uniform float uTime;
  uniform float uTherm;
  uniform float uPhase;
  varying vec2 vUv;
  varying float vY;

  void main() {
    // Vertical heat ripple — looks like rising convection.
    float ripple = 0.5 + 0.5 * sin(vY * 4.0 - uTime * 5.0 + uPhase);
    float core   = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.4);

    // Thermal palette: deep red core to orange edge with yellow hotspot.
    vec3 hot = mix(vec3(1.00, 0.18, 0.05), vec3(1.00, 0.62, 0.15), ripple);
    hot = mix(hot, vec3(1.00, 0.95, 0.55), core * 0.55);

    // Normal-mode appearance: nearly transparent cyan-grey glass. Just enough
    // that the player notices something is there if they look really hard,
    // but not enough to read as a threat without the thermal lens.
    vec3 cold = vec3(0.10, 0.14, 0.20);

    vec3 col   = mix(cold, hot, uTherm);
    float alpha = mix(0.16, 0.96, uTherm);

    gl_FragColor = vec4(col, alpha);
  }
`;

function createThermalLensMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uTherm: { value: 0 },
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
      uniform float uTherm;
      varying vec2 vUv;

      vec3 thermalPalette(float t) {
        // Classic IR camera ramp.
        vec3 c1 = vec3(0.02, 0.02, 0.08); // void
        vec3 c2 = vec3(0.25, 0.05, 0.40); // purple
        vec3 c3 = vec3(0.85, 0.10, 0.10); // red
        vec3 c4 = vec3(1.00, 0.55, 0.10); // orange
        vec3 c5 = vec3(1.00, 0.95, 0.40); // yellow
        vec3 c6 = vec3(1.0);              // white-hot
        t = clamp(t, 0.0, 1.0);
        if (t < 0.20) return mix(c1, c2,  t            / 0.20);
        if (t < 0.40) return mix(c2, c3, (t - 0.20)    / 0.20);
        if (t < 0.60) return mix(c3, c4, (t - 0.40)    / 0.20);
        if (t < 0.85) return mix(c4, c5, (t - 0.60)    / 0.25);
        return            mix(c5, c6, (t - 0.85)       / 0.15);
      }

      void main() {
        vec3 src = texture2D(tDiffuse, vUv).rgb;
        float lum = dot(src, vec3(0.299, 0.587, 0.114));

        // Heat score: pixels rich in red relative to blue+green read as hot.
        float heatScore = clamp(src.r - max(src.g, src.b) * 0.72, 0.0, 1.0);
        // Brightness still nudges temperature up so emissive things glow.
        float temp = clamp(heatScore * 1.9 + lum * 0.45, 0.0, 1.0);

        vec3 thermalC = thermalPalette(temp);
        // Normal mode: a little cool cast so the lab feels chilly.
        vec3 normalC  = src * vec3(0.92, 0.97, 1.06);

        vec3 final = mix(normalC, thermalC, uTherm);

        // IR scan ripples — only in thermal, and only subtly.
        float sl = 0.93 + 0.07 * sin(vUv.y * 620.0 + uTime * 2.2);
        final *= mix(1.0, sl, uTherm * 0.55);

        // Vignette in both modes.
        vec2 d = vUv - 0.5;
        float vig = 1.0 - smoothstep(0.34, 0.95, length(d));
        final *= mix(0.58, 1.0, vig);

        gl_FragColor = vec4(final, 1.0);
      }
    `,
  });
}

export class HeatVisionLevel implements Level {
  name = "Heat Vision";
  blurb =
    "Cold pillars block your path; <b>heat bars</b> kill on contact and are nearly invisible without thermal. Press <b>E</b> to toggle <i>Thermal Lens</i> — but in thermal the cold pillars wash out, so you'll need both senses to find a safe lane.";
  abilityLabel = "Thermal Lens (E)";

  postMaterial?: THREE.ShaderMaterial;

  private heatBars: HeatBar[] = [];
  private thermalMat!: THREE.ShaderMaterial;
  private thermalTarget = 0;
  private thermalNow = 0;
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private respawn = new THREE.Vector3();

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;

    this.heatBars = [];
    this.thermalTarget = 0;
    this.thermalNow = 0;

    scene.background = new THREE.Color(0x0a0e14);
    scene.fog = new THREE.Fog(0x0a0e14, 6, 32);

    scene.add(new THREE.AmbientLight(0x8aa0c0, 0.40));
    const key = new THREE.DirectionalLight(0xb6c8e0, 0.55);
    key.position.set(5, 12, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6488a8, 0.25);
    fill.position.set(-4, 6, -2);
    scene.add(fill);

    this.thermalMat = createThermalLensMaterial();
    this.postMaterial = this.thermalMat;

    // --- shell
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x14181f });
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x1c2330 });
    const ceilMat = new THREE.MeshLambertMaterial({ color: 0x10141a });

    const cZ = ROOM_D / 2;
    const wT = 0.4;

    const floor = box(0, -0.5, cZ, ROOM_W + 2, 1, ROOM_D + 2);
    scene.add(boxMesh(floor, floorMat));
    world.add(floor);
    const ceil = box(0, ROOM_H + 0.5, cZ, ROOM_W + 2, 1, ROOM_D + 2);
    scene.add(boxMesh(ceil, ceilMat));
    world.add(ceil);
    const wS = box(0, ROOM_H / 2, -wT / 2, ROOM_W + wT * 2, ROOM_H, wT);
    scene.add(boxMesh(wS, wallMat));
    world.add(wS);
    const wN = box(0, ROOM_H / 2, ROOM_D + wT / 2, ROOM_W + wT * 2, ROOM_H, wT);
    scene.add(boxMesh(wN, wallMat));
    world.add(wN);
    const wW = box(-ROOM_W / 2 - wT / 2, ROOM_H / 2, cZ, wT, ROOM_H, ROOM_D);
    scene.add(boxMesh(wW, wallMat));
    world.add(wW);
    const wE = box(ROOM_W / 2 + wT / 2, ROOM_H / 2, cZ, wT, ROOM_H, ROOM_D);
    scene.add(boxMesh(wE, wallMat));
    world.add(wE);

    // Faint cyan grid on the floor for a "scan deck" feel.
    const grid = new THREE.GridHelper(Math.max(ROOM_W, ROOM_D), Math.max(ROOM_W, ROOM_D), 0x2a4860, 0x14202c);
    grid.position.set(0, 0.02, cZ);
    const tunes = (m: THREE.Material) => {
      m.transparent = true;
      (m as THREE.LineBasicMaterial).opacity = 0.35;
    };
    const gMat = grid.material as THREE.Material | THREE.Material[];
    if (Array.isArray(gMat)) for (const m of gMat) tunes(m);
    else tunes(gMat);
    scene.add(grid);

    // --- pillar field
    const startX = -((COLS - 1) / 2) * COL_SPACING;
    for (let r = 0; r < ROWS; r++) {
      const row = LAYOUT[r];
      for (let c = 0; c < COLS; c++) {
        const ch = row[c];
        if (ch === ".") continue;
        const px = startX + c * COL_SPACING;
        const pz = FIELD_Z0 + r * ROW_SPACING;
        if (ch === "C") this.spawnColdPillar(scene, world, px, pz);
        else if (ch === "H") this.spawnHeatBar(scene, px, pz);
      }
    }

    // --- pads
    const startGeo = new THREE.RingGeometry(0.7, 1.0, 48);
    startGeo.rotateX(-Math.PI / 2);
    const startMat = new THREE.MeshBasicMaterial({
      color: 0x4cb0e0,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const startMesh = new THREE.Mesh(startGeo, startMat);
    startMesh.position.set(0, 0.05, 1);
    scene.add(startMesh);

    this.exitCenter.set(0, 0.05, ROOM_D - 1.8);
    this.exitMesh = makeExitPad();
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    this.respawn.set(0, 1.6, 1);
    player.reset(this.respawn, Math.PI); // face +Z

    ctx.setAbility(this.abilityLabel, "NORMAL");
    ctx.message("Press <b>E</b> to scan in thermal. Heat bars are lethal.", 5);
  }

  private spawnColdPillar(scene: THREE.Scene, world: BoxWorld, x: number, z: number) {
    const geo = new THREE.CylinderGeometry(PILLAR_R, PILLAR_R, ROOM_H, 14);
    const mat = new THREE.MeshLambertMaterial({ color: 0x3a4860 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, ROOM_H / 2, z);
    scene.add(mesh);

    // Approximate the round pillar with a square AABB. Slightly smaller than
    // the visual radius so the player can graze a corner without snagging.
    const colliderHalf = PILLAR_R * 0.9;
    const collider = box(x, ROOM_H / 2, z, colliderHalf * 2, ROOM_H, colliderHalf * 2);
    world.add(collider);
  }

  private spawnHeatBar(scene: THREE.Scene, x: number, z: number) {
    const geo = new THREE.CylinderGeometry(HEAT_BAR_R, HEAT_BAR_R, HEAT_BAR_H, 14);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTherm: { value: 0 },
        uPhase: { value: Math.random() * Math.PI * 2 },
      },
      vertexShader: HEAT_BAR_VS,
      fragmentShader: HEAT_BAR_FS,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, HEAT_BAR_H / 2 + 0.2, z);
    scene.add(mesh);

    this.heatBars.push({ pos: new THREE.Vector3(x, 0, z), material: mat });
  }

  ability(_ctx: LevelContext) {
    this.thermalTarget = this.thermalTarget > 0.5 ? 0 : 1;
  }

  update(dt: number, ctx: LevelContext) {
    const now = performance.now() / 1000;
    const { player } = ctx;

    const k = 1 - Math.exp(-dt * 6.0);
    this.thermalNow += (this.thermalTarget - this.thermalNow) * k;

    for (const hb of this.heatBars) {
      hb.material.uniforms.uTime.value = now;
      hb.material.uniforms.uTherm.value = this.thermalNow;
    }

    this.thermalMat.uniforms.uTime.value = now;
    this.thermalMat.uniforms.uTherm.value = this.thermalNow;

    // Lethal proximity check.
    const px = player.position.x;
    const pz = player.position.z;
    const killSq = HEAT_KILL_R * HEAT_KILL_R;
    for (const hb of this.heatBars) {
      const dx = px - hb.pos.x;
      const dz = pz - hb.pos.z;
      if (dx * dx + dz * dz < killSq) {
        player.reset(this.respawn, Math.PI);
        ctx.message("🔥 Burned. Scan in thermal before committing.", 2.5);
        return;
      }
    }

    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = now;

    const exDx = px - this.exitCenter.x;
    const exDz = pz - this.exitCenter.z;
    if (exDx * exDx + exDz * exDz < 1.1 * 1.1) ctx.complete();

    ctx.setAbility(this.abilityLabel, this.thermalTarget > 0.5 ? "THERMAL" : "NORMAL");
  }

  dispose(_ctx: LevelContext) {
    this.postMaterial = undefined;
    this.heatBars = [];
  }
}

function makeExitPad(): THREE.Mesh {
  const exitGeo = new THREE.CircleGeometry(1.0, 32);
  exitGeo.rotateX(-Math.PI / 2);
  const exitMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float d = distance(vUv, vec2(0.5));
        float ring = smoothstep(0.5, 0.42, d) - smoothstep(0.42, 0.30, d);
        float pulse = 0.55 + 0.45 * sin(uTime * 2.4);
        float core  = smoothstep(0.30, 0.0, d) * 0.5;
        float a = ring * pulse + core;
        // Cyan-green so it never reads as a heat bar in thermal.
        gl_FragColor = vec4(0.30, 0.95, 0.60, a);
      }
    `,
  });
  return new THREE.Mesh(exitGeo, exitMat);
}
