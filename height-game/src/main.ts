import * as THREE from "three";
import { levels, Level } from "./levels";

// --- State ---
let currentLevel = 0;
let selectedParam = 0;
let userParams = [0, 0, 0, 0, 0];
let won = false;

// Camera orbit state
let camDist = 12;
let camAngle = Math.PI / 4;
let camHeight = 8;

const GRID_SIZE = 60;
const GRID_RANGE = 3; // x,y in [-3, 3]
const PARAM_NAMES = ["A", "B", "C", "D", "E"];

// --- Three.js setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a12);
scene.fog = new THREE.FogExp2(0x0a0a12, 0.02);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0x333355, 1.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xccccff, 1.2);
dirLight.position.set(5, 10, 5);
scene.add(dirLight);

const dirLight2 = new THREE.DirectionalLight(0xffccaa, 0.4);
dirLight2.position.set(-5, 5, -5);
scene.add(dirLight2);

// Grid floor
const gridHelper = new THREE.GridHelper(12, 24, 0x1a1a30, 0x111122);
gridHelper.position.y = -0.01;
scene.add(gridHelper);

// --- Height map geometry ---
function createHeightGeometry(): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(
    GRID_RANGE * 2,
    GRID_RANGE * 2,
    GRID_SIZE - 1,
    GRID_SIZE - 1
  );
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function updateGeometry(
  geo: THREE.PlaneGeometry,
  level: Level,
  params: number[]
) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = level.fn(x, z, params);
    pos.setY(i, isFinite(y) ? y : 0);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// User mesh (solid)
const userGeo = createHeightGeometry();
const userMat = new THREE.MeshPhongMaterial({
  color: 0x4444aa,
  shininess: 60,
  side: THREE.DoubleSide,
  flatShading: true,
});
const userMesh = new THREE.Mesh(userGeo, userMat);
scene.add(userMesh);

// User wireframe
const userWireMat = new THREE.MeshBasicMaterial({
  color: 0x5555cc,
  wireframe: true,
  transparent: true,
  opacity: 0.15,
});
const userWireMesh = new THREE.Mesh(createHeightGeometry(), userWireMat);
scene.add(userWireMesh);

// Target mesh (transparent overlay)
const targetGeo = createHeightGeometry();
const targetMat = new THREE.MeshPhongMaterial({
  color: 0xcc4444,
  shininess: 40,
  side: THREE.DoubleSide,
  flatShading: true,
  transparent: true,
  opacity: 0.4,
});
const targetMesh = new THREE.Mesh(targetGeo, targetMat);
scene.add(targetMesh);

// Target wireframe
const targetWireMat = new THREE.MeshBasicMaterial({
  color: 0xcc5555,
  wireframe: true,
  transparent: true,
  opacity: 0.08,
});
const targetWireMesh = new THREE.Mesh(createHeightGeometry(), targetWireMat);
scene.add(targetWireMesh);

// --- DOM references ---
const formulaText = document.getElementById("formula-text")!;
const paramsList = document.getElementById("params-list")!;
const levelNum = document.getElementById("level-num")!;
const levelTotal = document.getElementById("level-total")!;
const winOverlay = document.getElementById("win-overlay")!;
const nextBtn = document.getElementById("next-btn")!;

// --- UI update ---
function updateHUD() {
  const level = levels[currentLevel];
  formulaText.innerHTML = `<strong>${level.name}</strong><br>${level.formula}`;
  levelNum.textContent = String(currentLevel + 1);
  levelTotal.textContent = String(levels.length);

  paramsList.innerHTML = PARAM_NAMES.map((name, i) => {
    const val = userParams[i];
    const pct = ((val + 1) / 2) * 100;
    const sel = i === selectedParam ? " selected" : "";
    return `<div class="param-row${sel}">
      <span class="param-name">${name}</span>
      <span class="param-value">${val >= 0 ? "+" : ""}${val.toFixed(1)}</span>
      <div class="param-bar"><div class="param-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");
}

function updateMeshes() {
  const level = levels[currentLevel];
  updateGeometry(userGeo, level, userParams);
  updateGeometry(userWireMesh.geometry as THREE.PlaneGeometry, level, userParams);
  updateGeometry(targetGeo, level, level.targetParams);
  updateGeometry(
    targetWireMesh.geometry as THREE.PlaneGeometry,
    level,
    level.targetParams
  );
}

function checkWin(): boolean {
  const level = levels[currentLevel];
  return level.targetParams.every(
    (t, i) => Math.abs(t - userParams[i]) < 0.001
  );
}

function loadLevel(idx: number) {
  currentLevel = idx;
  userParams = [0, 0, 0, 0, 0];
  selectedParam = 0;
  won = false;
  winOverlay.classList.remove("show");
  updateMeshes();
  updateHUD();
}

// --- Camera ---
function updateCamera() {
  camera.position.set(
    Math.cos(camAngle) * camDist,
    camHeight,
    Math.sin(camAngle) * camDist
  );
  camera.lookAt(0, 0, 0);
}

// --- Input ---
const keysDown = new Set<string>();

window.addEventListener("keydown", (e) => {
  if (won && e.key !== "Enter") return;

  keysDown.add(e.key.toLowerCase());

  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      selectedParam = (selectedParam - 1 + 5) % 5;
      updateHUD();
      break;
    case "ArrowDown":
      e.preventDefault();
      selectedParam = (selectedParam + 1) % 5;
      updateHUD();
      break;
    case "ArrowLeft":
      e.preventDefault();
      userParams[selectedParam] = Math.max(
        -1,
        Math.round((userParams[selectedParam] - 0.1) * 10) / 10
      );
      updateMeshes();
      updateHUD();
      if (checkWin()) {
        won = true;
        winOverlay.classList.add("show");
        if (currentLevel >= levels.length - 1) {
          nextBtn.textContent = "Restart →";
        } else {
          nextBtn.textContent = "Next Level →";
        }
      }
      break;
    case "ArrowRight":
      e.preventDefault();
      userParams[selectedParam] = Math.min(
        1,
        Math.round((userParams[selectedParam] + 0.1) * 10) / 10
      );
      updateMeshes();
      updateHUD();
      if (checkWin()) {
        won = true;
        winOverlay.classList.add("show");
        if (currentLevel >= levels.length - 1) {
          nextBtn.textContent = "Restart →";
        } else {
          nextBtn.textContent = "Next Level →";
        }
      }
      break;
    case "Enter":
      if (won) {
        loadLevel((currentLevel + 1) % levels.length);
      }
      break;
  }
});

window.addEventListener("keyup", (e) => {
  keysDown.delete(e.key.toLowerCase());
});

nextBtn.addEventListener("click", () => {
  loadLevel((currentLevel + 1) % levels.length);
});

// --- Animation loop ---
function animate() {
  requestAnimationFrame(animate);

  // Continuous camera controls
  const rotSpeed = 0.025;
  const zoomSpeed = 0.15;
  const heightSpeed = 0.12;

  if (keysDown.has("a")) camAngle += rotSpeed;
  if (keysDown.has("d")) camAngle -= rotSpeed;
  if (keysDown.has("w")) camDist = Math.max(4, camDist - zoomSpeed);
  if (keysDown.has("s")) camDist = Math.min(25, camDist + zoomSpeed);
  if (keysDown.has("q")) camHeight = Math.min(20, camHeight + heightSpeed);
  if (keysDown.has("e")) camHeight = Math.max(1, camHeight - heightSpeed);

  updateCamera();
  renderer.render(scene, camera);
}

// --- Resize ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Init ---
loadLevel(0);
updateCamera();
animate();
