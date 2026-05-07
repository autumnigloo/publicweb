import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh } from "../world";
import { createTimeFlowMaterial } from "../effects/timeFlow";

const CORRIDOR_W = 7;
const CORRIDOR_H = 4;
const CORRIDOR_LEN = 56;
const LASER_THICKNESS = 0.18;
const LASER_KILL_RADIUS = 0.45;
const TRAIL_COUNT = 5;
const TRAIL_DT = 0.07; // worldtime spacing between ghost trails

interface LaserSweep {
  zPos: number;
  period: number; // sec for one full back-and-forth cycle
  phase: number;  // 0..1
  liveBar: THREE.Mesh;
  liveMat: THREE.MeshBasicMaterial;
  trails: THREE.Mesh[];
  trailMats: THREE.MeshBasicMaterial[];
  currentX: number;
}

function sweepX(t: number, period: number, phase: number): number {
  const u = ((t / period + phase) % 1 + 1) % 1;
  // Triangle wave 0->1->0, with brief dwell at the ends.
  let tri: number;
  if (u < 0.4) tri = u / 0.4;
  else if (u < 0.5) tri = 1; // dwell
  else if (u < 0.9) tri = 1 - (u - 0.5) / 0.4;
  else tri = 0; // dwell
  const halfRange = CORRIDOR_W / 2 - 0.6;
  return THREE.MathUtils.lerp(-halfRange, halfRange, tri);
}

export class TimeSliceLevel implements Level {
  name = "Time Slice";
  blurb =
    "Time bends to your motion. Stand still and the world freezes; move and it races. Cross the corridor without touching the red sweeps. Press <b>E</b> for a brief emergency freeze.";
  abilityLabel = "Freeze (E)";

  private wallMats: THREE.ShaderMaterial[] = [];
  private lasers: LaserSweep[] = [];
  private worldTime = 0;
  private timeScale = 0.05;
  private freezeUntil = 0;
  private freezeCdDone = 0;
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private startPos = new THREE.Vector3();
  private startYaw = 0;
  private deathFlash = 0;
  private deaths = 0;
  private flashOverlay!: THREE.Mesh;

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;

    // Reset per-init state so restart (R) doesn't keep references to the old
    // (orphaned) meshes/materials.
    this.wallMats = [];
    this.lasers = [];
    this.worldTime = 0;
    this.timeScale = 0.05;
    this.freezeUntil = 0;
    this.freezeCdDone = 0;
    this.deathFlash = 0;
    this.deaths = 0;

    // --- Walls / floor / ceiling.
    const wallMat = createTimeFlowMaterial();
    this.wallMats.push(wallMat);

    const floorMat = new THREE.MeshBasicMaterial({ color: 0xeef0f3 });
    const ceilMat = new THREE.MeshBasicMaterial({ color: 0x111316 });

    const floorB = box(0, -0.5, 0, CORRIDOR_W + 1, 1, CORRIDOR_LEN);
    scene.add(boxMesh(floorB, floorMat));
    world.add(floorB);

    const ceilB = box(0, CORRIDOR_H + 0.5, 0, CORRIDOR_W + 1, 1, CORRIDOR_LEN);
    scene.add(boxMesh(ceilB, ceilMat));
    world.add(ceilB);

    const sideL = box(-CORRIDOR_W / 2 - 0.25, CORRIDOR_H / 2, 0, 0.5, CORRIDOR_H, CORRIDOR_LEN);
    scene.add(boxMesh(sideL, wallMat));
    world.add(sideL);

    const sideR = box(CORRIDOR_W / 2 + 0.25, CORRIDOR_H / 2, 0, 0.5, CORRIDOR_H, CORRIDOR_LEN);
    scene.add(boxMesh(sideR, wallMat));
    world.add(sideR);

    const capStart = box(0, CORRIDOR_H / 2, -CORRIDOR_LEN / 2 - 0.25, CORRIDOR_W, CORRIDOR_H, 0.5);
    scene.add(boxMesh(capStart, wallMat));
    world.add(capStart);

    const capEnd = box(0, CORRIDOR_H / 2, CORRIDOR_LEN / 2 + 0.25, CORRIDOR_W, CORRIDOR_H, 0.5);
    scene.add(boxMesh(capEnd, wallMat));
    world.add(capEnd);

    // --- Lasers. Five sweeps with different periods and phases.
    const sweeps = [
      { z: -16, period: 3.4, phase: 0.0 },
      { z:  -8, period: 2.6, phase: 0.35 },
      { z:   0, period: 4.2, phase: 0.7 },
      { z:   8, period: 2.2, phase: 0.15 },
      { z:  16, period: 3.6, phase: 0.55 },
    ];
    for (const s of sweeps) this.lasers.push(this.makeLaser(scene, s.z, s.period, s.phase));

    // --- Player start at the near end (-Z), facing +Z.
    this.startPos.set(0, 1.6, -CORRIDOR_LEN / 2 + 2.5);
    this.startYaw = Math.PI;
    player.reset(this.startPos.clone(), this.startYaw);

    // --- Exit pad at far end.
    this.exitCenter.set(0, 0.05, CORRIDOR_LEN / 2 - 2.5);
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
          gl_FragColor = vec4(0.95, 0.98, 1.0, a);
        }
      `,
    });
    this.exitMesh = new THREE.Mesh(exitGeo, exitMat);
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    // --- Death-flash full-screen overlay (camera-locked plane).
    const flashGeo = new THREE.PlaneGeometry(2, 2);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.flashOverlay = new THREE.Mesh(flashGeo, flashMat);
    this.flashOverlay.frustumCulled = false;
    this.flashOverlay.renderOrder = 9999;
    // Attach to camera so it fills the view.
    player.camera.add(this.flashOverlay);
    this.flashOverlay.position.set(0, 0, -0.1);

    ctx.setAbility(this.abilityLabel, "READY");
    ctx.message("Move = time. Stand still to think. Touch a sweep and you reset.", 5);
  }

  private makeLaser(scene: THREE.Scene, z: number, period: number, phase: number): LaserSweep {
    const liveMat = new THREE.MeshBasicMaterial({
      color: 0xff2230,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const liveGeo = new THREE.BoxGeometry(LASER_THICKNESS, CORRIDOR_H * 0.96, LASER_THICKNESS);
    const liveBar = new THREE.Mesh(liveGeo, liveMat);
    liveBar.position.set(0, CORRIDOR_H / 2, z);
    scene.add(liveBar);

    const trails: THREE.Mesh[] = [];
    const trailMats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const tMat = new THREE.MeshBasicMaterial({
        color: 0xff5566,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const tGeo = new THREE.BoxGeometry(LASER_THICKNESS * 0.85, CORRIDOR_H * 0.96, LASER_THICKNESS * 0.85);
      const tBar = new THREE.Mesh(tGeo, tMat);
      tBar.position.set(0, CORRIDOR_H / 2, z);
      scene.add(tBar);
      trails.push(tBar);
      trailMats.push(tMat);
    }

    return {
      zPos: z,
      period,
      phase,
      liveBar,
      liveMat,
      trails,
      trailMats,
      currentX: 0,
    };
  }

  ability(_ctx: LevelContext) {
    const now = performance.now() / 1000;
    if (now < this.freezeCdDone) return;
    this.freezeUntil = now + 1.4;
    this.freezeCdDone = now + 6.0;
  }

  update(dt: number, ctx: LevelContext) {
    const now = performance.now() / 1000;
    const { player } = ctx;

    // Player horizontal speed (XZ only).
    const speed2D = Math.hypot(player.velocity.x, player.velocity.z);
    const moveFrac = Math.min(1, speed2D / player.walkSpeed);
    let targetScale = 0.04 + 0.96 * moveFrac;
    if (now < this.freezeUntil) targetScale = 0.0;

    // Smooth time-scale changes so it doesn't snap.
    const k = 1 - Math.exp(-dt * 8);
    this.timeScale = THREE.MathUtils.lerp(this.timeScale, targetScale, k);
    this.worldTime += dt * this.timeScale;

    // Wall scroll uniforms.
    for (const m of this.wallMats) {
      m.uniforms.uWorldTime.value = this.worldTime;
      m.uniforms.uTimeScale.value = this.timeScale;
      m.uniforms.uPlayerY.value = player.position.y;
    }

    // Lasers.
    for (const l of this.lasers) {
      const xNow = sweepX(this.worldTime, l.period, l.phase);
      l.currentX = xNow;
      l.liveBar.position.x = xNow;
      // Pulse the live bar slightly.
      const pulse = 0.85 + 0.15 * Math.sin(this.worldTime * 9 + l.phase * 6);
      l.liveMat.opacity = pulse;

      // Ghost trails: sample previous worldtime positions.
      for (let i = 0; i < TRAIL_COUNT; i++) {
        const dT = (i + 1) * TRAIL_DT;
        const x = sweepX(this.worldTime - dT, l.period, l.phase);
        l.trails[i].position.x = x;
        // Fade strongly with age, and damp by current motion (still = no trail).
        const fade = (1 - i / TRAIL_COUNT) * 0.55 * Math.min(1, this.timeScale * 1.6 + 0.05);
        l.trailMats[i].opacity = fade;
      }

      // Lethal collision: vertical bar at (xNow, *, l.zPos), thickness ~LASER_THICKNESS.
      const dx = player.position.x - xNow;
      const dz = player.position.z - l.zPos;
      if (Math.hypot(dx, dz) < LASER_KILL_RADIUS) {
        this.killAndRespawn(ctx);
        break;
      }
    }

    // Death flash decay.
    if (this.deathFlash > 0) {
      this.deathFlash = Math.max(0, this.deathFlash - dt * 1.5);
      (this.flashOverlay.material as THREE.MeshBasicMaterial).opacity = this.deathFlash;
    }

    // Exit.
    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = now;
    const exDx = player.position.x - this.exitCenter.x;
    const exDz = player.position.z - this.exitCenter.z;
    if (exDx * exDx + exDz * exDz < 1.1 * 1.1) {
      ctx.complete();
    }

    // HUD.
    let abilityState: string;
    if (now < this.freezeUntil) abilityState = "FREEZING";
    else if (now < this.freezeCdDone) abilityState = `... ${(this.freezeCdDone - now).toFixed(1)}s`;
    else abilityState = `READY · ${(this.timeScale * 100).toFixed(0)}%`;
    ctx.setAbility(this.abilityLabel, abilityState);
  }

  private killAndRespawn(ctx: LevelContext) {
    this.deaths++;
    this.deathFlash = 0.6;
    ctx.player.reset(this.startPos.clone(), this.startYaw);
    this.freezeUntil = 0;
    ctx.message(`Sliced. Resets: ${this.deaths}`, 1.6);
  }

  dispose(ctx: LevelContext) {
    // Detach overlay from camera so the next level doesn't inherit a red tint.
    if (this.flashOverlay && this.flashOverlay.parent) {
      this.flashOverlay.parent.remove(this.flashOverlay);
    }
    (this.flashOverlay?.material as THREE.MeshBasicMaterial | undefined)?.dispose?.();
    this.flashOverlay?.geometry?.dispose?.();
  }
}
