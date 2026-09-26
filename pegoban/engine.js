/* Pegoban engine: the rules and the physics, with no DOM.
 *
 * The page (game.js) draws this and tools/solve.js searches it for solutions,
 * so a shot the solver proves works is the same shot a player can take.
 * Everything is deterministic: a fixed 240 Hz step, no randomness, and aim
 * angles quantised to tenths of a degree.
 *
 * Units are grid cells. +x is right, +y is down the tilted warehouse floor
 * (the way marbles roll). Cell (x, y) spans [x, x+1] x [y, y+1].
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PegobanEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ── Tuning ──────────────────────────────────────────────────────────────────
const W = 9, H = 14;
const DT = 1 / 240;
const G = 13;                       // down-slope acceleration, cells/s²
const V0 = 9.5;                     // launch speed, cells/s
const BALL_R = 0.18, PEG_R = 0.16, BUMPER_R = 0.34;
const LAUNCH_X = 4.5, LAUNCH_Y = 0.42, MUZZLE = 0.52, LAUNCHER_R = 0.3;
const ANGLE_MAX = 850;              // aim limit either side of straight down, 0.1° units
const MAX_V = 24;
const PUSH_MIN = 3, PUSH_MIN_HEAVY = 7;   // impact speed that budges a crate
const E_WALL = 0.6, F_WALL = 0.95;
const E_CRATE = 0.5, E_PUSH = 0.15, F_CRATE = 0.9;
const E_PEG = 0.72, F_PEG = 0.97;
const BUMPER_KICK = 10, BUMPER_MAX_KICKS = 4;
const REST_V = 0.9, ROLL = 1.2;     // below REST_V an impact is a roll, not a bounce
const STUCK_V = 0.6, STUCK_T = 0.9, MAX_T = 15;
const PARK_R = 0.3, PARK_T = 1.5;   // a marble that loiters within PARK_R for PARK_T is done
const DULL_T = 2;                   // ...and so is one that touches nothing lively for DULL_T
const SLIDE_DT = 0.06;              // seconds per tile for a crate gliding on ice
const PORTAL_R = 0.3, PORTAL_CLEAR = 0.55;
const EXIT_Y = H + 0.35;
const FEVER = [500, 2000, 10000, 2000, 500];
const PTS = { peg: 10, gold: 100, green: 50, push: 25, lock: 300 };

// ── Tiles ───────────────────────────────────────────────────────────────────
const S_NONE = 0, S_WALL = 1, S_BR = 2, S_BL = 3, S_TL = 4, S_TR = 5, S_GATE = 6;
const F_NONE = 0, F_ICE = 1, F_PAD = 2, F_SWITCH = 3, F_PORTAL = 4;
const P_BLUE = 0, P_GOLD = 1, P_GREEN = 2, P_STEEL = 3, P_BUMPER = 4;
const K_NONE = 0, K_WALL = 1, K_RAMP = 2, K_CRATE = 3, K_PEG = 4, K_BUMPER = 5;
const FACE_NONE = 0, FACE_TOP = 1, FACE_BOTTOM = 2, FACE_LEFT = 3, FACE_RIGHT = 4;
// What happened when a marble met a crate.
const R_NONE = 0, R_PUSH = 1, R_BLOCKED = 2, R_WEAK = 3, R_SPENT = 4, R_LOCKED = 5, R_GLANCE = 6, R_BUSY = 7;

// Ramps are half-cell triangles. Vertices in cell-local coordinates.
//   ◢ solid bottom-right   ◣ solid bottom-left   ◤ solid top-left   ◥ solid top-right
const TRI = [null, null, [1, 0, 1, 1, 0, 1], [0, 0, 1, 1, 0, 1], [0, 0, 1, 0, 0, 1], [0, 0, 1, 0, 1, 1]];
// Which cell edges a ramp covers completely (1 top, 2 right, 4 bottom, 8 left).
const RAMP_EDGES = [0, 0, 6, 12, 9, 3];
const PEG_CHARS = { o: P_BLUE, O: P_GOLD, '+': P_GREEN, x: P_STEEL, B: P_BUMPER };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ── Level parsing ───────────────────────────────────────────────────────────
function circleRect(px, py, r, cx, cy) {
  const qx = px < cx ? cx : px > cx + 1 ? cx + 1 : px;
  const qy = py < cy ? cy : py > cy + 1 ? cy + 1 : py;
  const dx = px - qx, dy = py - qy;
  return dx * dx + dy * dy < r * r;
}

function parseLevel(def) {
  const name = def.name || '?';
  if (!def.map || def.map.length !== H) throw new Error(name + ': map needs ' + H + ' rows');
  const solid = new Uint8Array(W * H), floor = new Uint8Array(W * H);
  const portalAt = new Int8Array(W * H).fill(-1);
  const crateAt = new Int16Array(W * H).fill(-1);
  const crates = [], rawPegs = [], portals = [], pads = [], switches = [], gates = [];
  const digits = {};
  for (let y = 0; y < H; y++) {
    const row = def.map[y];
    if (row.length !== W) throw new Error(name + ': row ' + y + ' is ' + row.length + ' wide');
    for (let x = 0; x < W; x++) {
      const ch = row[x], i = y * W + x;
      switch (ch) {
        case '.': break;
        case '#': solid[i] = S_WALL; break;
        case '◢': solid[i] = S_BR; break;
        case '◣': solid[i] = S_BL; break;
        case '◤': solid[i] = S_TL; break;
        case '◥': solid[i] = S_TR; break;
        case 'G': solid[i] = S_GATE; gates.push(i); break;
        case 'P': floor[i] = F_PAD; pads.push(i); break;
        case '~': floor[i] = F_ICE; break;
        case 'S': floor[i] = F_SWITCH; switches.push(i); break;
        case 'C': case 'H': crates.push(newCrate(x, y, ch === 'H')); break;
        case '*': floor[i] = F_PAD; pads.push(i); crates.push(newCrate(x, y, false)); break;
        case 'c': case 'h': floor[i] = F_ICE; crates.push(newCrate(x, y, ch === 'h')); break;
        case 'o': case 'O': case '+': case 'x': case 'B': rawPegs.push([x + 0.5, y + 0.5, ch]); break;
        default:
          if (ch >= '1' && ch <= '9') {
            floor[i] = F_PORTAL;
            (digits[ch] = digits[ch] || []).push(i);
            break;
          }
          throw new Error(name + ': unknown tile "' + ch + '" at ' + x + ',' + y);
      }
    }
  }
  for (const d in digits) {
    const pair = digits[d];
    if (pair.length !== 2) throw new Error(name + ': portal ' + d + ' needs exactly two ends');
    const a = portals.length;
    for (const i of pair) {
      portalAt[i] = portals.length;
      portals.push({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, cell: i, pair: -1, tag: +d });
    }
    portals[a].pair = a + 1; portals[a + 1].pair = a;
  }
  for (const p of def.pegs || []) rawPegs.push(p);
  crates.forEach((c, k) => { crateAt[c.y * W + c.x] = k; });

  const n = rawPegs.length;
  const pegX = new Float64Array(n), pegY = new Float64Array(n), pegR = new Float64Array(n);
  const pegKind = new Uint8Array(n);
  const pegCells = [];
  for (let i = 0; i < W * H; i++) pegCells.push([]);
  const blockCell = new Uint8Array(W * H);
  let goldTotal = 0;
  rawPegs.forEach((p, k) => {
    const kind = PEG_CHARS[p[2]];
    if (kind === undefined) throw new Error(name + ': unknown peg "' + p[2] + '"');
    pegX[k] = p[0]; pegY[k] = p[1]; pegKind[k] = kind;
    pegR[k] = kind === P_BUMPER ? BUMPER_R : PEG_R;
    if (kind === P_GOLD) goldTotal++;
    const cx = Math.floor(p[0]), cy = Math.floor(p[1]);
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) throw new Error(name + ': peg off the board at ' + p);
    pegCells[cy * W + cx].push(k);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (!circleRect(p[0], p[1], pegR[k], x, y)) continue;
      const i = y * W + x;
      if (solid[i] || crateAt[i] >= 0 || floor[i] === F_PORTAL)
        throw new Error(name + ': peg at ' + p[0] + ',' + p[1] + ' overlaps tile ' + x + ',' + y);
      if (kind === P_STEEL || kind === P_BUMPER) blockCell[i] = 1;   // anchored: crates can't pass
    }
  });
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const dx = pegX[a] - pegX[b], dy = pegY[a] - pegY[b], rr = pegR[a] + pegR[b];
    if (dx * dx + dy * dy < rr * rr) throw new Error(name + ': pegs overlap at ' + pegX[a] + ',' + pegY[a]);
  }
  // The launcher's own cell never takes a crate.
  for (let x = 0; x < W; x++) if (circleRect(LAUNCH_X, LAUNCH_Y, LAUNCHER_R + 0.2, x, 0)) blockCell[x] = 1;
  for (let k = 0; k < crates.length; k++) {
    if (blockCell[crates[k].y * W + crates[k].x]) throw new Error(name + ': crate in a blocked cell');
  }
  if (!pads.length) throw new Error(name + ': no pads');
  if (crates.length < pads.length) throw new Error(name + ': fewer crates than pads');

  const S = {
    def, solid, floor, portalAt, portals, pads, switches, gates,
    nPegs: n, pegX, pegY, pegR, pegKind, pegCells, blockCell, goldTotal,
    power: def.power || 'heavy',
  };
  const st = {
    S, crateAt, crates,
    pegAlive: new Uint8Array(n).fill(1), pegLit: new Uint8Array(n), bumperKicks: new Uint8Array(n),
    gatesOpen: 0,
    marbles: def.marbles || 10, score: 0, golds: 0, shots: 0, won: false,
    charges: { heavy: 0, ghost: 0, split: 0 },
  };
  updateGates(st, null);
  // A crate that starts on a pad is already delivered.
  for (let k = 0; k < crates.length; k++) if (floor[crates[k].y * W + crates[k].x] === F_PAD) crates[k].locked = 1;
  return st;
}

function newCrate(x, y, heavy) {
  // px/py/mT are only for drawing the slide between tiles.
  return { x, y, heavy: heavy ? 1 : 0, locked: 0, pushed: 0, sdx: 0, sdy: 0, sT: 0, px: x, py: y, mT: 9 };
}

function cloneState(st) {
  const crates = new Array(st.crates.length);
  for (let k = 0; k < crates.length; k++) {
    const c = st.crates[k];
    crates[k] = { x: c.x, y: c.y, heavy: c.heavy, locked: c.locked, pushed: c.pushed, sdx: c.sdx, sdy: c.sdy,
                  sT: c.sT, px: c.px, py: c.py, mT: c.mT };
  }
  return {
    S: st.S, crateAt: st.crateAt.slice(), crates,
    pegAlive: st.pegAlive.slice(), pegLit: st.pegLit.slice(), bumperKicks: st.bumperKicks.slice(),
    gatesOpen: st.gatesOpen, marbles: st.marbles, score: st.score, golds: st.golds, shots: st.shots,
    won: st.won, charges: { heavy: st.charges.heavy, ghost: st.charges.ghost, split: st.charges.split },
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────
function fullSolid(st, cx, cy) {
  // Is this cell a full square as far as a marble is concerned?
  if (cx < 0 || cx >= W || cy < 0) return true;
  if (cy >= H) return false;
  const i = cy * W + cx, s = st.S.solid[i];
  if (s === S_WALL) return true;
  if (s === S_GATE) return !st.gatesOpen;
  return st.crateAt[i] >= 0;
}

function canEnter(st, sim, x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  const i = y * W + x, S = st.S;
  if (S.solid[i] !== S_NONE || st.crateAt[i] >= 0) return false;
  if (S.floor[i] === F_PORTAL || S.blockCell[i]) return false;
  if (sim) for (let k = 0; k < sim.balls.length; k++) {
    const b = sim.balls[k];
    if (b.alive && circleRect(b.x, b.y, b.r, x, y)) return false;
  }
  return true;
}

function isWon(st) {
  const pads = st.S.pads;
  for (let k = 0; k < pads.length; k++) {
    const ci = st.crateAt[pads[k]];
    if (ci < 0 || !st.crates[ci].locked) return false;
  }
  return true;
}

// Can a crate never again move out of (x, y)? Walls, ramps, gates, portals,
// anchored pegs and delivered crates are forever; loose crates are not.
function permBlocked(st, x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return true;
  const i = y * W + x, S = st.S;
  if (S.solid[i] !== S_NONE || S.floor[i] === F_PORTAL || S.blockCell[i]) return true;
  const ci = st.crateAt[i];
  return ci >= 0 && st.crates[ci].locked === 1;
}
// Can a marble never touch the crate face shared with neighbour (x, y)?
// edge is the neighbour's edge that faces the crate (1 top, 2 right, 4 bottom, 8 left).
function faceSealed(st, x, y, edge) {
  if (x < 0 || x >= W || y < 0) return true;
  if (y >= H) return false;
  const i = y * W + x, s = st.S.solid[i];
  if (s === S_WALL) return true;
  if (s >= S_BR && s <= S_TR) return (RAMP_EDGES[s] & edge) !== 0;
  const ci = st.crateAt[i];
  return ci >= 0 && st.crates[ci].locked === 1;
}
const EDGE_TOWARD = { '1,0': 2, '-1,0': 8, '0,1': 4, '0,-1': 1 };
// A crate is dead when no direction is left: the tile ahead is shut for good,
// or the face a marble would have to strike is walled in for good.
function crateDead(st, k) {
  const c = st.crates[k];
  if (c.locked) return false;
  for (let d = 0; d < 4; d++) {
    const dx = DIRS[d][0], dy = DIRS[d][1];
    if (permBlocked(st, c.x + dx, c.y + dy)) continue;
    // To push in +d the marble hits the face on the -d side; the neighbour there
    // faces the crate with its edge pointing +d.
    if (faceSealed(st, c.x - dx, c.y - dy, EDGE_TOWARD[dx + ',' + dy])) continue;
    return false;
  }
  return true;
}
function deadCrates(st) {
  const out = [];
  for (let k = 0; k < st.crates.length; k++) if (crateDead(st, k)) out.push(k);
  return out;
}
// Fewer live crates than open pads: no sequence of shots can win any more.
function hopeless(st) {
  let open = 0, live = 0;
  for (const i of st.S.pads) { const ci = st.crateAt[i]; if (ci < 0 || !st.crates[ci].locked) open++; }
  for (let k = 0; k < st.crates.length; k++) if (!st.crates[k].locked && !crateDead(st, k)) live++;
  return live < open;
}

function stateKey(st) {
  const parts = [];
  for (const c of st.crates) parts.push((c.heavy ? 'H' : 'C') + (c.y * W + c.x) + (c.locked ? '*' : ''));
  parts.sort();
  let pegs = '';
  const S = st.S;
  for (let p = 0; p < S.nPegs; p++) if (S.pegKind[p] <= P_GREEN) pegs += st.pegAlive[p] ? '1' : '0';
  return parts.join(',') + '|' + pegs + '|' + st.charges.heavy + st.charges.ghost + st.charges.split;
}

// ── Shots ───────────────────────────────────────────────────────────────────
// Math.sin/cos may differ in the last bit between browsers, and one bit is
// enough to fork a long bouncy shot. A plain Taylor series uses only + and *,
// which IEEE pins down exactly, so a shot flies identically everywhere (and a
// solution found in Node replays in Safari). |x| <= 1.49 here.
function dsin(x) {
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n <= 12; n++) { term *= -x2 / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
function dcos(x) {
  const x2 = x * x;
  let term = 1, sum = 1;
  for (let n = 1; n <= 12; n++) { term *= -x2 / ((2 * n - 1) * (2 * n)); sum += term; }
  return sum;
}
function aimDir(angle) {
  const r = angle * (Math.PI / 1800);
  return [dsin(r), dcos(r)];
}

function makeBall(sx, sy, power, id) {
  return {
    x: LAUNCH_X + sx * MUZZLE, y: LAUNCH_Y + sy * MUZZLE, vx: sx * V0, vy: sy * V0, r: BALL_R,
    alive: true, slowT: 0, portalLock: -1, id,
    ax: LAUNCH_X + sx * MUZZLE, ay: LAUNCH_Y + sy * MUZZLE, aT: 0, liveT: 0,
    heavy: power === 'heavy', ghost: power === 'ghost',
  };
}

// angle: tenths of a degree from straight down, positive to the right.
function fire(st, angle, opts) {
  opts = opts || {};
  angle = Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, Math.round(angle)));
  let power = opts.power || null;
  if (power && !(st.charges[power] > 0)) power = null;
  const sim = {
    balls: [], t: 0, events: [], quiet: !!opts.quiet, combo: 0, pushes: 0, locks: 0,
    won: false, done: false, bucket: opts.bucket || null, caught: 0, fever: -1,
    power, angle, onHit: null, bumps: 0, banks: 0, lit: [],
  };
  const dirs = power === 'split' ? [angle - 60, angle, angle + 60] : [angle];
  dirs.forEach((a, id) => {
    const d = aimDir(Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, a)));
    sim.balls.push(makeBall(d[0], d[1], power, id));
  });
  for (let k = 0; k < st.crates.length; k++) st.crates[k].pushed = 0;
  st.bumperKicks.fill(0);
  st.marbles--; st.shots++;
  if (power) st.charges[power]--;
  return sim;
}

function ev(sim, type, a, b, c, d, e) {
  if (!sim || sim.quiet) return;
  sim.events.push({ type, a, b, c, d, e });
}

function bucketX(bucket, t) {
  return W / 2 + (W / 2 - bucket.half - 0.12) * Math.sin(bucket.phase + bucket.speed * t);
}

function step(st, sim) {
  sim.t += DT;
  const crates = st.crates;
  for (let k = 0; k < crates.length; k++) {
    const c = crates[k];
    c.mT += DT;
    if (c.sdx || c.sdy) {
      c.sT -= DT;
      if (c.sT <= 0) {
        if (canEnter(st, sim, c.x + c.sdx, c.y + c.sdy)) moveCrate(st, sim, k, c.sdx, c.sdy);
        else { c.sdx = 0; c.sdy = 0; settle(st, sim, k); }
      }
    }
  }
  let alive = 0;
  const S = st.S;
  for (let k = 0; k < sim.balls.length; k++) {
    const b = sim.balls[k];
    if (!b.alive) continue;
    b.vy += G * DT;
    const sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 > MAX_V * MAX_V) { const f = MAX_V / Math.sqrt(sp2); b.vx *= f; b.vy *= f; }
    b.x += b.vx * DT; b.y += b.vy * DT;
    collideBall(st, sim, b);
    if (S.portals.length) portalCheck(st, sim, b);
    if (b.y > EXIT_Y) {
      b.alive = false;
      let caught = false;
      if (sim.won) {
        sim.fever = Math.max(0, Math.min(4, Math.floor(b.x / (W / 5))));
        st.score += FEVER[sim.fever];
        ev(sim, 'fever', sim.fever, FEVER[sim.fever], b.x);
      } else if (sim.bucket && Math.abs(b.x - bucketX(sim.bucket, sim.t)) < sim.bucket.half) {
        caught = true; sim.caught++;
      }
      ev(sim, 'exit', b.id, b.x, caught);
      continue;
    }
    const v2 = b.vx * b.vx + b.vy * b.vy;
    if (v2 < STUCK_V * STUCK_V) b.slowT += DT; else b.slowT = 0;
    // Jittering in a notch between pegs, or rocking in a half-pipe, never looks
    // "slow" to the speed test, so also retire marbles that go nowhere or do nothing.
    const adx = b.x - b.ax, ady = b.y - b.ay;
    if (adx * adx + ady * ady > PARK_R * PARK_R) { b.ax = b.x; b.ay = b.y; b.aT = sim.t; }
    if (b.slowT > STUCK_T || sim.t - b.aT > PARK_T || sim.t - b.liveT > DULL_T || sim.t > MAX_T) {
      b.alive = false;
      ev(sim, 'fizzle', b.id, b.x, b.y);
      continue;
    }
    alive++;
  }
  if (!alive) {
    let moving = false;
    for (let k = 0; k < crates.length; k++) if (crates[k].sdx || crates[k].sdy) moving = true;
    if (!moving) sim.done = true;
  }
}

// ── Collision ───────────────────────────────────────────────────────────────
// The deepest contact of this pass. Kept in module scope so the hot loop allocates nothing.
let cPen = 0, cNx = 0, cNy = 0, cKind = K_NONE, cRef = -1, cFace = FACE_NONE, cCent = 0;
function consider(pen, nx, ny, kind, ref, face, cent) {
  if (pen > cPen) { cPen = pen; cNx = nx; cNy = ny; cKind = kind; cRef = ref; cFace = face; cCent = cent; }
}

function boxContact(st, b, cx, cy, kind, ref) {
  const r = b.r, x = b.x, y = b.y;
  const qx = x < cx ? cx : x > cx + 1 ? cx + 1 : x;
  const qy = y < cy ? cy : y > cy + 1 ? cy + 1 : y;
  const dx = x - qx, dy = y - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  if (dx === 0 && dy === 0) {
    // Centre inside the box (a gate shut on the marble): leave by the nearest face.
    const l = x - cx, rt = cx + 1 - x, t = y - cy, bt = cy + 1 - y;
    const m = Math.min(l, rt, t, bt);
    if (m === t) consider(r + t, 0, -1, kind, ref, FACE_TOP, 1);
    else if (m === bt) consider(r + bt, 0, 1, kind, ref, FACE_BOTTOM, 1);
    else if (m === l) consider(r + l, -1, 0, kind, ref, FACE_LEFT, 1);
    else consider(r + rt, 1, 0, kind, ref, FACE_RIGHT, 1);
    return;
  }
  if (dx === 0) {
    if (dy < 0) consider(r + dy, 0, -1, kind, ref, FACE_TOP, 1);
    else consider(r - dy, 0, 1, kind, ref, FACE_BOTTOM, 1);
    return;
  }
  if (dy === 0) {
    if (dx < 0) consider(r + dx, -1, 0, kind, ref, FACE_LEFT, 1);
    else consider(r - dx, 1, 0, kind, ref, FACE_RIGHT, 1);
    return;
  }
  // Corner region. A corner is only round if it is really exposed; where a
  // neighbour continues the surface, treat it as flat so marbles roll across
  // seams between blocks instead of snagging on them.
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const nX = fullSolid(st, cx + sx, cy), nY = fullSolid(st, cx, cy + sy);
  if (nX && nY) return;
  if (nX) { consider(r - (dy < 0 ? -dy : dy), 0, sy, kind, ref, sy < 0 ? FACE_TOP : FACE_BOTTOM, 0); return; }
  if (nY) { consider(r - (dx < 0 ? -dx : dx), sx, 0, kind, ref, sx < 0 ? FACE_LEFT : FACE_RIGHT, 0); return; }
  const d = Math.sqrt(d2);
  consider(r - d, dx / d, dy / d, kind, ref, FACE_NONE, 0);
}

function triContact(b, cx, cy, s) {
  const v = TRI[s], r = b.r;
  const px = b.x - cx, py = b.y - cy;
  let best = 1e9, qx = 0, qy = 0, pos = 0, neg = 0;
  for (let k = 0; k < 3; k++) {
    const ax = v[2 * k], ay = v[2 * k + 1];
    const k2 = k === 2 ? 0 : k + 1;
    const ex = v[2 * k2] - ax, ey = v[2 * k2 + 1] - ay;
    const cr = ex * (py - ay) - ey * (px - ax);
    if (cr > 0) pos++; else if (cr < 0) neg++;
    let t = ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const hx = ax + ex * t, hy = ay + ey * t;
    const d2 = (px - hx) * (px - hx) + (py - hy) * (py - hy);
    if (d2 < best) { best = d2; qx = hx; qy = hy; }
  }
  const d = Math.sqrt(best);
  if (pos === 0 || neg === 0) {
    if (d < 1e-9) return;
    consider(r + d, (qx - px) / d, (qy - py) / d, K_RAMP, -1, FACE_NONE, 0);
  } else if (d < r) {
    consider(r - d, (px - qx) / d, (py - qy) / d, K_RAMP, -1, FACE_NONE, 0);
  }
}

function collideBall(st, sim, b) {
  const S = st.S;
  for (let iter = 0; iter < 5; iter++) {
    cPen = 1e-9; cKind = K_NONE;
    const r = b.r, x = b.x, y = b.y;
    if (x < r) consider(r - x, 1, 0, K_WALL, -1, FACE_NONE, 0);
    if (x > W - r) consider(x - (W - r), -1, 0, K_WALL, -1, FACE_NONE, 0);
    if (y < r) consider(r - y, 0, 1, K_WALL, -1, FACE_NONE, 0);
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.floor(y + r));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * W + cx, s = S.solid[i];
        if (s === S_WALL || (s === S_GATE && !st.gatesOpen)) boxContact(st, b, cx, cy, K_WALL, -1);
        else if (s >= S_BR && s <= S_TR) triContact(b, cx, cy, s);
        else if (st.crateAt[i] >= 0) boxContact(st, b, cx, cy, K_CRATE, st.crateAt[i]);
      }
    }
    if (S.nPegs) {
      const pcx = Math.floor(x), pcy = Math.floor(y);
      for (let cy = pcy - 1; cy <= pcy + 1; cy++) {
        if (cy < 0 || cy >= H) continue;
        for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
          if (cx < 0 || cx >= W) continue;
          const list = S.pegCells[cy * W + cx];
          for (let k = 0; k < list.length; k++) {
            const p = list[k];
            if (!st.pegAlive[p]) continue;
            const kind = S.pegKind[p];
            if (b.ghost && kind !== P_BUMPER) continue;
            const dx = x - S.pegX[p], dy = y - S.pegY[p], rr = r + S.pegR[p];
            const d2 = dx * dx + dy * dy;
            if (d2 < rr * rr && d2 > 1e-12) {
              const d = Math.sqrt(d2);
              consider(rr - d, dx / d, dy / d, kind === P_BUMPER ? K_BUMPER : K_PEG, p, FACE_NONE, 0);
            }
          }
        }
      }
    }
    {
      const dx = x - LAUNCH_X, dy = y - LAUNCH_Y, rr = r + LAUNCHER_R, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 1e-12) { const d = Math.sqrt(d2); consider(rr - d, dx / d, dy / d, K_WALL, -2, FACE_NONE, 0); }
    }
    if (cKind === K_NONE) return;
    resolve(st, sim, b);
  }
}

function bounce(b, nx, ny, imp, tx, ty, e, f) {
  if (imp < REST_V) {
    const k = 1 - ROLL * DT;   // rolling: drop the normal part, keep most of the glide
    b.vx = tx * k; b.vy = ty * k;
  } else {
    const o = imp * e;
    b.vx = tx * f + nx * o; b.vy = ty * f + ny * o;
  }
}

function resolve(st, sim, b) {
  const nx = cNx, ny = cNy, kind = cKind, ref = cRef, face = cFace, cent = cCent;
  b.x += nx * cPen; b.y += ny * cPen;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  const imp = -vn;
  const tx = b.vx - vn * nx, ty = b.vy - vn * ny;
  const hx = b.x - nx * b.r, hy = b.y - ny * b.r;   // the point of contact
  if (kind === K_WALL || kind === K_RAMP) {
    bounce(b, nx, ny, imp, tx, ty, E_WALL, F_WALL);
    if (imp > 2.5) { ev(sim, 'wall', hx, hy, imp); if (nx !== 0 && ny === 0) b.banked = true; }
    if (imp > 3) b.liveT = sim.t;
  } else if (kind === K_CRATE) {
    b.liveT = sim.t;
    let res = R_GLANCE;
    const dx = -nx, dy = -ny;
    if (face !== FACE_NONE && cent) res = tryPush(st, sim, b, ref, dx, dy, imp);
    else if (st.crates[ref].locked) res = R_LOCKED;
    bounce(b, nx, ny, imp, tx, ty, res === R_PUSH ? E_PUSH : E_CRATE, F_CRATE);
    if (imp > 1.2) {
      if (sim.onHit) sim.onHit(K_CRATE, ref, res, hx, hy, dx, dy, b.id);
      if (res !== R_PUSH) ev(sim, 'thud', ref, res, hx, hy, imp);
    }
  } else if (kind === K_PEG) {
    if (imp > 1) b.liveT = sim.t;
    bounce(b, nx, ny, imp, tx, ty, E_PEG, F_PEG);
    // A fresh peg lights on any touch; a lit or steel one only reacts to a real knock
    // (a marble resting against it would otherwise ping every step).
    if (!st.pegLit[ref] && st.S.pegKind[ref] !== P_STEEL) hitPeg(st, sim, ref, b, false);
    else if (imp > 1.5) hitPeg(st, sim, ref, b, false);
  } else if (kind === K_BUMPER) {
    let out;
    if (st.bumperKicks[ref] < BUMPER_MAX_KICKS) { st.bumperKicks[ref]++; out = Math.max(imp * 1.05, BUMPER_KICK); }
    else out = imp * 0.5;   // an overheated bumper stops a marble looping forever
    b.vx = tx + nx * out; b.vy = ty + ny * out;
    b.liveT = sim.t;
    sim.bumps++;
    if (out > 2) ev(sim, 'bump', ref, out);
  }
}

function tryPush(st, sim, b, ci, dx, dy, imp) {
  const c = st.crates[ci];
  if (c.locked) return R_LOCKED;
  if (c.sdx || c.sdy) return R_BUSY;
  if (c.pushed) return R_SPENT;
  if (!b.heavy && imp < (c.heavy ? PUSH_MIN_HEAVY : PUSH_MIN)) return R_WEAK;
  if (!canEnter(st, sim, c.x + dx, c.y + dy)) return R_BLOCKED;
  c.pushed = 1;
  sim.pushes++;
  if (b.banked) sim.banks++;   // a shove after bouncing off a side wall
  st.score += PTS.push;
  ev(sim, 'push', ci, dx, dy, imp, b.id);
  moveCrate(st, sim, ci, dx, dy);
  return R_PUSH;
}

function moveCrate(st, sim, ci, dx, dy) {
  const c = st.crates[ci], S = st.S;
  const from = c.y * W + c.x;
  const leftSwitch = S.floor[from] === F_SWITCH;
  st.crateAt[from] = -1;
  c.px = c.x; c.py = c.y; c.x += dx; c.y += dy; c.mT = 0;
  const to = c.y * W + c.x;
  st.crateAt[to] = ci;
  crushPegs(st, sim, ci);
  if (S.floor[to] === F_ICE && canEnter(st, sim, c.x + dx, c.y + dy)) {
    c.sdx = dx; c.sdy = dy; c.sT = SLIDE_DT;
    ev(sim, 'slide', ci);
  } else {
    c.sdx = 0; c.sdy = 0;
    settle(st, sim, ci);
  }
  if (leftSwitch) updateGates(st, sim);
}

function settle(st, sim, ci) {
  const c = st.crates[ci];
  const f = st.S.floor[c.y * W + c.x];
  if (f === F_PAD && !c.locked) {
    c.locked = 1;
    st.score += PTS.lock;
    if (sim) sim.locks++;
    ev(sim, 'lock', ci);
    if (isWon(st)) { st.won = true; if (sim) sim.won = true; ev(sim, 'win', ci); }
  }
  if (f === F_SWITCH) updateGates(st, sim);
}

function updateGates(st, sim) {
  const S = st.S;
  if (!S.switches.length) return;
  let open = 1;
  for (let k = 0; k < S.switches.length; k++) if (st.crateAt[S.switches[k]] < 0) { open = 0; break; }
  if (open !== st.gatesOpen) { st.gatesOpen = open; ev(sim, 'gate', open); }
}

function crushPegs(st, sim, ci) {
  const c = st.crates[ci], S = st.S;
  for (let y = c.y - 1; y <= c.y + 1; y++) for (let x = c.x - 1; x <= c.x + 1; x++) {
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const list = S.pegCells[y * W + x];
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      if (!st.pegAlive[p] || S.pegKind[p] > P_GREEN) continue;
      if (!circleRect(S.pegX[p], S.pegY[p], S.pegR[p], c.x, c.y)) continue;
      hitPeg(st, sim, p, null, true);
      st.pegAlive[p] = 0; st.pegLit[p] = 0;
      ev(sim, 'crush', p, ci);
    }
  }
}

function hitPeg(st, sim, p, b, crushed) {
  const kind = st.S.pegKind[p];
  if (kind === P_STEEL) { ev(sim, 'steel', p); return; }
  if (st.pegLit[p]) { ev(sim, 'reping', p); return; }
  st.pegLit[p] = 1;
  sim.combo++;
  if (!crushed) sim.lit.push(p);
  let pts = PTS.peg;
  if (kind === P_GOLD) { pts = PTS.gold; st.golds++; }
  else if (kind === P_GREEN) { pts = PTS.green; st.charges[st.S.power]++; ev(sim, 'power', st.S.power, p); }
  pts *= Math.min(sim.combo, 10);
  st.score += pts;
  if (sim.onHit && b) sim.onHit(K_PEG, p, R_NONE, st.S.pegX[p], st.S.pegY[p], 0, 0, b.id);
  ev(sim, 'peg', p, sim.combo, pts, crushed);
}

function portalCheck(st, sim, b) {
  const P = st.S.portals;
  for (let k = 0; k < P.length; k++) {
    const dx = b.x - P[k].x, dy = b.y - P[k].y, d2 = dx * dx + dy * dy;
    if (b.portalLock === k) {
      if (d2 > PORTAL_CLEAR * PORTAL_CLEAR) b.portalLock = -1;
      continue;
    }
    if (d2 < PORTAL_R * PORTAL_R) {
      const q = P[k].pair;
      b.x = P[q].x + dx; b.y = P[q].y + dy;
      b.portalLock = q;
      b.liveT = sim.t; b.ax = b.x; b.ay = b.y; b.aT = sim.t;
      ev(sim, 'portal', k, q, b.id);
      return;
    }
  }
}

// ── Whole-shot helpers ──────────────────────────────────────────────────────
// After the marble is gone: lit pegs vanish (in hit order for the pop cascade).
function finishShot(st, sim) {
  const popped = [];
  for (let p = 0; p < st.S.nPegs; p++) if (st.pegLit[p]) { popped.push(p); st.pegLit[p] = 0; st.pegAlive[p] = 0; }
  for (let k = 0; k < st.crates.length; k++) st.crates[k].pushed = 0;
  st.marbles += sim.caught;
  st.won = isWon(st);
  return { popped, caught: sim.caught, pushes: sim.pushes, locks: sim.locks, won: st.won };
}

function simulate(st, angle, opts) {
  const sim = fire(st, angle, Object.assign({ quiet: true }, opts));
  let n = 0;
  while (!sim.done && n < 240 * 30) { step(st, sim); n++; }
  return finishShot(st, sim);
}

// The aiming guide: fly a copy of the shot and stop after `contacts` things
// that change (breakable pegs, crate shoves, or a shove that fails). Walls,
// ramps, bumpers, steel pegs and delivered crates never change, so the guide
// flies straight past them.
function predict(st, angle, opts) {
  opts = opts || {};
  const limit = opts.contacts || 1;
  const t = cloneState(st);
  t.marbles = 99;
  const sim = fire(t, angle, { power: opts.power, quiet: true });
  const paths = sim.balls.map(b => [b.x, b.y]);
  const tails = sim.balls.map(() => -1);
  const counts = sim.balls.map(() => 0);
  const cuts = sim.balls.map(() => -1);
  const hits = [];
  sim.onHit = function (kind, ref, res, x, y, dx, dy, id) {
    if (tails[id] >= 0) return;
    // Glances, delivered crates and crates already shoved this shot change nothing: fly on past them.
    if (kind === K_CRATE && (res === R_GLANCE || res === R_LOCKED || res === R_SPENT || res === R_BUSY)) return;
    hits.push({ kind, ref, res, x, y, dx, dy, ball: id });
    if (++counts[id] >= limit) { tails[id] = 0; paths[id].push(x, y); cuts[id] = paths[id].length; }
  };
  const last = sim.balls.map(b => [b.x, b.y]);
  for (let n = 0; n < 240 * 7; n++) {
    step(t, sim);
    let any = false;
    for (let k = 0; k < sim.balls.length; k++) {
      const b = sim.balls[k];
      if (tails[k] === -2) continue;
      if (!b.alive) { paths[k].push(b.x, b.y); tails[k] = -2; continue; }
      if (tails[k] >= 0 && ++tails[k] > 26) { paths[k].push(b.x, b.y); tails[k] = -2; continue; }
      any = true;
      const dx = b.x - last[k][0], dy = b.y - last[k][1];
      if (dx * dx + dy * dy > 0.02) { paths[k].push(b.x, b.y); last[k][0] = b.x; last[k][1] = b.y; }
    }
    if (!any) break;
  }
  // Let shoved crates finish gliding (ice) so the guide can show where they really stop.
  for (let n = 0; n < 240 * 2; n++) {
    let moving = false;
    for (const c of t.crates) if (c.sdx || c.sdy) moving = true;
    if (!moving) break;
    step(t, sim);
  }
  for (const h of hits) if (h.kind === K_CRATE && h.res === R_PUSH) h.to = [t.crates[h.ref].x, t.crates[h.ref].y];
  return { paths, hits, cuts };
}

// Fly the live shot ahead on a copy: does it win within `seconds`? (for the
// slow-motion finish.) Returns the crate that will lock, or -1.
function winsSoon(st, sim, seconds) {
  const t = cloneState(st);
  const s = {
    balls: sim.balls.map(b => Object.assign({}, b)), t: sim.t, events: [], quiet: true, combo: sim.combo,
    pushes: 0, locks: 0, won: false, done: false, bucket: null, caught: 0, fever: -1, power: sim.power,
    angle: sim.angle, onHit: null, bumps: 0, banks: 0, lit: [],
  };
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n && !s.done; k++) {
    const before = t.crates.map(c => c.locked);
    step(t, s);
    if (s.won) {
      for (let c = 0; c < t.crates.length; c++) if (t.crates[c].locked && !before[c]) return c;
      return 0;
    }
  }
  return -1;
}

return {
  W, H, DT, G, V0, BALL_R, PEG_R, BUMPER_R, LAUNCH_X, LAUNCH_Y, MUZZLE, LAUNCHER_R, ANGLE_MAX,
  PUSH_MIN, PUSH_MIN_HEAVY, SLIDE_DT, EXIT_Y, FEVER, PORTAL_R,
  S_NONE, S_WALL, S_BR, S_BL, S_TL, S_TR, S_GATE, TRI,
  F_NONE, F_ICE, F_PAD, F_SWITCH, F_PORTAL,
  P_BLUE, P_GOLD, P_GREEN, P_STEEL, P_BUMPER,
  K_CRATE, K_PEG,
  R_NONE, R_PUSH, R_BLOCKED, R_WEAK, R_SPENT, R_LOCKED, R_GLANCE, R_BUSY,
  parseLevel, cloneState, fire, step, finishShot, simulate, predict, winsSoon,
  isWon, deadCrates, crateDead, hopeless, stateKey, bucketX, canEnter, aimDir,
};
}));
