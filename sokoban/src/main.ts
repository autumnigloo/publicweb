import { LEVELS } from "./levels";

// ============ TYPES ============

const enum Tile {
  Floor,
  Wall,
  Trap,
  Flag,
  BtnRed,
  BtnGreen,
  BtnBlue,
  BarRed,
  BarGreen,
  BarBlue,
  LockedDoor,
  Key,
}

type Dir = "up" | "down" | "left" | "right";

interface Pos {
  x: number;
  y: number;
}

interface ScenarioState {
  width: number;
  height: number;
  grid: Tile[][]; // [row][col]
  player: Pos;
  boxes: Pos[];
  won: boolean;
  dead: boolean;
  keysHeld: number;
  moveCount: number;
}

// ============ PARSING ============

const CHAR_MAP: Record<string, Tile> = {
  ".": Tile.Floor,
  " ": Tile.Floor,
  "#": Tile.Wall,
  X: Tile.Trap,
  F: Tile.Flag,
  r: Tile.BtnRed,
  g: Tile.BtnGreen,
  b: Tile.BtnBlue,
  R: Tile.BarRed,
  G: Tile.BarGreen,
  B: Tile.BarBlue,
  L: Tile.LockedDoor,
  K: Tile.Key,
  "@": Tile.Floor,
  O: Tile.Floor,
};

function parseScenario(src: string): ScenarioState {
  const lines = src.split("\n");
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));
  const grid: Tile[][] = [];
  let player: Pos = { x: 0, y: 0 };
  const boxes: Pos[] = [];

  for (let r = 0; r < height; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < width; c++) {
      const ch = lines[r]?.[c] ?? " ";
      if (ch === "@") player = { x: c, y: r };
      if (ch === "O") boxes.push({ x: c, y: r });
      row.push(CHAR_MAP[ch] ?? Tile.Floor);
    }
    grid.push(row);
  }

  return { width, height, grid, player, boxes, won: false, dead: false, keysHeld: 0, moveCount: 0 };
}

function cloneState(s: ScenarioState): ScenarioState {
  return {
    width: s.width,
    height: s.height,
    grid: s.grid.map((r) => [...r]),
    player: { ...s.player },
    boxes: s.boxes.map((b) => ({ ...b })),
    won: s.won,
    dead: s.dead,
    keysHeld: s.keysHeld,
    moveCount: s.moveCount,
  };
}

// ============ GAME LOGIC ============

const DIR_DELTA: Record<Dir, Pos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function tileAt(s: ScenarioState, x: number, y: number): Tile {
  if (y < 0 || y >= s.height || x < 0 || x >= s.width) return Tile.Wall;
  return s.grid[y][x];
}

function boxAt(s: ScenarioState, x: number, y: number): number {
  return s.boxes.findIndex((b) => b.x === x && b.y === y);
}

function isButtonPressed(s: ScenarioState, color: "red" | "green" | "blue"): boolean {
  const btnTile = color === "red" ? Tile.BtnRed : color === "green" ? Tile.BtnGreen : Tile.BtnBlue;
  for (let r = 0; r < s.height; r++) {
    for (let c = 0; c < s.width; c++) {
      if (s.grid[r][c] === btnTile && boxAt(s, c, r) !== -1) return true;
    }
  }
  return false;
}

function isBarrierOpen(s: ScenarioState, tile: Tile): boolean {
  if (tile === Tile.BarRed) return isButtonPressed(s, "red");
  if (tile === Tile.BarGreen) return isButtonPressed(s, "green");
  if (tile === Tile.BarBlue) return isButtonPressed(s, "blue");
  return false;
}

function isSolid(s: ScenarioState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === Tile.Wall) return true;
  if ((t === Tile.BarRed || t === Tile.BarGreen || t === Tile.BarBlue) && !isBarrierOpen(s, t)) return true;
  if (t === Tile.LockedDoor && s.keysHeld <= 0) return true;
  return false;
}

function moveScenario(s: ScenarioState, dir: Dir): "ok" | "blocked" | "dead" | "win" {
  if (s.won || s.dead) return s.won ? "win" : "dead";

  const d = DIR_DELTA[dir];
  const nx = s.player.x + d.x;
  const ny = s.player.y + d.y;

  // Out of bounds or wall
  if (isSolid(s, nx, ny) && tileAt(s, nx, ny) !== Tile.LockedDoor) {
    // Check if it's a closed barrier or wall
    return "blocked";
  }

  // Locked door with key
  if (tileAt(s, nx, ny) === Tile.LockedDoor) {
    if (s.keysHeld > 0) {
      s.keysHeld--;
      s.grid[ny][nx] = Tile.Floor;
    } else {
      return "blocked";
    }
  }

  // Box at target
  const bi = boxAt(s, nx, ny);
  if (bi !== -1) {
    const bx = nx + d.x;
    const by = ny + d.y;
    // Check if box can move there
    if (isSolid(s, bx, by) || boxAt(s, bx, by) !== -1) return "blocked";
    // Check if pushing box onto trap — box fills the trap
    if (tileAt(s, bx, by) === Tile.Trap) {
      s.grid[by][bx] = Tile.Floor;
      s.boxes.splice(bi, 1); // box consumed by trap
    } else {
      s.boxes[bi] = { x: bx, y: by };
    }
  }

  // Move player
  s.player = { x: nx, y: ny };
  s.moveCount++;

  // Check tile effects
  const t = tileAt(s, nx, ny);
  if (t === Tile.Trap) {
    s.dead = true;
    return "dead";
  }
  if (t === Tile.Key) {
    s.keysHeld++;
    s.grid[ny][nx] = Tile.Floor;
  }
  if (t === Tile.Flag) {
    s.won = true;
    return "win";
  }

  return "ok";
}

// ============ GAME STATE ============

interface GameState {
  levelIdx: number;
  stageIdx: number; // 0-3
  scenarios: ScenarioState[];
  originalScenarios: ScenarioState[];
  overlayType: "" | "stage" | "died" | "won";
  overlayTimer: number;
}

function initStage(gs: GameState) {
  const level = LEVELS[gs.levelIdx];
  const count = gs.stageIdx + 1;
  gs.scenarios = [];
  gs.originalScenarios = [];
  for (let i = 0; i < count; i++) {
    const s = parseScenario(level.scenarios[i]);
    gs.originalScenarios.push(cloneState(s));
    gs.scenarios.push(s);
  }
}

function resetStage(gs: GameState) {
  gs.scenarios = gs.originalScenarios.map((s) => cloneState(s));
}

const gs: GameState = {
  levelIdx: 0,
  stageIdx: 0,
  scenarios: [],
  originalScenarios: [],
  overlayType: "",
  overlayTimer: 0,
};

// ============ RENDERING ============

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const overlay = document.getElementById("overlay")!;
const ovTitle = document.getElementById("ov-title")!;
const ovSub = document.getElementById("ov-sub")!;
const ovHint = document.getElementById("ov-hint")!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const COLORS = {
  bg: "#0d0d1a",
  floor1: "#1e1e2e",
  floor2: "#222236",
  wall: "#3d3d56",
  wallHi: "#4a4a66",
  wallLo: "#2a2a3e",
  player: "#44aaff",
  playerDark: "#2277cc",
  box: "#cc8844",
  boxDark: "#996633",
  key: "#ffcc33",
  keyDark: "#cc9900",
  lockedDoor: "#8b7355",
  lockedDoorHi: "#a08060",
  trap: "#cc2244",
  trapDark: "#881133",
  flag: "#44dd88",
  flagPole: "#888888",
  btnRed: "#ff4444",
  btnGreen: "#44cc44",
  btnBlue: "#4488ff",
  barRed: "#cc3333",
  barGreen: "#339933",
  barBlue: "#3366cc",
  barRedOpen: "#441111",
  barGreenOpen: "#114411",
  barBlueOpen: "#111144",
  wonTint: "rgba(68,221,136,0.08)",
  deadTint: "rgba(255,68,102,0.12)",
  border: "#2a2a44",
  labelBg: "rgba(13,13,26,0.85)",
  text: "#ccccdd",
  textDim: "#666677",
};

function drawTile(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  tile: Tile,
  s: ScenarioState,
) {
  const px = x * ts;
  const py = y * ts;

  // Floor checkerboard
  cx.fillStyle = (x + y) % 2 === 0 ? COLORS.floor1 : COLORS.floor2;
  cx.fillRect(px, py, ts, ts);

  switch (tile) {
    case Tile.Wall:
      cx.fillStyle = COLORS.wall;
      cx.fillRect(px, py, ts, ts);
      // 3D bevel
      cx.fillStyle = COLORS.wallHi;
      cx.fillRect(px, py, ts, 2);
      cx.fillRect(px, py, 2, ts);
      cx.fillStyle = COLORS.wallLo;
      cx.fillRect(px, py + ts - 2, ts, 2);
      cx.fillRect(px + ts - 2, py, 2, ts);
      break;

    case Tile.Trap:
      // Spikes
      cx.fillStyle = COLORS.trapDark;
      cx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
      cx.fillStyle = COLORS.trap;
      const spikes = 3;
      for (let i = 0; i < spikes; i++) {
        const sx = px + (ts / (spikes + 1)) * (i + 1);
        cx.beginPath();
        cx.moveTo(sx - ts * 0.1, py + ts * 0.75);
        cx.lineTo(sx, py + ts * 0.2);
        cx.lineTo(sx + ts * 0.1, py + ts * 0.75);
        cx.fill();
      }
      break;

    case Tile.Flag:
      // Pole
      cx.fillStyle = COLORS.flagPole;
      cx.fillRect(px + ts * 0.3, py + ts * 0.15, ts * 0.06, ts * 0.7);
      // Flag triangle
      cx.fillStyle = COLORS.flag;
      cx.beginPath();
      cx.moveTo(px + ts * 0.36, py + ts * 0.15);
      cx.lineTo(px + ts * 0.8, py + ts * 0.3);
      cx.lineTo(px + ts * 0.36, py + ts * 0.45);
      cx.fill();
      break;

    case Tile.BtnRed:
    case Tile.BtnGreen:
    case Tile.BtnBlue: {
      const col =
        tile === Tile.BtnRed ? COLORS.btnRed : tile === Tile.BtnGreen ? COLORS.btnGreen : COLORS.btnBlue;
      cx.fillStyle = col;
      cx.globalAlpha = 0.35;
      cx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
      cx.globalAlpha = 1;
      cx.beginPath();
      cx.arc(px + ts / 2, py + ts / 2, ts * 0.25, 0, Math.PI * 2);
      cx.fillStyle = col;
      cx.fill();
      cx.strokeStyle = col;
      cx.lineWidth = 1.5;
      cx.stroke();
      break;
    }

    case Tile.BarRed:
    case Tile.BarGreen:
    case Tile.BarBlue: {
      const open = isBarrierOpen(s, tile);
      if (open) {
        const oc =
          tile === Tile.BarRed ? COLORS.barRedOpen : tile === Tile.BarGreen ? COLORS.barGreenOpen : COLORS.barBlueOpen;
        cx.fillStyle = oc;
        cx.fillRect(px, py, ts, ts);
        // Dashed outline
        cx.strokeStyle =
          tile === Tile.BarRed ? COLORS.barRed : tile === Tile.BarGreen ? COLORS.barGreen : COLORS.barBlue;
        cx.globalAlpha = 0.3;
        cx.lineWidth = 1;
        cx.setLineDash([3, 3]);
        cx.strokeRect(px + 2, py + 2, ts - 4, ts - 4);
        cx.setLineDash([]);
        cx.globalAlpha = 1;
      } else {
        const bc =
          tile === Tile.BarRed ? COLORS.barRed : tile === Tile.BarGreen ? COLORS.barGreen : COLORS.barBlue;
        cx.fillStyle = bc;
        cx.fillRect(px, py, ts, ts);
        // Stripes
        cx.fillStyle = "rgba(0,0,0,0.2)";
        for (let i = 0; i < ts; i += 6) {
          cx.fillRect(px + i, py, 3, ts);
        }
        // Bevel
        cx.fillStyle = "rgba(255,255,255,0.15)";
        cx.fillRect(px, py, ts, 2);
        cx.fillStyle = "rgba(0,0,0,0.2)";
        cx.fillRect(px, py + ts - 2, ts, 2);
      }
      break;
    }

    case Tile.LockedDoor:
      cx.fillStyle = COLORS.lockedDoor;
      cx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
      cx.fillStyle = COLORS.lockedDoorHi;
      cx.fillRect(px + 1, py + 1, ts - 2, 2);
      // Keyhole
      cx.fillStyle = "#222";
      cx.beginPath();
      cx.arc(px + ts / 2, py + ts * 0.4, ts * 0.1, 0, Math.PI * 2);
      cx.fill();
      cx.fillRect(px + ts / 2 - ts * 0.04, py + ts * 0.45, ts * 0.08, ts * 0.2);
      break;

    case Tile.Key:
      drawKeyIcon(cx, px, py, ts);
      break;
  }
}

function drawKeyIcon(cx: CanvasRenderingContext2D, px: number, py: number, ts: number) {
  cx.fillStyle = COLORS.key;
  cx.strokeStyle = COLORS.keyDark;
  cx.lineWidth = 1.5;
  // Ring
  cx.beginPath();
  cx.arc(px + ts * 0.4, py + ts * 0.35, ts * 0.15, 0, Math.PI * 2);
  cx.fill();
  cx.stroke();
  // Shaft
  cx.fillRect(px + ts * 0.4, py + ts * 0.45, ts * 0.04, ts * 0.35);
  cx.strokeRect(px + ts * 0.4, py + ts * 0.45, ts * 0.04, ts * 0.35);
  // Teeth
  cx.fillRect(px + ts * 0.44, py + ts * 0.6, ts * 0.1, ts * 0.04);
  cx.fillRect(px + ts * 0.44, py + ts * 0.7, ts * 0.12, ts * 0.04);
}

function drawEntity(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  type: "player" | "box",
) {
  const px = x * ts;
  const py = y * ts;

  if (type === "box") {
    const pad = ts * 0.12;
    cx.fillStyle = COLORS.box;
    cx.fillRect(px + pad, py + pad, ts - pad * 2, ts - pad * 2);
    cx.fillStyle = COLORS.boxDark;
    cx.fillRect(px + pad, py + ts - pad - 2, ts - pad * 2, 2);
    cx.fillRect(px + ts - pad - 2, py + pad, 2, ts - pad * 2);
    // Cross
    cx.strokeStyle = COLORS.boxDark;
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.moveTo(px + pad + 3, py + pad + 3);
    cx.lineTo(px + ts - pad - 3, py + ts - pad - 3);
    cx.moveTo(px + ts - pad - 3, py + pad + 3);
    cx.lineTo(px + pad + 3, py + ts - pad - 3);
    cx.stroke();
  } else {
    // Player - circle with face
    const cx2 = px + ts / 2;
    const cy2 = py + ts / 2;
    const r = ts * 0.35;
    cx.fillStyle = COLORS.player;
    cx.beginPath();
    cx.arc(cx2, cy2, r, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = COLORS.playerDark;
    cx.beginPath();
    cx.arc(cx2, cy2 + 1, r, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = COLORS.player;
    cx.beginPath();
    cx.arc(cx2, cy2, r, 0, Math.PI * 2);
    cx.fill();
    // Eyes
    cx.fillStyle = "#fff";
    cx.beginPath();
    cx.arc(cx2 - r * 0.3, cy2 - r * 0.15, r * 0.2, 0, Math.PI * 2);
    cx.arc(cx2 + r * 0.3, cy2 - r * 0.15, r * 0.2, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = "#112";
    cx.beginPath();
    cx.arc(cx2 - r * 0.25, cy2 - r * 0.1, r * 0.1, 0, Math.PI * 2);
    cx.arc(cx2 + r * 0.35, cy2 - r * 0.1, r * 0.1, 0, Math.PI * 2);
    cx.fill();
  }
}

function drawScenario(
  cx: CanvasRenderingContext2D,
  s: ScenarioState,
  vx: number,
  vy: number,
  vw: number,
  vh: number,
  scenIdx: number,
  total: number,
) {
  // Calculate tile size to fit
  const padX = 20;
  const padY = 40;
  const availW = vw - padX * 2;
  const availH = vh - padY - padX;
  const ts = Math.floor(Math.min(availW / s.width, availH / s.height));
  const gridW = ts * s.width;
  const gridH = ts * s.height;
  const ox = vx + Math.floor((vw - gridW) / 2);
  const oy = vy + padY + Math.floor((availH - gridH) / 2);

  // Border
  cx.strokeStyle = COLORS.border;
  cx.lineWidth = 1;
  if (total > 1) {
    cx.strokeRect(vx + 1, vy + 1, vw - 2, vh - 2);
  }

  // Label
  cx.fillStyle = COLORS.textDim;
  cx.font = "bold 13px 'Segoe UI', system-ui, sans-serif";
  cx.textAlign = "left";
  const label = `Scenario ${scenIdx + 1}`;
  cx.fillText(label, vx + 10, vy + 22);

  // Status badge
  if (s.won) {
    cx.fillStyle = COLORS.flag;
    cx.fillText(" CLEAR", vx + 10 + cx.measureText(label).width, vy + 22);
  } else if (s.dead) {
    cx.fillStyle = COLORS.trap;
    cx.fillText(" DEAD", vx + 10 + cx.measureText(label).width, vy + 22);
  }

  // Keys held indicator
  if (s.keysHeld > 0) {
    cx.fillStyle = COLORS.key;
    cx.textAlign = "right";
    cx.fillText(`🔑×${s.keysHeld}`, vx + vw - 10, vy + 22);
  }

  cx.save();
  cx.translate(ox, oy);

  // Draw grid
  for (let r = 0; r < s.height; r++) {
    for (let c = 0; c < s.width; c++) {
      drawTile(cx, c, r, ts, s.grid[r][c], s);
    }
  }

  // Draw boxes
  for (const b of s.boxes) {
    drawEntity(cx, b.x, b.y, ts, "box");
  }

  // Draw player
  if (!s.dead) {
    drawEntity(cx, s.player.x, s.player.y, ts, "player");
  }

  // Won/dead overlay tint
  if (s.won) {
    cx.fillStyle = COLORS.wonTint;
    cx.fillRect(0, 0, gridW, gridH);
    // Checkmark
    cx.strokeStyle = COLORS.flag;
    cx.lineWidth = ts * 0.15;
    cx.lineCap = "round";
    cx.beginPath();
    cx.moveTo(gridW * 0.35, gridH * 0.5);
    cx.lineTo(gridW * 0.45, gridH * 0.62);
    cx.lineTo(gridW * 0.65, gridH * 0.38);
    cx.stroke();
  }
  if (s.dead) {
    cx.fillStyle = COLORS.deadTint;
    cx.fillRect(0, 0, gridW, gridH);
  }

  cx.restore();
}

function render() {
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const n = gs.scenarios.length;

  // HUD: level + stage info at top center
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  const levelName = LEVELS[gs.levelIdx].name;
  ctx.fillText(
    `Level ${gs.levelIdx + 1}: ${levelName}  —  Stage ${gs.stageIdx + 1}/4`,
    W / 2,
    16,
  );

  // Controls hint bottom center
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Arrow keys: move  |  R: reset  |  Z: undo", W / 2, H - 8);

  if (n === 1) {
    // Full screen (with small margins)
    const margin = 30;
    drawScenario(ctx, gs.scenarios[0], margin, margin, W - margin * 2, H - margin * 2, 0, 1);
  } else {
    // Quadrants
    const hw = Math.floor(W / 2);
    const hh = Math.floor(H / 2);
    const positions = [
      [0, 0],
      [hw, 0],
      [0, hh],
      [hw, hh],
    ];
    for (let i = 0; i < n; i++) {
      drawScenario(ctx, gs.scenarios[i], positions[i][0], positions[i][1], hw, hh, i, n);
    }
  }
}

// ============ OVERLAY ============

function showOverlay(type: "stage" | "died" | "won") {
  gs.overlayType = type;
  overlay.className = `show ${type}`;

  if (type === "died") {
    ovTitle.textContent = "DEAD";
    ovSub.textContent = "You hit a trap!";
    ovHint.textContent = "Press any key to retry";
  } else if (type === "stage") {
    if (gs.stageIdx >= 3) {
      // Completed all 4 stages
      ovTitle.textContent = "LEVEL COMPLETE";
      ovSub.textContent = `${LEVELS[gs.levelIdx].name} cleared!`;
      ovHint.textContent = gs.levelIdx < LEVELS.length - 1 ? "Press any key for next level" : "Press any key...";
    } else {
      ovTitle.textContent = `STAGE ${gs.stageIdx + 1} CLEAR`;
      ovSub.textContent = `Now control ${gs.stageIdx + 2} scenarios at once!`;
      ovHint.textContent = "Press any key to continue";
    }
  } else if (type === "won") {
    ovTitle.textContent = "YOU WIN";
    ovSub.textContent = "All levels completed!";
    ovHint.textContent = "Press R to restart";
  }
}

function hideOverlay() {
  gs.overlayType = "";
  overlay.className = "";
}

// ============ UNDO ============

let undoStack: ScenarioState[][] = [];

function pushUndo() {
  undoStack.push(gs.scenarios.map((s) => cloneState(s)));
  if (undoStack.length > 200) undoStack.shift();
}

function popUndo() {
  const prev = undoStack.pop();
  if (prev) gs.scenarios = prev;
}

// ============ INPUT ============

function handleMove(dir: Dir) {
  if (gs.overlayType) return;

  pushUndo();

  let anyMoved = false;
  let died = false;

  for (const s of gs.scenarios) {
    if (s.won || s.dead) continue;
    const result = moveScenario(s, dir);
    if (result !== "blocked") anyMoved = true;
    if (result === "dead") died = true;
  }

  if (!anyMoved) {
    undoStack.pop(); // Nothing happened, discard undo entry
    return;
  }

  render();

  if (died) {
    setTimeout(() => {
      showOverlay("died");
      render();
    }, 300);
    return;
  }

  // Check if all scenarios won
  if (gs.scenarios.every((s) => s.won)) {
    setTimeout(() => {
      if (gs.stageIdx >= 3) {
        // Level complete
        if (gs.levelIdx >= LEVELS.length - 1) {
          showOverlay("won");
        } else {
          showOverlay("stage");
        }
      } else {
        showOverlay("stage");
      }
      render();
    }, 400);
  }
}

function handleOverlayDismiss() {
  if (gs.overlayType === "died") {
    hideOverlay();
    resetStage(gs);
    undoStack = [];
    render();
  } else if (gs.overlayType === "stage") {
    hideOverlay();
    if (gs.stageIdx >= 3) {
      // Next level
      if (gs.levelIdx < LEVELS.length - 1) {
        gs.levelIdx++;
        gs.stageIdx = 0;
      } else {
        // Game over — restart
        gs.levelIdx = 0;
        gs.stageIdx = 0;
      }
    } else {
      gs.stageIdx++;
    }
    initStage(gs);
    undoStack = [];
    render();
  } else if (gs.overlayType === "won") {
    hideOverlay();
    gs.levelIdx = 0;
    gs.stageIdx = 0;
    initStage(gs);
    undoStack = [];
    render();
  }
}

window.addEventListener("keydown", (e) => {
  if (gs.overlayType) {
    e.preventDefault();
    handleOverlayDismiss();
    return;
  }

  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      handleMove("up");
      break;
    case "ArrowDown":
      e.preventDefault();
      handleMove("down");
      break;
    case "ArrowLeft":
      e.preventDefault();
      handleMove("left");
      break;
    case "ArrowRight":
      e.preventDefault();
      handleMove("right");
      break;
    case "r":
    case "R":
      resetStage(gs);
      undoStack = [];
      render();
      break;
    case "z":
    case "Z":
      popUndo();
      render();
      break;
  }
});

// ============ INIT ============

initStage(gs);
render();
