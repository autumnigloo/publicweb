import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, type Box } from "../world";

/**
 * Wireframe Dream — pitch-black void with a white wireframe room outline and
 * a faint floor grid. Invisible solid pillars are scattered between start and
 * exit; the player can only learn where they are by bumping into them, after
 * which their edges remain drawn (white).
 *
 * Ability: Lucid Flash (E) — every unrevealed pillar dimly silhouettes for
 * ~1.5s on a 7s cooldown. Lets you commit a layout to memory before walking,
 * but isn't enough on its own — the flash is faint and short.
 *
 * Visual identity: pure white-on-black line art, no fills. The revealed
 * pillars accumulate as a kind of dream-blueprint of the route you took.
 */

const ROOM_HALF_X = 7;
const ROOM_Z_START = -2;
const ROOM_Z_END = 26;
const ROOM_H = 4;

const PILLAR_S = 1.2;
const PILLAR_HALF = PILLAR_S / 2;
const PILLAR_H = 4;

const FLASH_DURATION = 1.5;
const FLASH_COOLDOWN = 7.0;
const FLASH_PEAK_OPACITY = 0.22;

// Hand-placed positions (x, z) for the invisible pillars. Tuned so a player
// who walks forward in a straight line will bump several within the first few
// steps; gaps between pillars are >= 1.6m so the 0.7m-diameter player can
// always squeeze through once they see (or feel) the layout.
const PILLAR_SPOTS: Array<[number, number]> = [
  [-3, 3], [3, 3], [0, 5],
  [-5, 7], [5, 7],
  [-2, 9], [2, 9],
  [-4, 11], [4, 11], [0, 12],
  [-5, 14], [5, 14],
  [-2, 16], [2, 16],
  [-4, 18], [4, 18], [0, 19],
  [-3, 21], [3, 21],
  [-5, 23], [5, 23],
];

interface Pillar {
  collider: Box;
  edges: THREE.LineSegments;
  edgeMat: THREE.LineBasicMaterial;
  revealed: boolean;
}

export class WireframeDreamLevel implements Level {
  name = "Wireframe Dream";
  blurb =
    "An unlit dream-room. Pillars are invisible until you bump them — once touched, their wireframe stays drawn. Press <b>E</b> for a faint Lucid Flash that briefly silhouettes every pillar at once.";
  abilityLabel = "Lucid Flash (E)";

  private pillars: Pillar[] = [];
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private flashTimer = 0;
  private cooldown = 0;

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;

    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 16, 38);

    const cz = (ROOM_Z_START + ROOM_Z_END) / 2;
    const roomW = ROOM_HALF_X * 2;
    const roomD = ROOM_Z_END - ROOM_Z_START;

    // Wireframe floor grid for spatial reference. Faint primary lines + even
    // fainter secondary, so the void doesn't feel like a blank canvas — but
    // the room never actually "lights up".
    const grid = new THREE.GridHelper(
      Math.max(roomW, roomD),
      Math.max(roomW, roomD),
      0xffffff,
      0x303030
    );
    grid.position.set(0, 0.01, cz);
    const gMat = grid.material as THREE.Material | THREE.Material[];
    if (Array.isArray(gMat)) {
      for (const m of gMat) {
        m.transparent = true;
        (m as THREE.LineBasicMaterial).opacity = 0.45;
      }
    } else {
      gMat.transparent = true;
      (gMat as THREE.LineBasicMaterial).opacity = 0.45;
    }
    scene.add(grid);

    // Solid (invisible) floor + ceiling for collision only.
    const floor = box(0, -0.5, cz, roomW + 2, 1, roomD + 2);
    world.add(floor);
    const ceil = box(0, ROOM_H + 0.5, cz, roomW + 2, 1, roomD + 2);
    world.add(ceil);

    // Outer walls: visible as white wireframe boxes, plus a solid AABB for
    // collision. No fill — pure line art.
    const wallT = 0.4;
    const addWireWall = (b: Box) => {
      world.add(b);
      const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
      const cxw = (b.min.x + b.max.x) / 2;
      const cyw = (b.min.y + b.max.y) / 2;
      const czw = (b.min.z + b.max.z) / 2;
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
      );
      edges.position.set(cxw, cyw, czw);
      scene.add(edges);
      geo.dispose();
    };
    addWireWall(box(0, ROOM_H / 2, ROOM_Z_START - wallT / 2, roomW + wallT * 2, ROOM_H, wallT));
    addWireWall(box(0, ROOM_H / 2, ROOM_Z_END + wallT / 2, roomW + wallT * 2, ROOM_H, wallT));
    addWireWall(box(-ROOM_HALF_X - wallT / 2, ROOM_H / 2, cz, wallT, ROOM_H, roomD));
    addWireWall(box(ROOM_HALF_X + wallT / 2, ROOM_H / 2, cz, wallT, ROOM_H, roomD));

    // Pillars: invisible AABB + a single LineSegments mesh whose opacity flips
    // between {0 (hidden), FLASH_PEAK_OPACITY (during flash), 1 (revealed)}.
    this.pillars = [];
    const pillarGeo = new THREE.BoxGeometry(PILLAR_S, PILLAR_H, PILLAR_S);
    const pillarEdgeGeo = new THREE.EdgesGeometry(pillarGeo);
    pillarGeo.dispose();
    for (const [x, z] of PILLAR_SPOTS) {
      const collider: Box = {
        min: new THREE.Vector3(x - PILLAR_HALF, 0, z - PILLAR_HALF),
        max: new THREE.Vector3(x + PILLAR_HALF, PILLAR_H, z + PILLAR_HALF),
      };
      world.add(collider);

      const edgeMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
      });
      const edges = new THREE.LineSegments(pillarEdgeGeo, edgeMat);
      edges.position.set(x, PILLAR_H / 2, z);
      scene.add(edges);

      this.pillars.push({ collider, edges, edgeMat, revealed: false });
    }

    // Start pad — soft cool ring so you can always find your way back.
    const startGeo = new THREE.RingGeometry(0.7, 1.0, 48);
    startGeo.rotateX(-Math.PI / 2);
    const startMat = new THREE.MeshBasicMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const startMesh = new THREE.Mesh(startGeo, startMat);
    startMesh.position.set(0, 0.05, 0);
    scene.add(startMesh);

    // Exit pad — gently pulsing white disc at the far end.
    this.exitCenter.set(0, 0.05, ROOM_Z_END - 1.8);
    this.exitMesh = makeExitPad();
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);

    // Player faces +z (into the room).
    player.reset(new THREE.Vector3(0, 1.6, 0), Math.PI);
    player.camera.rotation.set(0, Math.PI, 0, "YXZ");

    this.flashTimer = 0;
    this.cooldown = 0;
    ctx.setAbility(this.abilityLabel, "READY");
    ctx.message(
      "Pillars are invisible until you bump them. Walk slowly — E for a faint flash.",
      6
    );
  }

  ability(_ctx: LevelContext) {
    if (this.cooldown > 0) return;
    this.flashTimer = FLASH_DURATION;
    this.cooldown = FLASH_COOLDOWN;
  }

  update(dt: number, ctx: LevelContext) {
    const { player } = ctx;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);

    // Reveal pillars the player is currently touching. We use a 2D distance
    // (XZ plane) to the AABB rather than relying on bumps from the collision
    // resolver — that way you also reveal pillars you brush past sideways.
    const reach = player.radius + 0.06;
    const reach2 = reach * reach;
    for (const p of this.pillars) {
      if (p.revealed) continue;
      const dx = Math.max(p.collider.min.x - player.position.x, 0, player.position.x - p.collider.max.x);
      const dz = Math.max(p.collider.min.z - player.position.z, 0, player.position.z - p.collider.max.z);
      if (dx * dx + dz * dz < reach2) p.revealed = true;
    }

    // Flash opacity ramps in over ~0.35s and decays for the rest of the flash.
    const flashOp =
      this.flashTimer > 0
        ? Math.min(1, (FLASH_DURATION - this.flashTimer) / 0.35) *
          Math.min(1, this.flashTimer / 0.6) *
          FLASH_PEAK_OPACITY
        : 0;
    for (const p of this.pillars) {
      p.edgeMat.opacity = p.revealed ? 1 : flashOp;
    }

    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value =
      performance.now() / 1000;

    const dx = player.position.x - this.exitCenter.x;
    const dz = player.position.z - this.exitCenter.z;
    if (dx * dx + dz * dz < 1.0 * 1.0) ctx.complete();

    let state = "READY";
    if (this.flashTimer > 0) state = `FLASH ${this.flashTimer.toFixed(1)}s`;
    else if (this.cooldown > 0) state = `... ${this.cooldown.toFixed(1)}s`;
    ctx.setAbility(this.abilityLabel, state);
  }

  dispose(_ctx: LevelContext) {
    this.pillars = [];
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
        float pulse = 0.55 + 0.45 * sin(uTime * 2.0);
        float core  = smoothstep(0.30, 0.0, d) * 0.35;
        float a = ring * pulse + core;
        gl_FragColor = vec4(1.0, 1.0, 1.0, a);
      }
    `,
  });
  return new THREE.Mesh(exitGeo, exitMat);
}
