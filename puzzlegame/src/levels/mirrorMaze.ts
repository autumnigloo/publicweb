import * as THREE from "three";
import type { Level, LevelContext } from "./types";
import { box, boxMesh, BoxWorld } from "../world";
import { createChromaticAberrationMaterial } from "../effects/chromaticAberration";

/**
 * Mirror Maze — three chambers, four archways each. Only one archway per
 * chamber is real and teleports the player onward; the others are sealed by
 * mirror panels.
 *
 * The puzzle hint lives on a glyph plaque above every archway. The real
 * archway shows its glyph the right way around; the three fake ones show the
 * same glyph horizontally flipped (because reflections invert handedness).
 *
 * Heavy chromatic aberration is applied as a post-process. Pressing E
 * "Polarizes" the world for 2.5 s — fakes flash red, the truth flashes green,
 * and the aberration inverts so the screen looks distinctly "treated".
 */

const ROOM_S = 12;
const ROOM_H = 4;
const WALL_T = 0.5;
const ARCH_W = 2.6;
const ARCH_H = 3.2;
const BACKWALL_DIST = 1.4; // distance from outer wall face to mirror panel
const BACKWALL_THICK = 0.35;
const CHAMBER_GAP = 60; // chambers far enough apart that fog hides them
const CHAMBER_COUNT = 3;
const TELEPORT_TRIGGER_PAST = 0.7; // how far past the wall outer face triggers teleport

type Side = "N" | "E" | "S" | "W";
const SIDES: Side[] = ["N", "E", "S", "W"];

// Asymmetric letters that visibly read "wrong" when mirrored. Avoid: A H I M O T U V W X Y.
const GLYPH_POOL = ["F", "R", "P", "J", "B", "K", "L", "G", "E", "Q", "S", "Z"];

interface ArchwayInfo {
  side: Side;
  isReal: boolean;
  glyph: string;
  // World position 1m past the wall along the outward normal — used as the
  // teleport (real) or back-wall (fake) reference.
  outerCenter: THREE.Vector3;
  outward: THREE.Vector3;
  glyphMesh: THREE.Mesh;
  glyphMat: THREE.MeshBasicMaterial;
  // Mirror back-wall (fake archways only).
  backMesh?: THREE.Mesh;
  backMat?: THREE.ShaderMaterial;
}

interface ChamberData {
  index: number;
  origin: THREE.Vector3;
  archways: ArchwayInfo[];
  realArch: ArchwayInfo;
}

function sideOutward(side: Side): THREE.Vector3 {
  switch (side) {
    case "N":
      return new THREE.Vector3(0, 0, 1);
    case "S":
      return new THREE.Vector3(0, 0, -1);
    case "E":
      return new THREE.Vector3(1, 0, 0);
    case "W":
      return new THREE.Vector3(-1, 0, 0);
  }
}

function makeGlyphTexture(char: string, mirrored: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  // Plaque background + frame.
  ctx.fillStyle = "rgba(14, 18, 30, 0.92)";
  ctx.fillRect(8, 8, size - 16, size - 16);
  ctx.strokeStyle = "#7aa2ff";
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, size - 24, size - 24);

  ctx.save();
  if (mirrored) {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = "#e6efff";
  ctx.font = `bold ${Math.floor(size * 0.7)}px ui-monospace, "SFMono-Regular", Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, size / 2, size / 2 + 8);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function makeMirrorPanelMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0.62, 0.78, 1.0) },
      uHighlight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTint;
      uniform float uHighlight;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        // Slow drifting "polished metal" bands — convincing enough that the
        // player reads the surface as a mirror without an actual reflection.
        vec2 p = vUv;
        float b1 = sin(p.x * 6.0 + uTime * 0.45 + p.y * 11.0);
        float b2 = sin(p.x * 21.0 - uTime * 0.7 + p.y * 4.0);
        float b3 = sin((p.x + p.y) * 3.5 + uTime * 0.3);
        float k = 0.5 + 0.18 * b1 + 0.12 * b2 + 0.08 * b3;

        // Soft inset frame.
        float edge = smoothstep(0.0, 0.12, p.x) * smoothstep(1.0, 0.88, p.x)
                   * smoothstep(0.0, 0.12, p.y) * smoothstep(1.0, 0.88, p.y);
        float frame = 1.0 - smoothstep(0.0, 0.06, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));

        vec3 col = uTint * k * mix(0.55, 1.0, edge);
        col += vec3(0.22, 0.30, 0.45) * frame;

        // Highlight pulse during ability — fakes glow red.
        col = mix(col, vec3(1.0, 0.25, 0.30), uHighlight * 0.7);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function makeWallMaterial(): THREE.ShaderMaterial {
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
      void main() {
        // Brushed-stone wall with faint vertical streaks.
        float v1 = sin(vWorldPos.x * 1.6 + vWorldPos.z * 0.7) * 0.06;
        float v2 = sin(vWorldPos.y * 4.0) * 0.025;
        vec3 base = vec3(0.062, 0.066, 0.108);
        vec3 col = base + vec3(v1) + vec3(v2 * 0.7, v2 * 0.7, v2);
        // Tiny rim highlight where normals point upward, so corners read.
        col += vec3(0.05, 0.06, 0.10) * max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.0))) * 0.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export class MirrorMazeLevel implements Level {
  name = "Mirror Maze";
  blurb =
    "Three chambers, four archways each — only one is real. Reflections invert: the genuine archway's glyph reads forward, the three fakes read <b>mirrored</b>. Press <b>E</b> to <i>Polarize</i> and pulse the truth.";
  abilityLabel = "Polarize (E)";

  postMaterial?: THREE.ShaderMaterial;

  private chambers: ChamberData[] = [];
  private currentChamberIdx = 0;
  private wallMat!: THREE.ShaderMaterial;
  private aberrationMat!: THREE.ShaderMaterial;
  private polarizeUntil = 0;
  private polarizeCdDone = 0;
  private polarizeAmt = 0;
  private allMirrorMats: THREE.ShaderMaterial[] = [];
  private allGlyphTextures: THREE.CanvasTexture[] = [];
  private allGlyphMaterials: THREE.MeshBasicMaterial[] = [];
  private exitCenter = new THREE.Vector3();
  private exitMesh!: THREE.Mesh;
  private flashOverlay!: THREE.Mesh;
  private flashAmt = 0;
  private flashColor = new THREE.Color(0x4488ff);

  init(ctx: LevelContext) {
    const { scene, world, player } = ctx;

    // --- reset per-init state (R restart safety)
    this.chambers = [];
    this.currentChamberIdx = 0;
    this.polarizeUntil = 0;
    this.polarizeCdDone = 0;
    this.polarizeAmt = 0;
    this.allMirrorMats = [];
    this.allGlyphTextures = [];
    this.allGlyphMaterials = [];
    this.flashAmt = 0;

    scene.background = new THREE.Color(0x070811);
    scene.fog = new THREE.FogExp2(0x070811, 0.04);

    this.aberrationMat = createChromaticAberrationMaterial({ strength: 0.018 });
    this.postMaterial = this.aberrationMat;

    this.wallMat = makeWallMaterial();
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x0a0a14 });
    const ceilMat = new THREE.MeshBasicMaterial({ color: 0x05060c });

    // --- build chambers
    for (let i = 0; i < CHAMBER_COUNT; i++) {
      const origin = new THREE.Vector3(i * CHAMBER_GAP, 0, 0);
      const realSide = SIDES[Math.floor(Math.random() * SIDES.length)];
      const glyph = GLYPH_POOL[Math.floor(Math.random() * GLYPH_POOL.length)];

      const archways: ArchwayInfo[] = [];
      for (const side of SIDES) {
        const aw = this.buildArchway(scene, world, origin, side, side === realSide, glyph, floorMat);
        archways.push(aw);
      }

      // Floor + ceiling for this chamber.
      const floorB = box(origin.x, -0.5, origin.z, ROOM_S, 1, ROOM_S);
      scene.add(boxMesh(floorB, floorMat));
      world.add(floorB);
      const ceilB = box(origin.x, ROOM_H + 0.5, origin.z, ROOM_S, 1, ROOM_S);
      scene.add(boxMesh(ceilB, ceilMat));
      world.add(ceilB);

      const realArch = archways.find((a) => a.isReal)!;
      this.chambers.push({ index: i, origin, archways, realArch });
    }

    // --- exit pad just past the last chamber's real archway
    const last = this.chambers[CHAMBER_COUNT - 1];
    this.exitCenter
      .copy(last.origin)
      .add(last.realArch.outward.clone().multiplyScalar(ROOM_S / 2 + WALL_T + 3));
    this.exitCenter.y = 0.05;
    this.makeExitPad(scene);

    // Floor bridge from last chamber to exit pad so the player can walk to it.
    const bridgeDir = last.realArch.outward;
    const bridgeCenter = new THREE.Vector3()
      .copy(last.origin)
      .add(bridgeDir.clone().multiplyScalar(ROOM_S / 2 + WALL_T + 1.6));
    const bridgeB =
      bridgeDir.x !== 0
        ? box(bridgeCenter.x, -0.5, bridgeCenter.z, 3.2, 1, ARCH_W + 0.4)
        : box(bridgeCenter.x, -0.5, bridgeCenter.z, ARCH_W + 0.4, 1, 3.2);
    scene.add(boxMesh(bridgeB, floorMat));
    world.add(bridgeB);

    // --- player spawn in chamber 0, looking at its real archway.
    const c0 = this.chambers[0];
    player.reset(
      new THREE.Vector3(c0.origin.x, 1.6, c0.origin.z),
      yawToward(c0.realArch.outward)
    );

    // --- death/flash camera-attached overlay.
    const flashGeo = new THREE.PlaneGeometry(2, 2);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.flashOverlay = new THREE.Mesh(flashGeo, flashMat);
    this.flashOverlay.frustumCulled = false;
    this.flashOverlay.renderOrder = 9999;
    player.camera.add(this.flashOverlay);
    this.flashOverlay.position.set(0, 0, -0.1);

    ctx.setAbility(this.abilityLabel, "READY");
    ctx.message("Look up. The real archway reads forward. Mirrors lie.", 6);
  }

  private buildArchway(
    scene: THREE.Scene,
    world: BoxWorld,
    origin: THREE.Vector3,
    side: Side,
    isReal: boolean,
    glyph: string,
    _floorMat: THREE.Material
  ): ArchwayInfo {
    const out = sideOutward(side);
    const o = origin;

    // --- wall segments around the arch
    if (side === "N" || side === "S") {
      const z = o.z + out.z * (ROOM_S / 2 + WALL_T / 2);
      const sideSpan = (ROOM_S - ARCH_W) / 2;
      const left = box(
        o.x - ARCH_W / 2 - sideSpan / 2,
        ROOM_H / 2,
        z,
        sideSpan,
        ROOM_H,
        WALL_T
      );
      scene.add(boxMesh(left, this.wallMat));
      world.add(left);
      const right = box(
        o.x + ARCH_W / 2 + sideSpan / 2,
        ROOM_H / 2,
        z,
        sideSpan,
        ROOM_H,
        WALL_T
      );
      scene.add(boxMesh(right, this.wallMat));
      world.add(right);
      const topH = ROOM_H - ARCH_H;
      const top = box(o.x, ARCH_H + topH / 2, z, ARCH_W, topH, WALL_T);
      scene.add(boxMesh(top, this.wallMat));
      world.add(top);
    } else {
      const x = o.x + out.x * (ROOM_S / 2 + WALL_T / 2);
      const sideSpan = (ROOM_S - ARCH_W) / 2;
      const south = box(
        x,
        ROOM_H / 2,
        o.z - ARCH_W / 2 - sideSpan / 2,
        WALL_T,
        ROOM_H,
        sideSpan
      );
      scene.add(boxMesh(south, this.wallMat));
      world.add(south);
      const north = box(
        x,
        ROOM_H / 2,
        o.z + ARCH_W / 2 + sideSpan / 2,
        WALL_T,
        ROOM_H,
        sideSpan
      );
      scene.add(boxMesh(north, this.wallMat));
      world.add(north);
      const topH = ROOM_H - ARCH_H;
      const top = box(x, ARCH_H + topH / 2, o.z, WALL_T, topH, ARCH_W);
      scene.add(boxMesh(top, this.wallMat));
      world.add(top);
    }

    // --- mirror back-wall for fake archways
    const outerCenter = new THREE.Vector3()
      .copy(o)
      .add(out.clone().multiplyScalar(ROOM_S / 2 + WALL_T + BACKWALL_DIST));
    outerCenter.y = ARCH_H / 2;

    let backMesh: THREE.Mesh | undefined;
    let backMat: THREE.ShaderMaterial | undefined;
    if (!isReal) {
      backMat = makeMirrorPanelMaterial();
      this.allMirrorMats.push(backMat);
      const bw =
        side === "N" || side === "S"
          ? box(outerCenter.x, ARCH_H / 2, outerCenter.z, ARCH_W, ARCH_H, BACKWALL_THICK)
          : box(outerCenter.x, ARCH_H / 2, outerCenter.z, BACKWALL_THICK, ARCH_H, ARCH_W);
      const m = boxMesh(bw, backMat);
      scene.add(m);
      world.add(bw);
      backMesh = m;
    }

    // --- glyph plaque just inside the wall, above the archway
    const glyphTex = makeGlyphTexture(glyph, !isReal);
    this.allGlyphTextures.push(glyphTex);
    const glyphMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.allGlyphMaterials.push(glyphMat);
    const glyphGeo = new THREE.PlaneGeometry(1.1, 1.1);
    const glyphMesh = new THREE.Mesh(glyphGeo, glyphMat);

    const inner = 0.04; // small offset off the wall surface, into the chamber
    if (side === "N") {
      glyphMesh.position.set(o.x, ARCH_H + 0.55, o.z + ROOM_S / 2 - inner);
      glyphMesh.rotation.y = Math.PI;
    } else if (side === "S") {
      glyphMesh.position.set(o.x, ARCH_H + 0.55, o.z - ROOM_S / 2 + inner);
      // default orientation faces +Z (into chamber from S wall)
    } else if (side === "E") {
      glyphMesh.position.set(o.x + ROOM_S / 2 - inner, ARCH_H + 0.55, o.z);
      glyphMesh.rotation.y = -Math.PI / 2;
    } else {
      glyphMesh.position.set(o.x - ROOM_S / 2 + inner, ARCH_H + 0.55, o.z);
      glyphMesh.rotation.y = Math.PI / 2;
    }
    scene.add(glyphMesh);

    return {
      side,
      isReal,
      glyph,
      outerCenter,
      outward: out,
      glyphMesh,
      glyphMat,
      backMesh,
      backMat,
    };
  }

  private makeExitPad(scene: THREE.Scene) {
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
          gl_FragColor = vec4(0.6, 0.85, 1.0, a);
        }
      `,
    });
    this.exitMesh = new THREE.Mesh(exitGeo, exitMat);
    this.exitMesh.position.copy(this.exitCenter);
    scene.add(this.exitMesh);
  }

  ability(_ctx: LevelContext) {
    const now = performance.now() / 1000;
    if (now < this.polarizeCdDone) return;
    this.polarizeUntil = now + 2.5;
    this.polarizeCdDone = now + 7.0;
  }

  update(dt: number, ctx: LevelContext) {
    const now = performance.now() / 1000;
    const { player } = ctx;

    // Animate post-effect uniforms.
    const polarizing = now < this.polarizeUntil;
    const targetAmt = polarizing ? 1 : 0;
    const k = 1 - Math.exp(-dt * 6);
    this.polarizeAmt = THREE.MathUtils.lerp(this.polarizeAmt, targetAmt, k);
    this.aberrationMat.uniforms.uTime.value = now;
    this.aberrationMat.uniforms.uPolarize.value = this.polarizeAmt;

    this.wallMat.uniforms.uTime.value = now;
    for (const m of this.allMirrorMats) {
      m.uniforms.uTime.value = now;
      // Fakes flash red while polarizing.
      m.uniforms.uHighlight.value = this.polarizeAmt;
    }

    // Tint the real archway's glyph green during polarize for a strong hint.
    const ch = this.chambers[this.currentChamberIdx];
    if (ch) {
      const realMat = ch.realArch.glyphMat;
      const t = this.polarizeAmt;
      // R/G/B channels of the glyph map are multiplied by `color`.
      realMat.color.setRGB(1 - 0.6 * t, 1, 1 - 0.6 * t);
      for (const aw of ch.archways) {
        if (aw === ch.realArch) continue;
        aw.glyphMat.color.setRGB(1, 1 - 0.4 * t, 1 - 0.4 * t);
      }
    }

    // Flash overlay decay.
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - dt * 1.6);
      const fm = this.flashOverlay.material as THREE.MeshBasicMaterial;
      fm.opacity = this.flashAmt;
      fm.color.copy(this.flashColor);
    }

    // Detect crossing the current chamber's real archway.
    if (ch) {
      const rel = new THREE.Vector3().subVectors(player.position, ch.origin);
      const proj = rel.dot(ch.realArch.outward);
      if (proj > ROOM_S / 2 + WALL_T + TELEPORT_TRIGGER_PAST) {
        this.advanceChamber(ctx);
      }
    }

    // Exit pad.
    (this.exitMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = now;
    const exDx = player.position.x - this.exitCenter.x;
    const exDz = player.position.z - this.exitCenter.z;
    if (exDx * exDx + exDz * exDz < 1.1 * 1.1) {
      ctx.complete();
    }

    // HUD.
    let abilityState: string;
    if (polarizing) abilityState = "POLARIZED";
    else if (now < this.polarizeCdDone)
      abilityState = `... ${(this.polarizeCdDone - now).toFixed(1)}s`;
    else abilityState = "READY";
    ctx.setAbility(this.abilityLabel, abilityState);
  }

  private advanceChamber(ctx: LevelContext) {
    const next = this.currentChamberIdx + 1;
    if (next >= this.chambers.length) {
      // Already past the last chamber: drop the player onto the bridge so they
      // can walk to the exit pad.
      const last = this.chambers[this.chambers.length - 1];
      const out = last.realArch.outward;
      const pos = new THREE.Vector3()
        .copy(last.origin)
        .add(out.clone().multiplyScalar(ROOM_S / 2 + WALL_T + 1.6));
      pos.y = 1.6;
      ctx.player.reset(pos, yawToward(out));
      this.flashAmt = 0.5;
      this.flashColor.setRGB(0.45, 0.9, 0.7);
      this.currentChamberIdx = next;
      ctx.message("Through the looking glass. The exit pulses ahead.", 4);
      return;
    }
    this.currentChamberIdx = next;
    const ch = this.chambers[next];
    // Spawn at chamber center facing the new real archway.
    ctx.player.reset(
      new THREE.Vector3(ch.origin.x, 1.6, ch.origin.z),
      yawToward(ch.realArch.outward)
    );
    this.flashAmt = 0.55;
    this.flashColor.setRGB(0.45, 0.7, 1.0);
    ctx.message(`Chamber ${next + 1} / ${this.chambers.length}. Read carefully.`, 3);
  }

  dispose(ctx: LevelContext) {
    if (this.flashOverlay && this.flashOverlay.parent) {
      this.flashOverlay.parent.remove(this.flashOverlay);
    }
    (this.flashOverlay?.material as THREE.MeshBasicMaterial | undefined)?.dispose?.();
    this.flashOverlay?.geometry?.dispose?.();
    for (const tex of this.allGlyphTextures) tex.dispose();
    // Drop the post material reference so main.ts falls back to direct render.
    this.postMaterial = undefined;
  }
}

// --- helpers
function yawToward(out: THREE.Vector3): number {
  // Player.forward() = (0,0,-1) rotated by yaw around Y → (-sin yaw, 0, -cos yaw).
  // We want forward = out, so sin yaw = -out.x, cos yaw = -out.z.
  return Math.atan2(-out.x, -out.z);
}
