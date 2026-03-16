import { GameId, GameState, Move, Player, RULES, RuleSet, serializeState } from "./games";

export interface SearchProfile {
  benchmarkOps: number;
  budgetMs: number;
  maxNodes: number;
  gomokuMoveCap: number;
}

export interface SearchResult {
  move: Move | null;
  score: number;
  depth: number;
  nodes: number;
  elapsedMs: number;
  timedOut: boolean;
}

interface SearchContext {
  startedAt: number;
  deadline: number;
  nodeCount: number;
  maxNodes: number;
  cache: Map<string, { depth: number; score: number }>;
  timedOut: boolean;
  profile: SearchProfile;
}

const WIN_SCORE = 100000000;

export function measureDeviceProfile(): SearchProfile {
  const started = performance.now();
  let ops = 0;
  let value = 0;
  while (performance.now() - started < 120) {
    value += Math.sqrt((ops % 97) + 1);
    ops += 1;
  }
  const benchmarkOps = Math.max(ops / Math.max(1, performance.now() - started), 1);
  const speed = Math.max(0.55, Math.min(benchmarkOps / 350, 2.4));
  return {
    benchmarkOps,
    budgetMs: Math.round(Math.min(2000, Math.max(900, 1100 + speed * 450))),
    maxNodes: Math.round(Math.min(220000, Math.max(15000, 30000 * speed * speed))),
    gomokuMoveCap: Math.round(Math.min(18, Math.max(8, 8 + speed * 4))),
  };
}

export function chooseAiMove(
  state: GameState,
  profile: SearchProfile
): SearchResult {
  const rule = RULES[state.gameId];
  const startedAt = performance.now();
  const forcedMove = findForcedMove(rule, state, profile);
  if (forcedMove) {
    return {
      move: forcedMove,
      score: WIN_SCORE,
      depth: 1,
      nodes: 0,
      elapsedMs: performance.now() - startedAt,
      timedOut: false,
    };
  }
  const ctx: SearchContext = {
    startedAt,
    deadline: startedAt + profile.budgetMs,
    nodeCount: 0,
    maxNodes: profile.maxNodes,
    cache: new Map(),
    timedOut: false,
    profile,
  };

  let bestMove: Move | null = null;
  let bestScore = -WIN_SCORE;
  let completedDepth = 0;

  for (let depth = 1; depth <= maxDepthForGame(state.gameId); depth += 1) {
    const orderedMoves = orderMoves(rule, state, rule.getLegalMoves(state), profile);
    if (orderedMoves.length === 0) {
      bestMove = null;
      bestScore = rule.evaluate(state, state.currentPlayer);
      completedDepth = depth;
      break;
    }
    let depthBestMove: Move | null = null;
    let depthBestScore = -WIN_SCORE;
    let alpha = -WIN_SCORE;
    const beta = WIN_SCORE;

    for (const move of orderedMoves) {
      if (shouldStop(ctx)) {
        break;
      }
      const next = rule.applyMove(state, move);
      const score = -negamax(rule, next, depth - 1, -beta, -alpha, ctx);
      if (ctx.timedOut) {
        break;
      }
      if (score > depthBestScore) {
        depthBestScore = score;
        depthBestMove = move;
      }
      if (score > alpha) {
        alpha = score;
      }
    }

    if (!ctx.timedOut && depthBestMove) {
      bestMove = depthBestMove;
      bestScore = depthBestScore;
      completedDepth = depth;
      if (Math.abs(bestScore) > WIN_SCORE / 2) {
        break;
      }
    } else {
      break;
    }
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: completedDepth,
    nodes: ctx.nodeCount,
    elapsedMs: performance.now() - startedAt,
    timedOut: ctx.timedOut,
  };
}

function findForcedMove(rule: RuleSet, state: GameState, profile: SearchProfile): Move | null {
  const orderedMoves = orderMoves(rule, state, rule.getLegalMoves(state), profile);

  for (const move of orderedMoves) {
    const next = rule.applyMove(state, move);
    if (next.winner === state.currentPlayer) {
      return move;
    }
  }

  let bestBlock: { move: Move; remainingThreats: number; score: number } | null = null;
  const baselineThreats = immediateWinningMoves(rule, state, profile, state.currentPlayer * -1 as Player);
  if (baselineThreats.length === 0) {
    return null;
  }

  for (const move of orderedMoves) {
    const next = rule.applyMove(state, move);
    const remainingThreats = immediateWinningMoves(
      rule,
      next,
      profile,
      next.currentPlayer
    ).length;
    const score = rule.evaluate(next, state.currentPlayer);
    if (
      !bestBlock ||
      remainingThreats < bestBlock.remainingThreats ||
      (remainingThreats === bestBlock.remainingThreats && score > bestBlock.score)
    ) {
      bestBlock = { move, remainingThreats, score };
    }
    if (remainingThreats === 0) {
      return move;
    }
  }

  return bestBlock?.move ?? null;
}

function immediateWinningMoves(
  rule: RuleSet,
  state: GameState,
  profile: SearchProfile,
  player: Player
): Move[] {
  const probeState =
    state.currentPlayer === player ? state : { ...state, currentPlayer: player };
  const moves = orderMoves(rule, probeState, rule.getLegalMoves(probeState), profile);
  const wins: Move[] = [];
  for (const move of moves) {
    const next = rule.applyMove(probeState, move);
    if (next.winner === player) {
      wins.push(move);
    }
  }
  return wins;
}

function negamax(
  rule: RuleSet,
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchContext
): number {
  if (shouldStop(ctx)) {
    return 0;
  }
  ctx.nodeCount += 1;
  const cacheKey = `${depth}:${serializeState(state)}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached && cached.depth >= depth) {
    return cached.score;
  }
  if (depth === 0 || rule.isTerminal(state)) {
    const score = quiescence(rule, state, alpha, beta, ctx, 0);
    ctx.cache.set(cacheKey, { depth, score });
    return score;
  }

  let best = -WIN_SCORE;
  const moves = orderMoves(rule, state, rule.getLegalMoves(state), ctx.profile);
  if (moves.length === 0) {
    return rule.evaluate(state, state.currentPlayer);
  }

  for (const move of moves) {
    const next = rule.applyMove(state, move);
    const score = -negamax(rule, next, depth - 1, -beta, -alpha, ctx);
    if (ctx.timedOut) {
      return 0;
    }
    if (score > best) {
      best = score;
    }
    if (score > alpha) {
      alpha = score;
    }
    if (alpha >= beta) {
      break;
    }
  }

  ctx.cache.set(cacheKey, { depth, score: best });
  return best;
}

function quiescence(
  rule: RuleSet,
  state: GameState,
  alpha: number,
  beta: number,
  ctx: SearchContext,
  ply: number
): number {
  const standPat = rule.evaluate(state, state.currentPlayer);
  if (ply >= 2 || state.gameId === "tic-tac-toe") {
    return standPat;
  }
  if (standPat >= beta) {
    return beta;
  }
  if (standPat > alpha) {
    alpha = standPat;
  }
  const tacticalMoves = orderMoves(rule, state, rule.getLegalMoves(state), ctx.profile).filter(
    (move) => isTacticalMove(rule, state, move)
  );
  for (const move of tacticalMoves) {
    if (shouldStop(ctx)) {
      break;
    }
    const next = rule.applyMove(state, move);
    const score = -quiescence(rule, next, -beta, -alpha, ctx, ply + 1);
    if (score >= beta) {
      return beta;
    }
    if (score > alpha) {
      alpha = score;
    }
  }
  return alpha;
}

function shouldStop(ctx: SearchContext): boolean {
  if (ctx.timedOut) {
    return true;
  }
  const now = performance.now();
  if (now >= ctx.deadline || ctx.nodeCount >= ctx.maxNodes) {
    ctx.timedOut = true;
    return true;
  }
  return false;
}

function maxDepthForGame(gameId: GameId): number {
  switch (gameId) {
    case "tic-tac-toe":
      return 9;
    case "connect-four":
      return 11;
    case "othello":
      return 7;
    case "gomoku":
      return 5;
  }
}

function orderMoves(
  rule: RuleSet,
  state: GameState,
  moves: Move[],
  profile: SearchProfile
): Move[] {
  const ranked = moves.map((move) => {
    const next = rule.applyMove(state, move);
    let score = rule.evaluate(next, state.currentPlayer);
    if (state.gameId === "connect-four") {
      const center = Math.abs(move.x - (state.width - 1) / 2);
      score -= center * 6;
    }
    if (state.gameId === "gomoku") {
      const cx = Math.abs(move.x - (state.width - 1) / 2);
      const cy = Math.abs(move.y - (state.height - 1) / 2);
      score -= (cx + cy) * 4;
    }
    return { move, score };
  });
  ranked.sort((a, b) => b.score - a.score);
  if (state.gameId === "gomoku") {
    return ranked.slice(0, profile.gomokuMoveCap).map((entry) => entry.move);
  }
  return ranked.map((entry) => entry.move);
}

function isTacticalMove(rule: RuleSet, state: GameState, move: Move): boolean {
  if (move.pass) {
    return false;
  }
  const next = rule.applyMove(state, move);
  if (next.winner !== null) {
    return true;
  }
  return Math.abs(rule.evaluate(next, state.currentPlayer) - rule.evaluate(state, state.currentPlayer)) > 120;
}
