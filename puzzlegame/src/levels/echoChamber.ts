import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh } from "../world";
import { EchoEffect, PulseWaveVisual } from "../effects/echo";

// A simple maze laid out on a 13x13 grid. '#' = wall, 'S' = start, 'E' = exit.
// Walls become EchoEffect-shaded boxes; floor + ceiling cover the whole area.
const MAZE = [
  "#############",
  "#S..#.......#",
  "#.#.#.#####.#",
  "#.#...#...#.#",
  "#.#####.#.#.#",
  "#.....#.#.#.#",
  "#####.#.#.#.#",
  "#...#.#.#...#",
  "#.#.#.#.#####",
  "#.#.#.#.....#",
  "#.#.#.#####.#",
  "#...#......E#",
  "#############",
];

const CELL = 3;

export class EchoChamberLevel implements Level {
  name = "Echo Chamber";
  blurb =
    "Find the exit in total darkness. Press E to send a sonar pulse that briefly lights up the geometry it touches.";
  abilityLabel = "Sonar (E)";

  private echo!: EchoEffect;
  private wave!: PulseWaveVisual;
  private cooldown = 0;
  private readonly cooldownTime = 0.9;
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;
    scene.background = new THREE.Color(0x010204);
    scene.fog = new THREE.FogExp2(0x000000, 0.035);

    const rows = MAZE.length;
    const cols = MAZE[0].length;
    const offX = -(cols * CELL) / 2;
    const offZ = -(rows * CELL) / 2;

    this.echo = new EchoEffect();

    // Floor + ceiling as a single big slab each (they share the echo material).
    const floorB = box(
      offX + (cols * CELL) / 2,
      -0.5,
      offZ + (rows * CELL) / 2,
      cols * CELL,
      1,
      rows * CELL
    );
    scene.add(boxMesh(floorB, this.echo.material));
    world.add(floorB);

    const ceilingB = box(
      offX + (cols * CELL) / 2,
      3.5,
      offZ + (rows * CELL) / 2,
      cols * CELL,
      1,
      rows * CELL
    );
    scene.add(boxMesh(ceilingB, this.echo.material));
    world.add(ceilingB);

    // Walls.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = MAZE[r][c];
        const cx = offX + c * CELL + CELL / 2;
        const cz = offZ + r * CELL + CELL / 2;
        if (ch === "#") {
          const b = box(cx, 1.5, cz, CELL, 3, CELL);
          scene.add(boxMesh(b, this.echo.material));
          world.add(b);
        } else if (ch === "S") {
          player.reset(new THREE.Vector3(cx, 1.6, cz), -Math.PI / 2);
        } else if (ch === "E") {
          this.exitCenter.set(cx, 0.05, cz);
        }
      }
    }

    // Exit pad: a faint always-visible green disc on the floor.
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

    // Pulse-wave visual for player feedback.
    this.wave = new PulseWaveVisual();
    scene.add(this.wave.mesh);

    // Initial pulse so the player can see the room briefly.
    setTimeout(() => this.echo.pulse(player.position.clone()), 250);

    ctx.setAbility(this.abilityLabel, "READY");
    ctx.message("Press E to ping. Find the green exit.", 4);
  }

  ability(ctx: LevelContext) {
    if (this.cooldown > 0) return;
    this.echo.pulse(ctx.player.position.clone());
    this.wave.pulse(ctx.player.position.clone());
    this.cooldown = this.cooldownTime;
  }

  update(dt: number, ctx: LevelContext) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.echo.update(ctx.player.position);
    this.wave.update();
    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value =
      performance.now() / 1000;

    ctx.setAbility(
      this.abilityLabel,
      this.cooldown > 0 ? `... ${this.cooldown.toFixed(1)}s` : "READY"
    );

    // Check exit.
    const dx = ctx.player.position.x - this.exitCenter.x;
    const dz = ctx.player.position.z - this.exitCenter.z;
    if (dx * dx + dz * dz < 1.1 * 1.1) {
      ctx.complete();
    }
  }
}
