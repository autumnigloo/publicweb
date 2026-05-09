import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh, type Box, BoxWorld } from "../world";
import { createPastelPosterizeMaterial } from "../effects/pastelPosterize";

/**
 * Gravity Cubes — pastel low-poly chamber. Cubes hang in midair, frozen by
 * default. Aim at one and press E to cycle its gravity through {frozen, down,
 * up}. Falling cubes stack on the floor and on each other; rising cubes fly
 * to the ceiling. Build a staircase up to the exit ledge.
 *
 * Visual identity: warm pastel palette + posterize post-process for a
 * Tintin/Moebius cel feel. Distinct from the dark/neon mood of levels 1–4.
 */

const CUBE_S = 0.75;
const CUBE_HALF = CUBE_S / 2;
const CUBE_ACCEL = 6.0;
const RAYCAST_RANGE = 30;

const CHAMBER_X = 7;
const CHAMBER_Z_FRONT = -2;
const CHAMBER_Z_BACK = 17;
const CHAMBER_H = 11;
const FLOOR_Y = 0;
const CEIL_Y = CHAMBER_H;

const LEDGE_Z_START = 9.0;
const LEDGE_Z_END = CHAMBER_Z_BACK;
const LEDGE_Y = 2.25;

const PALETTE = {
  frozen: new THREE.Color(0.78, 0.95, 0.85),
  down: new THREE.Color(0.98, 0.78, 0.78),
  up: new THREE.Color(0.78, 0.88, 0.98),
};

type Gravity = -1 | 0 | 1;

interface GravityCube {
  pos: THREE.Vector3;
  vel: number;
  gravity: Gravity;
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  aimRing: THREE.LineSegments;
  collider: Box;
}

export class GravityCubesLevel implements Level {
  name = "Gravity Cubes";
  blurb =
    "Cubes hang in pastel air. Aim at one and press <b>E</b> to cycle its gravity through frozen / down / up. Stack a staircase to the ledge.";
  abilityLabel = "Flip Gravity (E)";

  postMaterial?: THREE.ShaderMaterial;

  private cubes: GravityCube[] = [];
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private aimedCube: GravityCube | null = null;
  private raycaster = new THREE.Raycaster();

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;

    this.cubes = [];
    this.aimedCube = null;

    scene.background = new THREE.Color(0xfff3e0);
    scene.fog = new THREE.Fog(0xfff3e0, 22, 70);

    this.postMaterial = createPastelPosterizeMaterial({ bands: 5, warmth: 0.18 });

    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(amb);
    const key = new THREE.DirectionalLight(0xfff0d0, 0.6);
    key.position.set(4, 9, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9d8ff, 0.25);
    fill.position.set(-5, 6, -3);
    scene.add(fill);

    // --- chamber: floor, ceiling, walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xf3e0c8 });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xe7d3b6 });
    const ceilMat = new THREE.MeshLambertMaterial({ color: 0xfff5e3 });

    const chamberW = CHAMBER_X * 2;
    const chamberD = CHAMBER_Z_BACK - CHAMBER_Z_FRONT;
    const cZ = (CHAMBER_Z_FRONT + CHAMBER_Z_BACK) / 2;

    const floor = box(0, -0.5, cZ, chamberW, 1, chamberD);
    scene.add(boxMesh(floor, floorMat));
    world.add(floor);

    const ceil = box(0, CEIL_Y + 0.5, cZ, chamberW, 1, chamberD);
    scene.add(boxMesh(ceil, ceilMat));
    world.add(ceil);

    const wallT = 0.6;
    const wallS = box(0, CEIL_Y / 2, CHAMBER_Z_FRONT - wallT / 2, chamberW + wallT * 2, CEIL_Y, wallT);
    scene.add(boxMesh(wallS, wallMat));
    world.add(wallS);
    const wallN = box(0, CEIL_Y / 2, CHAMBER_Z_BACK + wallT / 2, chamberW + wallT * 2, CEIL_Y, wallT);
    scene.add(boxMesh(wallN, wallMat));
    world.add(wallN);
    const wallW = box(-CHAMBER_X - wallT / 2, CEIL_Y / 2, cZ, wallT, CEIL_Y, chamberD);
    scene.add(boxMesh(wallW, wallMat));
    world.add(wallW);
    const wallE = box(CHAMBER_X + wallT / 2, CEIL_Y / 2, cZ, wallT, CEIL_Y, chamberD);
    scene.add(boxMesh(wallE, wallMat));
    world.add(wallE);

    // --- ledge: solid block at the back of the chamber.
    const ledgeMat = new THREE.MeshLambertMaterial({ color: 0xd6c9ff });
    const ledgeCZ = (LEDGE_Z_START + LEDGE_Z_END) / 2;
    const ledgeD = LEDGE_Z_END - LEDGE_Z_START;
    const ledge = box(0, LEDGE_Y / 2, ledgeCZ, chamberW, LEDGE_Y, ledgeD);
    scene.add(boxMesh(ledge, ledgeMat));
    world.add(ledge);

    // --- start pad
    const startMat = new THREE.MeshBasicMaterial({ color: 0x9ce4b4 });
    const startGeo = new THREE.CircleGeometry(0.9, 32);
    startGeo.rotateX(-Math.PI / 2);
    const start = new THREE.Mesh(startGeo, startMat);
    start.position.set(0, 0.06, 0);
    scene.add(start);

    // --- exit pad on top of the ledge
    this.exitCenter.set(0, LEDGE_Y + 0.06, ledgeCZ + 1.5);
    this.exitMesh = makeExitPad();
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    // --- cubes: 3 columns of 1, 2, 3. Stack flush with the ledge top when
    // all are dropped.
    const layout: { x: number; z: number; ys: number[] }[] = [
      { x: 0, z: 2.5, ys: [4.0] },
      { x: 0, z: 5.0, ys: [4.0, 6.0] },
      { x: 0, z: 7.5, ys: [4.0, 6.0, 8.0] },
    ];
    for (const col of layout) {
      for (const y of col.ys) this.spawnCube(scene, world, col.x, y, col.z);
    }
    // A pair of off-axis decoys for visual interest. Harmless to flip.
    this.spawnCube(scene, world, -3.5, 5.5, 4.0);
    this.spawnCube(scene, world, 3.5, 7.0, 6.5);

    // --- player
    player.reset(new THREE.Vector3(0, 1.6, 0), Math.PI); // face +z
    player.camera.rotation.set(0, Math.PI, 0, "YXZ");

    ctx.setAbility(this.abilityLabel, "READY");
    ctx.message("Aim at a cube and press E to cycle gravity. Drop them to climb.", 6);
  }

  private spawnCube(scene: THREE.Scene, world: BoxWorld, x: number, y: number, z: number) {
    const geo = new THREE.BoxGeometry(CUBE_S, CUBE_S, CUBE_S);
    const mat = new THREE.MeshLambertMaterial({ color: PALETTE.frozen.clone() });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);

    // Subtle dark edge so cubes read as solid against the pastel walls.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x1c2230, transparent: true, opacity: 0.6 })
    );
    mesh.add(edges);

    // Aim highlight ring — slightly larger box edges, hidden until aimed at.
    const aimGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(CUBE_S * 1.07, CUBE_S * 1.07, CUBE_S * 1.07)
    );
    const aimRing = new THREE.LineSegments(
      aimGeo,
      new THREE.LineBasicMaterial({ color: 0xffd66b })
    );
    aimRing.visible = false;
    mesh.add(aimRing);

    scene.add(mesh);

    const collider: Box = {
      min: new THREE.Vector3(x - CUBE_HALF, y - CUBE_HALF, z - CUBE_HALF),
      max: new THREE.Vector3(x + CUBE_HALF, y + CUBE_HALF, z + CUBE_HALF),
    };
    world.add(collider);

    this.cubes.push({
      pos: mesh.position,
      vel: 0,
      gravity: 0,
      mesh,
      material: mat,
      aimRing,
      collider,
    });
  }

  ability(_ctx: LevelContext) {
    const c = this.aimedCube;
    if (!c) return;
    // Cycle: frozen -> down -> up -> frozen
    c.gravity = c.gravity === 0 ? -1 : c.gravity === -1 ? 1 : 0;
    c.vel = 0;
    if (c.gravity === 0) c.material.color.copy(PALETTE.frozen);
    else if (c.gravity === -1) c.material.color.copy(PALETTE.down);
    else c.material.color.copy(PALETTE.up);
  }

  update(dt: number, ctx: LevelContext) {
    const { player } = ctx;

    // --- integrate velocity for cubes that have gravity
    for (const c of this.cubes) {
      if (c.gravity === 0) {
        c.vel = 0;
        continue;
      }
      c.vel += c.gravity * CUBE_ACCEL * dt;
      c.pos.y += c.vel * dt;
    }

    // --- relax collisions a few iterations.
    // Frozen cubes act as immovable walls; only moving cubes get pushed back.
    const colSize = CUBE_S;
    for (let iter = 0; iter < 6; iter++) {
      let changed = false;
      const order = [...this.cubes].sort((a, b) => a.pos.y - b.pos.y);
      for (const c of order) {
        if (c.gravity === 0) continue;

        // Floor / ceiling.
        if (c.pos.y - CUBE_HALF < FLOOR_Y) {
          c.pos.y = FLOOR_Y + CUBE_HALF;
          if (c.vel < 0) c.vel = 0;
          changed = true;
        }
        if (c.pos.y + CUBE_HALF > CEIL_Y) {
          c.pos.y = CEIL_Y - CUBE_HALF;
          if (c.vel > 0) c.vel = 0;
          changed = true;
        }

        // Ledge top: cubes overlapping the ledge area can't fall through it.
        const overLedge =
          c.pos.z > LEDGE_Z_START - CUBE_HALF + 0.05 &&
          c.pos.z < LEDGE_Z_END + CUBE_HALF - 0.05;
        if (overLedge && c.pos.y - CUBE_HALF < LEDGE_Y) {
          c.pos.y = LEDGE_Y + CUBE_HALF;
          if (c.vel < 0) c.vel = 0;
          changed = true;
        }

        // Other cubes.
        for (const o of this.cubes) {
          if (o === c) continue;
          if (
            Math.abs(c.pos.x - o.pos.x) < colSize - 1e-3 &&
            Math.abs(c.pos.z - o.pos.z) < colSize - 1e-3
          ) {
            const dy = c.pos.y - o.pos.y;
            if (Math.abs(dy) < colSize - 1e-3) {
              if (dy >= 0 && c.vel <= 0) {
                c.pos.y = o.pos.y + colSize;
                c.vel = 0;
                changed = true;
              } else if (dy < 0 && c.vel >= 0) {
                c.pos.y = o.pos.y - colSize;
                c.vel = 0;
                changed = true;
              }
            }
          }
        }
      }
      if (!changed) break;
    }

    // --- sync collider AABBs with current cube positions.
    for (const c of this.cubes) {
      c.collider.min.set(c.pos.x - CUBE_HALF, c.pos.y - CUBE_HALF, c.pos.z - CUBE_HALF);
      c.collider.max.set(c.pos.x + CUBE_HALF, c.pos.y + CUBE_HALF, c.pos.z + CUBE_HALF);
    }

    // --- aim raycast: find the closest cube the camera is looking at.
    const fwd = player.forward();
    this.raycaster.set(player.position, fwd);
    this.raycaster.far = RAYCAST_RANGE;
    const cubeMeshes = this.cubes.map((c) => c.mesh);
    const hits = this.raycaster.intersectObjects(cubeMeshes, false);
    let aimed: GravityCube | null = null;
    if (hits.length > 0) {
      const m = hits[0].object as THREE.Mesh;
      aimed = this.cubes.find((c) => c.mesh === m) ?? null;
    }
    if (aimed !== this.aimedCube) {
      if (this.aimedCube) this.aimedCube.aimRing.visible = false;
      if (aimed) aimed.aimRing.visible = true;
      this.aimedCube = aimed;
    }

    // --- post effect time
    if (this.postMaterial) {
      this.postMaterial.uniforms.uTime.value = performance.now() / 1000;
    }

    // --- exit pad
    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value =
      performance.now() / 1000;
    const exDx = player.position.x - this.exitCenter.x;
    const exDy = player.position.y - this.exitCenter.y;
    const exDz = player.position.z - this.exitCenter.z;
    if (exDx * exDx + exDz * exDz < 1.2 * 1.2 && Math.abs(exDy) < 2.5) {
      ctx.complete();
    }

    // --- HUD
    let state = "READY";
    if (this.aimedCube) {
      const g = this.aimedCube.gravity;
      const tag = g === 0 ? "FROZEN" : g === -1 ? "FALL" : "RISE";
      const next = g === 0 ? "FALL" : g === -1 ? "RISE" : "FREEZE";
      state = `${tag} → ${next}`;
    }
    ctx.setAbility(this.abilityLabel, state);
  }

  dispose(_ctx: LevelContext) {
    this.postMaterial = undefined;
    this.aimedCube = null;
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
        gl_FragColor = vec4(0.5, 1.0, 0.8, a);
      }
    `,
  });
  return new THREE.Mesh(exitGeo, exitMat);
}
