#!/usr/bin/env node
/* Pegoban level checker. Runs the real engine, so what it proves is what the
 * page plays.
 *
 *   node tools/solve.js                    replay every level's stored solution
 *   node tools/solve.js 3 solve [w b p d]  beam-search level 3: windows >= w tenths of a degree,
 *                                          beam b, p states per crate layout, depth d
 *   node tools/solve.js 3 sweep [a b ...]  after shots a, b, ...: what every aim angle does
 *   node tools/solve.js 3 trace a [b ...]  ASCII picture of the last shot's flight
 *   node tools/solve.js 3 show [a b ...]   ASCII picture of the board after the shots
 *
 * Angles are tenths of a degree from straight down, positive to the right.
 */
'use strict';
const os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const E = require('../engine.js');
const LEVELS = require('../levels.js').slice();
// Try out a draft without touching levels.js: PEGOBAN_LEVEL=draft.js node tools/solve.js 10 solve
if (process.env.PEGOBAN_LEVEL) LEVELS.push(require(require('path').resolve(process.env.PEGOBAN_LEVEL)));
const { W, H, ANGLE_MAX } = E;

function play(def, shots) {
  const st = E.parseLevel(def);
  st.marbles = 99;
  for (const a of shots) E.simulate(st, a);
  return st;
}

// ── Describing outcomes ─────────────────────────────────────────────────────
function describe(before, after) {
  const bits = [];
  after.crates.forEach((c, k) => {
    const o = before.crates[k];
    if (o.x !== c.x || o.y !== c.y) bits.push('#' + k + ' ' + o.x + ',' + o.y + '>' + c.x + ',' + c.y + (c.locked ? ' LOCK' : ''));
  });
  let gone = 0, golds = 0;
  for (let p = 0; p < before.S.nPegs; p++) if (before.pegAlive[p] && !after.pegAlive[p]) { gone++; if (before.S.pegKind[p] === E.P_GOLD) golds++; }
  if (gone) bits.push('-' + gone + ' pegs' + (golds ? ' (' + golds + ' gold)' : ''));
  if (after.charges.heavy + after.charges.ghost + after.charges.split > before.charges.heavy + before.charges.ghost + before.charges.split) bits.push('+power');
  if (after.won) bits.push('WIN');
  return bits.join('; ') || '-';
}

function crateKey(st) {
  return st.crates.map(c => c.x + ',' + c.y + (c.locked ? '*' : '')).join(' ');
}

// Every aim angle from state st, grouped into runs of identical outcome
// (the full state, or with cratesOnly just where the crates end up).
function sweep(st, opts) {
  opts = opts || {};
  const runs = [];
  let cur = null;
  for (let a = -ANGLE_MAX; a <= ANGLE_MAX; a++) {
    const c = E.cloneState(st);
    E.simulate(c, a, opts);
    const key = opts.cratesOnly ? crateKey(c) : E.stateKey(c);
    if (cur && cur.key === key) { cur.a1 = a; continue; }
    cur = { key, a0: a, a1: a, st: c };
    runs.push(cur);
  }
  for (const r of runs) {
    r.width = r.a1 - r.a0 + 1;
    r.mid = Math.round((r.a0 + r.a1) / 2);
    // Keep the state the run's middle angle produces (all share a key, the middle is the one we'd advise).
    const c = E.cloneState(st);
    E.simulate(c, r.mid, opts);
    r.st = c;
  }
  return runs;
}

// ── Search ──────────────────────────────────────────────────────────────────
function openPads(st) {
  return st.S.pads.filter(i => { const ci = st.crateAt[i]; return ci < 0 || !st.crates[ci].locked; });
}
function heuristic(st) {
  const open = openPads(st);
  const d = [];
  for (const c of st.crates) {
    if (c.locked) continue;
    let best = 99;
    for (const i of open) best = Math.min(best, Math.abs(i % W - c.x) + Math.abs(Math.floor(i / W) - c.y));
    d.push(best);
  }
  d.sort((a, b) => a - b);
  let sum = 0;
  for (let k = 0; k < open.length && k < d.length; k++) sum += d[k];
  return open.length * 3 + sum;
}

// States travel between threads as plain data.
function pack(st) {
  return { c: st.crates.map(c => [c.x, c.y, c.locked]), p: Array.from(st.pegAlive), ch: [st.charges.heavy, st.charges.ghost, st.charges.split] };
}
function unpack(def, d) {
  const st = E.parseLevel(def);
  st.marbles = 99;
  st.crateAt.fill(-1);
  d.c.forEach((v, k) => {
    const c = st.crates[k];
    c.x = c.px = v[0]; c.y = c.py = v[1]; c.locked = v[2];
    st.crateAt[v[1] * W + v[0]] = k;
  });
  st.pegAlive.set(d.p);
  st.charges.heavy = d.ch[0]; st.charges.ghost = d.ch[1]; st.charges.split = d.ch[2];
  const sw = st.S.switches;
  st.gatesOpen = sw.length && sw.every(i => st.crateAt[i] >= 0) ? 1 : 0;
  st.won = E.isWon(st);
  return st;
}

// Candidate shots from a state. A shot that moves crates is judged by how wide
// its window of aims gives the same crate outcome (which pegs it clips on the way
// doesn't matter to a player), and we aim at the middle of that window. A shot
// that only clears pegs is judged by its exact outcome, since which pegs go is
// the whole point of it.
function candidates(st) {
  const n = 2 * ANGLE_MAX + 1;
  const full = new Array(n), crate = new Array(n), states = new Array(n);
  const base = crateKey(st);
  for (let k = 0; k < n; k++) {
    const c = E.cloneState(st);
    E.simulate(c, k - ANGLE_MAX);
    full[k] = E.stateKey(c); crate[k] = crateKey(c); states[k] = c;
  }
  const out = [];
  const runs = (keyOf, from, to, fn) => {
    let a = from;
    while (a <= to) {
      let b = a;
      while (b + 1 <= to && keyOf[b + 1] === keyOf[a]) b++;
      fn(a, b);
      a = b + 1;
    }
  };
  runs(crate, 0, n - 1, (a, b) => {
    if (crate[a] !== base) {
      const mid = (a + b) >> 1;
      out.push({ angle: mid - ANGLE_MAX, width: b - a + 1, st: states[mid] });
    } else {
      runs(full, a, b, (a2, b2) => {
        const mid = (a2 + b2) >> 1;
        if (full[mid] !== E.stateKey(st)) out.push({ angle: mid - ANGLE_MAX, width: b2 - a2 + 1, st: states[mid], pegsOnly: true });
      });
    }
  });
  return out;
}

function expandNode(li, d) {
  const def = LEVELS[li], st = unpack(def, d);
  return candidates(st).map(r => ({
    key: E.stateKey(r.st), mid: r.angle, width: r.width, what: describe(st, r.st), d: pack(r.st),
    won: r.st.won, hopeless: !r.st.won && E.hopeless(r.st), h: heuristic(r.st), ck: crateKey(r.st),
  }));
}

function workerMain() {
  parentPort.on('message', msg => {
    parentPort.postMessage({ id: msg.id, out: msg.jobs.map(j => ({ node: j.node, runs: expandNode(msg.li, j.d) })) });
  });
}

// Beam search over whole shots, fanned out over worker threads. A beam slot
// per crate layout stops one layout's peg variations crowding out the rest.
async function solve(li, opts) {
  const def = LEVELS[li];
  const minWidth = opts.minWidth || 4, beam = opts.beam || 80, perLayout = opts.perLayout || 3;
  const nWorkers = Math.max(1, Math.min(os.cpus().length, 8));
  const workers = Array.from({ length: nWorkers }, () => new Worker(__filename));
  let msgId = 0;
  const call = (w, jobs) => new Promise(res => {
    const id = ++msgId;
    const on = m => { if (m.id === id) { w.off('message', on); res(m.out); } };
    w.on('message', on);
    w.postMessage({ id, li, jobs });
  });
  const root = E.parseLevel(def);
  const seen = new Set([E.stateKey(root)]);
  let frontier = [{ d: pack(root), path: [], h: heuristic(root), rob: 0 }];
  const maxDepth = opts.depth || def.marbles || 10;
  let found = null;
  try {
    for (let depth = 1; depth <= maxDepth && !found; depth++) {
      const chunks = workers.map(() => []);
      frontier.forEach((n, i) => chunks[i % nWorkers].push({ node: i, d: n.d }));
      const results = (await Promise.all(workers.map((w, k) => chunks[k].length ? call(w, chunks[k]) : []))).flat();
      results.sort((a, b) => a.node - b.node);
      const next = [];
      for (const { node, runs } of results) {
        const parent = frontier[node];
        for (const r of runs) {
          if (r.width < minWidth || seen.has(r.key)) continue;
          seen.add(r.key);
          const path = parent.path.concat([{ angle: r.mid, width: r.width, what: r.what }]);
          if (r.won) { if (!found || path.length < found.length) found = path; continue; }
          if (r.hopeless) continue;
          next.push({ d: r.d, path, h: r.h, rob: parent.rob + Math.log(r.width), ck: r.ck });
        }
      }
      if (found) break;
      next.sort((a, b) => a.h - b.h || b.rob - a.rob);
      const per = new Map();
      frontier = [];
      for (const n of next) {
        const c = per.get(n.ck) || 0;
        if (c >= perLayout) continue;
        per.set(n.ck, c + 1);
        frontier.push(n);
        if (frontier.length >= beam) break;
      }
      if (opts.verbose) console.log('depth ' + depth + ': ' + next.length + ' new states in ' + per.size + ' layouts, best h ' + (frontier[0] ? frontier[0].h : '-'));
      if (!frontier.length) break;
    }
  } finally {
    for (const w of workers) w.terminate();
  }
  return found;
}

// ── Pictures ────────────────────────────────────────────────────────────────
const SX = 4, SY = 2;
function canvas(st) {
  const rows = [];
  for (let y = 0; y < (H + 1) * SY; y++) rows.push(new Array(W * SX).fill(' '));
  const S = st.S;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let ch = null;
    const s = S.solid[i], f = S.floor[i];
    if (s === E.S_WALL) ch = '#';
    else if (s === E.S_GATE) ch = st.gatesOpen ? ':' : 'G';
    else if (s >= E.S_BR && s <= E.S_TR) ch = '◢◣◤◥'[s - 2];
    else if (f === E.F_PAD) ch = 'p';
    else if (f === E.F_ICE) ch = '~';
    else if (f === E.F_SWITCH) ch = 's';
    else if (f === E.F_PORTAL) ch = '@';
    const ci = st.crateAt[i];
    for (let dy = 0; dy < SY; dy++) for (let dx = 0; dx < SX; dx++) {
      let c = ch || (dx === 0 && dy === 0 ? '.' : ' ');
      if (ci >= 0) c = dx === 0 ? '[' : dx === SX - 1 ? ']' : (st.crates[ci].heavy ? 'H' : st.crates[ci].locked ? '*' : 'C');
      rows[y * SY + dy][x * SX + dx] = c;
    }
  }
  for (let p = 0; p < S.nPegs; p++) {
    if (!st.pegAlive[p]) continue;
    const cx = Math.floor(S.pegX[p] * SX), cy = Math.floor(S.pegY[p] * SY);
    if (cy >= 0 && cy < rows.length && cx >= 0 && cx < W * SX) rows[cy][cx] = 'ob+xB'[S.pegKind[p]].replace('b', 'O');
  }
  return rows;
}
function print(rows) {
  console.log('+' + '-'.repeat(W * SX) + '+');
  for (const r of rows) console.log('|' + r.join('') + '|');
  console.log('+' + '-'.repeat(W * SX) + '+');
}
function trace(st, angle) {
  const rows = canvas(st);
  const s = E.cloneState(st);
  const sim = E.fire(s, angle, {});
  let n = 0;
  while (!sim.done && n < 240 * 30) {
    E.step(s, sim); n++;
    const b = sim.balls[0];
    if (!b.alive) continue;
    const cx = Math.floor(b.x * SX), cy = Math.floor(b.y * SY);
    if (cy >= 0 && cy < rows.length && cx >= 0 && cx < W * SX && rows[cy][cx] === ' ') rows[cy][cx] = '·';
  }
  print(rows);
  console.log(sim.events.filter(e => e.type !== 'wall').map(e => e.type + (e.type === 'push' ? '#' + e.a + '(' + e.b + ',' + e.c + ')' : '')).join(' '));
  E.finishShot(s, sim);
  console.log('after:', describe(st, s));
}

// ── Main ────────────────────────────────────────────────────────────────────
function verifyAll() {
  let ok = true;
  LEVELS.forEach((def, n) => {
    const st = E.parseLevel(def);
    const sol = def.solution || [];
    let fail = '';
    for (const a of sol) {
      if (st.marbles <= 0) { fail = 'ran out of marbles'; break; }
      E.simulate(st, a);
    }
    if (!fail && !st.won) fail = 'not won after ' + sol.length + ' shots';
    // Robustness: aims 0.2° either side must move the crates the same way (and a
    // shot that only clears pegs must clear the same pegs).
    const narrow = [];
    if (!fail) {
      const s = E.parseLevel(def);
      sol.forEach((a, k) => {
        const before = crateKey(s);
        const outs = [-2, -1, 0, 1, 2].map(d => { const c = E.cloneState(s); E.simulate(c, a + d); return c; });
        const key = outs[2] && crateKey(outs[2]) === before ? E.stateKey : crateKey;
        if (outs.some(o => key(o) !== key(outs[2]))) narrow.push(k + 1);
        E.simulate(s, a);
      });
    }
    const par = def.par, used = sol.length;
    console.log((fail ? 'FAIL ' : 'ok   ') + (n + 1) + ' ' + def.name.padEnd(16) + ' hint route ' + used + ' shots, ' + def.marbles +
      ' marbles, par ' + par + (narrow.length ? '  narrow steps: ' + narrow.join(',') : '') + (fail ? '  ' + fail : ''));
    if (fail) ok = false;
  });
  process.exitCode = ok ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) verifyAll();
  else {
    const def = LEVELS[+args[0] - 1];
    if (!def) throw new Error('no level ' + args[0]);
    const cmd = args[1] || 'show';
    const nums = args.slice(2).map(Number);
    if (cmd === 'solve') {
      const t0 = Date.now();
      solve(+args[0] - 1, { minWidth: nums[0] || 4, beam: nums[1] || 80, perLayout: nums[2] || 3, depth: nums[3], verbose: true }).then(path => {
        console.log(path ? 'SOLVED in ' + path.length + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)' : 'no solution found');
        if (path) path.forEach((p, k) => console.log('  ' + (k + 1) + '. ' + String(p.angle).padStart(5) + '  w' + String(p.width).padStart(3) + '  ' + p.what));
        if (path) console.log('solution: [' + path.map(p => p.angle).join(', ') + ']');
      });
    } else if (cmd === 'sweep' || cmd === 'fullsweep') {
      const st = play(def, nums);
      print(canvas(st));
      const base = crateKey(st);
      for (const r of sweep(st, { cratesOnly: cmd === 'sweep' })) {
        if (cmd === 'sweep' && r.key === base) continue;
        const what = describe(st, r.st).replace(/; -\d+ pegs( \(\d+ gold\))?/, '');
        if (what === '-') continue;
        console.log(String(r.a0).padStart(5) + '..' + String(r.a1).padEnd(5) + ' w' + String(r.width).padStart(3) + '  ' + what);
      }
    } else if (cmd === 'trace') {
      const st = play(def, nums.slice(0, -1));
      trace(st, nums[nums.length - 1]);
    } else {
      const st = play(def, nums);
      print(canvas(st));
      console.log('dead crates:', E.deadCrates(st), 'hopeless:', E.hopeless(st), 'won:', st.won);
    }
  }
}

if (!isMainThread) workerMain();
else if (require.main === module) main();
module.exports = { solve, sweep, describe };
