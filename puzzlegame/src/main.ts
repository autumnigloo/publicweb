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

// --- Progress (furthest level reached) ---
const PROGRESS_KEY = "puzzlegame.progress";
function loadProgress(max: number): number {
  try {
    const n = parseInt(localStorage.getItem(PROGRESS_KEY) ?? "0", 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
  } catch {
    return 0;
  }
}
function saveProgress(idx: number) {
  try {
    const prev = parseInt(localStorage.getItem(PROGRESS_KEY) ?? "0", 10);
    if (!Number.isFinite(prev) || idx > prev) {
      localStorage.setItem(PROGRESS_KEY, String(idx));
    }
  } catch {
    /* private mode etc. — progress just isn't saved */
  }
}

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
  paused: document.pointerLockElement !== canvas,
  message: showMessage,
  setAbility,
  complete: onLevelComplete,
});

// Free GPU resources held by a scene's meshes. Materials/geometries may be
// shared between meshes; dispose() is idempotent so double-disposal is fine.
function disposeScene(s: THREE.Scene) {
  s.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else if (mat) mat.dispose();
  });
}

function loadLevel(idx: number) {
  if (currentLevel) {
    const oldPost = currentLevel.postMaterial;
    currentLevel.dispose?.(makeContext());
    oldPost?.dispose();
    if (scene) {
      // Detach the camera first so it (and anything a level left attached to
      // it) survives the scene teardown.
      scene.remove(player.camera);
      disposeScene(scene);
    }
  }

  scene = new THREE.Scene();
  world = new BoxWorld();
  // The camera must be in the scene graph for camera-attached children
  // (death-flash overlays etc.) to render.
  scene.add(player.camera);

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
      showMessage("All levels cleared. More coming soon. — Press N to play again from Level 1.", 12);
      // Stay on the final level rendering-wise.
    }, 600);
    return;
  }
  saveProgress(next);
  // If pointer-lock is still engaged, auto-advance without showing the
  // overlay — releasing the lock would force the user to press Esc and then
  // fight the browser's post-Esc cooldown to re-acquire it (the classic
  // "click did nothing" trap). Show the briefing as a non-blocking message
  // instead. If the user has already released pointer-lock, fall back to the
  // overlay so they have a clear click target.
  if (document.pointerLockElement === canvas) {
    setTimeout(() => {
      if (!levelCompleted) return; // user pressed R/N already
      const lvl = levels[next];
      loadLevel(next);
      showMessage(`Level ${next + 1} — ${lvl.name}<br><br>${lvl.blurb}`, 6);
    }, 700);
  } else {
    setTimeout(() => {
      showOverlayFor(next);
    }, 700);
  }
}

function showOverlayFor(idx: number) {
  const lvl = levels[idx];
  overlayLevelTitle.textContent = `Level ${idx + 1} — ${lvl.name}`;
  overlayBlurb.innerHTML = lvl.blurb;
  overlay.classList.remove("hidden");
  pendingLoadIdx = idx;
}

let pendingLoadIdx: number | null = 0;
// True while we want pointer-lock but it hasn't engaged yet (e.g. blocked by
// the post-Esc cooldown). pointerlockchange resolves this to false.
let wantPointerLock = false;
let retryTimer: number | null = null;

function tryAcquirePointerLock() {
  wantPointerLock = true;
  let retriesLeft = 6; // ~2.4s of 400ms retries — covers the post-Esc cooldown
  const attempt = () => {
    if (!wantPointerLock || document.pointerLockElement === canvas) return;
    const req = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (req && typeof req.then === "function") {
      req.catch(() => {
        // Browsers refuse pointer-lock for ~1.5s after Esc. Retry a few times
        // so a single overlay click reliably enters the level.
        if (retriesLeft-- <= 0) return;
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = window.setTimeout(attempt, 400);
      });
    }
  };
  attempt();
}

overlay.addEventListener("click", () => {
  if (pendingLoadIdx !== null) {
    loadLevel(pendingLoadIdx);
    pendingLoadIdx = null;
  }
  tryAcquirePointerLock();
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    wantPointerLock = false;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    overlay.classList.add("hidden");
  } else if (currentLevel) {
    wantPointerLock = false;
    // Drop any held movement so the level doesn't keep simulating a moving
    // player while paused (Time Slice's world-time is speed-driven, and a key
    // held across the Esc would otherwise stay "down" forever).
    player.keys.clear();
    player.velocity.x = 0;
    player.velocity.z = 0;
    overlay.classList.remove("hidden");
  }
});

// Keyup events are lost when the window loses focus — clear held keys so they
// don't stick (the classic "walks forever after alt-tab" bug).
window.addEventListener("blur", () => player.keys.clear());

document.addEventListener("pointerlockerror", () => {
  if (currentLevel) overlay.classList.remove("hidden");
});

// Global hotkeys. R (restart) and N (next/skip) work even when pointer-lock
// isn't active. E still requires pointer-lock since it's a gameplay action.
document.addEventListener("keydown", (e) => {
  if (!currentLevel) return;
  if (e.code === "KeyE" && document.pointerLockElement === canvas) {
    currentLevel.ability?.(makeContext());
  } else if (e.code === "KeyR") {
    pendingLoadIdx = null;
    loadLevel(currentIdx);
    tryAcquirePointerLock();
  } else if (e.code === "KeyN") {
    // Actually skip to the next level — previously this only updated the
    // overlay text, so users pressing N to skip went nowhere. Wraps back to
    // Level 1 after the last level.
    pendingLoadIdx = null;
    loadLevel((currentIdx + 1) % levels.length);
    tryAcquirePointerLock();
  }
});

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  player.camera.aspect = window.innerWidth / window.innerHeight;
  player.camera.updateProjectionMatrix();
  const [w, h] = rtSize();
  sceneRT.setSize(w, h);
});

// Initialize the furthest-reached level (saved in localStorage) so returning
// players continue where they left off. Also gives the menu a moving backdrop.
const startIdx = loadProgress(levels.length - 1);
loadLevel(startIdx);
showOverlayFor(startIdx);

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
