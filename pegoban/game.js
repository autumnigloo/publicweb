/* Pegoban: drawing, sound, input and screens around engine.js.
 * The engine owns every rule; this file only watches it and makes it pretty. */
(() => {
'use strict';
const E = window.PegobanEngine, LEVELS = window.PegobanLevels;
const { W, H } = E;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);

// ═══ Save ════════════════════════════════════════════════════════════════════
const SAVE_KEY = 'pegoban-save-v1';
const save = (() => {
  const blank = { v: 1, unlocked: 1, best: {}, bolts: 0, up: { lens: 0, pouch: 0, catcher: 0, core: 0 }, sound: 1, story: 0, ending: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.v === 1) return Object.assign(blank, s, { up: Object.assign(blank.up, s.up || {}) });
  } catch (e) { /* private mode or corrupt: start fresh */ }
  return blank;
})();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage off */ } }

const UPGRADES = [
  { id: 'lens', icon: '🔭', name: 'Seer Lens', costs: [4, 7, 11],
    desc: t => t >= 3 ? 'The aim guide sees four hits ahead.' : 'The aim guide sees ' + (t + 2) + ' hits ahead instead of ' + (t + 1) + '.' },
  { id: 'pouch', icon: '👝', name: 'Marble Pouch', costs: [5, 9],
    desc: t => t >= 2 ? 'Two extra marbles every level.' : (t ? 'Another' : 'One') + ' extra marble every level.' },
  { id: 'catcher', icon: '🧺', name: 'Wide Catcher', costs: [3, 6],
    desc: t => t >= 2 ? 'The free-marble bucket is extra wide.' : 'A wider free-marble bucket at the bottom.' },
  { id: 'core', icon: '🔋', name: 'Power Core', costs: [8, 12],
    desc: t => t === 0 ? 'Start every level with a Heavy marble.' : t === 1 ? 'Also start every level with a Ghost marble.' : 'A Heavy and a Ghost marble every level.' },
];
const POWERS = {
  heavy: { name: 'Heavy', icon: '🔩', color: '#ffa23e', tip: 'Heavy marble: shoves any crate it touches, iron too, however soft the hit.' },
  ghost: { name: 'Ghost', icon: '👻', color: '#8af4ff', tip: 'Ghost marble: sails straight through pegs.' },
  split: { name: 'Split', icon: '✨', color: '#ff7ae0', tip: 'Split marble: three marbles in a fan.' },
};
const CAST = {
  soko: ['🤖', 'Soko'], granny: ['👵', 'Granny Pachi'], tanuki: ['🦝', 'The Tanuki'], inspector: ['🧐', 'The Inspector'],
};

// ═══ Sound ═══════════════════════════════════════════════════════════════════
// Everything is synthesised, so the game is one folder with no audio files.
const Sound = (() => {
  let ac = null, out = null, on = save.sound !== 0, noiseBuf = null, lastWall = 0;
  const VOL = 0.55;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5;
    out = ac.createGain(); out.gain.value = on ? VOL : 0;
    out.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const ok = () => ac && on && ac.state === 'running';
  function tone(f, dur, type, vol, delay, f2, attack) {
    if (!ok()) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, freq, delay, type, q) {
    if (!ok()) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 1000; f.Q.value = q || 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  const PENTA = [0, 2, 4, 7, 9];
  const deg = i => PENTA[i % 5] + 12 * Math.floor(i / 5);
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  return {
    unlock: init,
    get on() { return on; },
    toggle() { on = !on; if (out) out.gain.value = on ? VOL : 0; return on; },
    // Each peg in a shot rings one step higher up a pentatonic scale, like the game this pays homage to.
    peg(combo, kind) {
      const n = 67 + deg(Math.min(combo - 1, 17));
      tone(hz(n), 0.22, 'triangle', 0.16);
      tone(hz(n + 12), 0.1, 'sine', 0.05);
      if (kind === E.P_GOLD) { tone(hz(n + 7), 0.4, 'triangle', 0.1, 0.04); tone(hz(n + 16), 0.35, 'sine', 0.05, 0.08); }
      if (kind === E.P_GREEN) tone(hz(n - 12), 0.35, 'square', 0.03, 0, hz(n + 12));
    },
    steel() { tone(2300, 0.05, 'square', 0.02); tone(3400, 0.05, 'sine', 0.03); },
    bump() { tone(170, 0.2, 'sine', 0.32, 0, 520); tone(340, 0.12, 'triangle', 0.07); },
    wall(s) {
      if (!ac) return;
      const now = ac.currentTime;
      if (now - lastWall < 0.06) return;
      lastWall = now;
      noise(0.05, Math.min(0.09, 0.011 * s), 800);
    },
    push(heavy) {
      noise(0.14, 0.33, heavy ? 260 : 460);
      tone(heavy ? 72 : 112, 0.16, 'sine', 0.34, 0, heavy ? 45 : 64);
      if (heavy) tone(820, 0.25, 'square', 0.025, 0, 520);
    },
    thud(blocked) { tone(blocked ? 150 : 96, 0.08, 'sine', 0.16); noise(0.04, 0.06, 600); },
    lock() {
      noise(0.08, 0.22, 380);
      tone(hz(79), 0.28, 'triangle', 0.17); tone(hz(83), 0.3, 'triangle', 0.14, 0.07);
      tone(hz(86), 0.5, 'sine', 0.12, 0.14); tone(hz(91), 0.7, 'sine', 0.07, 0.21);
    },
    launch() { noise(0.12, 0.1, 1800, 0, 'bandpass', 2); tone(250, 0.12, 'sine', 0.12, 0, 640); },
    caught() { [72, 76, 79, 84, 88].forEach((n, i) => tone(hz(n), 0.18, 'triangle', 0.12, i * 0.055)); },
    pop(i) { tone(hz(79 + deg(i % 14)), 0.06, 'sine', 0.05); },
    portal() { tone(280, 0.25, 'sine', 0.09, 0, 1200); tone(1500, 0.2, 'triangle', 0.035, 0.05, 420); },
    gate(open) {
      if (open) [60, 67, 72, 79].forEach((n, i) => tone(hz(n), 0.22, 'sawtooth', 0.035, i * 0.05));
      else tone(220, 0.3, 'sawtooth', 0.05, 0, 90);
    },
    power() { [67, 71, 74, 79, 83, 86].forEach((n, i) => tone(hz(n), 0.14, 'square', 0.035, i * 0.04)); },
    fizzle() { noise(0.35, 0.05, 2600, 0, 'highpass'); },
    click() { tone(1150, 0.04, 'sine', 0.045); },
    buy() { [72, 79, 84, 88, 91].forEach((n, i) => tone(hz(n), 0.22, 'triangle', 0.11, i * 0.05)); },
    fail() { [67, 63, 60, 55].forEach((n, i) => tone(hz(n), 0.4, 'triangle', 0.11, i * 0.2)); },
    stuck() { tone(300, 0.15, 'square', 0.04); tone(240, 0.25, 'square', 0.04, 0.16); },
    heartbeat() { tone(58, 0.14, 'sine', 0.42); tone(52, 0.16, 'sine', 0.32, 0.17); },
    style() { [76, 83, 88].forEach((n, i) => tone(hz(n), 0.16, 'triangle', 0.08, i * 0.07)); },
    fever(slot) {
      const top = [72, 76, 84, 76, 72][slot];
      [0, 4, 7, 12].forEach((d, i) => tone(hz(top + d), 0.3, 'triangle', 0.12, i * 0.07));
      noise(0.5, 0.15, 5000, 0, 'highpass');
    },
    // Beethoven's Ode to Joy: the last-peg fanfare this whole genre owes.
    ode() {
      if (!ok()) return;
      const mel = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, [64, 1.5], [62, 0.5], [62, 2]];
      const bass = [48, 43, 48, 43];
      const beat = 0.21;
      let t = 0.05;
      for (const m of mel) {
        const n = Array.isArray(m) ? m[0] : m, b = Array.isArray(m) ? m[1] : 1;
        tone(hz(n + 12), beat * b * 0.95, 'triangle', 0.15, t);
        tone(hz(n + 24), beat * b * 0.6, 'sine', 0.03, t);
        t += beat * b;
      }
      bass.forEach((n, i) => {
        for (let k = 0; k < 4; k++) tone(hz(n + (k % 2 ? 7 : 0)), beat * 0.9, 'sine', 0.13, 0.05 + (i * 4 + k) * beat);
      });
      for (let k = 0; k < 16; k++) noise(0.05, k % 4 === 0 ? 0.12 : 0.05, k % 2 ? 7000 : 180, 0.05 + k * beat, k % 2 ? 'highpass' : 'lowpass');
      [60, 64, 67, 72, 76].forEach((n, i) => tone(hz(n + 12), 1.1, 'triangle', 0.08, t + i * 0.03));
    },
  };
})();

// ═══ Canvas & layout ═════════════════════════════════════════════════════════
const cv = $('cv'), ctx = cv.getContext('2d');
const stage = $('stage');
const bg = document.createElement('canvas'), bgx = bg.getContext('2d');
let DPR = 1, U = 40, OX = 0, OY = 0, SW = 1, SH = 1;
const VIEW = { x0: -0.32, x1: W + 0.32, y0: -1.02, y1: H + 0.92 };
let staticDirty = true;
let SPR = {};

function resize() {
  const r = stage.getBoundingClientRect();
  SW = Math.max(1, r.width); SH = Math.max(1, r.height);
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = bg.width = Math.round(SW * DPR);
  cv.height = bg.height = Math.round(SH * DPR);
  const vw = VIEW.x1 - VIEW.x0, vh = VIEW.y1 - VIEW.y0;
  U = Math.min(SW / vw, SH / vh);
  OX = (SW - vw * U) / 2 - VIEW.x0 * U;
  OY = (SH - vh * U) / 2 - VIEW.y0 * U;
  buildSprites();
  staticDirty = true;
}

// ── Sprites (drawn once per size, in world units) ─────────────────────────────
function makeSprite(size, draw) {
  const px = Math.max(2, Math.ceil(size * U * DPR));
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.setTransform(px / size, 0, 0, px / size, px / 2, px / 2);
  draw(g);
  c.ws = size;
  return c;
}
function blit(spr, x, y, scale, alpha) {
  const s = spr.ws * (scale || 1);
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.drawImage(spr, x - s / 2, y - s / 2, s, s);
  if (alpha !== undefined) ctx.globalAlpha = 1;
}
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
  g.closePath();
}
const RGB = {
  cyan: [62, 240, 255], gold: [255, 194, 51], blue: [80, 170, 255], green: [69, 232, 138], pink: [255, 79, 180],
  white: [255, 255, 255], orange: [255, 140, 50], violet: [176, 110, 255], red: [255, 70, 90], ice: [150, 225, 255],
};
const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

function sphere(g, r, c0, c1, c2) {
  const grd = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
  grd.addColorStop(0, c0); grd.addColorStop(0.45, c1); grd.addColorStop(1, c2);
  g.fillStyle = grd; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = r * 0.1; g.beginPath(); g.arc(0, 0, r * 0.95, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.ellipse(-r * 0.3, -r * 0.42, r * 0.32, r * 0.17, -0.55, 0, TAU); g.fill();
}

function buildSprites() {
  const pr = E.PEG_R, br = E.BALL_R;
  const peg = cols => makeSprite(pr * 2 + 0.04, g => sphere(g, pr, cols[0], cols[1], cols[2]));
  SPR = {
    peg: [
      [peg(['#d8efff', '#3a9cff', '#10306e']), peg(['#ffffff', '#b4e8ff', '#3a8cff'])],
      [peg(['#fff4c0', '#ffae1a', '#7a3a00']), peg(['#ffffff', '#ffe68a', '#ff9a1a'])],
      [peg(['#dcffe8', '#2fd06c', '#08502a']), peg(['#ffffff', '#b8ffd2', '#3ae07e'])],
      [peg(['#ffffff', '#b8c0d8', '#3e4666']), peg(['#ffffff', '#dfe4f2', '#7a84a6'])],
    ],
    bumper: makeSprite(E.BUMPER_R * 2 + 0.06, g => {
      const r = E.BUMPER_R;
      sphere(g, r, '#ffd0ec', '#ff4fb4', '#6a0a44');
      g.strokeStyle = '#fff'; g.lineWidth = 0.035;
      g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.18 : r * 0.42;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
    }),
    ball: makeSprite(br * 2 + 0.04, g => sphere(g, br, '#ffffff', '#dfe5ff', '#5a64a0')),
    heavy: makeSprite(br * 2 + 0.04, g => sphere(g, br, '#ffe2b8', '#9a7a5a', '#2a1a10')),
    ghost: makeSprite(br * 2 + 0.04, g => { g.globalAlpha = 0.75; sphere(g, br, '#ffffff', '#9af4ff', '#1a6a8a'); }),
    crate: makeSprite(1, g => drawCrate(g, false)),
    iron: makeSprite(1, g => drawCrate(g, true)),
    glow: {},
  };
  for (const k in RGB) {
    SPR.glow[k] = makeSprite(1, g => {
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 0.5);
      grd.addColorStop(0, rgba(RGB[k], 0.9)); grd.addColorStop(0.3, rgba(RGB[k], 0.35)); grd.addColorStop(1, rgba(RGB[k], 0));
      g.fillStyle = grd; g.fillRect(-0.5, -0.5, 1, 1);
    });
  }
}

function drawCrate(g, iron) {
  const s = 0.47;
  if (!iron) {
    const grd = g.createLinearGradient(0, -s, 0, s);
    grd.addColorStop(0, '#e29a4c'); grd.addColorStop(1, '#b06a28');
    g.fillStyle = grd; rrect(g, -s, -s, 2 * s, 2 * s, 0.07); g.fill();
    g.strokeStyle = 'rgba(110,56,16,0.55)'; g.lineWidth = 0.022;
    for (const y of [-0.2, -0.02, 0.16]) { g.beginPath(); g.moveTo(-s + 0.1, y); g.lineTo(s - 0.1, y + 0.02); g.stroke(); }
    g.strokeStyle = '#7a4214'; g.lineWidth = 0.1;
    rrect(g, -s + 0.05, -s + 0.05, 2 * s - 0.1, 2 * s - 0.1, 0.05); g.stroke();
    g.lineWidth = 0.1; g.beginPath(); g.moveTo(-s + 0.12, s - 0.12); g.lineTo(s - 0.12, -s + 0.12); g.stroke();
    g.strokeStyle = 'rgba(255,214,150,0.6)'; g.lineWidth = 0.03;
    g.beginPath(); g.moveTo(-s + 0.02, s - 0.1); g.lineTo(-s + 0.02, -s + 0.07); g.lineTo(s - 0.1, -s + 0.02); g.stroke();
    g.fillStyle = '#4a2a10';
    for (const [x, y] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) { g.beginPath(); g.arc(x, y, 0.028, 0, TAU); g.fill(); }
  } else {
    const grd = g.createLinearGradient(-s, -s, s, s);
    grd.addColorStop(0, '#c7cfe6'); grd.addColorStop(0.5, '#7d87a8'); grd.addColorStop(1, '#474f6e');
    g.fillStyle = grd; rrect(g, -s, -s, 2 * s, 2 * s, 0.06); g.fill();
    g.strokeStyle = '#2c3350'; g.lineWidth = 0.08; rrect(g, -s + 0.04, -s + 0.04, 2 * s - 0.08, 2 * s - 0.08, 0.05); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.025;
    g.beginPath(); g.moveTo(-s + 0.1, -0.12); g.lineTo(s - 0.1, -0.12); g.moveTo(-s + 0.1, 0.12); g.lineTo(s - 0.1, 0.12); g.stroke();
    for (const [x, y] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32], [0, -0.32], [0, 0.32]]) {
      g.fillStyle = '#2c3350'; g.beginPath(); g.arc(x, y, 0.045, 0, TAU); g.fill();
      g.fillStyle = '#e8ecff'; g.beginPath(); g.arc(x - 0.012, y - 0.012, 0.018, 0, TAU); g.fill();
    }
    g.fillStyle = '#2c3350'; g.font = '700 0.2px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('IRON', 0, 0.01);
  }
}

// ── Static layer: floor, walls, ramps, ice, rails. Rebuilt on resize / level load. ──
const CEIL = -0.34;
function drawStatic() {
  staticDirty = false;
  const g = bgx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, bg.width, bg.height);
  if (!G.st) return;
  g.setTransform(DPR * U, 0, 0, DPR * U, DPR * OX, DPR * OY);
  const S = G.st.S;

  // frame + floor
  g.fillStyle = '#07061a'; rrect(g, -0.3, CEIL - 0.1, W + 0.6, H + 1.2 - CEIL, 0.3); g.fill();
  const fl = g.createLinearGradient(0, 0, 0, H);
  fl.addColorStop(0, '#24224e'); fl.addColorStop(1, '#161538');
  g.fillStyle = fl; g.fillRect(0, CEIL, W, H + 0.85 - CEIL);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.05)';
    g.fillRect(x, y, 1, 1);
  }
  g.strokeStyle = 'rgba(140,140,255,0.07)'; g.lineWidth = 0.02;
  g.beginPath();
  for (let x = 1; x < W; x++) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 1; y < H; y++) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  // faint slope arrows stencilled on the floor
  g.fillStyle = 'rgba(160,160,255,0.045)';
  for (let y = 2; y < H; y += 4) for (let x = 1; x < W; x += 3) {
    if (S.solid[y * W + x]) continue;
    g.beginPath(); g.moveTo(x + 0.3, y + 0.25); g.lineTo(x + 0.7, y + 0.25); g.lineTo(x + 0.7, y + 0.5);
    g.lineTo(x + 0.85, y + 0.5); g.lineTo(x + 0.5, y + 0.85); g.lineTo(x + 0.15, y + 0.5); g.lineTo(x + 0.3, y + 0.5); g.fill();
  }

  // ice
  for (let i = 0; i < W * H; i++) {
    if (S.floor[i] !== E.F_ICE) continue;
    const x = i % W, y = (i / W) | 0;
    const ig = g.createLinearGradient(x, y, x + 1, y + 1);
    ig.addColorStop(0, 'rgba(170,235,255,0.34)'); ig.addColorStop(1, 'rgba(90,170,255,0.22)');
    g.fillStyle = ig; g.fillRect(x + 0.02, y + 0.02, 0.96, 0.96);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.025;
    g.beginPath(); g.moveTo(x + 0.18, y + 0.62); g.lineTo(x + 0.55, y + 0.25); g.moveTo(x + 0.4, y + 0.8); g.lineTo(x + 0.62, y + 0.58); g.stroke();
  }
  // pad bases
  for (const i of S.pads) {
    const x = i % W, y = (i / W) | 0;
    g.fillStyle = 'rgba(62,240,255,0.08)'; rrect(g, x + 0.08, y + 0.08, 0.84, 0.84, 0.12); g.fill();
    g.strokeStyle = 'rgba(62,240,255,0.35)'; g.lineWidth = 0.035;
    rrect(g, x + 0.08, y + 0.08, 0.84, 0.84, 0.12); g.stroke();
  }
  // switch plates
  for (const i of S.switches) {
    const x = i % W + 0.5, y = ((i / W) | 0) + 0.5;
    g.fillStyle = '#2a1830'; g.beginPath(); g.arc(x, y, 0.38, 0, TAU); g.fill();
    g.strokeStyle = '#5a3a60'; g.lineWidth = 0.05; g.stroke();
  }
  // walls, with bevels only where they meet open floor
  const wall = (x, y) => x < 0 || x >= W || y < 0 || (y < H && S.solid[y * W + x] === E.S_WALL);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (S.solid[y * W + x] !== E.S_WALL) continue;
    const wg = g.createLinearGradient(x, y, x, y + 1);
    wg.addColorStop(0, '#3d4274'); wg.addColorStop(1, '#2d3160');
    g.fillStyle = wg; g.fillRect(x, y, 1, 1);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    if ((x * 7 + y * 3) % 2) g.fillRect(x + 0.08, y + 0.5, 0.84, 0.03);
    if (!wall(x, y - 1)) { g.fillStyle = '#7a82cc'; g.fillRect(x, y, 1, 0.09); g.fillStyle = '#5a61a8'; g.fillRect(x, y + 0.09, 1, 0.05); }
    if (!wall(x - 1, y)) { g.fillStyle = 'rgba(140,150,230,0.5)'; g.fillRect(x, y, 0.06, 1); }
    if (!wall(x + 1, y)) { g.fillStyle = 'rgba(10,10,40,0.45)'; g.fillRect(x + 0.94, y, 0.06, 1); }
    if (!wall(x, y + 1)) { g.fillStyle = '#1a1c40'; g.fillRect(x, y + 0.88, 1, 0.12); }
  }
  // ramps: steel wedges with hazard-striped slopes
  for (let i = 0; i < W * H; i++) {
    const s = S.solid[i];
    if (s < E.S_BR || s > E.S_TR) continue;
    const x = i % W, y = (i / W) | 0, v = E.TRI[s];
    g.beginPath(); g.moveTo(x + v[0], y + v[1]); g.lineTo(x + v[2], y + v[3]); g.lineTo(x + v[4], y + v[5]); g.closePath();
    const rg = g.createLinearGradient(x, y, x + 1, y + 1);
    rg.addColorStop(0, '#4a4f88'); rg.addColorStop(1, '#2a2d5c');
    g.fillStyle = rg; g.fill();
    // the slope is the edge that isn't axis aligned
    let a = null;
    for (let k = 0; k < 3; k++) {
      const x0 = v[2 * k], y0 = v[2 * k + 1], x1 = v[(2 * k + 2) % 6], y1 = v[(2 * k + 3) % 6];
      if (x0 !== x1 && y0 !== y1) a = [x + x0, y + y0, x + x1, y + y1];
    }
    g.lineCap = 'butt';
    g.strokeStyle = '#1a1a2a'; g.lineWidth = 0.14;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[2], a[3]); g.stroke();
    g.setLineDash([0.1, 0.1]); g.strokeStyle = '#ffc233';
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[2], a[3]); g.stroke();
    g.setLineDash([]);
  }
  // ceiling beam
  const cg = g.createLinearGradient(0, CEIL - 0.7, 0, 0);
  cg.addColorStop(0, '#2a2b52'); cg.addColorStop(1, '#3b3d78');
  g.fillStyle = cg; g.fillRect(-0.3, CEIL - 0.68, W + 0.6, 0.68 + 0.02);
  g.fillStyle = '#6a70c0'; g.fillRect(-0.3, CEIL - 0.02, W + 0.6, 0.04);
  for (let x = 0.3; x < W; x += 0.9) { g.fillStyle = '#1c1d40'; g.beginPath(); g.arc(x, CEIL - 0.34, 0.05, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(255,194,51,0.8)'; g.font = '600 0.28px Fredoka, sans-serif'; g.textBaseline = 'middle';
  g.textAlign = 'left'; g.fillText('WH-8', 0.1, CEIL - 0.34);
  g.textAlign = 'right'; g.fillText('SLOPE ↓', W - 0.1, CEIL - 0.34);
  // bucket rail
  g.fillStyle = '#0e0d26'; g.fillRect(0, H, W, 0.86);
  g.strokeStyle = '#3a3a78'; g.lineWidth = 0.05;
  g.beginPath(); g.moveTo(0, H + 0.72); g.lineTo(W, H + 0.72); g.stroke();
  // frame rim
  g.strokeStyle = '#4a4c90'; g.lineWidth = 0.08;
  rrect(g, -0.2, CEIL - 0.72, W + 0.4, H + 0.86 - CEIL + 0.72 + 0.1, 0.22); g.stroke();
}

// ═══ Effects ═════════════════════════════════════════════════════════════════
const FX = { parts: [], texts: [], rings: [], banners: [], shake: 0, flash: 0, flashRGB: RGB.white };
function particle(p) { if (FX.parts.length < 600) FX.parts.push(p); }
function sparks(x, y, n, col, speed, life, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.9);
    particle({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 3, life: life * rand(0.6, 1.2), t: 0, size: size * rand(0.6, 1.2), c: col });
  }
}
function dust(x, y, n, dx, dy) {
  for (let i = 0; i < n; i++) {
    particle({ k: 'dust', x: x + rand(-0.3, 0.3) * (dy ? 1 : 0.2), y: y + rand(-0.3, 0.3) * (dx ? 1 : 0.2),
      vx: -dx * rand(0.4, 1.4) + rand(-0.5, 0.5), vy: -dy * rand(0.4, 1.4) + rand(-0.5, 0.5), g: 0, life: rand(0.35, 0.7), t: 0, size: rand(0.08, 0.18), c: [190, 150, 110] });
  }
}
function shards(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = rand(1.5, 4);
    particle({ k: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, g: 9, life: rand(0.4, 0.8), t: 0, size: rand(0.05, 0.09), c: col, rot: rand(0, TAU), vr: rand(-12, 12) });
  }
}
function confetti(x, y, n, spread) {
  const cols = [RGB.gold, RGB.cyan, RGB.pink, RGB.green, RGB.violet, RGB.white];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + rand(-spread, spread), s = rand(4, 11);
    particle({ k: 'conf', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 7, drag: 1.6, life: rand(1.6, 2.8), t: 0, size: rand(0.1, 0.18),
      c: cols[(Math.random() * cols.length) | 0], rot: rand(0, TAU), vr: rand(-10, 10) });
  }
}
function firework(x, y) {
  const cols = [RGB.gold, RGB.cyan, RGB.pink, RGB.green, RGB.violet];
  const c = cols[(Math.random() * cols.length) | 0];
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, s = rand(3.2, 4.4);
    particle({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 2.2, drag: 1.2, life: rand(0.9, 1.3), t: 0, size: 0.1, c });
  }
  ring(x, y, 0.2, 2.2, c, 0.5, 0.06);
  Sound.pop((Math.random() * 10) | 0);
}
function ring(x, y, r0, r1, c, life, w) { FX.rings.push({ x, y, r0, r1, c, life, t: 0, w: w || 0.06 }); }
function popText(x, y, text, c, size, life, rise) {
  FX.texts.push({ x, y, text, c: c || RGB.white, size: size || 0.4, life: life || 0.9, t: 0, rise: rise === undefined ? 1 : rise });
}
// Big callouts live in screen space, so the slow-motion zoom never crops them.
function banner(text, c, size, life, y) { FX.banners.push({ text, c, size, life, t: 0, y }); }
function shake(m) { FX.shake = Math.max(FX.shake, m); }
function flash(c, a) { FX.flashRGB = c; FX.flash = Math.max(FX.flash, a); }

function updateFX(dt, realDt) {
  for (let i = FX.parts.length - 1; i >= 0; i--) {
    const p = FX.parts[i];
    p.t += dt;
    if (p.t >= p.life) { FX.parts[i] = FX.parts[FX.parts.length - 1]; FX.parts.pop(); continue; }
    p.vy += (p.g || 0) * dt;
    if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.vr) p.rot += p.vr * dt;
  }
  for (let i = FX.rings.length - 1; i >= 0; i--) { const r = FX.rings[i]; r.t += dt; if (r.t >= r.life) FX.rings.splice(i, 1); }
  for (let i = FX.texts.length - 1; i >= 0; i--) { const t = FX.texts[i]; t.t += realDt; if (t.t >= t.life) FX.texts.splice(i, 1); }
  for (let i = FX.banners.length - 1; i >= 0; i--) { const b = FX.banners[i]; b.t += realDt; if (b.t >= b.life) FX.banners.splice(i, 1); }
  FX.shake = Math.max(0, FX.shake - dt * 1.4);
  FX.flash = Math.max(0, FX.flash - dt * 2.2);
}

function drawFX() {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of FX.parts) {
    if (p.k !== 'spark') continue;
    const f = 1 - p.t / p.life;
    ctx.fillStyle = rgba(p.c, 0.9 * f);
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * f), 0, TAU); ctx.fill();
  }
  for (const r of FX.rings) {
    const f = r.t / r.life, e = easeOut(f);
    ctx.strokeStyle = rgba(r.c, 0.8 * (1 - f)); ctx.lineWidth = r.w * (1 - f * 0.6);
    ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r0, r.r1, e), 0, TAU); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const p of FX.parts) {
    const f = 1 - p.t / p.life;
    if (p.k === 'dust') {
      ctx.fillStyle = rgba(p.c, 0.35 * f);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - f * 0.6), 0, TAU); ctx.fill();
    } else if (p.k === 'shard' || p.k === 'conf') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = rgba(p.c, Math.min(1, f * 2));
      if (p.k === 'conf') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else { ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.7, p.size * 0.6); ctx.lineTo(-p.size * 0.7, p.size * 0.6); ctx.fill(); }
      ctx.restore();
    }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of FX.texts) {
    const f = t.t / t.life;
    const s = t.size * (f < 0.15 ? lerp(0.6, 1.1, f / 0.15) : f < 0.3 ? lerp(1.1, 1, (f - 0.15) / 0.15) : 1);
    const a = f > 0.7 ? (1 - f) / 0.3 : 1;
    ctx.font = '700 ' + s.toFixed(3) + 'px Fredoka, sans-serif';
    ctx.lineWidth = s * 0.22; ctx.lineJoin = 'round';
    const y = t.y - t.rise * easeOut(f) * 0.9;
    ctx.strokeStyle = 'rgba(10,8,30,' + (0.85 * a) + ')'; ctx.strokeText(t.text, t.x, y);
    ctx.fillStyle = rgba(t.c, a); ctx.fillText(t.text, t.x, y);
  }
}

// Dust motes drifting down the slope, for a little air in the warehouse.
const MOTES = Array.from({ length: 28 }, () => ({
  x: rand(0, W), y: rand(0, H), vx: rand(-0.05, 0.05), vy: rand(0.06, 0.2), r: rand(0.02, 0.05), a: rand(0.1, 0.28), t: rand(0, 10),
}));
function updateMotes(dt) {
  for (const m of MOTES) {
    m.t += dt;
    m.x += (m.vx + 0.05 * Math.sin(m.t * 0.7)) * dt;
    m.y += m.vy * dt;
    if (m.y > H) { m.y = -0.2; m.x = rand(0, W); }
    if (m.x < 0) m.x += W; else if (m.x > W) m.x -= W;
  }
}
function drawMotes() {
  ctx.fillStyle = '#c8c8ff';
  for (const m of MOTES) {
    ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(m.t * 1.3));
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ═══ Game state ══════════════════════════════════════════════════════════════
const G = {
  mode: 'none',      // 'attract' behind the title, 'play' in a level
  li: 0, def: null, st: null, sim: null, undo: [],
  aim: 0, power: null, acc: 0,
  preview: null, previewSig: '',
  bucketPhase: 0, pops: [], trails: [], dead: [],
  settle: 0, phase: 'aim', route: null, hintT: 0,
  timeScale: 1, slow: null, zoom: 1, zx: W / 2, zy: H / 2,
  robot: { recoil: 0, blink: 0, mood: 0, moodT: 0 },
  bumperFlash: {}, crateFlash: {}, feverT: -1,
  attractT: 0, time: 0, stateVer: 0,
};

function freshState(def) {
  const st = E.parseLevel(def);
  if (G.mode === 'play') {
    st.marbles += save.up.pouch;
    if (save.up.core >= 1) st.charges.heavy++;
    if (save.up.core >= 2) st.charges.ghost++;
  }
  return st;
}

function startLevel(i) {
  G.mode = 'play';
  document.body.classList.remove('attract');
  G.li = i; G.def = LEVELS[i];
  G.st = freshState(G.def);
  G.sim = null; G.undo = []; G.pops = []; G.trails = []; G.dead = [];
  G.aim = G.def.aim || 0; G.power = null; G.phase = 'aim'; G.settle = 0;
  G.timeScale = 1; G.slow = null; G.zoom = 1; G.feverT = -1; G.hintT = 0; G.resultShown = false;
  G.bumperFlash = {}; G.crateFlash = {};
  FX.parts.length = 0; FX.texts.length = 0; FX.rings.length = 0; FX.banners.length = 0;
  const st = freshState(G.def), keys = [E.stateKey(st)];
  for (const a of G.def.solution || []) { E.simulate(st, a); keys.push(E.stateKey(st)); }
  G.route = { keys, sol: G.def.solution || [] };
  G.stateVer++;
  staticDirty = true;
  $('lvNum').textContent = 'Level ' + (i + 1);
  $('lvName').textContent = G.def.name;
  hud();
}

function restartLevel() { startLevel(G.li); toast('Level restarted'); levelStartFX(); }

// A little flourish as a level opens: the pads ping and Soko grins.
function levelStartFX() {
  const S = G.st.S;
  S.pads.forEach((i, k) => setTimeout(() => {
    ring(i % W + 0.5, ((i / W) | 0) + 0.5, 0.2, 1.1, RGB.cyan, 0.5, 0.07);
    Sound.pop(k * 2);
  }, 120 + k * 110));
  G.st.crates.forEach(c => sparks(c.x + 0.5, c.y + 0.5, 6, RGB.gold, 1.6, 0.4, 0.05));
  G.robot.mood = 1; G.robot.moodT = 1.2;
}

function playing() { return G.mode === 'play' && G.phase === 'aim' && !anyScreen(); }

function canFire() { return playing() && !G.sim && G.st.marbles > 0 && !G.st.won; }

function fire() {
  if (!canFire()) return;
  Sound.unlock();
  G.undo.push(E.cloneState(G.st));
  const half = 0.72 + 0.3 * save.up.catcher;
  G.sim = E.fire(G.st, G.aim, { power: G.power, bucket: { phase: G.bucketPhase, speed: 1.1, half } });
  G.power = null;
  G.phase = 'flight';
  G.acc = 0;
  G.trails = G.sim.balls.map(() => []);
  G.robot.recoil = 1;
  const d = E.aimDir(G.aim);
  sparks(E.LAUNCH_X + d[0] * 0.55, E.LAUNCH_Y + d[1] * 0.55, 10, RGB.gold, 3, 0.3, 0.07);
  Sound.launch();
  hud();
}

function undo() {
  if (G.sim || !G.undo.length || G.mode !== 'play' || G.phase === 'won') return;
  G.st = G.undo.pop();
  G.phase = 'aim'; G.pops = []; G.dead = E.deadCrates(G.st);
  G.stateVer++;
  staticDirty = true;
  Sound.click();
  toast('↶ Shot undone');
  hud();
}

function selectPower() {
  const order = ['heavy', 'ghost', 'split'];
  const have = order.filter(k => G.st.charges[k] > 0);
  if (!have.length) { toast('No power marbles. Green pegs charge one' + (save.up.core ? '.' : ', or build a Power Core.')); return; }
  const i = G.power ? have.indexOf(G.power) : -1;
  G.power = i + 1 < have.length ? have[i + 1] : null;
  Sound.click();
  if (G.power) toast(POWERS[G.power].icon + ' ' + POWERS[G.power].tip);
  hud();
}

function hint() {
  const r = G.route;
  if (!r || !r.sol.length || G.sim || G.phase !== 'aim' || G.st.won) return;
  let k = r.keys.indexOf(E.stateKey(G.st));
  let rewound = false;
  if (k < 0 || k >= r.sol.length) {
    // Step back through the undo history to the last position on the known route.
    let j = G.undo.length - 1;
    for (; j >= 0; j--) if (r.keys.indexOf(E.stateKey(G.undo[j])) >= 0) break;
    if (j >= 0) { G.st = G.undo[j]; G.undo.length = j; }
    else { G.st = freshState(G.def); G.undo = []; }
    G.dead = E.deadCrates(G.st); G.stateVer++; staticDirty = true;
    k = r.keys.indexOf(E.stateKey(G.st));
    rewound = true;
  }
  if (k < 0 || k >= r.sol.length) { toast('No hint from here, sorry!'); return; }
  G.aim = r.sol[k];
  G.power = null;
  G.hintT = 3;
  toast((rewound ? '↶ Rewound to a known route. ' : '') + '💡 Shot ' + (k + 1) + ' of ' + r.sol.length + ': aim ' + fmtAngle(G.aim));
  hud();
}

function fmtAngle(a) { return (a > 0 ? '+' : a < 0 ? '−' : '') + (Math.abs(a) / 10).toFixed(1) + '°'; }

function setAim(a) {
  a = clamp(Math.round(a), -E.ANGLE_MAX, E.ANGLE_MAX);
  if (a !== G.aim) { G.aim = a; hudAngle(); }
}

// ── Engine events → juice ────────────────────────────────────────────────────
const PEG_RGB = [RGB.blue, RGB.gold, RGB.green, RGB.white];
function crateCenter(ci) { const c = G.st.crates[ci]; return [c.x + 0.5, c.y + 0.5]; }

// Behind the title the marbles play silently: nobody asked for plinking while reading the story.
const MUTE = new Proxy({}, { get: () => () => {} });
function handleEvents(sim) {
  const S = G.st.S;
  const sfx = G.mode === 'attract' ? MUTE : Sound;
  for (const e of sim.events) {
    switch (e.type) {
      case 'peg': {
        const p = e.a, x = S.pegX[p], y = S.pegY[p], kind = S.pegKind[p];
        sparks(x, y, kind === E.P_GOLD ? 16 : 8, PEG_RGB[kind], kind === E.P_GOLD ? 4 : 2.6, 0.35, 0.06);
        ring(x, y, 0.1, 0.55, PEG_RGB[kind], 0.3, 0.05);
        popText(x, y - 0.3, '+' + e.c, kind === E.P_GOLD ? RGB.gold : kind === E.P_GREEN ? RGB.green : RGB.white, kind === E.P_GOLD ? 0.42 : 0.3, 0.7, 0.8);
        sfx.peg(e.b, kind);
        if (kind === E.P_GOLD) popText(x, y - 0.75, 'GOLD PEG!', RGB.gold, 0.36, 1, 0.9);
        break;
      }
      case 'reping': sfx.pop(2); break;
      case 'steel': sparks(S.pegX[e.a], S.pegY[e.a], 4, RGB.white, 2, 0.18, 0.04); sfx.steel(); break;
      case 'bump': {
        const x = S.pegX[e.a], y = S.pegY[e.a];
        G.bumperFlash[e.a] = 1;
        ring(x, y, 0.3, 0.95, RGB.pink, 0.35, 0.08);
        sparks(x, y, 10, RGB.pink, 3.5, 0.3, 0.06);
        sfx.bump();
        break;
      }
      case 'wall': if (e.c > 5) { sparks(e.a, e.b, 3, [200, 200, 255], 1.6, 0.2, 0.035); } sfx.wall(e.c); break;
      case 'push': {
        const c = G.st.crates[e.a];
        const cx = c.px + 0.5, cy = c.py + 0.5;
        dust(cx - e.b * 0.45, cy - e.c * 0.45, 10, e.b, e.c);
        sparks(cx - e.b * 0.5, cy - e.c * 0.5, 6, RGB.gold, 2.2, 0.25, 0.05);
        G.crateFlash[e.a] = 1;
        shake(c.heavy ? 0.16 : 0.1);
        sfx.push(c.heavy);
        G.shotPushes = (G.shotPushes || 0) + 1;
        if (G.shotPushes >= 2) popText(c.x + 0.5, c.y - 0.2, '×' + G.shotPushes, RGB.gold, 0.45, 0.9);
        break;
      }
      case 'thud': {
        if (e.b === E.R_BLOCKED) { popText(e.c, e.d - 0.2, 'blocked', RGB.red, 0.26, 0.6, 0.5); sfx.thud(true); }
        else if (e.b === E.R_WEAK && G.st.crates[e.a].heavy) { popText(e.c, e.d - 0.2, 'too soft', [200, 200, 230], 0.26, 0.6, 0.5); sfx.thud(false); sparks(e.c, e.d, 4, RGB.white, 1.5, 0.2, 0.04); }
        else sfx.thud(false);
        break;
      }
      case 'slide': { const c = G.st.crates[e.a]; sparks(c.x + 0.5, c.y + 0.5, 3, RGB.ice, 1.2, 0.3, 0.05); break; }
      case 'lock': {
        const [x, y] = crateCenter(e.a);
        ring(x, y, 0.3, 1.6, RGB.cyan, 0.55, 0.1);
        ring(x, y, 0.2, 0.9, RGB.white, 0.35, 0.05);
        sparks(x, y, 24, RGB.cyan, 4.5, 0.55, 0.07);
        popText(x, y - 0.55, '+300', RGB.cyan, 0.42, 1);
        shake(0.14); flash(RGB.cyan, 0.12);
        sfx.lock();
        G.robot.mood = 1; G.robot.moodT = 1.6;
        break;
      }
      case 'win': winMoment(e.a); break;
      case 'gate': {
        for (const i of S.gates) sparks(i % W + 0.5, ((i / W) | 0) + 0.5, 6, e.a ? RGB.green : RGB.red, 2, 0.35, 0.05);
        toast(e.a ? '🔓 Gates open!' : '🔒 Gates closed');
        sfx.gate(e.a);
        break;
      }
      case 'crush': {
        const p = e.a, kind = S.pegKind[p];
        shards(S.pegX[p], S.pegY[p], PEG_RGB[kind], 8);
        popText(S.pegX[p], S.pegY[p] - 0.3, 'crunch!', PEG_RGB[kind], 0.28, 0.7);
        break;
      }
      case 'power': {
        const p = e.b;
        popText(S.pegX[p], S.pegY[p] - 0.7, POWERS[e.a].icon + ' ' + POWERS[e.a].name.toUpperCase() + ' +1', RGB.green, 0.36, 1.3);
        ring(S.pegX[p], S.pegY[p], 0.2, 1.3, RGB.green, 0.5, 0.08);
        sfx.power();
        break;
      }
      case 'portal': {
        const P = S.portals;
        ring(P[e.a].x, P[e.a].y, 0.1, 0.9, RGB.violet, 0.4, 0.07);
        ring(P[e.b].x, P[e.b].y, 0.9, 0.1, RGB.violet, 0.4, 0.07);
        G.trails[e.c] = [];
        sfx.portal();
        break;
      }
      case 'fever': {
        const x = (e.a + 0.5) * W / 5;
        popText(x, H - 0.6, '+' + e.b.toLocaleString(), RGB.gold, e.a === 2 ? 0.8 : 0.6, 1.6, 1.2);
        for (let k = 0; k < (e.a === 2 ? 5 : 3); k++) setTimeout(() => firework(rand(1, W - 1), rand(2, 7)), k * 220);
        confetti(x, H, 40, 0.6);
        sfx.fever(e.a);
        break;
      }
      case 'exit':
        if (e.c) {
          popText(e.b, H - 0.3, 'FREE MARBLE!', RGB.cyan, 0.42, 1.2);
          ring(e.b, H + 0.35, 0.2, 1.2, RGB.cyan, 0.4, 0.08);
          sparks(e.b, H + 0.3, 16, RGB.cyan, 3.5, 0.5, 0.06);
          sfx.caught();
        }
        break;
      case 'fizzle': sparks(e.b, e.c, 10, [180, 180, 220], 1.2, 0.5, 0.05); sfx.fizzle(); break;
    }
  }
  if (sim.events.length && G.mode === 'play') hud();   // score and pads tick up live
  sim.events.length = 0;
}

function openPads(st) {
  let n = 0;
  for (const i of st.S.pads) { const ci = st.crateAt[i]; if (ci < 0 || !st.crates[ci].locked) n++; }
  return n;
}

function winMoment(ci) {
  const [x, y] = crateCenter(ci);
  G.phase = 'won';
  G.feverT = 0;
  flash(RGB.white, 0.55);
  shake(0.3);
  for (let k = 0; k < 4; k++) setTimeout(() => firework(rand(1, W - 1), rand(1.5, 8)), 150 + k * 260);
  confetti(x, y, 60, 1.2);
  banner('WAREHOUSE SORTED!', RGB.gold, 0.1, 2.8, 0.36);
  Sound.ode();
  G.robot.mood = 2; G.robot.moodT = 99;
  if (G.slow) G.slow.hit = true;
}

// ── Shot lifecycle ───────────────────────────────────────────────────────────
function endShot() {
  const sim = G.sim;
  G.sim = null;
  const res = E.finishShot(G.st, sim);
  const S = G.st.S;
  G.pops = sim.lit.filter(p => !G.st.pegAlive[p]).map((p, i) => ({ p, x: S.pegX[p], y: S.pegY[p], kind: S.pegKind[p], t: -i * 0.045, i }));
  G.settle = G.pops.length * 0.045 + 0.35;
  // Style points, awarded on the state so an undo takes them back too.
  const style = [];
  if (sim.pushes >= 2) style.push([sim.pushes >= 4 ? 'Mega shove' : sim.pushes === 3 ? 'Triple shove' : 'Double shove', [0, 0, 500, 1500, 3000][Math.min(4, sim.pushes)]]);
  if (sim.bumps && sim.pushes) style.push(['Bumper boost', 250]);
  if (sim.banks && sim.pushes) style.push(['Bank shot', 200]);
  if (sim.combo >= 8) style.push(['Peg party', 100 * sim.combo]);
  for (const [, pts] of style) G.st.score += pts;
  if (style.length && !res.won) {
    style.forEach(([name, pts], k) => banner(name.toUpperCase() + '  +' + pts.toLocaleString(), RGB.gold, 0.062, 1.5, 0.4 + k * 0.07));
    Sound.style();
  }
  G.shotPushes = 0;
  G.slow = null; G.timeScale = 1;
  G.dead = E.deadCrates(G.st);
  G.phase = res.won ? 'won' : 'settle';
  G.stateVer++;
  hud();
}

function afterSettle() {
  G.phase = 'aim';
  if (G.st.won) return;
  if (E.hopeless(G.st)) {
    toast('A crate is stuck where it can never reach a pad. Tap ↶ Undo.', true);
    Sound.stuck();
    $('undo').classList.add('nudge');
  } else if (G.dead.length) {
    toast('That crate is wedged for good, but you can still win.', true);
  }
  if (G.st.marbles <= 0) setTimeout(() => { if (G.mode === 'play' && !G.sim && G.st.marbles <= 0 && !G.st.won) showFail(); }, 500);
}

// ═══ Main loop ═══════════════════════════════════════════════════════════════
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  G.time += dt;
  update(dt);
  render(dt);
}

function update(dt) {
  if (!$('pause').hidden || !$('help').hidden) return;   // the menu freezes the warehouse
  if (G.mode === 'attract') attractUpdate(dt);
  // slow motion eases in and out
  let target = 1;
  if (G.slow) target = G.slow.hit ? 0.55 : 0.18;
  else if (G.sim && G.mode === 'play' && G.sim.balls.every(b => !b.alive || (G.sim.t - b.liveT > 0.6 && b.vx * b.vx + b.vy * b.vy < 16))) target = 1.8;   // fast-forward a marble that's only coasting
  G.timeScale = lerp(G.timeScale, target, 1 - Math.exp(-dt * (G.slow && !G.slow.hit ? 14 : 3)));
  const sdt = dt * G.timeScale;

  if (G.sim) {
    G.acc += sdt;
    let n = 0;
    while (G.acc >= E.DT && n < 48 && !G.sim.done) { E.step(G.st, G.sim); G.acc -= E.DT; n++; }
    G.sim.balls.forEach((b, k) => {
      const tr = G.trails[k] || (G.trails[k] = []);
      if (b.alive) { tr.push(b.x, b.y); if (tr.length > 28) tr.splice(0, 2); }
      else if (tr.length) tr.splice(0, 4);
    });
    handleEvents(G.sim);
    if (G.mode === 'play' && !G.slow && !G.sim.won && openPads(G.st) === 1 && ((G.time * 60) | 0) % 2 === 0) {
      const c = E.winsSoon(G.st, G.sim, 0.35);
      if (c >= 0) { G.slow = { crate: c, hit: false }; Sound.heartbeat(); }
    }
    if (G.sim.done) G.mode === 'attract' ? attractEndShot() : endShot();
  } else {
    G.bucketPhase += dt * 1.1;
    for (const c of G.st ? G.st.crates : []) if (c.mT < 1) c.mT += dt;
    for (let k = 0; k < G.trails.length; k++) if (G.trails[k].length) G.trails[k].splice(0, 4);
  }
  // camera
  let zt = 1, fx = W / 2, fy = H / 2;
  if (G.slow && G.st) { zt = G.slow.hit ? 1.25 : 1.6; [fx, fy] = crateCenter(G.slow.crate); }
  G.zoom = lerp(G.zoom, zt, 1 - Math.exp(-dt * 5));
  G.zx = lerp(G.zx, fx, 1 - Math.exp(-dt * 6)); G.zy = lerp(G.zy, fy, 1 - Math.exp(-dt * 6));

  // after-shot peg cascade
  if (G.pops.length) {
    for (const p of G.pops) {
      const before = p.t;
      p.t += dt;
      if (before < 0 && p.t >= 0) { shards(p.x, p.y, PEG_RGB[p.kind], 5); Sound.pop(p.i); }
    }
    G.pops = G.pops.filter(p => p.t < 0.3);
  }
  if (G.phase === 'settle') { G.settle -= dt; if (G.settle <= 0) afterSettle(); }
  if (G.phase === 'won' && !G.sim && G.mode === 'play') {
    G.feverT += dt;
    if (G.feverT > 0.6 && !G.resultShown && Math.random() < dt * 2.5) firework(rand(1, W - 1), rand(1.5, 9));
    if (G.feverT > 2.4 && !G.resultShown) { G.resultShown = true; showWin(); }
  }
  // robot
  const R = G.robot;
  R.recoil = Math.max(0, R.recoil - dt * 5);
  R.blink -= dt; if (R.blink < -0.12) R.blink = rand(2, 5);
  if (R.moodT > 0) { R.moodT -= dt; if (R.moodT <= 0) R.mood = 0; }
  for (const k in G.bumperFlash) { G.bumperFlash[k] -= dt * 4; if (G.bumperFlash[k] <= 0) delete G.bumperFlash[k]; }
  for (const k in G.crateFlash) { G.crateFlash[k] -= dt * 4; if (G.crateFlash[k] <= 0) delete G.crateFlash[k]; }
  if (G.hintT > 0) G.hintT -= dt;
  updateMotes(sdt);
  updateFX(sdt, dt);
}

// ═══ Rendering ═══════════════════════════════════════════════════════════════
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!G.st) return;
  if (staticDirty) drawStatic();
  const z = G.zoom;
  const px = DPR * (OX + G.zx * U), py = DPR * (OY + G.zy * U);
  let ex = (1 - z) * px, ey = (1 - z) * py;
  if (FX.shake > 0) { const m = FX.shake * U * DPR * 0.5; ex += rand(-m, m); ey += rand(-m, m); }
  ctx.setTransform(z, 0, 0, z, ex, ey);
  ctx.drawImage(bg, 0, 0);
  const k = z * DPR * U;
  ctx.setTransform(k, 0, 0, k, z * DPR * OX + ex, z * DPR * OY + ey);

  const st = G.st, t = G.time;
  drawMotes();
  drawPads(st, t);
  drawSwitchesGatesPortals(st, t);
  drawPegs(st, t);
  drawCrates(st, t);
  if (G.mode === 'play' && G.phase === 'aim' && !G.sim && !st.won && !anyScreen()) drawGuide(st, t);
  drawBalls();
  drawBucket(t);
  drawRobot(t);
  drawFX();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (G.slow && !G.slow.hit) {
    const v = ctx.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.2, cv.width / 2, cv.height / 2, cv.height * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (0.55 * (1 - G.timeScale)) + ')');
    ctx.fillStyle = v; ctx.fillRect(0, 0, cv.width, cv.height);
  }
  if (FX.flash > 0) { ctx.fillStyle = rgba(FX.flashRGB, FX.flash * 0.6); ctx.fillRect(0, 0, cv.width, cv.height); }
  drawBanners();
}

function drawBanners() {
  if (!FX.banners.length) return;
  const w = cv.width, base = Math.min(w, cv.height * 0.62);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const b of FX.banners) {
    const f = b.t / b.life;
    const pop = f < 0.12 ? lerp(0.5, 1.12, f / 0.12) : f < 0.22 ? lerp(1.12, 1, (f - 0.12) / 0.1) : 1;
    const a = f > 0.75 ? (1 - f) / 0.25 : 1;
    let px = b.size * base * pop;
    ctx.font = '700 ' + px.toFixed(1) + 'px Fredoka, sans-serif';
    const tw = ctx.measureText(b.text).width;
    if (tw > w * 0.92) { px *= w * 0.92 / tw; ctx.font = '700 ' + px.toFixed(1) + 'px Fredoka, sans-serif'; }
    const y = b.y * cv.height - f * px * 0.3;
    ctx.lineWidth = px * 0.2;
    ctx.strokeStyle = 'rgba(10,8,30,' + (0.9 * a) + ')'; ctx.strokeText(b.text, w / 2, y);
    ctx.fillStyle = rgba(b.c, a); ctx.fillText(b.text, w / 2, y);
  }
}

function drawPads(st, t) {
  const S = st.S;
  for (const i of S.pads) {
    const x = i % W, y = (i / W) | 0, ci = st.crateAt[i];
    const full = ci >= 0 && st.crates[ci].locked;
    if (full) continue;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + x + y);
    ctx.globalCompositeOperation = 'lighter';
    blit(SPR.glow.cyan, x + 0.5, y + 0.5, 1.3 + pulse * 0.25, 0.35 + pulse * 0.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(RGB.cyan, 0.6 + 0.4 * pulse); ctx.lineWidth = 0.06;
    const m = 0.14, L = 0.22;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x + m, y + m, 1, 1], [x + 1 - m, y + m, -1, 1], [x + m, y + 1 - m, 1, -1], [x + 1 - m, y + 1 - m, -1, -1]]) {
      ctx.moveTo(cx, cy + sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * L, cy);
    }
    ctx.stroke();
    ctx.save(); ctx.translate(x + 0.5, y + 0.5); ctx.rotate(Math.PI / 4 + t * 0.6);
    ctx.fillStyle = rgba(RGB.cyan, 0.25 + 0.25 * pulse);
    const d = 0.13 + 0.03 * pulse;
    ctx.fillRect(-d, -d, 2 * d, 2 * d);
    ctx.restore();
  }
}

function drawSwitchesGatesPortals(st, t) {
  const S = st.S;
  for (const i of S.switches) {
    const x = i % W + 0.5, y = ((i / W) | 0) + 0.5, on = st.crateAt[i] >= 0;
    ctx.fillStyle = on ? '#2ee07a' : '#ff4a5e';
    ctx.beginPath(); ctx.arc(x, y, 0.26, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x - 0.07, y - 0.08, 0.09, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    blit(on ? SPR.glow.green : SPR.glow.red, x, y, 1.2, 0.35 + 0.15 * Math.sin(t * 4));
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const i of S.gates) {
    const x = i % W, y = (i / W) | 0;
    if (st.gatesOpen) {
      ctx.strokeStyle = 'rgba(69,232,138,0.35)'; ctx.lineWidth = 0.03; ctx.setLineDash([0.08, 0.08]);
      ctx.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88); ctx.setLineDash([]);
      continue;
    }
    ctx.fillStyle = 'rgba(255,60,90,0.12)'; ctx.fillRect(x, y, 1, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const yy = y + 0.22 + k * 0.28, a = 0.55 + 0.35 * Math.sin(t * 9 + k * 2 + x);
      ctx.strokeStyle = 'rgba(255,70,100,' + a + ')'; ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 1, yy); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,210,' + (a * 0.8) + ')'; ctx.lineWidth = 0.015;
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 1, yy); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#5a2030';
    ctx.fillRect(x, y + 0.05, 0.08, 0.9); ctx.fillRect(x + 0.92, y + 0.05, 0.08, 0.9);
  }
  const PC = [RGB.violet, RGB.orange, RGB.green, RGB.pink];
  for (const P of S.portals) {
    const c = PC[(P.tag - 1) % PC.length];
    ctx.globalCompositeOperation = 'lighter';
    blit(SPR.glow[c === RGB.violet ? 'violet' : c === RGB.orange ? 'orange' : c === RGB.green ? 'green' : 'pink'], P.x, P.y, 1.5, 0.55);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05040f'; ctx.beginPath(); ctx.arc(P.x, P.y, 0.3, 0, TAU); ctx.fill();
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = rgba(c, 0.9 - k * 0.2); ctx.lineWidth = 0.05 - k * 0.01;
      const a0 = t * (2.2 + k * 0.7) * (k % 2 ? -1 : 1) + k * 2;
      ctx.beginPath(); ctx.arc(P.x, P.y, 0.34 - k * 0.08, a0, a0 + 4); ctx.stroke();
    }
    ctx.fillStyle = rgba(c, 0.9); ctx.font = '700 0.2px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(P.tag), P.x, P.y + 0.01);
  }
}

function drawPegs(st, t) {
  const S = st.S;
  for (let p = 0; p < S.nPegs; p++) {
    if (!st.pegAlive[p]) continue;
    const x = S.pegX[p], y = S.pegY[p], kind = S.pegKind[p];
    if (kind === E.P_BUMPER) {
      const f = G.bumperFlash[p] || 0;
      ctx.globalCompositeOperation = 'lighter';
      blit(SPR.glow.pink, x, y, 1.4 + f, 0.35 + 0.5 * f + 0.1 * Math.sin(t * 5 + p));
      ctx.globalCompositeOperation = 'source-over';
      blit(SPR.bumper, x, y, 1 + 0.25 * f);
      continue;
    }
    const lit = st.pegLit[p];
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      blit(SPR.glow[kind === E.P_GOLD ? 'gold' : kind === E.P_GREEN ? 'green' : 'blue'], x, y, 0.95 + 0.12 * Math.sin(t * 12 + p), 0.9);
      ctx.globalCompositeOperation = 'source-over';
    } else if (kind === E.P_GOLD || kind === E.P_GREEN) {
      ctx.globalCompositeOperation = 'lighter';
      blit(SPR.glow[kind === E.P_GOLD ? 'gold' : 'green'], x, y, 0.75, 0.25 + 0.15 * Math.sin(t * 3 + p));
      ctx.globalCompositeOperation = 'source-over';
    }
    blit(SPR.peg[kind][lit], x, y);
  }
  for (const pp of G.pops) {
    if (pp.t < 0) { blit(SPR.peg[pp.kind][1], pp.x, pp.y); continue; }
    const f = pp.t / 0.3;
    ctx.globalCompositeOperation = 'lighter';
    blit(SPR.glow[pp.kind === E.P_GOLD ? 'gold' : pp.kind === E.P_GREEN ? 'green' : 'blue'], pp.x, pp.y, 1 + f, 1 - f);
    ctx.globalCompositeOperation = 'source-over';
    blit(SPR.peg[pp.kind][1], pp.x, pp.y, 1 + f * 0.8, 1 - f);
  }
}

function crateDrawPos(c) {
  const iceFrom = G.st.S.floor[c.py * W + c.px] === E.F_ICE;
  const dur = iceFrom ? E.SLIDE_DT : 0.1;
  const f = clamp(c.mT / dur, 0, 1);
  const e = iceFrom ? f : easeOut(f);
  return [lerp(c.px, c.x, e), lerp(c.py, c.y, e)];
}

function drawCrates(st, t) {
  st.crates.forEach((c, k) => {
    const [x, y] = crateDrawPos(c);
    const cx = x + 0.5, cy = y + 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    rrect(ctx, x + 0.06, y + 0.1, 0.94, 0.94, 0.08); ctx.fill();
    if (c.locked) {
      ctx.globalCompositeOperation = 'lighter';
      blit(SPR.glow.cyan, cx, cy, 1.9, 0.45 + 0.12 * Math.sin(t * 2.5 + k));
      ctx.globalCompositeOperation = 'source-over';
    }
    const f = G.crateFlash[k] || 0;
    blit(c.heavy ? SPR.iron : SPR.crate, cx, cy, 1 + f * 0.06);
    if (f > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (f * 0.5) + ')'; rrect(ctx, x + 0.03, y + 0.03, 0.94, 0.94, 0.07); ctx.fill(); }
    if (c.locked) {
      ctx.strokeStyle = rgba(RGB.cyan, 0.9); ctx.lineWidth = 0.06;
      rrect(ctx, x + 0.04, y + 0.04, 0.92, 0.92, 0.08); ctx.stroke();
      ctx.fillStyle = '#0a2a34'; ctx.beginPath(); ctx.arc(x + 0.82, y + 0.18, 0.13, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(RGB.cyan, 1); ctx.font = '700 0.17px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✓', x + 0.82, y + 0.19);
    }
  });
  if (G.phase === 'aim') for (const k of G.dead) {
    const c = st.crates[k], a = 0.55 + 0.35 * Math.sin(t * 5);
    ctx.strokeStyle = 'rgba(255,80,100,' + a + ')'; ctx.lineWidth = 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(c.x + 0.25, c.y + 0.25); ctx.lineTo(c.x + 0.75, c.y + 0.75);
    ctx.moveTo(c.x + 0.75, c.y + 0.25); ctx.lineTo(c.x + 0.25, c.y + 0.75); ctx.stroke();
  }
}

function lensContacts() { return 1 + save.up.lens; }
function getPreview() {
  const sig = G.stateVer + '|' + G.aim + '|' + G.power + '|' + save.up.lens;
  if (sig !== G.previewSig) {
    G.previewSig = sig;
    G.preview = E.predict(G.st, G.aim, { contacts: lensContacts(), power: G.power });
  }
  return G.preview;
}

function drawGuide(st, t) {
  const pv = getPreview();
  const hintOn = G.hintT > 0;
  pv.paths.forEach((pts, k) => {
    const cut = pv.cuts[k] < 0 ? pts.length : pv.cuts[k];
    let acc = 0.15, dist = 0;
    const step = 0.26;
    for (let i = 2; i < pts.length; i += 2) {
      const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      const tail = i >= cut;
      while (acc <= seg) {
        const f = acc / seg, x = lerp(x0, x1, f), y = lerp(y0, y1, f);
        const a = tail ? 0.3 : clamp(1 - dist * 0.012, 0.35, 1);
        const r = tail ? 0.035 : 0.05 + 0.012 * Math.sin(t * 8 - (dist + acc) * 3);
        ctx.fillStyle = hintOn ? 'rgba(255,220,90,' + a + ')' : 'rgba(255,255,255,' + a + ')';
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        acc += step;
      }
      acc -= seg; dist += seg;
    }
  });
  for (const h of pv.hits) {
    if (h.kind === E.K_PEG) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.arc(st.S.pegX[h.ref], st.S.pegY[h.ref], 0.27, 0, TAU); ctx.stroke();
      continue;
    }
    const c = st.crates[h.ref];
    const cx = c.x + 0.5, cy = c.y + 0.5;
    if (h.res === E.R_PUSH) {
      const [tx, ty] = h.to || [c.x + h.dx, c.y + h.dy];
      ctx.strokeStyle = 'rgba(69,232,138,0.85)'; ctx.lineWidth = 0.04; ctx.setLineDash([0.1, 0.07]);
      rrect(ctx, tx + 0.08, ty + 0.08, 0.84, 0.84, 0.08); ctx.stroke(); ctx.setLineDash([]);
      arrow(cx, cy, h.dx, h.dy, '#45e88a', t);
    } else if (h.res === E.R_BLOCKED) {
      badge(cx, cy, '✕', '#ff5a6e');
    } else if (h.res === E.R_WEAK) {
      badge(cx, cy, c.heavy ? 'soft' : '…', '#a0a0c8');
    } else if (h.res === E.R_GLANCE) {
      badge(h.x, h.y, '↯', '#a0a0c8', 0.16);
    }
  }
}
function arrow(x, y, dx, dy, col, t) {
  const b = 0.06 * Math.sin(t * 8);
  ctx.save(); ctx.translate(x + dx * b, y + dy * b); ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,20,10,0.8)'; ctx.lineWidth = 0.04; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0.36, 0); ctx.lineTo(0.06, -0.26); ctx.lineTo(0.06, -0.1); ctx.lineTo(-0.3, -0.1);
  ctx.lineTo(-0.3, 0.1); ctx.lineTo(0.06, 0.1); ctx.lineTo(0.06, 0.26); ctx.closePath();
  ctx.stroke(); ctx.fill();
  ctx.restore();
}
function badge(x, y, txt, col, r) {
  r = r || 0.22;
  ctx.fillStyle = 'rgba(12,10,30,0.85)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 0.035; ctx.stroke();
  ctx.fillStyle = col; ctx.font = '700 ' + (r * (txt.length > 1 ? 0.8 : 1.3)).toFixed(3) + 'px Fredoka, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y + 0.01);
}

function drawBalls() {
  const sim = G.sim;
  const pw = sim ? sim.power : null;
  const col = pw === 'heavy' ? RGB.orange : pw === 'ghost' ? RGB.ice : pw === 'split' ? RGB.pink : [170, 190, 255];
  ctx.globalCompositeOperation = 'lighter';
  for (const tr of G.trails) {
    const n = tr.length / 2;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      ctx.fillStyle = rgba(col, 0.28 * f);
      ctx.beginPath(); ctx.arc(tr[2 * i], tr[2 * i + 1], E.BALL_R * (0.35 + 0.65 * f), 0, TAU); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  if (!sim) return;
  for (const b of sim.balls) {
    if (!b.alive) continue;
    ctx.globalCompositeOperation = 'lighter';
    blit(SPR.glow[pw === 'heavy' ? 'orange' : pw === 'ghost' ? 'ice' : pw === 'split' ? 'pink' : 'white'], b.x, b.y, 0.9, 0.45);
    ctx.globalCompositeOperation = 'source-over';
    blit(pw === 'heavy' ? SPR.heavy : pw === 'ghost' ? SPR.ghost : SPR.ball, b.x, b.y);
  }
}

function drawBucket(t) {
  const y = H + 0.36;
  if (G.phase === 'won' || (G.sim && G.sim.won)) {
    const vals = E.FEVER;
    for (let k = 0; k < 5; k++) {
      const x0 = k * W / 5, w = W / 5;
      const hue = [RGB.violet, RGB.cyan, RGB.gold, RGB.cyan, RGB.violet][k];
      const a = 0.35 + 0.25 * Math.sin(t * 6 + k);
      ctx.fillStyle = rgba(hue, a); ctx.fillRect(x0 + 0.05, H + 0.05, w - 0.1, 0.62);
      ctx.fillStyle = '#fff'; ctx.font = '700 ' + (k === 2 ? 0.3 : 0.24) + 'px Fredoka, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(vals[k] >= 1000 ? vals[k] / 1000 + 'k' : String(vals[k]), x0 + w / 2, H + 0.37);
    }
    return;
  }
  if (G.mode !== 'play') return;
  const half = 0.72 + 0.3 * save.up.catcher;
  const x = G.sim && G.sim.bucket ? E.bucketX(G.sim.bucket, G.sim.t) : E.bucketX({ phase: G.bucketPhase, speed: 1.1, half }, 0);
  ctx.globalCompositeOperation = 'lighter';
  blit(SPR.glow.cyan, x, y, half * 2.2, 0.35);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(62,240,255,0.16)';
  ctx.beginPath(); ctx.moveTo(x - half, y - 0.26); ctx.lineTo(x + half, y - 0.26); ctx.lineTo(x + half - 0.12, y + 0.26); ctx.lineTo(x - half + 0.12, y + 0.26); ctx.fill();
  ctx.strokeStyle = rgba(RGB.cyan, 0.9); ctx.lineWidth = 0.05; ctx.stroke();
  ctx.fillStyle = rgba(RGB.cyan, 0.9); ctx.font = '600 0.2px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('+1', x, y + 0.02);
}

function drawRobot(t) {
  const R = G.robot, x = E.LAUNCH_X, y = E.LAUNCH_Y;
  const a = G.aim * Math.PI / 1800;
  const dx = Math.sin(a), dy = Math.cos(a);
  const armed = G.power || (G.sim && G.sim.power);
  // cannon
  ctx.save(); ctx.translate(x, y); ctx.rotate(-a);
  const len = 0.56 - R.recoil * 0.14;
  const bgr = ctx.createLinearGradient(-0.13, 0, 0.13, 0);
  bgr.addColorStop(0, '#5a6090'); bgr.addColorStop(0.5, '#c8d0ff'); bgr.addColorStop(1, '#4a5080');
  ctx.fillStyle = bgr; rrect(ctx, -0.12, 0.05, 0.24, len, 0.05); ctx.fill();
  ctx.fillStyle = armed ? POWERS[armed].color : '#ffc233';
  rrect(ctx, -0.145, len - 0.02, 0.29, 0.1, 0.04); ctx.fill();
  ctx.restore();
  // head
  const hy = y - 0.36, bob = Math.sin(t * 2) * 0.02;
  ctx.fillStyle = '#b8bee0'; ctx.fillRect(x - 0.03, CEIL - 0.1, 0.06, hy - CEIL - 0.2);
  ctx.save(); ctx.translate(x, hy + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; rrect(ctx, -0.6, -0.34, 1.2, 0.8, 0.26); ctx.fill();
  const hg = ctx.createLinearGradient(0, -0.4, 0, 0.4);
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(1, '#b9c1e6');
  ctx.fillStyle = hg; rrect(ctx, -0.6, -0.4, 1.2, 0.78, 0.26); ctx.fill();
  ctx.strokeStyle = '#7d86b8'; ctx.lineWidth = 0.04; ctx.stroke();
  // arm stubs with plasters
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#9aa2cc'; rrect(ctx, s * 0.6 - (s > 0 ? 0 : 0.16), -0.06, 0.16, 0.2, 0.06); ctx.fill();
    ctx.fillStyle = '#ffd9a0'; ctx.fillRect(s * 0.68 - 0.05, -0.02, 0.1, 0.05);
  }
  // antenna
  ctx.strokeStyle = '#7d86b8'; ctx.lineWidth = 0.035;
  ctx.beginPath(); ctx.moveTo(0.28, -0.4); ctx.lineTo(0.36, -0.58); ctx.stroke();
  const light = armed ? RGB[armed === 'heavy' ? 'orange' : armed === 'ghost' ? 'ice' : 'pink'] : G.sim ? RGB.gold : RGB.green;
  ctx.globalCompositeOperation = 'lighter';
  blit(SPR.glow[armed === 'heavy' ? 'orange' : armed === 'ghost' ? 'ice' : armed ? 'pink' : G.sim ? 'gold' : 'green'], 0.36, -0.6, 0.5, 0.6 + 0.3 * Math.sin(t * 6));
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = rgba(light, 1); ctx.beginPath(); ctx.arc(0.36, -0.6, 0.055, 0, TAU); ctx.fill();
  // face screen
  ctx.fillStyle = '#1c1f44'; rrect(ctx, -0.44, -0.27, 0.88, 0.5, 0.16); ctx.fill();
  const ex = dx * 0.06, ey = (dy - 0.6) * 0.05;
  ctx.fillStyle = '#7af4ff';
  if (R.mood === 1 || R.mood === 2) {
    ctx.strokeStyle = '#7af4ff'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.19, -0.02, 0.08, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
  } else if (R.blink < 0) {
    ctx.fillRect(-0.28, -0.03, 0.16, 0.03); ctx.fillRect(0.12, -0.03, 0.16, 0.03);
  } else {
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(s * 0.19 + ex, -0.03 + ey, 0.075, 0.1, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 0.19 + ex - 0.02, -0.07 + ey, 0.025, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7af4ff';
    }
  }
  ctx.strokeStyle = '#7af4ff'; ctx.lineWidth = 0.035; ctx.lineCap = 'round';
  ctx.beginPath();
  if (R.mood === 2) { ctx.arc(0, 0.08, 0.1, 0.1, Math.PI - 0.1); ctx.fillStyle = '#7af4ff'; ctx.fill(); }
  else if (R.recoil > 0.3) ctx.arc(0, 0.12, 0.045, 0, TAU);
  else if (R.mood === 1) ctx.arc(0, 0.07, 0.08, 0.2, Math.PI - 0.2);
  else { ctx.moveTo(-0.06, 0.12); ctx.lineTo(0.06, 0.12); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,170,0.35)';
  ctx.beginPath(); ctx.arc(-0.34, 0.1, 0.06, 0, TAU); ctx.arc(0.34, 0.1, 0.06, 0, TAU); ctx.fill();
  ctx.restore();
}

// ═══ HUD ═════════════════════════════════════════════════════════════════════
function hud() {
  if (!G.st) return;
  const st = G.st;
  $('mCount').textContent = st.marbles;
  const total = st.S.pads.length, filled = total - openPads(st);
  $('pads').textContent = '◆ ' + filled + '/' + total;
  $('score').textContent = st.score.toLocaleString();
  const have = st.charges.heavy + st.charges.ghost + st.charges.split;
  $('powerCount').textContent = have ? String(have) : '';
  $('power').classList.toggle('armed', !!G.power);
  $('power').disabled = (!have && !G.power) || !!G.sim;
  $('powerName').textContent = G.power ? POWERS[G.power].name : 'Power';
  $('power').firstChild.nodeValue = G.power ? POWERS[G.power].icon : '⚡';
  $('undo').disabled = !G.undo.length || !!G.sim;
  $('fire').disabled = !!G.sim || st.marbles <= 0 || st.won;
  if (!G.undo.length) $('undo').classList.remove('nudge');
  hudAngle();
}
function hudAngle() { $('angle').textContent = fmtAngle(G.aim); }

let toastTimer = 0;
function toast(msg, warn) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('warn', !!warn);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), warn ? 4200 : 2600);
}

// ═══ Input ═══════════════════════════════════════════════════════════════════
function worldFromClient(cx, cy) {
  const r = cv.getBoundingClientRect();
  return [(cx - r.left - OX) / U, (cy - r.top - OY) / U];
}
function aimAt(cx, cy) {
  const [x, y] = worldFromClient(cx, cy);
  const dx = x - E.LAUNCH_X, dy = Math.max(0.05, y - E.LAUNCH_Y);
  setAim(Math.atan2(dx, dy) * 1800 / Math.PI);
}
let ptr = null;
cv.addEventListener('pointerdown', e => {
  Sound.unlock();
  if (!playing() || G.sim) return;
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aim0: G.aim, moved: false, mouse: e.pointerType === 'mouse' };
  if (ptr.mouse) aimAt(e.clientX, e.clientY);
});
cv.addEventListener('pointermove', e => {
  if (!ptr) { if (e.pointerType === 'mouse' && playing() && !G.sim) aimAt(e.clientX, e.clientY); return; }
  if (e.pointerId !== ptr.id) return;
  const dx = e.clientX - ptr.x0, dy = e.clientY - ptr.y0;
  if (!ptr.moved && Math.hypot(dx, dy) > 7) ptr.moved = true;
  if (!ptr.moved) return;
  if (ptr.mouse) aimAt(e.clientX, e.clientY);
  else setAim(ptr.aim0 + dx * 2.2);   // touch: sideways drag swings the cannon, 0.22° per pixel
});
function pointerEnd(e) {
  if (!ptr || e.pointerId !== ptr.id) return;
  const p = ptr;
  ptr = null;
  if (p.moved || e.type === 'pointercancel') return;
  aimAt(e.clientX, e.clientY);
  if (p.mouse) fire();
}
cv.addEventListener('pointerup', pointerEnd);
cv.addEventListener('pointercancel', pointerEnd);
cv.addEventListener('wheel', e => { if (playing()) { e.preventDefault(); setAim(G.aim + (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 10 : 1)); } }, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());

function holdRepeat(el, fn) {
  let timer = 0, n = 0;
  const stop = () => { clearTimeout(timer); timer = 0; };
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); Sound.unlock();
    n = 0; fn(1);
    const loop = () => { n++; fn(n > 25 ? 10 : n > 10 ? 3 : 1); timer = setTimeout(loop, 55); };
    timer = setTimeout(loop, 320);
  });
  el.addEventListener('pointerup', stop); el.addEventListener('pointerleave', stop); el.addEventListener('pointercancel', stop);
}
holdRepeat($('left'), s => { if (playing()) setAim(G.aim - s); });
holdRepeat($('right'), s => { if (playing()) setAim(G.aim + s); });
$('fire').addEventListener('click', () => fire());
$('undo').addEventListener('click', () => undo());
$('power').addEventListener('click', () => { if (playing()) selectPower(); });
$('menuBtn').addEventListener('click', () => { if (G.mode === 'play') openPause(); });

document.addEventListener('keydown', e => {
  if (e.repeat && !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  if (e.key === 'Escape') {
    if (!$('pause').hidden) closePause(); else if (G.mode === 'play' && !anyScreen()) openPause();
    return;
  }
  if (!playing()) return;
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a') setAim(G.aim - (e.shiftKey ? 10 : 1));
  else if (k === 'ArrowRight' || k === 'd') setAim(G.aim + (e.shiftKey ? 10 : 1));
  else if (k === ' ' || k === 'Enter') { e.preventDefault(); fire(); }
  else if (k === 'z' || k === 'u' || k === 'Backspace') undo();
  else if (k === 'r') restartLevel();
  else if (k === 'h') hint();
  else if (k === 'p' || k === 'q') selectPower();
});

// ═══ Screens ═════════════════════════════════════════════════════════════════
const SCREENS = ['title', 'story', 'levels', 'intro', 'result', 'shop', 'pause', 'help'];
function anyScreen() { return SCREENS.some(s => !$(s).hidden); }
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; }
function hideAll() { for (const s of SCREENS) $(s).hidden = true; }
function soundLabel() { const on = Sound.on; $('soundBtn1').textContent = on ? '🔊' : '🔇'; $('soundBtn2').textContent = (on ? '🔊' : '🔇') + ' Sound'; }
function toggleSound() { save.sound = Sound.toggle() ? 1 : 0; persist(); soundLabel(); Sound.click(); }
$('soundBtn1').onclick = toggleSound;
$('soundBtn2').onclick = toggleSound;
document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });

// ── Title (with the attract-mode board behind it) ─────────────────────────────
function showTitle() {
  startAttract();
  show('title');
  $('playBtn').textContent = save.unlocked > 1 || save.best[0] ? 'Continue' : 'Play';
}
$('playBtn').onclick = () => { Sound.click(); if (!save.story) showStory(STORY, () => { save.story = 1; persist(); showLevels(); }); else showLevels(); };
$('storyBtn').onclick = () => { Sound.click(); showStory(STORY, showTitle); };
$('storyBtn2').onclick = () => { Sound.click(); showStory(STORY, showLevels); };
$('shopBtn1').onclick = () => { Sound.click(); showShop(showTitle); };
$('shopBtn2').onclick = () => { Sound.click(); showShop(showLevels); };

// ── Story ───────────────────────────────────────────────────────────────────
const STORY = [
  ['🏭', 'Warehouse No. 8 clings to the slopes of Mount Kura. For forty years one little robot kept it spotless: <em>Soko</em>, the warehouse keeper. Every crate on its mark.'],
  ['🌋', 'Then, last night: <em>the Great Quake</em>. The whole warehouse tipped like a pachinko table. Pegs burst up through the floorboards and crates skidded everywhere.'],
  ['🦾💥', 'Worse, Soko\'s pushing arms snapped clean off and rolled away down the slope.'],
  ['🤖🎯', 'But Soko still has the marble cannon from staff pachinko night. And marbles roll downhill. <em>A marble that hits a crate shoves it one tile.</em>'],
  ['🌅', 'The Inspector arrives at dawn. Every crate back on its mark, or Warehouse No. 8 closes forever. Time to start shoving.'],
];
const ENDING = [
  ['🌅🧐', 'Dawn. The Inspector steps inside, clipboard raised, and walks every aisle in silence.'],
  ['✅', '"Every crate on its mark. The pegs are... unusual. But the marks are <em>impeccable</em>. Warehouse No. 8 stays open!"'],
  ['👵🤖', 'Granny Pachi hugs Soko so hard a bolt pops out. "We\'ll get you new arms." Soko thinks about it. "Keep the arms. I like the marbles."'],
  ['🦝', 'And under the floorboards, a tanuki is already drawing up plans for the next quake. <em>Thanks for playing Pegoban!</em>'],
];
let storyPages = [], storyIdx = 0, storyDone = null;
function showStory(pages, done) {
  storyPages = pages; storyIdx = 0; storyDone = done;
  if (G.mode !== 'play') startAttract();
  renderStory(); show('story');
}
function renderStory() {
  const [art, text] = storyPages[storyIdx];
  $('storyArt').textContent = art;
  $('storyText').innerHTML = text;
  $('storyPips').innerHTML = storyPages.map((_, i) => '<i class="' + (i === storyIdx ? 'on' : '') + '"></i>').join('');
  $('storyNext').textContent = storyIdx === storyPages.length - 1 ? 'Let\'s go!' : 'Next';
}
$('storyNext').onclick = () => { Sound.click(); if (++storyIdx >= storyPages.length) storyDone(); else renderStory(); };
$('storySkip').onclick = () => { Sound.click(); storyDone(); };

// ── Level select ────────────────────────────────────────────────────────────
function showLevels() {
  if (G.mode !== 'attract') startAttract();
  const grid = $('levelGrid');
  grid.innerHTML = '';
  LEVELS.forEach((def, i) => {
    const b = document.createElement('button');
    const locked = i >= save.unlocked, best = save.best[i];
    b.className = 'lv' + (locked ? ' locked' : '') + (!locked && !best ? ' next' : '');
    b.disabled = locked;
    const stars = best ? best.stars : 0;
    b.innerHTML = '<span class="n">' + (locked ? '🔒' : i + 1) + '</span><span class="nm">' + def.name + '</span>' +
      '<span class="st">' + [0, 1, 2].map(k => '<span class="' + (k < stars ? 'on' : '') + '">★</span>').join('') + '</span>';
    b.onclick = () => { Sound.click(); showIntro(i); };
    grid.appendChild(b);
  });
  $('boltsChip').textContent = '⚙ ' + save.bolts;
  show('levels');
}
$('levelsBack').onclick = () => { Sound.click(); showTitle(); };

// ── Level intro dialogue ──────────────────────────────────────────────────────
let introLines = [], introIdx = 0;
function showIntro(i) {
  startLevel(i);
  const def = LEVELS[i];
  introLines = def.intro || [];
  introIdx = save.best[i] ? Math.max(0, introLines.length - 1) : 0;   // replays skip to the tip
  $('introNum').textContent = 'LEVEL ' + (i + 1) + ' OF ' + LEVELS.length;
  $('introName').textContent = def.name;
  if (!introLines.length) { hideAll(); return; }
  renderIntro();
  show('intro');
}
function renderIntro() {
  const [who, text] = introLines[introIdx];
  const c = CAST[who] || CAST.soko;
  $('introWho').textContent = c[0];
  $('introName2').textContent = c[1];
  $('introText').textContent = text;
  const last = introIdx === introLines.length - 1;
  $('introTip').textContent = last && LEVELS[G.li].tip ? '💡 ' + LEVELS[G.li].tip : '';
  $('introPips').innerHTML = introLines.length > 1 ? introLines.map((_, i) => '<i class="' + (i === introIdx ? 'on' : '') + '"></i>').join('') : '';
  $('introNext').textContent = last ? 'Start shoving!' : 'Next';
}
$('introNext').onclick = () => {
  Sound.click();
  if (++introIdx >= introLines.length) {
    hideAll();
    levelStartFX();
    if (G.li === 0 && !save.best[0]) setTimeout(() => toast('Drag to aim · FIRE to launch'), 700);
  }
  else renderIntro();
};

// ── Results ─────────────────────────────────────────────────────────────────
function showWin() {
  const st = G.st, def = G.def, i = G.li;
  const shots = st.shots, par = def.par;
  const stars = shots <= par ? 3 : shots <= par + 2 ? 2 : 1;
  const bonus = st.marbles * 1000;
  const total = st.score + bonus;
  const prev = save.best[i] || { stars: 0, golds: 0, score: 0 };
  const bolts = 2 * Math.max(0, stars - prev.stars) + Math.max(0, st.golds - prev.golds);
  save.best[i] = { stars: Math.max(stars, prev.stars), golds: Math.max(st.golds, prev.golds), score: Math.max(total, prev.score) };
  save.bolts += bolts;
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, i + 2));
  const last = i === LEVELS.length - 1;
  persist();
  $('resTitle').textContent = ['Sorted!', 'Nicely sorted!', 'Perfectly sorted!'][stars - 1];
  $('resSub').textContent = def.name + ' · ' + shots + ' shot' + (shots === 1 ? '' : 's') + ' (par ' + par + ')';
  const starsEl = $('resStars').children;
  for (let k = 0; k < 3; k++) {
    starsEl[k].className = '';
    if (k < stars) setTimeout(() => { starsEl[k].className = 'on'; Sound.peg(3 + k * 3, E.P_GOLD); }, 350 + k * 280);
  }
  $('resStats').innerHTML =
    row('Score', st.score.toLocaleString()) +
    row('Unused marbles × 1,000', '+' + bonus.toLocaleString()) +
    row('Total', total.toLocaleString(), true) +
    row('Gold pegs', st.golds + ' / ' + st.S.goldTotal) +
    row('Bolts earned', bolts ? '⚙ +' + bolts : '—', !!bolts);
  const btns = $('resBtns');
  btns.innerHTML = '';
  btns.appendChild(button(last ? 'Finale ▶' : 'Next level ▶', 'btn primary', () => {
    if (last) { save.ending = 1; persist(); showStory(ENDING, showLevels); } else showIntro(i + 1);
  }));
  const r = document.createElement('div'); r.className = 'row';
  r.appendChild(button('↻ Replay', 'btn small', () => showIntro(i)));
  r.appendChild(button('🔧 Workshop', 'btn small', () => showShop(() => show('result'))));
  r.appendChild(button('☰ Levels', 'btn small', showLevels));
  btns.appendChild(r);
  show('result');
}
function showFail() {
  Sound.fail();
  $('resTitle').textContent = 'Out of marbles';
  $('resSub').textContent = openPads(G.st) + ' crate' + (openPads(G.st) === 1 ? '' : 's') + ' still off the mark. Undo is free, so rewind and try another line!';
  for (const s of $('resStars').children) s.className = '';
  $('resStats').innerHTML = '';
  const btns = $('resBtns');
  btns.innerHTML = '';
  btns.appendChild(button('↶ Undo last shot', 'btn primary', () => { hideAll(); undo(); }));
  const r = document.createElement('div'); r.className = 'row';
  r.appendChild(button('↻ Restart', 'btn small', () => { hideAll(); restartLevel(); }));
  r.appendChild(button('💡 Hint', 'btn small', () => { hideAll(); hint(); }));
  r.appendChild(button('☰ Levels', 'btn small', showLevels));
  btns.appendChild(r);
  show('result');
}
function row(a, b, hl) { return '<div' + (hl ? ' class="hl"' : '') + '><span>' + a + '</span><span>' + b + '</span></div>'; }
function button(label, cls, fn) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = label;
  b.onclick = () => { Sound.click(); fn(); };
  return b;
}

// ── Workshop ────────────────────────────────────────────────────────────────
let shopBack = null;
function showShop(back) {
  shopBack = back;
  renderShop();
  show('shop');
}
function renderShop() {
  $('boltsChip2').textContent = '⚙ ' + save.bolts;
  const list = $('shopList');
  list.innerHTML = '';
  for (const up of UPGRADES) {
    const tier = save.up[up.id], max = up.costs.length, cost = up.costs[tier];
    const el = document.createElement('div');
    el.className = 'up';
    el.innerHTML = '<div class="ic">' + up.icon + '</div><div class="tx"><b>' + up.name + '</b><p>' + up.desc(tier) + '</p>' +
      '<div class="tiers">' + up.costs.map((_, k) => '<i class="' + (k < tier ? 'on' : '') + '"></i>').join('') + '</div></div>';
    const b = document.createElement('button');
    b.className = 'buy';
    b.textContent = tier >= max ? 'MAX' : '⚙ ' + cost;
    b.disabled = tier >= max || save.bolts < cost;
    b.onclick = () => {
      if (save.bolts < cost || tier >= max) return;
      save.bolts -= cost; save.up[up.id]++; persist();
      Sound.buy(); renderShop();
      if (G.mode === 'play' && G.st) G.stateVer++;
    };
    el.appendChild(b);
    list.appendChild(el);
  }
}
$('shopBack').onclick = () => { Sound.click(); shopBack(); };

// ── Pause ───────────────────────────────────────────────────────────────────
function openPause() { Sound.click(); soundLabel(); show('pause'); }
function closePause() { hideAll(); }
$('resumeBtn').onclick = () => { Sound.click(); closePause(); };
$('hintBtn').onclick = () => { Sound.click(); closePause(); if (G.sim) return; hint(); };
$('restartBtn').onclick = () => { Sound.click(); closePause(); restartLevel(); };
$('levelsBtn').onclick = () => { Sound.click(); showLevels(); };
$('helpBtn').onclick = () => { Sound.click(); show('help'); };
$('helpClose').onclick = () => { Sound.click(); if (G.mode === 'play') show('pause'); else hideAll(); };

// ═══ Attract mode: Soko idly plinking pegs behind the title ════════════════════
const ATTRACT = (() => {
  const pegs = [];
  const ring = (cx, cy, r, n, kind) => { for (let k = 0; k < n; k++) { const a = k / n * TAU; pegs.push([cx + r * Math.cos(a), cy + r * Math.sin(a), kind]); } };
  ring(2.2, 4.2, 1.1, 8, 'o'); ring(6.8, 4.2, 1.1, 8, 'o');
  pegs.push([2.2, 4.2, 'O'], [6.8, 4.2, '+']);
  for (let k = 0; k < 7; k++) pegs.push([1.5 + k, 7.4 + (k % 2) * 0.5, k === 3 ? 'O' : 'o']);
  pegs.push([4.5, 5.2, 'B']);
  return {
    name: 'attract', marbles: 9999,
    map: ['.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........',
          '..◥...◤..', '.*.....*.', '.........', '◢...*...◣', '###...###'],
    pegs,
  };
})();
function startAttract() {
  if (G.mode === 'attract') return;
  G.mode = 'attract';
  document.body.classList.add('attract');
  G.def = ATTRACT;
  G.st = E.parseLevel(ATTRACT);
  G.sim = null; G.undo = []; G.pops = []; G.trails = []; G.dead = [];
  G.phase = 'aim'; G.slow = null; G.zoom = 1; G.attractT = 1.2;
  G.stateVer++;
  staticDirty = true;
}
function attractUpdate(dt) {
  if (G.sim) return;
  G.attractT -= dt;
  const target = Math.sin(G.time * 0.7) * 600 + Math.sin(G.time * 1.9) * 150;
  G.aim = Math.round(lerp(G.aim, target, 1 - Math.exp(-dt * 3)));
  if (G.attractT <= 0) {
    G.st.marbles = 9999;
    G.sim = E.fire(G.st, G.aim, {});
    G.trails = G.sim.balls.map(() => []);
    G.robot.recoil = 1;
    G.phase = 'flight';
  }
}
function attractEndShot() {
  const sim = G.sim;
  G.sim = null;
  E.finishShot(G.st, sim);
  const S = G.st.S;
  G.pops = sim.lit.map((p, i) => ({ p, x: S.pegX[p], y: S.pegY[p], kind: S.pegKind[p], t: -i * 0.045, i }));
  let alive = 0;
  for (let p = 0; p < S.nPegs; p++) if (G.st.pegAlive[p] && S.pegKind[p] <= E.P_GREEN) alive++;
  if (alive < 8) { G.st.pegAlive.fill(1); for (let p = 0; p < S.nPegs; p++) ring(S.pegX[p], S.pegY[p], 0, 0.5, RGB.blue, 0.4, 0.04); }
  G.phase = 'aim';
  G.attractT = rand(0.8, 1.6);
}

// ═══ Boot ════════════════════════════════════════════════════════════════════
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();
soundLabel();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { staticDirty = true; buildSprites(); });
showTitle();
requestAnimationFrame(frame);

// For tools/playtest.js: drive the real page without touching its internals.
window.Pegoban = { G, E, LEVELS, save, startLevel, fire, undo, hint, setAim, showIntro, showLevels, hideAll, persist };
})();
