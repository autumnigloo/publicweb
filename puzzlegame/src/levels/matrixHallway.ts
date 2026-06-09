import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh } from "../world";
import { createMatrixMaterial } from "../effects/matrix";

const CORRIDOR_W = 6;
const CORRIDOR_H = 4;
const CORRIDOR_LEN = 42;
const PANEL_W = CORRIDOR_W / 3;
const PANEL_DEPTH = 0.25;
const BARRIER_ZS = [-10, 2, 14];

/**
 * Matrix Hallway — three barriers, each split into 3 side-by-side panels.
 * Two panels per barrier are SOLID (matrix code flows downward).
 * One panel per barrier is FAKE (matrix code flows UPWARD) and the player
 * can walk through it.
 *
 * The hint is in the briefing: "fake walls flow up". Pressing E briefly
 * tints fake panels red so the player can confirm without committing.
 */
export class MatrixHallwayLevel implements Level {
  name = "Matrix Hallway";
  blurb =
    "Cross three Matrix barriers. Two of every three panels are real and will block you. Look at the flow direction: <b>fake walls flow upward</b>. Press <b>E</b> to briefly highlight fake panels.";
  abilityLabel = "Decode (E)";

  private fakeMaterials: THREE.ShaderMaterial[] = [];
  private allMatrixMaterials: THREE.ShaderMaterial[] = [];
  private revealUntil = 0;
  private cooldownDone = 0;
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private fakeIndices: number[] = [];

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;

    // Reset per-init state so R-restart doesn't accumulate orphaned materials.
    this.fakeMaterials = [];
    this.allMatrixMaterials = [];
    this.revealUntil = 0;
    this.cooldownDone = 0;

    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.02);

    const dim = new THREE.MeshBasicMaterial({ color: 0x080a08 });

    // Floor + ceiling (full corridor length).
    const floorB = box(0, -0.5, 0, CORRIDOR_W + 1, 1, CORRIDOR_LEN);
    scene.add(boxMesh(floorB, dim));
    world.add(floorB);

    const ceilingB = box(0, CORRIDOR_H + 0.5, 0, CORRIDOR_W + 1, 1, CORRIDOR_LEN);
    scene.add(boxMesh(ceilingB, dim));
    world.add(ceilingB);

    // Side walls.
    const sideL = box(-CORRIDOR_W / 2 - 0.25, CORRIDOR_H / 2, 0, 0.5, CORRIDOR_H, CORRIDOR_LEN);
    scene.add(boxMesh(sideL, dim));
    world.add(sideL);

    const sideR = box(CORRIDOR_W / 2 + 0.25, CORRIDOR_H / 2, 0, 0.5, CORRIDOR_H, CORRIDOR_LEN);
    scene.add(boxMesh(sideR, dim));
    world.add(sideR);

    // End caps.
    const capStart = box(0, CORRIDOR_H / 2, -CORRIDOR_LEN / 2 - 0.25, CORRIDOR_W, CORRIDOR_H, 0.5);
    scene.add(boxMesh(capStart, dim));
    world.add(capStart);

    const capEnd = box(0, CORRIDOR_H / 2, CORRIDOR_LEN / 2 + 0.25, CORRIDOR_W, CORRIDOR_H, 0.5);
    scene.add(boxMesh(capEnd, dim));
    world.add(capEnd);

    // Three barriers, each with one fake panel index in [0,1,2].
    const fakeChoices: number[] = [];
    for (let i = 0; i < BARRIER_ZS.length; i++) {
      fakeChoices.push(Math.floor(Math.random() * 3));
    }
    this.fakeIndices = fakeChoices;

    for (let bi = 0; bi < BARRIER_ZS.length; bi++) {
      const z = BARRIER_ZS[bi];
      const fakeIdx = fakeChoices[bi];
      for (let pi = 0; pi < 3; pi++) {
        const x = -CORRIDOR_W / 2 + (pi + 0.5) * PANEL_W;
        const isFake = pi === fakeIdx;
        const mat = createMatrixMaterial({
          direction: isFake ? -1 : 1,
          cols: 4,
          rows: 12,
          speed: 0.9 + Math.random() * 0.3,
        });
        this.allMatrixMaterials.push(mat);
        if (isFake) this.fakeMaterials.push(mat);

        const b = box(x, CORRIDOR_H / 2, z, PANEL_W - 0.04, CORRIDOR_H - 0.04, PANEL_DEPTH);
        const m = boxMesh(b, mat);
        scene.add(m);
        if (!isFake) world.add(b);
      }
    }

    // Player start at the near end, facing the corridor (+Z).
    player.reset(new THREE.Vector3(0, 1.6, -CORRIDOR_LEN / 2 + 2.5), Math.PI);

    // Exit pad at the far end.
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
          gl_FragColor = vec4(0.2, 1.0, 0.6, a);
        }
      `,
    });
    this.exitMesh = new THREE.Mesh(exitGeo, exitMat);
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    ctx.setAbility(this.abilityLabel, "READY");
    ctx.message("Fake walls flow UP. Press E to highlight them briefly.", 5);
  }

  ability(_ctx: LevelContext) {
    const now = performance.now() / 1000;
    if (now < this.cooldownDone) return;
    this.revealUntil = now + 1.6;
    this.cooldownDone = now + 4.5;
  }

  update(dt: number, ctx: LevelContext) {
    const now = performance.now() / 1000;

    const revealing = now < this.revealUntil;
    for (const m of this.allMatrixMaterials) {
      m.uniforms.uTime.value = now;
    }
    // Tint fake panels red while revealing.
    for (const m of this.fakeMaterials) {
      const t = m.uniforms.uTint.value as THREE.Color;
      if (revealing) t.setRGB(1.0, 0.25, 0.25);
      else t.setRGB(0.0, 1.0, 0.35);
    }

    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = now;

    let abilityState: string;
    if (revealing) abilityState = "REVEALING";
    else if (now < this.cooldownDone) abilityState = `... ${(this.cooldownDone - now).toFixed(1)}s`;
    else abilityState = "READY";
    ctx.setAbility(this.abilityLabel, abilityState);

    const dx = ctx.player.position.x - this.exitCenter.x;
    const dz = ctx.player.position.z - this.exitCenter.z;
    if (dx * dx + dz * dz < 1.1 * 1.1) ctx.complete();
  }
}
