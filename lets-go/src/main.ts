import "./styles.css";
import { chooseAiMove, measureDeviceProfile, SearchProfile, SearchResult } from "./ai";
import { clamp, deltaMeters, formatMeters, LatLon } from "./geo";
import { GameId, GameState, Move, Player, RULES } from "./games";

interface Settings {
  gameId: GameId;
  metersPerCell: number;
  boardMetersWide: number;
  boardMetersTall: number;
}

interface AppState {
  settings: Settings;
  gameState: GameState;
  humanPlayer: Player;
  anchor: LatLon | null;
  currentLocation: LatLon | null;
  virtualOffsetEast: number;
  virtualOffsetNorth: number;
  boardCursor: { x: number; y: number };
  lastMoveLabel: string;
  aiThinking: boolean;
  aiProfile: SearchProfile;
  aiLastResult: SearchResult | null;
  geoStatus: string;
  watchId: number | null;
}

const STORAGE_KEY = "lets-go-settings-v1";
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root missing");
}

const savedSettings = loadSettings();
const initialRule = RULES[savedSettings.gameId];

const state: AppState = {
  settings: savedSettings,
  gameState: initialRule.createInitialState(),
  humanPlayer: 1,
  anchor: null,
  currentLocation: null,
  virtualOffsetEast: 0,
  virtualOffsetNorth: 0,
  boardCursor: {
    x: Math.floor(initialRule.config.boardWidth / 2),
    y: Math.floor(initialRule.config.boardHeight / 2),
  },
  lastMoveLabel: "Walk to a square, then place your stone there.",
  aiThinking: false,
  aiProfile: measureDeviceProfile(),
  aiLastResult: null,
  geoStatus: "Waiting for location permission",
  watchId: null,
};

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">GPS board strategy</p>
        <h1>Let's Go</h1>
        <p class="subtitle">
          Your real-world movement selects the square. Re-center on your current position, walk around, and play against a time-limited search AI.
        </p>
      </div>
      <div class="hero-chip" id="profile-chip"></div>
    </section>
    <section class="layout">
      <section class="panel board-panel">
        <div class="panel-head">
          <div>
            <h2 id="game-title"></h2>
            <p id="status-text"></p>
          </div>
          <button id="move-btn" class="primary">Place Move</button>
        </div>
        <div id="board" class="board"></div>
        <div class="board-meta">
          <div id="cursor-text"></div>
          <div id="move-text"></div>
        </div>
      </section>
      <aside class="stack">
        <section class="panel controls">
          <h3>Settings</h3>
          <label>
            <span>Game</span>
            <select id="game-select"></select>
          </label>
          <label>
            <span>Meters per cell</span>
            <input id="meters-range" type="range" min="5" max="60" step="1" />
            <strong id="meters-value"></strong>
          </label>
          <label>
            <span>Board width in meters</span>
            <input id="width-range" type="range" min="30" max="600" step="10" />
            <strong id="width-value"></strong>
          </label>
          <label>
            <span>Board height in meters</span>
            <input id="height-range" type="range" min="30" max="600" step="10" />
            <strong id="height-value"></strong>
          </label>
          <div class="button-row">
            <button id="center-btn">Use Current Spot as Center</button>
            <button id="new-btn">New Match</button>
          </div>
        </section>
        <section class="panel controls">
          <h3>Movement</h3>
          <p id="geo-status" class="small"></p>
          <p id="location-text" class="small"></p>
          <div class="button-row">
            <button data-step="0,12">North</button>
            <button data-step="-12,0">West</button>
            <button data-step="12,0">East</button>
            <button data-step="0,-12">South</button>
          </div>
          <p class="small">
            The step buttons are a fallback simulator for desktop testing if GPS is unavailable.
          </p>
        </section>
        <section class="panel controls">
          <h3>AI</h3>
          <p id="ai-text" class="small"></p>
          <p id="analysis-text" class="small"></p>
        </section>
      </aside>
    </section>
  </main>
`;

const boardEl = document.querySelector<HTMLDivElement>("#board")!;
const statusText = document.querySelector<HTMLParagraphElement>("#status-text")!;
const gameTitle = document.querySelector<HTMLHeadingElement>("#game-title")!;
const moveText = document.querySelector<HTMLDivElement>("#move-text")!;
const cursorText = document.querySelector<HTMLDivElement>("#cursor-text")!;
const geoStatus = document.querySelector<HTMLParagraphElement>("#geo-status")!;
const locationText = document.querySelector<HTMLParagraphElement>("#location-text")!;
const profileChip = document.querySelector<HTMLDivElement>("#profile-chip")!;
const aiText = document.querySelector<HTMLParagraphElement>("#ai-text")!;
const analysisText = document.querySelector<HTMLParagraphElement>("#analysis-text")!;
const moveButton = document.querySelector<HTMLButtonElement>("#move-btn")!;
const centerButton = document.querySelector<HTMLButtonElement>("#center-btn")!;
const newButton = document.querySelector<HTMLButtonElement>("#new-btn")!;
const gameSelect = document.querySelector<HTMLSelectElement>("#game-select")!;
const metersRange = document.querySelector<HTMLInputElement>("#meters-range")!;
const widthRange = document.querySelector<HTMLInputElement>("#width-range")!;
const heightRange = document.querySelector<HTMLInputElement>("#height-range")!;
const metersValue = document.querySelector<HTMLElement>("#meters-value")!;
const widthValue = document.querySelector<HTMLElement>("#width-value")!;
const heightValue = document.querySelector<HTMLElement>("#height-value")!;

for (const [id, rule] of Object.entries(RULES)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = rule.config.label;
  gameSelect.appendChild(option);
}

bindEvents();
startGeolocation();
render();
maybeRunAiTurn();

function bindEvents() {
  moveButton.addEventListener("click", () => {
    attemptHumanMove();
  });

  centerButton.addEventListener("click", () => {
    if (!state.currentLocation) {
      state.geoStatus = "No live GPS fix yet. Allow location first, or use the step buttons.";
      render();
      return;
    }
    state.anchor = state.currentLocation;
    state.virtualOffsetEast = 0;
    state.virtualOffsetNorth = 0;
    state.boardCursor = {
      x: Math.floor(state.gameState.width / 2),
      y: Math.floor(state.gameState.height / 2),
    };
    state.lastMoveLabel = "Center calibrated. Your current real-world position is the board center.";
    render();
  });

  newButton.addEventListener("click", () => {
    resetMatch();
  });

  gameSelect.addEventListener("change", () => {
    state.settings.gameId = gameSelect.value as GameId;
    const rule = RULES[state.settings.gameId];
    state.settings.metersPerCell = rule.config.metersPerCellDefault;
    state.settings.boardMetersWide = rule.config.boardWidth * rule.config.metersPerCellDefault;
    state.settings.boardMetersTall = rule.config.boardHeight * rule.config.metersPerCellDefault;
    persistSettings();
    resetMatch();
  });

  metersRange.addEventListener("input", () => {
    state.settings.metersPerCell = Number(metersRange.value);
    const rule = RULES[state.settings.gameId];
    state.settings.boardMetersWide = state.settings.metersPerCell * rule.config.boardWidth;
    state.settings.boardMetersTall = state.settings.metersPerCell * rule.config.boardHeight;
    persistSettings();
    updateCursorFromLocation();
    render();
  });

  widthRange.addEventListener("input", () => {
    state.settings.boardMetersWide = Number(widthRange.value);
    persistSettings();
    render();
  });

  heightRange.addEventListener("input", () => {
    state.settings.boardMetersTall = Number(heightRange.value);
    persistSettings();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const [east, north] = (button.dataset.step ?? "0,0").split(",").map(Number);
      state.virtualOffsetEast += east;
      state.virtualOffsetNorth += north;
      if (!state.currentLocation) {
        state.currentLocation = { lat: 0, lon: 0 };
      }
      state.geoStatus = "Using simulated movement.";
      updateCursorFromLocation();
      render();
    });
  });
}

function resetMatch() {
  const rule = RULES[state.settings.gameId];
  state.gameState = rule.createInitialState();
  state.boardCursor = {
    x: Math.floor(rule.config.boardWidth / 2),
    y: Math.floor(rule.config.boardHeight / 2),
  };
  state.lastMoveLabel = "New match started.";
  state.aiLastResult = null;
  state.aiThinking = false;
  render();
  maybeRunAiTurn();
}

function startGeolocation() {
  if (!("geolocation" in navigator)) {
    state.geoStatus = "Geolocation not supported by this browser.";
    render();
    return;
  }
  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      state.currentLocation = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      if (!state.anchor) {
        state.anchor = state.currentLocation;
        state.geoStatus = "Location locked. Tap 'Use Current Spot as Center' anytime to recalibrate.";
      } else {
        state.geoStatus = `GPS accuracy about ${Math.round(position.coords.accuracy)} m`;
      }
      updateCursorFromLocation();
      render();
    },
    (error) => {
      state.geoStatus = `Location error: ${error.message}`;
      render();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    }
  );
}

function updateCursorFromLocation() {
  const rule = RULES[state.settings.gameId];
  const centerX = Math.floor(rule.config.boardWidth / 2);
  const centerY = Math.floor(rule.config.boardHeight / 2);
  const cellMetersX = Math.max(1, state.settings.boardMetersWide / rule.config.boardWidth);
  const cellMetersY = Math.max(1, state.settings.boardMetersTall / rule.config.boardHeight);
  let offset = { x: 0, y: 0 };

  if (state.anchor && state.currentLocation) {
    const liveDelta = deltaMeters(state.anchor, state.currentLocation);
    offset = {
      x: clamp(
        Math.round((liveDelta.east + state.virtualOffsetEast) / cellMetersX),
        -centerX,
        centerX
      ),
      y: clamp(
        Math.round(-(liveDelta.north + state.virtualOffsetNorth) / cellMetersY),
        -centerY,
        centerY
      ),
    };
  } else if (state.virtualOffsetEast !== 0 || state.virtualOffsetNorth !== 0) {
    offset = {
      x: clamp(Math.round(state.virtualOffsetEast / cellMetersX), -centerX, centerX),
      y: clamp(Math.round(-state.virtualOffsetNorth / cellMetersY), -centerY, centerY),
    };
  }

  state.boardCursor = {
    x: clamp(centerX + offset.x, 0, rule.config.boardWidth - 1),
    y: clamp(centerY + offset.y, 0, rule.config.boardHeight - 1),
  };
}

function attemptHumanMove() {
  if (state.aiThinking || state.gameState.winner !== null) {
    return;
  }
  if (state.gameState.currentPlayer !== state.humanPlayer) {
    state.lastMoveLabel = "Wait for the AI to finish thinking.";
    render();
    return;
  }
  const rule = RULES[state.settings.gameId];
  const move = rule.moveFromBoardCell(
    state.gameState,
    state.boardCursor.x,
    state.boardCursor.y
  );
  if (!move) {
    state.lastMoveLabel = invalidMoveMessage();
    render();
    return;
  }
  playMove(move, "You");
}

function playMove(move: Move, actor: string) {
  const rule = RULES[state.settings.gameId];
  const applied = rule.applyMove(state.gameState, move);
  state.gameState = applied;
  state.lastMoveLabel = `${actor} played ${formatMove(move)}.`;
  render();
  if (!rule.isTerminal(applied)) {
    maybeRunAiTurn();
  }
}

function maybeRunAiTurn() {
  if (state.gameState.winner !== null) {
    render();
    return;
  }
  if (state.gameState.currentPlayer === state.humanPlayer) {
    if (RULES[state.settings.gameId].getLegalMoves(state.gameState)[0]?.pass) {
      state.lastMoveLabel = "You have no legal move. Passing turn.";
      state.gameState = RULES[state.settings.gameId].applyMove(state.gameState, {
        x: -1,
        y: -1,
        pass: true,
      });
      render();
      maybeRunAiTurn();
    }
    return;
  }
  state.aiThinking = true;
  state.lastMoveLabel = "AI is searching.";
  render();
  window.setTimeout(() => {
    const result = chooseAiMove(state.gameState, state.aiProfile);
    state.aiLastResult = result;
    state.aiThinking = false;
    if (result.move) {
      playMove(result.move, "AI");
    } else {
      const passMove = { x: -1, y: -1, pass: true };
      state.gameState = RULES[state.settings.gameId].applyMove(state.gameState, passMove);
      state.lastMoveLabel = "AI passes.";
      render();
      maybeRunAiTurn();
    }
  }, 30);
}

function invalidMoveMessage(): string {
  if (state.settings.gameId === "connect-four") {
    return "That column is full. Walk to a different column.";
  }
  if (state.settings.gameId === "othello") {
    return "Othello requires a square that flips at least one enemy disk.";
  }
  return "That square is already occupied. Walk to another square.";
}

function render() {
  const rule = RULES[state.settings.gameId];
  gameTitle.textContent = rule.config.label;
  statusText.textContent = rule.summarize(state.gameState);
  moveText.textContent = state.lastMoveLabel;
  cursorText.textContent = `Current square: ${state.boardCursor.x + 1}, ${state.boardCursor.y + 1}`;
  geoStatus.textContent = state.geoStatus;
  locationText.textContent = buildLocationText();
  profileChip.textContent = `AI budget ${state.aiProfile.budgetMs} ms • node cap ${state.aiProfile.maxNodes.toLocaleString()}`;
  aiText.textContent = `Device benchmark ${state.aiProfile.benchmarkOps.toFixed(0)} ops/ms. Faster phones search deeper within the same budget.`;
  analysisText.textContent = buildAnalysisText();
  moveButton.disabled =
    state.aiThinking ||
    state.gameState.winner !== null ||
    state.gameState.currentPlayer !== state.humanPlayer;

  gameSelect.value = state.settings.gameId;
  metersRange.value = String(state.settings.metersPerCell);
  widthRange.value = String(state.settings.boardMetersWide);
  heightRange.value = String(state.settings.boardMetersTall);
  metersValue.textContent = `${state.settings.metersPerCell} m`;
  widthValue.textContent = `${state.settings.boardMetersWide} m`;
  heightValue.textContent = `${state.settings.boardMetersTall} m`;

  renderBoard();
}

function renderBoard() {
  const { width, height } = state.gameState;
  boardEl.style.setProperty("--cols", String(width));
  boardEl.style.setProperty("--rows", String(height));
  boardEl.innerHTML = "";

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = document.createElement("button");
      cell.className = "cell";
      const value = state.gameState.cells[y * width + x];
      const isCursor = x === state.boardCursor.x && y === state.boardCursor.y;
      const legal = RULES[state.settings.gameId].moveFromBoardCell(state.gameState, x, y);
      if (value === 1) {
        cell.dataset.piece = "black";
      } else if (value === -1) {
        cell.dataset.piece = "white";
      }
      if (isCursor) {
        cell.classList.add("cursor");
      }
      if (legal) {
        cell.classList.add("legal");
      }
      cell.addEventListener("click", () => {
        state.boardCursor = { x, y };
        render();
      });
      boardEl.appendChild(cell);
    }
  }
}

function buildLocationText(): string {
  const centerX = Math.floor(state.gameState.width / 2);
  const centerY = Math.floor(state.gameState.height / 2);
  const cellMetersX = Math.max(1, state.settings.boardMetersWide / state.gameState.width);
  const cellMetersY = Math.max(1, state.settings.boardMetersTall / state.gameState.height);
  const dx = state.boardCursor.x - centerX;
  const dy = centerY - state.boardCursor.y;
  const eastMeters = dx * cellMetersX;
  const northMeters = dy * cellMetersY;
  return `Relative to center: ${formatMeters(eastMeters)} east, ${formatMeters(
    northMeters
  )} north. Board footprint ${state.settings.boardMetersWide} m × ${state.settings.boardMetersTall} m.`;
}

function buildAnalysisText(): string {
  if (!state.aiLastResult) {
    return "No AI move yet.";
  }
  return `Last search: depth ${state.aiLastResult.depth}, ${state.aiLastResult.nodes.toLocaleString()} nodes, ${Math.round(
    state.aiLastResult.elapsedMs
  )} ms${state.aiLastResult.timedOut ? ", budget reached" : ""}.`;
}

function formatMove(move: Move): string {
  if (move.pass) {
    return "pass";
  }
  if (state.settings.gameId === "connect-four") {
    return `column ${move.x + 1}`;
  }
  return `${move.x + 1}, ${move.y + 1}`;
}

function loadSettings(): Settings {
  const fallback: Settings = {
    gameId: "tic-tac-toe",
    metersPerCell: RULES["tic-tac-toe"].config.metersPerCellDefault,
    boardMetersWide:
      RULES["tic-tac-toe"].config.boardWidth * RULES["tic-tac-toe"].config.metersPerCellDefault,
    boardMetersTall:
      RULES["tic-tac-toe"].config.boardHeight *
      RULES["tic-tac-toe"].config.metersPerCellDefault,
  };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (!parsed.gameId || !(parsed.gameId in RULES)) {
      return fallback;
    }
    return {
      gameId: parsed.gameId,
      metersPerCell: clamp(Number(parsed.metersPerCell ?? fallback.metersPerCell), 5, 60),
      boardMetersWide: clamp(Number(parsed.boardMetersWide ?? fallback.boardMetersWide), 30, 600),
      boardMetersTall: clamp(Number(parsed.boardMetersTall ?? fallback.boardMetersTall), 30, 600),
    };
  } catch {
    return fallback;
  }
}

function persistSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}
