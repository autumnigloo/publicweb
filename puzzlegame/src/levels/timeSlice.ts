import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh } from "../world";
import { LaserBlade, createMonochromeWallMaterial } from "../effects/timeSlice";

const CORRIDOR_W = 7;
const CORRIDOR_H = 4;
const CORRIDOR_LEN = 56;

// Each laser sweeps left-right across the corridor at a given Z, with its own
// frequency / phase. The player times their forward dashes between crossings.
const LASER_DEFS: { z: number; omega: number; phase: number }[] = [
  { z: -16, omega: 1.7, phase: 0.0 },
  { z: -10, omega: 2.4, phase: 1.1 },
  { z: -3,  omega: 1.9, phase: 0.4 },
  { z: 4,   omega: 2.7, phase: 2.2 },
  { z: 11,  omega: 2.1, phase: 0.8 },
  { z: 18,  omega: 3.0, phase: 1.7 },
];

/**
 * Level 3 — Time Slice. Time scales with the player's horizontal speed:
 * stand still → lasers freeze; sprint → lasers race. Cross to the exit
 * without intersecting a laser.
 */
export class TimeSliceLevel implements Level {
  name = "Time Slice";
  blurb =
    "Time scales with your motion. <b>Stand still and the lasers freeze; move and they accelerate.</b> Time your dashes between sweeps. Touching a laser sends you back to start.";
  abilityLabel = "Time-x";

  private wallMat!: THREE.ShaderMaterial;
  private blades: LaserBlade[] = [];
  private levelTime = 0;
  private currentScale = 0;
  private startPos = new THREE.Vector3();
  private startYaw = Math.PI;
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private invulnUntil = 0;
  private flashTimer = 0;
  private flashOverlay: HTMLDivElement | null = null;

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;
    scene.background = new THREE.Color(0x070708);
    scene.fog = new THREE.FogExp2(0x000000, 0.02);

    // A directional light to give the monochrome material some shape.
    const key = new THREE.DirectionalLight(0xffffff, 0.4);
    key.position.set(2, 5, 1);
    scene.add(key);

    this.wallMat = createMonochromeWallMaterial();

    // Floor + ceiling.
    const floorB = box(0, -0.5, 0, CORRIDOR_W + 1, 1, CORRIDOR_LEN);
    scene.add(boxMesh(floorB, this.wallMat));
    world.add(floorB);

    const ceilingB = box(0, CORRIDOR_H + 0.5, 0, CORRIDOR_W + 1, 1, CORRIDOR_LEN);
    scene.add(boxMesh(ceilingB, this.wallMat));
    world.add(ceilingB);

    // Side walls.
    const sideL = box(-CORRIDOR_W / 2 - 0.25, CORRIDOR_H / 2, 0, 0.5, CORRIDOR_H, CORRIDOR_LEN);
    scene.add(boxMesh(sideL, this.wallMat));
    world.add(sideL);

    const sideR = box(CORRIDOR_W / 2 + 0.25, CORRIDOR_H / 2, 0, 0.5, CORRIDOR_H, CORRIDOR_LEN);
    scene.add(boxMesh(sideR, this.wallMat));
    world.add(sideR);

    // End caps.
    const capStart = box(0, CORRIDOR_H / 2, -CORRIDOR_LEN / 2 - 0.25, CORRIDOR_W, CORRIDOR_H, 0.5);
    scene.add(boxMesh(capStart, this.wallMat));
    world.add(capStart);

    const capEnd = box(0, CORRIDOR_H / 2, CORRIDOR_LEN / 2 + 0.25, CORRIDOR_W, CORRIDOR_H, 0.5);
    scene.add(boxMesh(capEnd, this.wallMat));
    world.add(capEnd);

    // Lasers.
    const amp = CORRIDOR_W / 2 - 0.4;
    for (const def of LASER_DEFS) {
      const blade = new LaserBlade({
        z: def.z,
        omega: def.omega,
        phaseOffset: def.phase,
        amplitude: amp,
        height: CORRIDOR_H - 0.1,
      });
      this.blades.push(blade);
      scene.add(blade.group);
    }

    // Start + exit.
    this.startPos.set(0, 1.6, -CORRIDOR_LEN / 2 + 3);
    this.startYaw = Math.PI;
    player.reset(this.startPos.clone(), this.startYaw);

    this.exitCenter.set(0, 0.05, CORRIDOR_LEN / 2 - 3);
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
          gl_FragColor = vec4(0.95, 0.95, 1.0, a);
        }
      `,
    });
    this.exitMesh = new THREE.Mesh(exitGeo, exitMat);
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    // Hit-flash overlay (DOM, simplest).
    this.flashOverlay = document.createElement("div");
    this.flashOverlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:50;" +
      "background:radial-gradient(circle,rgba(255,80,180,0.55),rgba(20,0,10,0.85));" +
      "opacity:0;transition:opacity 0.15s;";
    document.body.appendChild(this.flashOverlay);

    ctx.setAbility(this.abilityLabel, "x0.00");
    ctx.message("Stand still — the lasers freeze. Walk — they race.", 5);
    this.invulnUntil = performance.now() / 1000 + 1.2;
  }

  update(dt: number, ctx: LevelContext) {
    // Time scale = current player horizontal speed / walkSpeed. Velocity is
    // zeroed by collision, so pushing into a wall does NOT advance time.
    const v = ctx.player.velocity;
    const speed = Math.hypot(v.x, v.z);
    const scale = THREE.MathUtils.clamp(speed / ctx.player.walkSpeed, 0.0, 1.5);
    // Tiny ambient creep so the world doesn't 100% freeze (more atmospheric).
    const effective = Math.max(0.015, scale);
    this.currentScale = scale;
    this.levelTime += dt * effective;

    for (const b of this.blades) b.update(dt, this.levelTime, effective);

    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value =
      performance.now() / 1000;
    this.wallMat.uniforms.uTime.value = this.levelTime;

    // Hit detection. Treat each blade as a thin 0.5m AABB at (blade_x, _, z).
    const now = performance.now() / 1000;
    if (now > this.invulnUntil) {
      const px = ctx.player.position.x;
      const pz = ctx.player.position.z;
      const r = ctx.player.radius;
      for (const b of this.blades) {
        const halfThick = 0.18;
        if (
          Math.abs(pz - b.z) < halfThick + r &&
          Math.abs(px - b.mesh.position.x) < 0.18 + r
        ) {
          this.onHit(ctx);
          break;
        }
      }
    }

    // Flash fade.
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      if (this.flashOverlay) {
        this.flashOverlay.style.opacity = String(Math.min(1, this.flashTimer / 0.4));
      }
    }

    ctx.setAbility(this.abilityLabel, `x${this.currentScale.toFixed(2)}`);

    const dx = ctx.player.position.x - this.exitCenter.x;
    const dz = ctx.player.position.z - this.exitCenter.z;
    if (dx * dx + dz * dz < 1.1 * 1.1) ctx.complete();
  }

  private onHit(ctx: LevelContext) {
    ctx.player.reset(this.startPos.clone(), this.startYaw);
    this.invulnUntil = performance.now() / 1000 + 1.0;
    this.flashTimer = 0.45;
    if (this.flashOverlay) this.flashOverlay.style.opacity = "1";
    ctx.message("Sliced. Reset.", 1.4);
  }

  dispose(_ctx: LevelContext) {
    if (this.flashOverlay) {
      this.flashOverlay.remove();
      this.flashOverlay = null;
    }
  }
}
