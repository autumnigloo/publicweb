import * as THREE from "three";
import { Player } from "./player";
import { BoxWorld } from "./world";
import { makeLevels } from "./levels";
import type { Level, LevelContext } from "./levels/types";

// --- DOM refs ---
const canvas = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const overlayLevelTitle = document.getElementById("overlay-level-title") as HTMLDivElement;
const overlayBlurb = document.getElementById("overlay-blurb") as HTMLDivElement;
const messageEl = document.getElementById("message") as HTMLDivElement;
const levelNumEl = document.getElementById("level-num") as HTMLSpanElement;
const levelNameEl = document.getElementById("level-name") as HTMLSpanElement;
const abilityLabelEl = document.getElementById("ability-label") as HTMLDivElement;
const abilityValueEl = document.getElementById("ability-value") as HTMLDivElement;

// --- Three.js ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const player = new Player();
player.installInput(canvas);

// --- Post-processing pipeline ---
// Levels can opt in by setting `postMaterial`. We render the scene to this RT
// then draw a fullscreen quad with the level's material (which samples
// `tDiffuse`). Levels without a postMaterial render straight to the canvas.
function rtSize() {
  const dpr = Math.min(window.devicePixelRatio, 2);
  return [
    Math.max(1, Math.floor(window.innerWidth * dpr)),
    Math.max(1, Math.floor(window.innerHeight * dpr)),
  ] as const;
}
const [rtW, rtH] = rtSize();
const sceneRT = new THREE.WebGLRenderTarget(rtW, rtH, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  depthBuffer: true,
});
const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
postQuad.frustumCulled = false;
postScene.add(postQuad);

// --- Game state ---
const levels = makeLevels();
let currentIdx = 0;
let currentLevel: Level | null = null;
let scene: THREE.Scene;
let world: BoxWorld;
let messageTimer = 0;
let levelCompleted = false;

function showMessage(text: string, duration = 3) {
  messageEl.innerHTML = text;
  messageEl.classList.add("show");
  messageTimer = duration;
}

function setAbility(label: string, value: string) {
  abilityLabelEl.textContent = label;
  abilityValueEl.textContent = value;
}

const makeContext = (): LevelContext => ({
  scene: scene!,
  world: world!,
  player,
  message: showMessage,
  setAbility,
  complete: onLevelComplete,
});

function loadLevel(idx: number) {
  if (currentLevel) {
    currentLevel.dispose?.(makeContext());
  }

  scene = new THREE.Scene();
  world = new BoxWorld();

  // Default lighting; levels may override.
  const amb = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(amb);

  currentIdx = idx;
  currentLevel = levels[idx];
  levelCompleted = false;
  levelNumEl.textContent = String(idx + 1);
  levelNameEl.textContent = currentLevel.name;

  currentLevel.init(makeContext());
}

function onLevelComplete() {
  if (!currentLevel || levelCompleted) return;
  levelCompleted = true;
  showMessage(`✓ ${currentLevel.name} cleared`, 2.5);
  const next = currentIdx + 1;
  if (next >= levels.length) {
    setTimeout(() => {
      showMessage("All levels cleared. More coming soon. — Press R to restart from Level 1.", 12);
      // Stay on the final level rendering-wise.
    }, 600);
    return;
  }
  setTimeout(() => {
    showOverlayFor(next);
  }, 700);
}

function showOverlayFor(idx: number) {
  const lvl = levels[idx];
  overlayLevelTitle.textContent = `Level ${idx + 1} — ${lvl.name}`;
  overlayBlurb.innerHTML = lvl.blurb;
  overlay.classList.remove("hidden");
  pendingLoadIdx = idx;
}

let pendingLoadIdx: number | null = 0;

overlay.addEventListener("click", () => {
  if (pendingLoadIdx !== null) {
    loadLevel(pendingLoadIdx);
    pendingLoadIdx = null;
  }
  // Don't hide the overlay yet — wait for pointerlockchange to confirm the
  // lock actually engaged. Browsers silently refuse pointer-lock for ~1.5s
  // after Esc, and previously we'd hide the overlay anyway, leaving the user
  // stranded in an unlocked level with no way back.
  const req = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
  if (req && typeof req.then === "function") {
    req.catch(() => {
      /* silent reject — overlay is still visible so user can retry */
    });
  }
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    overlay.classList.add("hidden");
  } else if (currentLevel) {
    overlay.classList.remove("hidden");
  }
});

document.addEventListener("pointerlockerror", () => {
  if (currentLevel) overlay.classList.remove("hidden");
});

// Global hotkeys. R (restart) and N (next) work even when pointer-lock isn't
// active, so the player isn't stranded if a lock-grab fails or while the
// overlay is up. E still requires pointer-lock since it's a gameplay action.
document.addEventListener("keydown", (e) => {
  if (!currentLevel) return;
  if (e.code === "KeyE" && document.pointerLockElement === canvas) {
    currentLevel.ability?.(makeContext());
  } else if (e.code === "KeyR") {
    pendingLoadIdx = null;
    loadLevel(currentIdx);
  } else if (e.code === "KeyN") {
    if (currentIdx + 1 < levels.length) showOverlayFor(currentIdx + 1);
  }
});

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  player.camera.aspect = window.innerWidth / window.innerHeight;
  player.camera.updateProjectionMatrix();
  const [w, h] = rtSize();
  sceneRT.setSize(w, h);
});

// Initialize first level so we have a scene to render even before the
// overlay is dismissed (gives the menu a moving backdrop too).
loadLevel(0);

let prevTime = performance.now();
function animate() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevTime) / 1000);
  prevTime = now;

  // Only step physics + level when the user has clicked in.
  if (document.pointerLockElement === canvas) {
    player.update(dt, world);
    currentLevel?.update(dt, makeContext());
  } else {
    // Still call update so shaders animate while overlay is up.
    currentLevel?.update(dt, makeContext());
  }

  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) messageEl.classList.remove("show");
  }

  const post = currentLevel?.postMaterial;
  if (post) {
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, player.camera);
    renderer.setRenderTarget(null);
    if (post.uniforms.tDiffuse) post.uniforms.tDiffuse.value = sceneRT.texture;
    postQuad.material = post;
    renderer.render(postScene, postCamera);
  } else {
    renderer.render(scene, player.camera);
  }
  requestAnimationFrame(animate);
}
animate();
