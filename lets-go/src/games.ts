export type Player = 1 | -1;
export type GameId = "tic-tac-toe" | "gomoku" | "connect-four" | "othello";

export interface Move {
  x: number;
  y: number;
  pass?: boolean;
}

export interface GameState {
  gameId: GameId;
  width: number;
  height: number;
  cells: Int8Array;
  currentPlayer: Player;
  movesMade: number;
  winner: Player | 0 | null;
  consecutivePasses: number;
}

export interface GameConfig {
  id: GameId;
  label: string;
  boardWidth: number;
  boardHeight: number;
  metersPerCellDefault: number;
}

export interface RuleSet {
  config: GameConfig;
  createInitialState: () => GameState;
  getLegalMoves: (state: GameState) => Move[];
  applyMove: (state: GameState, move: Move) => GameState;
  evaluate: (state: GameState, perspective: Player) => number;
  isTerminal: (state: GameState) => boolean;
  moveFromBoardCell: (state: GameState, x: number, y: number) => Move | null;
  summarize: (state: GameState) => string;
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function idx(width: number, x: number, y: number): number {
  return y * width + x;
}

function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    cells: new Int8Array(state.cells),
  };
}

function winnerForLine(
  cells: Int8Array,
  width: number,
  height: number,
  need: number
): Player | null {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const here = cells[idx(width, x, y)];
      if (here === 0) {
        continue;
      }
      for (const [dx, dy] of DIRECTIONS) {
        let count = 1;
        while (
          count < need &&
          inBounds(width, height, x + dx * count, y + dy * count) &&
          cells[idx(width, x + dx * count, y + dy * count)] === here
        ) {
          count += 1;
        }
        if (count >= need) {
          return here as Player;
        }
      }
    }
  }
  return null;
}

function lineScore(run: number, openEnds: number): number {
  if (run >= 5) {
    return 1000000;
  }
  if (run === 4 && openEnds === 2) {
    return 120000;
  }
  if (run === 4 && openEnds === 1) {
    return 12000;
  }
  if (run === 3 && openEnds === 2) {
    return 5000;
  }
  if (run === 3 && openEnds === 1) {
    return 700;
  }
  if (run === 2 && openEnds === 2) {
    return 200;
  }
  if (run === 2 && openEnds === 1) {
    return 35;
  }
  if (run === 1 && openEnds === 2) {
    return 5;
  }
  return 0;
}

function evaluateLines(
  state: GameState,
  perspective: Player,
  need: number
): number {
  if (state.winner === perspective) {
    return 10000000 - state.movesMade;
  }
  if (state.winner === -perspective) {
    return -10000000 + state.movesMade;
  }
  let total = 0;
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      for (const [dx, dy] of DIRECTIONS) {
        const prevX = x - dx;
        const prevY = y - dy;
        if (inBounds(state.width, state.height, prevX, prevY)) {
          continue;
        }
        let sequence: number[] = [];
        let cx = x;
        let cy = y;
        while (inBounds(state.width, state.height, cx, cy)) {
          sequence.push(state.cells[idx(state.width, cx, cy)]);
          cx += dx;
          cy += dy;
        }
        total += evaluateSequence(sequence, perspective, need);
      }
    }
  }
  return total;
}

function evaluateSequence(
  sequence: number[],
  perspective: Player,
  need: number
): number {
  let score = 0;
  for (const player of [perspective, -perspective] as Player[]) {
    const sign = player === perspective ? 1 : -1;
    let i = 0;
    while (i < sequence.length) {
      if (sequence[i] !== player) {
        i += 1;
        continue;
      }
      let run = 0;
      while (i + run < sequence.length && sequence[i + run] === player) {
        run += 1;
      }
      const leftOpen = i - 1 >= 0 && sequence[i - 1] === 0 ? 1 : 0;
      const rightOpen = i + run < sequence.length && sequence[i + run] === 0 ? 1 : 0;
      if (run >= need) {
        return sign * 1000000;
      }
      score += sign * lineScore(run, leftOpen + rightOpen);
      i += run;
    }
  }
  return score;
}

function makeEmptyState(config: GameConfig): GameState {
  return {
    gameId: config.id,
    width: config.boardWidth,
    height: config.boardHeight,
    cells: new Int8Array(config.boardWidth * config.boardHeight),
    currentPlayer: 1,
    movesMade: 0,
    winner: null,
    consecutivePasses: 0,
  };
}

function moveFromCellDirect(state: GameState, x: number, y: number): Move | null {
  if (!inBounds(state.width, state.height, x, y)) {
    return null;
  }
  if (state.cells[idx(state.width, x, y)] !== 0) {
    return null;
  }
  return { x, y };
}

const ticTacToeConfig: GameConfig = {
  id: "tic-tac-toe",
  label: "Tic-Tac-Toe",
  boardWidth: 3,
  boardHeight: 3,
  metersPerCellDefault: 18,
};

const gomokuConfig: GameConfig = {
  id: "gomoku",
  label: "Gomoku",
  boardWidth: 15,
  boardHeight: 15,
  metersPerCellDefault: 14,
};

const connectFourConfig: GameConfig = {
  id: "connect-four",
  label: "Connect Four",
  boardWidth: 7,
  boardHeight: 6,
  metersPerCellDefault: 16,
};

const othelloConfig: GameConfig = {
  id: "othello",
  label: "Othello",
  boardWidth: 8,
  boardHeight: 8,
  metersPerCellDefault: 18,
};

function legalMovesSimple(state: GameState): Move[] {
  const moves: Move[] = [];
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      if (state.cells[idx(state.width, x, y)] === 0) {
        moves.push({ x, y });
      }
    }
  }
  return moves;
}

function applyLineMove(state: GameState, move: Move, need: number): GameState {
  const next = cloneState(state);
  next.cells[idx(state.width, move.x, move.y)] = state.currentPlayer;
  next.currentPlayer = (state.currentPlayer * -1) as Player;
  next.movesMade += 1;
  next.consecutivePasses = 0;
  next.winner = winnerForLine(next.cells, next.width, next.height, need);
  if (next.winner === null && next.movesMade === next.cells.length) {
    next.winner = 0;
  }
  return next;
}

function summarizeSimple(state: GameState): string {
  if (state.winner === 1) {
    return "Black wins";
  }
  if (state.winner === -1) {
    return "White wins";
  }
  if (state.winner === 0) {
    return "Draw";
  }
  return state.currentPlayer === 1 ? "Black to move" : "White to move";
}

function getGomokuMoves(state: GameState): Move[] {
  if (state.movesMade === 0) {
    return [{ x: Math.floor(state.width / 2), y: Math.floor(state.height / 2) }];
  }
  const candidates = new Map<string, Move>();
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      if (state.cells[idx(state.width, x, y)] === 0) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state.width, state.height, nx, ny)) {
            continue;
          }
          if (state.cells[idx(state.width, nx, ny)] !== 0) {
            continue;
          }
          candidates.set(`${nx},${ny}`, { x: nx, y: ny });
        }
      }
    }
  }
  return [...candidates.values()];
}

function connectFourLegalMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  for (let x = 0; x < state.width; x += 1) {
    for (let y = state.height - 1; y >= 0; y -= 1) {
      if (state.cells[idx(state.width, x, y)] === 0) {
        moves.push({ x, y });
        break;
      }
    }
  }
  return moves;
}

function connectFourMoveFromCell(state: GameState, x: number): Move | null {
  if (x < 0 || x >= state.width) {
    return null;
  }
  for (let y = state.height - 1; y >= 0; y -= 1) {
    if (state.cells[idx(state.width, x, y)] === 0) {
      return { x, y };
    }
  }
  return null;
}

const OTHELLO_DIRS: Array<[number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function collectOthelloFlips(state: GameState, x: number, y: number): number[] {
  if (state.cells[idx(state.width, x, y)] !== 0) {
    return [];
  }
  const flips: number[] = [];
  for (const [dx, dy] of OTHELLO_DIRS) {
    const ray: number[] = [];
    let cx = x + dx;
    let cy = y + dy;
    while (inBounds(state.width, state.height, cx, cy)) {
      const value = state.cells[idx(state.width, cx, cy)];
      if (value === 0) {
        ray.length = 0;
        break;
      }
      if (value === state.currentPlayer) {
        break;
      }
      ray.push(idx(state.width, cx, cy));
      cx += dx;
      cy += dy;
    }
    if (
      ray.length > 0 &&
      inBounds(state.width, state.height, cx, cy) &&
      state.cells[idx(state.width, cx, cy)] === state.currentPlayer
    ) {
      flips.push(...ray);
    }
  }
  return flips;
}

function othelloMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      if (collectOthelloFlips(state, x, y).length > 0) {
        moves.push({ x, y });
      }
    }
  }
  if (moves.length === 0) {
    return [{ x: -1, y: -1, pass: true }];
  }
  return moves;
}

function applyOthelloMove(state: GameState, move: Move): GameState {
  const next = cloneState(state);
  if (move.pass) {
    next.currentPlayer = (state.currentPlayer * -1) as Player;
    next.consecutivePasses += 1;
    if (next.consecutivePasses >= 2) {
      let total = 0;
      for (const cell of next.cells) {
        total += cell;
      }
      next.winner = total === 0 ? 0 : (total > 0 ? 1 : -1);
    }
    return next;
  }
  const flips = collectOthelloFlips(state, move.x, move.y);
  next.cells[idx(state.width, move.x, move.y)] = state.currentPlayer;
  for (const target of flips) {
    next.cells[target] = state.currentPlayer;
  }
  next.currentPlayer = (state.currentPlayer * -1) as Player;
  next.movesMade += 1;
  next.consecutivePasses = 0;
  const full = next.cells.every((cell) => cell !== 0);
  if (full) {
    let total = 0;
    for (const cell of next.cells) {
      total += cell;
    }
    next.winner = total === 0 ? 0 : (total > 0 ? 1 : -1);
  }
  return next;
}

function othelloEvaluate(state: GameState, perspective: Player): number {
  if (state.winner === perspective) {
    return 10000000 - state.movesMade;
  }
  if (state.winner === -perspective) {
    return -10000000 + state.movesMade;
  }
  let score = 0;
  const corners = [
    idx(state.width, 0, 0),
    idx(state.width, state.width - 1, 0),
    idx(state.width, 0, state.height - 1),
    idx(state.width, state.width - 1, state.height - 1),
  ];
  for (let i = 0; i < state.cells.length; i += 1) {
    const value = state.cells[i];
    if (value === perspective) {
      score += 8;
    } else if (value === -perspective) {
      score -= 8;
    }
  }
  for (const corner of corners) {
    if (state.cells[corner] === perspective) {
      score += 140;
    } else if (state.cells[corner] === -perspective) {
      score -= 140;
    }
  }
  const mobility =
    othelloMoves({ ...state, currentPlayer: perspective }).filter((move) => !move.pass)
      .length -
    othelloMoves({ ...state, currentPlayer: -perspective }).filter((move) => !move.pass)
      .length;
  return score + mobility * 14;
}

function othelloSummary(state: GameState): string {
  let black = 0;
  let white = 0;
  for (const cell of state.cells) {
    if (cell === 1) {
      black += 1;
    } else if (cell === -1) {
      white += 1;
    }
  }
  if (state.winner === 1) {
    return `Black wins ${black}-${white}`;
  }
  if (state.winner === -1) {
    return `White wins ${white}-${black}`;
  }
  if (state.winner === 0) {
    return `Draw ${black}-${white}`;
  }
  return `${state.currentPlayer === 1 ? "Black" : "White"} to move • ${black}-${white}`;
}

export const RULES: Record<GameId, RuleSet> = {
  "tic-tac-toe": {
    config: ticTacToeConfig,
    createInitialState: () => makeEmptyState(ticTacToeConfig),
    getLegalMoves: legalMovesSimple,
    applyMove: (state, move) => applyLineMove(state, move, 3),
    evaluate: (state, perspective) => evaluateLines(state, perspective, 3),
    isTerminal: (state) => state.winner !== null,
    moveFromBoardCell: moveFromCellDirect,
    summarize: summarizeSimple,
  },
  gomoku: {
    config: gomokuConfig,
    createInitialState: () => makeEmptyState(gomokuConfig),
    getLegalMoves: getGomokuMoves,
    applyMove: (state, move) => applyLineMove(state, move, 5),
    evaluate: (state, perspective) => evaluateLines(state, perspective, 5),
    isTerminal: (state) => state.winner !== null,
    moveFromBoardCell: moveFromCellDirect,
    summarize: summarizeSimple,
  },
  "connect-four": {
    config: connectFourConfig,
    createInitialState: () => makeEmptyState(connectFourConfig),
    getLegalMoves: connectFourLegalMoves,
    applyMove: (state, move) => applyLineMove(state, move, 4),
    evaluate: (state, perspective) => evaluateLines(state, perspective, 4),
    isTerminal: (state) => state.winner !== null,
    moveFromBoardCell: (state, x) => connectFourMoveFromCell(state, x),
    summarize: summarizeSimple,
  },
  othello: {
    config: othelloConfig,
    createInitialState: () => {
      const state = makeEmptyState(othelloConfig);
      state.cells[idx(state.width, 3, 3)] = -1;
      state.cells[idx(state.width, 4, 4)] = -1;
      state.cells[idx(state.width, 3, 4)] = 1;
      state.cells[idx(state.width, 4, 3)] = 1;
      return state;
    },
    getLegalMoves: othelloMoves,
    applyMove: applyOthelloMove,
    evaluate: othelloEvaluate,
    isTerminal: (state) => state.winner !== null,
    moveFromBoardCell: (state, x, y) =>
      collectOthelloFlips(state, x, y).length > 0 ? { x, y } : null,
    summarize: othelloSummary,
  },
};

export function serializeState(state: GameState): string {
  return `${state.gameId}:${state.currentPlayer}:${state.winner}:${state.consecutivePasses}:${Array.from(
    state.cells
  ).join("")}`;
}
