import "./styles.css";
import { chooseAiMove, measureDeviceProfile, SearchProfile, SearchResult } from "./ai";
import { clamp, deltaMeters, formatMeters, LatLon } from "./geo";
import { GameId, GameState, Move, Player, RULES } from "./games";

interface Settings {
  gameId: GameId;
  boardMetersWide: number;
  mapEnabled: boolean;
  mapAlpha: number;
  mapForeground: boolean;
}

interface HistoryEntry {
  gameState: GameState;
  label: string;
  aiLastResult: SearchResult | null;
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
  playerMarker: { x: number; y: number };
  lastMoveLabel: string;
  aiThinking: boolean;
  aiProfile: SearchProfile;
  aiLastResult: SearchResult | null;
  geoStatus: string;
  watchId: number | null;
  history: HistoryEntry[];
  historyIndex: number;
}

const STORAGE_KEY = "lets-go-settings-v1";
const SESSION_KEY = "lets-go-session-v1";
const app = document.querySelector<HTMLDivElement>("#app");
const isDesktopControls =
  window.matchMedia("(pointer:fine)").matches && window.matchMedia("(hover:hover)").matches;
const heldKeys = new Set<string>();

let keyboardFrame = 0;
let keyboardLastTs = 0;
let aiTimer = 0;

if (!app) {
  throw new Error("App root missing");
}

const savedSettings = loadSettings();
const initialRule = RULES[savedSettings.gameId];
const initialGameState = initialRule.createInitialState();

const state: AppState = {
  settings: savedSettings,
  gameState: initialGameState,
  humanPlayer: 1,
  anchor: null,
  currentLocation: null,
  virtualOffsetEast: 0,
  virtualOffsetNorth: 0,
  boardCursor: centeredCursor(initialGameState),
  playerMarker: { x: 0.5, y: 0.5 },
  lastMoveLabel: "Ready",
  aiThinking: false,
  aiProfile: measureDeviceProfile(),
  aiLastResult: null,
  geoStatus: "Waiting for GPS",
  watchId: null,
  history: [],
  historyIndex: 0,
};

state.history = [makeHistoryEntry(initialGameState, "Ready", null)];
restoreSession();

app.innerHTML = `
  <main class="shell">
    <section class="panel board-panel">
      <div class="board-topbar">
        <div class="title-block">
          <h1>Let's Go</h1>
          <div class="status-inline">
            <strong id="game-title"></strong>
            <span id="status-text"></span>
          </div>
        </div>
        <div class="actions">
          <button id="map-btn">Map</button>
          <button id="layer-btn">Overlay</button>
          <button id="undo-btn">Undo</button>
          <button id="redo-btn">Redo</button>
          <button id="move-btn" class="primary">Place</button>
        </div>
      </div>
      <div class="board-shell">
        <div id="map-layer" class="map-layer"></div>
        <div id="board" class="board"></div>
        <div id="player-marker" class="player-marker" aria-hidden="true"></div>
      </div>
      <div class="info-strip">
        <span id="cursor-text"></span>
        <span id="location-text"></span>
        <span id="analysis-text"></span>
      </div>
    </section>
    <section class="panel controls">
      <label>
        <span>Game</span>
        <select id="game-select"></select>
      </label>
      <label>
        <span>Board width</span>
        <input id="width-range" type="range" min="30" max="600" step="10" />
        <strong id="width-value"></strong>
      </label>
      <label>
        <span>Map alpha</span>
        <input id="alpha-range" type="range" min="0" max="100" step="1" />
        <strong id="alpha-value"></strong>
      </label>
      <div class="button-row">
        <button id="center-btn">Center Here</button>
        <button id="new-btn">New Match</button>
      </div>
      <p id="geo-status" class="small"></p>
      <p id="move-text" class="small"></p>
      <p id="desktop-hint" class="small"></p>
    </section>
  </main>
`;

const boardEl = document.querySelector<HTMLDivElement>("#board")!;
const boardShell = document.querySelector<HTMLDivElement>(".board-shell")!;
const mapLayer = document.querySelector<HTMLDivElement>("#map-layer")!;
const playerMarker = document.querySelector<HTMLDivElement>("#player-marker")!;
const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const gameTitle = document.querySelector<HTMLElement>("#game-title")!;
const moveText = document.querySelector<HTMLParagraphElement>("#move-text")!;
const cursorText = document.querySelector<HTMLSpanElement>("#cursor-text")!;
const geoStatus = document.querySelector<HTMLParagraphElement>("#geo-status")!;
const locationText = document.querySelector<HTMLSpanElement>("#location-text")!;
const analysisText = document.querySelector<HTMLSpanElement>("#analysis-text")!;
const moveButton = document.querySelector<HTMLButtonElement>("#move-btn")!;
const mapButton = document.querySelector<HTMLButtonElement>("#map-btn")!;
const layerButton = document.querySelector<HTMLButtonElement>("#layer-btn")!;
const undoButton = document.querySelector<HTMLButtonElement>("#undo-btn")!;
const redoButton = document.querySelector<HTMLButtonElement>("#redo-btn")!;
const centerButton = document.querySelector<HTMLButtonElement>("#center-btn")!;
const newButton = document.querySelector<HTMLButtonElement>("#new-btn")!;
const gameSelect = document.querySelector<HTMLSelectElement>("#game-select")!;
const widthRange = document.querySelector<HTMLInputElement>("#width-range")!;
const widthValue = document.querySelector<HTMLElement>("#width-value")!;
const alphaRange = document.querySelector<HTMLInputElement>("#alpha-range")!;
const alphaValue = document.querySelector<HTMLElement>("#alpha-value")!;
const desktopHint = document.querySelector<HTMLParagraphElement>("#desktop-hint")!;

for (const [id, rule] of Object.entries(RULES)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = rule.config.label;
  gameSelect.appendChild(option);
}

bindEvents();
startGeolocation();
updateCursorFromLocation();
render();
maybeRunAiTurn();

function bindEvents() {
  moveButton.addEventListener("click", () => {
    attemptHumanMove();
  });

  mapButton.addEventListener("click", () => {
    state.settings.mapEnabled = !state.settings.mapEnabled;
    persistSettings();
    render();
  });

  layerButton.addEventListener("click", () => {
    state.settings.mapForeground = !state.settings.mapForeground;
    persistSettings();
    render();
  });

  undoButton.addEventListener("click", () => {
    undoMove();
  });

  redoButton.addEventListener("click", () => {
    redoMove();
  });

  centerButton.addEventListener("click", () => {
    if (!state.currentLocation) {
      state.geoStatus = "No GPS fix yet";
      render();
      return;
    }
    state.anchor = state.currentLocation;
    state.virtualOffsetEast = 0;
    state.virtualOffsetNorth = 0;
    state.lastMoveLabel = "Centered";
    updateCursorFromLocation();
    render();
  });

  newButton.addEventListener("click", () => {
    resetMatch();
  });

  gameSelect.addEventListener("change", () => {
    state.settings.gameId = gameSelect.value as GameId;
    state.settings.boardMetersWide = defaultBoardWidth(state.settings.gameId);
    persistSettings();
    resetMatch();
  });

  widthRange.addEventListener("input", () => {
    state.settings.boardMetersWide = Number(widthRange.value);
    persistSettings();
    updateCursorFromLocation();
    render();
  });

  alphaRange.addEventListener("input", () => {
    state.settings.mapAlpha = clamp(Number(alphaRange.value) / 100, 0, 1);
    persistSettings();
    render();
  });

  if (isDesktopControls) {
    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", stopKeyboardMotion);
  }
}

function onKeyDown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    attemptHumanMove();
    return;
  }
  if (!event.key.startsWith("Arrow")) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  heldKeys.add(event.key);
  if (keyboardFrame === 0) {
    keyboardLastTs = performance.now();
    keyboardFrame = window.requestAnimationFrame(stepKeyboardMotion);
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (!event.key.startsWith("Arrow")) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  heldKeys.delete(event.key);
  if (heldKeys.size === 0) {
    stopKeyboardMotion();
  }
}

function stepKeyboardMotion(timestamp: number) {
  const dt = Math.min(32, timestamp - keyboardLastTs);
  keyboardLastTs = timestamp;
  const metersPerSecond = state.settings.boardMetersWide / 4;
  const delta = (metersPerSecond * dt) / 1000;

  if (heldKeys.has("ArrowLeft")) {
    state.virtualOffsetEast -= delta;
  }
  if (heldKeys.has("ArrowRight")) {
    state.virtualOffsetEast += delta;
  }
  if (heldKeys.has("ArrowUp")) {
    state.virtualOffsetNorth += delta;
  }
  if (heldKeys.has("ArrowDown")) {
    state.virtualOffsetNorth -= delta;
  }

  updateCursorFromLocation();
  render();

  if (heldKeys.size > 0) {
    keyboardFrame = window.requestAnimationFrame(stepKeyboardMotion);
  } else {
    keyboardFrame = 0;
  }
}

function stopKeyboardMotion() {
  heldKeys.clear();
  if (keyboardFrame !== 0) {
    window.cancelAnimationFrame(keyboardFrame);
    keyboardFrame = 0;
  }
}

function resetMatch() {
  clearAiTimer();
  const rule = RULES[state.settings.gameId];
  state.gameState = rule.createInitialState();
  state.aiLastResult = null;
  state.aiThinking = false;
  state.lastMoveLabel = "Ready";
  state.history = [makeHistoryEntry(state.gameState, "Ready", null)];
  state.historyIndex = 0;
  state.boardCursor = centeredCursor(state.gameState);
  updateCursorFromLocation();
  render();
  maybeRunAiTurn();
}

function undoMove() {
  if (state.historyIndex === 0) {
    return;
  }
  clearAiTimer();
  state.aiThinking = false;
  state.historyIndex -= 1;
  restoreHistoryEntry(state.history[state.historyIndex]);
  render();
}

function redoMove() {
  if (state.historyIndex >= state.history.length - 1) {
    return;
  }
  clearAiTimer();
  state.aiThinking = false;
  state.historyIndex += 1;
  restoreHistoryEntry(state.history[state.historyIndex]);
  render();
}

function restoreHistoryEntry(entry: HistoryEntry) {
  state.gameState = cloneGameState(entry.gameState);
  state.lastMoveLabel = entry.label;
  state.aiLastResult = entry.aiLastResult;
  updateCursorFromLocation();
}

function startGeolocation() {
  if (!("geolocation" in navigator)) {
    state.geoStatus = "GPS unavailable";
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
      }
      state.geoStatus = `GPS ±${Math.round(position.coords.accuracy)} m`;
      updateCursorFromLocation();
      render();
    },
    (error) => {
      state.geoStatus = `GPS error: ${error.message}`;
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
  const center = centeredCursor(state.gameState);
  const cellMeters = state.settings.boardMetersWide / rule.config.boardWidth;
  const boardMetersHigh = cellMeters * rule.config.boardHeight;
  const offset = combinedOffsetMeters();

  const snappedX = clamp(
    Math.round(offset.east / cellMeters),
    -center.x,
    rule.config.boardWidth - 1 - center.x
  );
  const snappedY = clamp(
    Math.round(-offset.north / cellMeters),
    -center.y,
    rule.config.boardHeight - 1 - center.y
  );

  state.boardCursor = {
    x: clamp(center.x + snappedX, 0, rule.config.boardWidth - 1),
    y: clamp(center.y + snappedY, 0, rule.config.boardHeight - 1),
  };

  const halfSpanX = state.settings.boardMetersWide / 2;
  const halfSpanY = boardMetersHigh / 2;
  state.playerMarker = {
    x: clamp((offset.east + halfSpanX) / state.settings.boardMetersWide, 0, 1),
    y: clamp((halfSpanY - offset.north) / boardMetersHigh, 0, 1),
  };
}

function combinedOffsetMeters() {
  let east = state.virtualOffsetEast;
  let north = state.virtualOffsetNorth;
  if (state.anchor && state.currentLocation) {
    const live = deltaMeters(state.anchor, state.currentLocation);
    east += live.east;
    north += live.north;
  }
  return { east, north };
}

function attemptHumanMove() {
  if (state.aiThinking || state.gameState.winner !== null) {
    return;
  }
  if (state.gameState.currentPlayer !== state.humanPlayer) {
    state.lastMoveLabel = "AI turn";
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
  playMove(move, "You", null);
}

function playMove(move: Move, actor: string, result: SearchResult | null) {
  const rule = RULES[state.settings.gameId];
  const applied = rule.applyMove(state.gameState, move);
  state.gameState = applied;
  state.aiLastResult = result;
  state.lastMoveLabel = `${actor} ${formatMove(move)}`;
  pushHistory(state.gameState, state.lastMoveLabel, state.aiLastResult);
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

  const rule = RULES[state.settings.gameId];
  if (state.gameState.currentPlayer === state.humanPlayer) {
    const legalMoves = rule.getLegalMoves(state.gameState);
    if (legalMoves[0]?.pass) {
      state.gameState = rule.applyMove(state.gameState, legalMoves[0]);
      state.lastMoveLabel = "You pass";
      pushHistory(state.gameState, state.lastMoveLabel, state.aiLastResult);
      render();
      maybeRunAiTurn();
    }
    return;
  }

  state.aiThinking = true;
  state.lastMoveLabel = "AI thinking";
  render();
  clearAiTimer();
  aiTimer = window.setTimeout(() => {
    const result = chooseAiMove(state.gameState, state.aiProfile);
    state.aiThinking = false;
    if (result.move) {
      playMove(result.move, "AI", result);
    } else {
      const passMove = { x: -1, y: -1, pass: true };
      state.gameState = rule.applyMove(state.gameState, passMove);
      state.aiLastResult = result;
      state.lastMoveLabel = "AI pass";
      pushHistory(state.gameState, state.lastMoveLabel, result);
      render();
      maybeRunAiTurn();
    }
  }, 25);
}

function clearAiTimer() {
  if (aiTimer !== 0) {
    window.clearTimeout(aiTimer);
    aiTimer = 0;
  }
}

function pushHistory(gameState: GameState, label: string, aiLastResult: SearchResult | null) {
  const entry = makeHistoryEntry(gameState, label, aiLastResult);
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(entry);
  state.historyIndex = state.history.length - 1;
}

function makeHistoryEntry(
  gameState: GameState,
  label: string,
  aiLastResult: SearchResult | null
): HistoryEntry {
  return {
    gameState: cloneGameState(gameState),
    label,
    aiLastResult,
  };
}

function cloneGameState(gameState: GameState): GameState {
  return {
    ...gameState,
    cells: new Int8Array(gameState.cells),
  };
}

function render() {
  const rule = RULES[state.settings.gameId];

  gameTitle.textContent = rule.config.label;
  statusText.textContent = rule.summarize(state.gameState);
  cursorText.textContent = `Cell ${state.boardCursor.x + 1}:${state.boardCursor.y + 1}`;
  locationText.textContent = buildLocationText();
  analysisText.textContent = buildAnalysisText();
  geoStatus.textContent = state.geoStatus;
  moveText.textContent = state.lastMoveLabel;
  desktopHint.textContent = isDesktopControls
    ? "Desktop: hold arrows to move, Enter to place."
    : "";

  gameSelect.value = state.settings.gameId;
  widthRange.value = String(state.settings.boardMetersWide);
  widthValue.textContent = `${state.settings.boardMetersWide} m`;
  alphaRange.value = String(Math.round(state.settings.mapAlpha * 100));
  alphaValue.textContent = `${Math.round(state.settings.mapAlpha * 100)}%`;
  mapButton.textContent = state.settings.mapEnabled ? "Map On" : "Map Off";
  layerButton.textContent = state.settings.mapForeground ? "Map Front" : "Map Back";

  moveButton.disabled =
    state.aiThinking ||
    state.gameState.winner !== null ||
    state.gameState.currentPlayer !== state.humanPlayer;
  undoButton.disabled = state.historyIndex === 0 || state.aiThinking;
  redoButton.disabled = state.historyIndex >= state.history.length - 1 || state.aiThinking;
  mapLayer.classList.toggle("hidden", !state.settings.mapEnabled);
  mapLayer.classList.toggle("foreground", state.settings.mapForeground);
  mapLayer.style.opacity = String(state.settings.mapForeground ? state.settings.mapAlpha : 1);
  boardEl.style.opacity = String(
    state.settings.mapEnabled && !state.settings.mapForeground ? state.settings.mapAlpha : 1
  );
  boardShell.style.aspectRatio = `${state.gameState.width} / ${state.gameState.height}`;
  boardEl.style.setProperty("--cols", String(state.gameState.width));
  boardEl.style.setProperty("--rows", String(state.gameState.height));

  renderMapLayer();
  renderPlayerMarker();
  renderBoard();
  persistSession();
}

function renderBoard() {
  const { width, height } = state.gameState;
  boardEl.innerHTML = "";

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = document.createElement("button");
      cell.className = "cell";

      const value = state.gameState.cells[y * width + x];
      const isCursor =
        state.settings.gameId === "connect-four"
          ? x === state.boardCursor.x
          : x === state.boardCursor.x && y === state.boardCursor.y;
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

      boardEl.appendChild(cell);
    }
  }
}

function renderMapLayer() {
  if (!state.settings.mapEnabled || !state.anchor) {
    mapLayer.innerHTML = "";
    return;
  }

  const geometry = getMapGeometry();
  const { zoom, boardPixelsWide, boardPixelsHigh, centerWorld } = geometry;
  const tileCenterX = Math.floor(centerWorld.x / 256);
  const tileCenterY = Math.floor(centerWorld.y / 256);
  const tilesX = Math.max(1, Math.ceil(boardPixelsWide / 256) + 1);
  const tilesY = Math.max(1, Math.ceil(boardPixelsHigh / 256) + 1);
  const tiles: string[] = [];

  for (let y = tileCenterY - tilesY; y <= tileCenterY + tilesY; y += 1) {
    for (let x = tileCenterX - tilesX; x <= tileCenterX + tilesX; x += 1) {
      const tileOriginX = x * 256;
      const tileOriginY = y * 256;
      const left = 50 + (((tileOriginX - centerWorld.x) / boardPixelsWide) * 100);
      const top = 50 + (((tileOriginY - centerWorld.y) / boardPixelsHigh) * 100);
      const width = (256 / boardPixelsWide) * 100;
      const height = (256 / boardPixelsHigh) * 100;
      const wrappedX = wrapTile(x, zoom);
      const wrappedY = clamp(y, 0, 2 ** zoom - 1);
      tiles.push(
        `<img alt="" src="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${wrappedY}.png" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%;">`
      );
    }
  }

  mapLayer.innerHTML = tiles.join("");
}

function renderPlayerMarker() {
  if (!state.anchor || !state.currentLocation) {
    playerMarker.style.left = `${state.playerMarker.x * 100}%`;
    playerMarker.style.top = `${state.playerMarker.y * 100}%`;
    return;
  }

  const geometry = getMapGeometry();
  const currentWorld = latLonToWorldPixels(
    state.currentLocation.lat,
    state.currentLocation.lon,
    geometry.zoom
  );
  const simulatedPixelsX = state.virtualOffsetEast / geometry.metersPerPixelAtZoom;
  const simulatedPixelsY = -state.virtualOffsetNorth / geometry.metersPerPixelAtZoom;
  const x = clamp(
    0.5 + (currentWorld.x - geometry.centerWorld.x + simulatedPixelsX) / geometry.boardPixelsWide,
    0,
    1
  );
  const y = clamp(
    0.5 + (currentWorld.y - geometry.centerWorld.y + simulatedPixelsY) / geometry.boardPixelsHigh,
    0,
    1
  );

  playerMarker.style.left = `${x * 100}%`;
  playerMarker.style.top = `${y * 100}%`;
}

function buildLocationText(): string {
  const center = centeredCursor(state.gameState);
  const cellMeters = state.settings.boardMetersWide / state.gameState.width;
  const dx = state.boardCursor.x - center.x;
  const dy = center.y - state.boardCursor.y;
  return `${formatMeters(dx * cellMeters)} E • ${formatMeters(dy * cellMeters)} N`;
}

function buildAnalysisText(): string {
  if (state.gameState.winner !== null) {
    return state.lastMoveLabel;
  }
  if (!state.aiLastResult) {
    return `AI ${state.aiProfile.budgetMs} ms`;
  }
  return `AI d${state.aiLastResult.depth} • ${Math.round(state.aiLastResult.elapsedMs)} ms`;
}

function invalidMoveMessage(): string {
  if (state.settings.gameId === "connect-four") {
    return "Column full";
  }
  if (state.settings.gameId === "othello") {
    return "Need a flipping square";
  }
  return "Cell occupied";
}

function formatMove(move: Move): string {
  if (move.pass) {
    return "pass";
  }
  if (state.settings.gameId === "connect-four") {
    return `column ${move.x + 1}`;
  }
  return `${move.x + 1}:${move.y + 1}`;
}

function centeredCursor(gameState: GameState) {
  return {
    x: Math.floor(gameState.width / 2),
    y: Math.floor(gameState.height / 2),
  };
}

function defaultBoardWidth(gameId: GameId): number {
  const rule = RULES[gameId];
  return rule.config.boardWidth * rule.config.metersPerCellDefault;
}

function loadSettings(): Settings {
  const fallback: Settings = {
    gameId: "tic-tac-toe",
    boardMetersWide: defaultBoardWidth("tic-tac-toe"),
    mapEnabled: true,
    mapAlpha: 0.5,
    mapForeground: true,
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
      boardMetersWide: clamp(Number(parsed.boardMetersWide ?? fallback.boardMetersWide), 30, 600),
      mapEnabled: parsed.mapEnabled !== false,
      mapAlpha: clamp(Number(parsed.mapAlpha ?? fallback.mapAlpha), 0, 1),
      mapForeground: parsed.mapForeground !== false,
    };
  } catch {
    return fallback;
  }
}

function persistSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function persistSession() {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      settings: state.settings,
      gameState: serializeGameState(state.gameState),
      anchor: state.anchor,
      virtualOffsetEast: state.virtualOffsetEast,
      virtualOffsetNorth: state.virtualOffsetNorth,
      boardCursor: state.boardCursor,
      playerMarker: state.playerMarker,
      lastMoveLabel: state.lastMoveLabel,
      aiLastResult: state.aiLastResult,
      historyIndex: state.historyIndex,
      history: state.history.map((entry) => ({
        gameState: serializeGameState(entry.gameState),
        label: entry.label,
        aiLastResult: entry.aiLastResult,
      })),
    })
  );
}

function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as {
      settings?: Settings;
      gameState?: SerializedGameState;
      anchor?: LatLon | null;
      virtualOffsetEast?: number;
      virtualOffsetNorth?: number;
      boardCursor?: { x: number; y: number };
      playerMarker?: { x: number; y: number };
      lastMoveLabel?: string;
      aiLastResult?: SearchResult | null;
      historyIndex?: number;
      history?: Array<{
        gameState: SerializedGameState;
        label: string;
        aiLastResult: SearchResult | null;
      }>;
    };
    if (parsed.settings && parsed.settings.gameId in RULES) {
      state.settings = {
        ...state.settings,
        ...parsed.settings,
      };
    }
    if (parsed.gameState) {
      state.gameState = deserializeGameState(parsed.gameState);
    }
    state.anchor = parsed.anchor ?? state.anchor;
    state.virtualOffsetEast = Number(parsed.virtualOffsetEast ?? state.virtualOffsetEast);
    state.virtualOffsetNorth = Number(parsed.virtualOffsetNorth ?? state.virtualOffsetNorth);
    state.boardCursor = parsed.boardCursor ?? centeredCursor(state.gameState);
    state.playerMarker = parsed.playerMarker ?? state.playerMarker;
    state.lastMoveLabel = parsed.lastMoveLabel ?? state.lastMoveLabel;
    state.aiLastResult = parsed.aiLastResult ?? state.aiLastResult;
    if (parsed.history?.length) {
      state.history = parsed.history.map((entry) => ({
        gameState: deserializeGameState(entry.gameState),
        label: entry.label,
        aiLastResult: entry.aiLastResult,
      }));
      state.historyIndex = clamp(
        Number(parsed.historyIndex ?? parsed.history.length - 1),
        0,
        parsed.history.length - 1
      );
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
}

function chooseMapZoom(boardMetersWide: number): number {
  if (boardMetersWide <= 80) {
    return 19;
  }
  if (boardMetersWide <= 160) {
    return 18;
  }
  if (boardMetersWide <= 320) {
    return 17;
  }
  if (boardMetersWide <= 640) {
    return 16;
  }
  return 15;
}

interface SerializedGameState {
  gameId: GameId;
  width: number;
  height: number;
  cells: number[];
  currentPlayer: Player;
  movesMade: number;
  winner: Player | 0 | null;
  consecutivePasses: number;
}

function serializeGameState(gameState: GameState): SerializedGameState {
  return {
    ...gameState,
    cells: Array.from(gameState.cells),
  };
}

function deserializeGameState(gameState: SerializedGameState): GameState {
  return {
    ...gameState,
    cells: new Int8Array(gameState.cells),
  };
}

function latLonToWorldPixels(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n * 256,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n *
      256,
  };
}

function getMapGeometry() {
  const boardMetersHigh =
    (state.settings.boardMetersWide * state.gameState.height) / state.gameState.width;
  const zoom = chooseMapZoom(Math.max(state.settings.boardMetersWide, boardMetersHigh));
  const metersPerPixelAtZoom = metersPerPixel(state.anchor!.lat, zoom);
  const boardPixelsWide = state.settings.boardMetersWide / metersPerPixelAtZoom;
  const boardPixelsHigh = boardMetersHigh / metersPerPixelAtZoom;
  const centerWorld = latLonToWorldPixels(state.anchor!.lat, state.anchor!.lon, zoom);
  return {
    zoom,
    metersPerPixelAtZoom,
    boardPixelsWide,
    boardPixelsHigh,
    centerWorld,
  };
}

function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function wrapTile(value: number, zoom: number): number {
  const max = 2 ** zoom;
  return ((value % max) + max) % max;
}
