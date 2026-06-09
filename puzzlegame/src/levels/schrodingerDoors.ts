import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh, type Box, BoxWorld } from "../world";

/**
 * Schrödinger Doors — cold "observation lab" corridor with four doors.
 *
 * Each door is a quantum panel that is solid (closed) by default and collapses
 * to passable (open) the instant the player's central gaze lands on its
 * surface. Look away and it re-seals. The *fourth* door inverts the rule:
 * observation collapses it shut. A floor glyph in front of each door tells
 * you which: a bare eye (observe to open) or an eye with a slash through it
 * (observe to close).
 *
 * The inverted door is solvable elegantly by looking down to read its glyph —
 * the act of reading happens to pitch the door out of the central FOV cone,
 * which opens it. Walking through while keeping your gaze on the floor passes
 * cleanly.
 *
 * Ability: Observer Lock (E) — for 2.5s freezes every door at its current
 * state, so you can cross a door even after looking elsewhere. 7s cooldown.
 *
 * Visual identity: dim teal-tinted lab with phosphor-green floor grid, a
 * scan-line + cool desaturation post-process, and the panels themselves
 * animate as violet (standard) or amber (inverted) wave-function interference.
 */

const HALL_HALF_X = 3;
const HALL_H = 4;
const Z_START = -3;
const Z_END = 42;

const DOOR_HALF_W = 3.0;
const DOOR_HALF_H = 1.8; // panel spans y=0..3.6, with center 0.2m above eye
const DOOR_CENTER_Y = DOOR_HALF_H;
const DOOR_THICK = 0.18;

interface DoorSpec {
  z: number;
  inverted: boolean;
}
const DOOR_SPECS: DoorSpec[] = [
  { z: 6, inverted: false },
  { z: 16, inverted: false },
  { z: 26, inverted: false },
  { z: 34, inverted: true },
];

// Central-FOV cone for observation. ~16° half-angle is generous enough that
// "look ahead" reliably keeps a door open even during head-bob micro-jitter.
const OBS_HALF_ANGLE = 0.28;
const OBS_COS = Math.cos(OBS_HALF_ANGLE);
const OBS_RANGE = 28;

const LOCK_DURATION = 2.5;
const LOCK_COOLDOWN = 7.0;

interface Door {
  z: number;
  inverted: boolean;
  panel: THREE.Mesh;
  material: THREE.ShaderMaterial;
  collider: Box;
  isOpen: boolean;
  openAmt: number; // 0..1 smoothed visual state
  closedMin: THREE.Vector3;
  closedMax: THREE.Vector3;
}

const QUANTUM_DOOR_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const QUANTUM_DOOR_FS = /* glsl */ `
  uniform float uTime;
  uniform float uOpen;
  uniform float uInverted;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;

    // Three-wave interference, like a probability amplitude.
    float w1 = sin((uv.x * 18.0 + uv.y *  6.0) - uTime * 1.6);
    float w2 = sin((uv.x *  9.0 - uv.y * 22.0) + uTime * 2.1);
    float w3 = sin((uv.x * 32.0 + uv.y * 30.0) - uTime * 3.4);
    float interf = (w1 + w2 + w3) / 3.0;

    // Sparse twinkles drift upward — "virtual particles".
    float gx = floor(uv.x * 40.0);
    float gy = floor(uv.y * 50.0 + uTime * 3.0);
    float twinkle = step(0.986, hash(vec2(gx, gy)));

    // Soft inset frame so the panel reads as a defined object.
    float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x)
              * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.92, uv.y);

    // Standard doors: violet/cyan plasma. Inverted: amber/orange.
    vec3 closedStd = mix(vec3(0.10, 0.06, 0.32), vec3(0.42, 0.30, 0.95), 0.5 + 0.45 * interf);
    vec3 closedInv = mix(vec3(0.38, 0.16, 0.04), vec3(1.00, 0.65, 0.18), 0.5 + 0.45 * interf);
    vec3 closedCol = mix(closedStd, closedInv, uInverted);
    closedCol += vec3(1.0) * twinkle * 1.4;
    float closedA = mix(0.62, 0.94, 0.5 + 0.5 * interf) * edge;

    // Open: thin outline only — you can read it as a doorway, not a wall.
    vec3 openColStd = vec3(0.55, 0.85, 1.0);
    vec3 openColInv = vec3(1.00, 0.80, 0.55);
    vec3 openCol = mix(openColStd, openColInv, uInverted);
    float frameLine = 1.0 - smoothstep(0.0, 0.05, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    float openA = frameLine * 0.55;

    vec3 col = mix(closedCol, openCol, uOpen);
    float a   = mix(closedA, openA,   uOpen);

    gl_FragColor = vec4(col, a);
  }
`;

function makeFloorGlyphTexture(inverted: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  const stroke = inverted ? "#ffae54" : "#6cd0ff";
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Eye outline (a lens shape).
  ctx.beginPath();
  ctx.moveTo(40, 128);
  ctx.bezierCurveTo(80, 56, 176, 56, 216, 128);
  ctx.bezierCurveTo(176, 200, 80, 200, 40, 128);
  ctx.closePath();
  ctx.stroke();

  // Pupil.
  ctx.beginPath();
  ctx.arc(128, 128, 28, 0, Math.PI * 2);
  ctx.fill();

  if (inverted) {
    // Diagonal slash through the eye = "do NOT observe".
    ctx.strokeStyle = "#ff6038";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(38, 220);
    ctx.lineTo(220, 38);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function createObserverHazeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uLock: { value: 0 },
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
      uniform float uLock;
      varying vec2 vUv;

      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;

        // Crisp scanlines — observation lab CRT.
        float sl = 0.94 + 0.06 * sin(vUv.y * 900.0);
        c *= sl;

        // Cool desaturation.
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        vec3 cool = vec3(lum) * vec3(0.85, 0.96, 1.12);
        c = mix(c, cool, 0.30);

        // Vignette.
        vec2 d = vUv - 0.5;
        float vig = 1.0 - smoothstep(0.32, 0.95, length(d));
        c *= mix(0.62, 1.0, vig);

        // Observer Lock: amber rim flicker so the ability has a strong tell.
        float lockPulse = 0.5 + 0.5 * sin(uTime * 13.0);
        c += vec3(0.6, 0.42, 0.10) * uLock * (1.0 - vig) * lockPulse * 0.55;

        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

export class SchrodingerDoorsLevel implements Level {
  name = "Schrödinger Doors";
  blurb =
    "Doors collapse to <b>open</b> the instant you observe them — and re-seal the instant you look away. The fourth glyph is slashed: that door <i>inverts</i> the rule. Press <b>E</b> to lock every door at its current state for 2.5s.";
  abilityLabel = "Observer Lock (E)";

  postMaterial?: THREE.ShaderMaterial;

  private doors: Door[] = [];
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private glyphTextures: THREE.CanvasTexture[] = [];
  private lockUntil = 0;
  private cdDone = 0;
  private lockedStates: boolean[] | null = null;
  private hazeMat!: THREE.ShaderMaterial;

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;

    this.doors = [];
    this.glyphTextures = [];
    this.lockUntil = 0;
    this.cdDone = 0;
    this.lockedStates = null;

    scene.background = new THREE.Color(0x05080f);
    scene.fog = new THREE.Fog(0x05080f, 14, 46);

    const amb = new THREE.AmbientLight(0xb0c8ff, 0.55);
    scene.add(amb);
    const key = new THREE.DirectionalLight(0xcfdcff, 0.45);
    key.position.set(2, 12, 0);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x66a0c0, 0.18);
    fill.position.set(-3, 5, 10);
    scene.add(fill);

    this.hazeMat = createObserverHazeMaterial();
    this.postMaterial = this.hazeMat;

    // --- corridor shell
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x202836 });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x0e1118 });
    const ceilMat = new THREE.MeshLambertMaterial({ color: 0x161c28 });

    const cZ = (Z_START + Z_END) / 2;
    const corridorD = Z_END - Z_START;
    const corridorW = HALL_HALF_X * 2;

    const floor = box(0, -0.5, cZ, corridorW + 2, 1, corridorD + 2);
    scene.add(boxMesh(floor, floorMat));
    world.add(floor);

    const ceil = box(0, HALL_H + 0.5, cZ, corridorW + 2, 1, corridorD + 2);
    scene.add(boxMesh(ceil, ceilMat));
    world.add(ceil);

    const wallT = 0.4;
    const wW = box(-HALL_HALF_X - wallT / 2, HALL_H / 2, cZ, wallT, HALL_H, corridorD);
    scene.add(boxMesh(wW, wallMat));
    world.add(wW);
    const wE = box(HALL_HALF_X + wallT / 2, HALL_H / 2, cZ, wallT, HALL_H, corridorD);
    scene.add(boxMesh(wE, wallMat));
    world.add(wE);
    const wS = box(0, HALL_H / 2, Z_START - wallT / 2, corridorW + wallT * 2, HALL_H, wallT);
    scene.add(boxMesh(wS, wallMat));
    world.add(wS);
    const wN = box(0, HALL_H / 2, Z_END + wallT / 2, corridorW + wallT * 2, HALL_H, wallT);
    scene.add(boxMesh(wN, wallMat));
    world.add(wN);

    // Phosphor-green floor grid lines.
    const gridSize = Math.max(corridorW, corridorD);
    const grid = new THREE.GridHelper(gridSize, gridSize, 0x3affa0, 0x163b22);
    grid.position.set(0, 0.02, cZ);
    const gMat = grid.material as THREE.Material | THREE.Material[];
    const tunes = (m: THREE.Material) => {
      m.transparent = true;
      (m as THREE.LineBasicMaterial).opacity = 0.45;
    };
    if (Array.isArray(gMat)) for (const m of gMat) tunes(m);
    else tunes(gMat);
    scene.add(grid);

    // --- doors
    for (const spec of DOOR_SPECS) {
      this.spawnDoor(scene, world, spec);
    }

    // --- start pad
    const startGeo = new THREE.RingGeometry(0.7, 1.0, 48);
    startGeo.rotateX(-Math.PI / 2);
    const startMat = new THREE.MeshBasicMaterial({
      color: 0x6cd0ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const startMesh = new THREE.Mesh(startGeo, startMat);
    startMesh.position.set(0, 0.05, 0);
    scene.add(startMesh);

    // --- exit pad (past door 4)
    this.exitCenter.set(0, 0.05, 38.5);
    this.exitMesh = makeExitPad();
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    // --- player
    player.reset(new THREE.Vector3(0, 1.6, 0), Math.PI); // face +Z
    player.camera.rotation.set(0, Math.PI, 0, "YXZ");

    ctx.setAbility(this.abilityLabel, "READY");
    ctx.message("Look at a door to open it. Read the floor glyphs.", 6);
  }

  private spawnDoor(scene: THREE.Scene, world: BoxWorld, spec: DoorSpec) {
    const geo = new THREE.BoxGeometry(DOOR_HALF_W * 2, DOOR_HALF_H * 2, DOOR_THICK);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: spec.inverted ? 1 : 0 },
        uInverted: { value: spec.inverted ? 1 : 0 },
      },
      vertexShader: QUANTUM_DOOR_VS,
      fragmentShader: QUANTUM_DOOR_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(geo, mat);
    panel.position.set(0, DOOR_CENTER_Y, spec.z);
    scene.add(panel);

    const closedMin = new THREE.Vector3(
      -DOOR_HALF_W,
      0,
      spec.z - DOOR_THICK / 2
    );
    const closedMax = new THREE.Vector3(
      DOOR_HALF_W,
      DOOR_HALF_H * 2,
      spec.z + DOOR_THICK / 2
    );
    const collider: Box = {
      min: closedMin.clone(),
      max: closedMax.clone(),
    };
    // Inverted doors start open; standard doors start closed. Either way the
    // first update() will set the collider correctly from isOpen.
    if (spec.inverted) {
      collider.min.set(1e6, 1e6, 1e6);
      collider.max.set(1e6 + 0.01, 1e6 + 0.01, 1e6 + 0.01);
    }
    world.add(collider);

    // Floor glyph 1.6m in front of the door (on the start side, -z direction).
    const tex = makeFloorGlyphTexture(spec.inverted);
    this.glyphTextures.push(tex);
    const glyphMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const glyphGeo = new THREE.PlaneGeometry(1.3, 1.3);
    glyphGeo.rotateX(-Math.PI / 2);
    const glyph = new THREE.Mesh(glyphGeo, glyphMat);
    glyph.position.set(0, 0.04, spec.z - 1.6);
    scene.add(glyph);

    this.doors.push({
      z: spec.z,
      inverted: spec.inverted,
      panel,
      material: mat,
      collider,
      isOpen: spec.inverted,
      openAmt: spec.inverted ? 1 : 0,
      closedMin,
      closedMax,
    });
  }

  ability(_ctx: LevelContext) {
    const now = performance.now() / 1000;
    if (now < this.cdDone) return;
    this.lockUntil = now + LOCK_DURATION;
    this.cdDone = now + LOCK_COOLDOWN;
    this.lockedStates = this.doors.map((d) => d.isOpen);
  }

  update(dt: number, ctx: LevelContext) {
    const now = performance.now() / 1000;
    const { player } = ctx;

    const locked = now < this.lockUntil;
    if (!locked) this.lockedStates = null;

    const fwd = player.forward();
    const eye = player.eyePos();
    const smoothK = 1 - Math.exp(-dt * 16); // fast visual snap, not instant

    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      let isOpen: boolean;
      if (locked && this.lockedStates) {
        isOpen = this.lockedStates[i];
      } else {
        // Closest point on the door panel rectangle to the eye. Using the
        // closest point (not the panel center) prevents trivial "auto-open"
        // when the player walks within ~1m of an inverted door — the panel
        // still subtends most of the FOV.
        const cx = THREE.MathUtils.clamp(eye.x, -DOOR_HALF_W, DOOR_HALF_W);
        const cy = THREE.MathUtils.clamp(
          eye.y,
          DOOR_CENTER_Y - DOOR_HALF_H,
          DOOR_CENTER_Y + DOOR_HALF_H
        );
        const cz = d.z;
        const dx = cx - eye.x;
        const dy = cy - eye.y;
        const dz = cz - eye.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let observed = false;
        if (dist < OBS_RANGE && dist > 1e-4) {
          const dot = (fwd.x * dx + fwd.y * dy + fwd.z * dz) / dist;
          observed = dot > OBS_COS;
        } else if (dist <= 1e-4) {
          // Pressed right against the panel — treat as observed.
          observed = true;
        }
        isOpen = d.inverted ? !observed : observed;
      }
      d.isOpen = isOpen;

      const target = isOpen ? 1 : 0;
      d.openAmt = d.openAmt + (target - d.openAmt) * smoothK;
      d.material.uniforms.uOpen.value = d.openAmt;
      d.material.uniforms.uTime.value = now;

      // Discrete state for collider — must NOT use openAmt or you can clip
      // through during the transition.
      if (isOpen) {
        d.collider.min.set(1e6, 1e6, 1e6);
        d.collider.max.set(1e6 + 0.01, 1e6 + 0.01, 1e6 + 0.01);
      } else {
        d.collider.min.copy(d.closedMin);
        d.collider.max.copy(d.closedMax);
      }
    }

    this.hazeMat.uniforms.uTime.value = now;
    this.hazeMat.uniforms.uLock.value = locked ? 1 : 0;

    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = now;
    const exDx = player.position.x - this.exitCenter.x;
    const exDz = player.position.z - this.exitCenter.z;
    if (exDx * exDx + exDz * exDz < 1.1 * 1.1) ctx.complete();

    let state: string;
    if (locked) state = `LOCK ${(this.lockUntil - now).toFixed(1)}s`;
    else if (now < this.cdDone) state = `... ${(this.cdDone - now).toFixed(1)}s`;
    else state = "READY";
    ctx.setAbility(this.abilityLabel, state);
  }

  dispose(_ctx: LevelContext) {
    this.postMaterial = undefined;
    for (const t of this.glyphTextures) t.dispose();
    this.glyphTextures = [];
    this.doors = [];
    this.lockedStates = null;
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
        gl_FragColor = vec4(0.55, 0.85, 1.0, a);
      }
    `,
  });
  return new THREE.Mesh(exitGeo, exitMat);
}
