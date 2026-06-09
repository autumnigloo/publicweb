import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh, sphereHitsBox, type Box } from "../world";
import { createColorInvertMaterial } from "../effects/colorInvert";

/**
 * Inverted Color — a long corridor cut into three obstacle zones. Two sets of
 * objects exist, RED and CYAN. Polarity toggles between POSITIVE (RED solid,
 * CYAN intangible) and NEGATIVE (CYAN solid, RED intangible). Pressing E
 * flips polarity and the entire framebuffer is colour-inverted by a
 * full-screen post-process, giving the level its visual signature.
 *
 * Layout, walking +Z from start to exit:
 *   [start]  RED wall   [mid1]  CYAN bridge over pit   [mid2]
 *   RED bridge over pit   [thin floor]  CYAN wall   [exit]
 *
 * Intended solve: flip to NEGATIVE (red wall → intangible, cyan bridge →
 * solid), cross zones 1 and 2, then flip back to POSITIVE on mid2 (red
 * bridge → solid, cyan wall → intangible) to finish.
 *
 * Falling into a pit respawns the player at the start pad. Trying to flip
 * while inside what would become a solid is refused with a HUD message so
 * the player can't get squashed.
 */

const CORRIDOR_HALF_W = 3;
const CORRIDOR_H = 4;
const WALL_T = 0.4;

// Z-axis layout (centre-of-feature in metres along +Z).
const START_Z0 = 0;
const START_Z1 = 7;          // start platform spans [0, 7]
const RED_WALL_Z = 8;        // red wall slab at z ≈ 8
const MID1_Z0 = 9;
const MID1_Z1 = 15;          // mid platform 1 spans [9, 15]
const CYAN_BRIDGE_Z0 = 15;
const CYAN_BRIDGE_Z1 = 18;   // pit 1 = [15, 18]; cyan bridge spans it
const MID2_Z0 = 18;
const MID2_Z1 = 21;          // mid platform 2 spans [18, 21]
const RED_BRIDGE_Z0 = 21;
const RED_BRIDGE_Z1 = 24;    // pit 2 = [21, 24]; red bridge spans it
const PRE_CYAN_Z0 = 24;
const PRE_CYAN_Z1 = 26;      // landing runs under the cyan wall to the exit
                             // platform — the wall is a barrier, not a pit
const CYAN_WALL_Z = 25.6;    // cyan wall slab at z ≈ 25.6
const EXIT_Z0 = 26;
const EXIT_Z1 = 33;          // exit platform spans [26, 33]

const PIT_FLOOR_Y = -8;      // player falls below this → respawn
const RESPAWN_Y_THRESHOLD = -3;

const RED_HEX = 0xff2a3a;
const CYAN_HEX = 0x18ddff;

type Polarity = "POSITIVE" | "NEGATIVE";

// One polarity-flipping object. The mesh is always rendered; opacity and
// depthWrite are toggled based on tangibility. The collider is spliced
// in/out of world.solids on flip.
interface PolarityObject {
  kind: "red" | "cyan";
  collider: Box;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  emissive: THREE.Color; // saturated colour
  faint: THREE.Color;    // tangible-state highlight (mostly the same as emissive)
}

export class InvertedColorLevel implements Level {
  name = "Inverted Color";
  blurb =
    "Two layers of objects, <span style=\"color:#ff5566\">RED</span> and <span style=\"color:#22e0ff\">CYAN</span>. Only one polarity is solid at a time. Press <b>E</b> to flip polarity — the whole world inverts. Use both states to thread the corridor.";
  abilityLabel = "Polarity (E)";

  postMaterial?: THREE.ShaderMaterial;

  private invertMat!: THREE.ShaderMaterial;
  private polarity: Polarity = "POSITIVE";
  private polarityNow = 0;    // shader-side smoothed (0 = positive, 1 = negative)
  private polarityTarget = 0;
  private flashAmt = 0;

  private objects: PolarityObject[] = [];
  private staticSolidCount = 0;
  private world!: import("../world").BoxWorld;

  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private respawn = new THREE.Vector3();
  private respawnYaw = Math.PI;

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;
    this.world = world;

    // --- reset state for R-restart safety
    this.objects = [];
    this.polarity = "POSITIVE";
    this.polarityNow = 0;
    this.polarityTarget = 0;
    this.flashAmt = 0;

    scene.background = new THREE.Color(0x6e7a85); // mid-grey so invert reads
    scene.fog = new THREE.Fog(0x6e7a85, 14, 50);

    // Lighting kept low-contrast and warm so the invert (cool, dim) is felt.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff2dd, 0.55);
    key.position.set(4, 10, 3);
    scene.add(key);
    const back = new THREE.DirectionalLight(0xc0d0ff, 0.18);
    back.position.set(-3, 6, -4);
    scene.add(back);

    this.invertMat = createColorInvertMaterial();
    this.postMaterial = this.invertMat;

    // --- static shell: floors, ceiling, side walls
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b8 });
    const ceilMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
    const sideWallMat = new THREE.MeshLambertMaterial({ color: 0xa0a0a0 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x707080 });

    // Floor segments (the pits are simply omitted from this list).
    const floors: Array<[number, number]> = [
      [START_Z0, START_Z1],
      [MID1_Z0, MID1_Z1],
      [MID2_Z0, MID2_Z1],
      [PRE_CYAN_Z0, PRE_CYAN_Z1],
      [EXIT_Z0, EXIT_Z1],
    ];
    for (const [z0, z1] of floors) {
      const cz = (z0 + z1) / 2;
      const sz = z1 - z0;
      const f = box(0, -0.5, cz, CORRIDOR_HALF_W * 2 + 0.4, 1, sz);
      scene.add(boxMesh(f, floorMat));
      world.add(f);
    }

    // Ceiling — single slab over the whole corridor.
    const corridorCZ = (START_Z0 + EXIT_Z1) / 2;
    const corridorDepth = EXIT_Z1 - START_Z0;
    const ceil = box(
      0,
      CORRIDOR_H + 0.5,
      corridorCZ,
      CORRIDOR_HALF_W * 2 + 0.4,
      1,
      corridorDepth + 2
    );
    scene.add(boxMesh(ceil, ceilMat));
    world.add(ceil);

    // Side walls — go the full length so the player can't escape sideways.
    // We give them a slightly different tone so corners read in both polarities.
    const wW = box(
      -CORRIDOR_HALF_W - WALL_T / 2,
      CORRIDOR_H / 2,
      corridorCZ,
      WALL_T,
      CORRIDOR_H,
      corridorDepth + 2
    );
    scene.add(boxMesh(wW, sideWallMat));
    world.add(wW);
    const wE = box(
      CORRIDOR_HALF_W + WALL_T / 2,
      CORRIDOR_H / 2,
      corridorCZ,
      WALL_T,
      CORRIDOR_H,
      corridorDepth + 2
    );
    scene.add(boxMesh(wE, sideWallMat));
    world.add(wE);

    // End-caps so the corridor reads as enclosed.
    const wS = box(
      0,
      CORRIDOR_H / 2,
      START_Z0 - WALL_T / 2,
      CORRIDOR_HALF_W * 2 + WALL_T * 2,
      CORRIDOR_H,
      WALL_T
    );
    scene.add(boxMesh(wS, accentMat));
    world.add(wS);
    const wN = box(
      0,
      CORRIDOR_H / 2,
      EXIT_Z1 + WALL_T / 2,
      CORRIDOR_HALF_W * 2 + WALL_T * 2,
      CORRIDOR_H,
      WALL_T
    );
    scene.add(boxMesh(wN, accentMat));
    world.add(wN);

    // Faint pit liner so the holes look intentional, not like missing geometry.
    const pitLinerMat = new THREE.MeshBasicMaterial({ color: 0x303040 });
    const pit1Liner = box(
      0,
      -3,
      (CYAN_BRIDGE_Z0 + CYAN_BRIDGE_Z1) / 2,
      CORRIDOR_HALF_W * 2,
      0.1,
      CYAN_BRIDGE_Z1 - CYAN_BRIDGE_Z0
    );
    scene.add(boxMesh(pit1Liner, pitLinerMat));
    const pit2Liner = box(
      0,
      -3,
      (RED_BRIDGE_Z0 + RED_BRIDGE_Z1) / 2,
      CORRIDOR_HALF_W * 2,
      0.1,
      RED_BRIDGE_Z1 - RED_BRIDGE_Z0
    );
    scene.add(boxMesh(pit2Liner, pitLinerMat));

    // Remember how many static colliders exist; everything appended after
    // staticSolidCount is dynamic and may be spliced on flip.
    this.staticSolidCount = world.solids.length;

    // --- dynamic polarity objects
    // Zone 1: RED wall blocks corridor between start and mid1.
    this.makePolarityWall(scene, "red", RED_WALL_Z);

    // Zone 2: CYAN bridge spans pit 1.
    this.makePolarityBridge(
      scene,
      "cyan",
      (CYAN_BRIDGE_Z0 + CYAN_BRIDGE_Z1) / 2,
      CYAN_BRIDGE_Z1 - CYAN_BRIDGE_Z0
    );

    // Zone 3a: RED bridge spans pit 2.
    this.makePolarityBridge(
      scene,
      "red",
      (RED_BRIDGE_Z0 + RED_BRIDGE_Z1) / 2,
      RED_BRIDGE_Z1 - RED_BRIDGE_Z0
    );

    // Zone 3b: CYAN wall blocks just past the red bridge.
    this.makePolarityWall(scene, "cyan", CYAN_WALL_Z);

    // --- start + exit pads
    const startGeo = new THREE.RingGeometry(0.7, 1.0, 48);
    startGeo.rotateX(-Math.PI / 2);
    const startMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const startMesh = new THREE.Mesh(startGeo, startMat);
    startMesh.position.set(0, 0.05, 2);
    scene.add(startMesh);

    this.exitCenter.set(0, 0.05, EXIT_Z1 - 2.0);
    this.exitMesh = makeExitPad();
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    this.respawn.set(0, 1.6, 2);
    this.respawnYaw = Math.PI; // forward = +Z
    player.reset(this.respawn, this.respawnYaw);

    // Apply initial polarity (POSITIVE) — sync colliders/materials.
    this.applyPolarity(true);

    ctx.setAbility(this.abilityLabel, this.polarity);
    ctx.message(
      "Press <b>E</b> to flip polarity. The world inverts; so does what's solid.",
      6
    );
  }

  private makePolarityWall(scene: THREE.Scene, kind: "red" | "cyan", z: number) {
    const colHex = kind === "red" ? RED_HEX : CYAN_HEX;
    const c = new THREE.Color(colHex);
    const mat = new THREE.MeshBasicMaterial({
      color: colHex,
      transparent: true,
      opacity: 1,
      depthWrite: true,
    });
    const collider = box(
      0,
      CORRIDOR_H / 2,
      z,
      CORRIDOR_HALF_W * 2,
      CORRIDOR_H - 0.2,
      0.5
    );
    const mesh = boxMesh(collider, mat);
    scene.add(mesh);
    this.objects.push({
      kind,
      collider,
      mesh,
      material: mat,
      emissive: c.clone(),
      faint: c.clone(),
    });
  }

  private makePolarityBridge(
    scene: THREE.Scene,
    kind: "red" | "cyan",
    centerZ: number,
    depth: number
  ) {
    const colHex = kind === "red" ? RED_HEX : CYAN_HEX;
    const c = new THREE.Color(colHex);
    const mat = new THREE.MeshBasicMaterial({
      color: colHex,
      transparent: true,
      opacity: 1,
      depthWrite: true,
    });
    const collider = box(0, -0.15, centerZ, CORRIDOR_HALF_W * 2 - 0.2, 0.3, depth);
    const mesh = boxMesh(collider, mat);
    scene.add(mesh);
    // Decorative side rails so the bridge reads as a path, not a slab.
    const railMat = new THREE.MeshBasicMaterial({
      color: colHex,
      transparent: true,
      opacity: 0.6,
    });
    for (const s of [-1, 1]) {
      const railGeo = new THREE.BoxGeometry(0.08, 0.8, depth);
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(s * (CORRIDOR_HALF_W - 0.15), 0.3, centerZ);
      mesh.add(rail); // parent so they fade together
    }
    this.objects.push({
      kind,
      collider,
      mesh,
      material: mat,
      emissive: c.clone(),
      faint: c.clone(),
    });
  }

  ability(ctx: LevelContext) {
    // Would-be-solids in the OPPOSITE polarity.
    const newPolarity: Polarity =
      this.polarity === "POSITIVE" ? "NEGATIVE" : "POSITIVE";
    const wouldBeSolidKind = newPolarity === "POSITIVE" ? "red" : "cyan";

    // Refuse if the player would end up inside a soon-to-be-solid.
    const p = ctx.player.position;
    const r = ctx.player.radius + 0.05;
    for (const obj of this.objects) {
      if (obj.kind !== wouldBeSolidKind) continue;
      if (sphereHitsBox(p, r, obj.collider)) {
        ctx.message("Polarity locked — clear of the opposite layer first.", 2.0);
        this.flashAmt = Math.max(this.flashAmt, 0.18);
        return;
      }
    }

    this.polarity = newPolarity;
    this.polarityTarget = newPolarity === "NEGATIVE" ? 1 : 0;
    this.flashAmt = 1.0;
    this.applyPolarity(false);
  }

  // Sync collider list + per-object visuals to current polarity.
  // `instant` snaps the post-shader uniform; otherwise it crossfades.
  private applyPolarity(instant: boolean) {
    const solidKind: "red" | "cyan" =
      this.polarity === "POSITIVE" ? "red" : "cyan";

    // Splice world.solids: keep the static prefix, append currently-solid objs.
    const newSolids = this.world.solids.slice(0, this.staticSolidCount);
    for (const obj of this.objects) {
      const active = obj.kind === solidKind;
      if (active) newSolids.push(obj.collider);
      // Visuals: tangible = full opacity, depthWrite on; intangible = 0.22
      // opacity, depthWrite off. Slight desat on intangibles so they read as
      // ghosted regardless of polarity.
      obj.material.opacity = active ? 1.0 : 0.22;
      obj.material.depthWrite = active;
      obj.material.color.copy(active ? obj.emissive : obj.faint);
      obj.mesh.renderOrder = active ? 0 : 1;
    }
    this.world.solids = newSolids;

    if (instant) {
      this.polarityNow = this.polarityTarget;
    }
  }

  update(dt: number, ctx: LevelContext) {
    const now = performance.now() / 1000;
    const { player } = ctx;

    // Smoothly chase the polarity uniform.
    const k = 1 - Math.exp(-dt * 9.0);
    this.polarityNow += (this.polarityTarget - this.polarityNow) * k;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 2.6);

    this.invertMat.uniforms.uTime.value = now;
    this.invertMat.uniforms.uPolarity.value = this.polarityNow;
    this.invertMat.uniforms.uFlash.value = this.flashAmt;

    // Pit fall → respawn.
    if (player.position.y < RESPAWN_Y_THRESHOLD) {
      player.reset(this.respawn, this.respawnYaw);
      this.flashAmt = Math.max(this.flashAmt, 0.5);
      ctx.message("Wrong polarity. Reset to start.", 2.0);
    }
    // Hard cap (shouldn't be hit; player.update has its own at -50).
    if (player.position.y < PIT_FLOOR_Y) {
      player.reset(this.respawn, this.respawnYaw);
    }

    // Exit pad shader tick + reach test.
    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = now;
    const exDx = player.position.x - this.exitCenter.x;
    const exDz = player.position.z - this.exitCenter.z;
    if (exDx * exDx + exDz * exDz < 1.1 * 1.1) ctx.complete();

    ctx.setAbility(this.abilityLabel, this.polarity);
  }

  dispose(_ctx: LevelContext) {
    this.postMaterial = undefined;
    this.objects = [];
  }
}

function makeExitPad(): THREE.Mesh {
  const exitGeo = new THREE.CircleGeometry(1.0, 32);
  exitGeo.rotateX(-Math.PI / 2);
  // Green/yellow so it stays a recognisable "go here" both right-side-up and
  // colour-inverted (inverts to magenta, still distinct from red/cyan walls).
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
        float pulse = 0.55 + 0.45 * sin(uTime * 2.2);
        float core  = smoothstep(0.30, 0.0, d) * 0.45;
        float a = ring * pulse + core;
        gl_FragColor = vec4(0.85, 0.95, 0.30, a);
      }
    `,
  });
  return new THREE.Mesh(exitGeo, exitMat);
}
