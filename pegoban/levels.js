/* Pegoban levels. Map legend (9 x 14, row 0 is where Soko sits):
 *   .  floor            #  wall             ◢ ◣ ◤ ◥  ramps (the solid half)
 *   C  crate            H  iron crate        P  pad (crates lock here)   *  crate already on a pad
 *   ~  ice              c h  crate / iron crate on ice
 *   S  switch plate     G  gate (open while every switch holds a crate)
 *   1-9 portal pairs    o blue peg   O gold peg   + green peg   x steel peg   B bumper
 * `pegs` adds pegs off the grid centres: [x, y, kind] with kind one of o O + x B.
 * `solution` is a list of aim angles (tenths of a degree) proven by tools/solve.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PegobanLevels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function arc(cx, cy, r, a0, a1, n, kind) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (a0 + (a1 - a0) * (n === 1 ? 0.5 : k / (n - 1))) * Math.PI / 180;
    out.push([+(cx + r * Math.cos(a)).toFixed(3), +(cy + r * Math.sin(a)).toFixed(3), kind]);
  }
  return out;
}
function ring(cx, cy, r, n, kind) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    out.push([+(cx + r * Math.cos(a)).toFixed(3), +(cy + r * Math.sin(a)).toFixed(3), kind]);
  }
  return out;
}
return [
  {
    name: 'Night Shift',
    marbles: 7, par: 3,
    intro: [
      ['granny', 'Soko! The Inspector arrives at dawn and my crates are all over the floor!'],
      ['soko', 'No arms, no problem. A marble that hits a crate shoves it one tile, away from the hit.'],
    ],
    tip: 'Drag across the board to swing the cannon; ◀ ▶ nudge it. The dotted guide shows the marble\'s path and a green arrow shows where a crate will go. Then FIRE!',
    map: [
      '.........',
      '.........',
      '.........',
      '....C....',
      '....P....',
      '.........',
      'PC.....CP',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ],
    pegs: [].concat(
      arc(4.5, 8.4, 2.6, 20, 160, 9, 'o'),
      [[4.5, 12.2, 'O'], [1.2, 12.4, 'o'], [7.8, 12.4, 'o'], [0.7, 1.4, 'o'], [8.3, 1.4, 'o']]),
    solution: [94, -274, 273],
  },
  {
    name: 'Chute Drop',
    marbles: 8, par: 4,
    intro: [
      ['granny', 'The quake bent the shelving into chutes. Drop a marble down one and it shoots out sideways.'],
      ['soko', 'Sideways into the crates, toward the middle, where the marks are. Got it.'],
    ],
    tip: 'The guide flies straight past walls and chutes, so you can see the whole trick shot before you take it.',
    map: [
      '.........',
      '.........',
      '.........',
      '.........',
      '.#.....#.',
      '◣C.P.P.C◢',
      '.#######.',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ],
    pegs: [].concat(
      arc(4.5, 7.4, 2.9, 25, 155, 9, 'o'),
      ring(4.5, 12.0, 0.7, 6, 'o'), [[4.5, 12.0, 'O']],
      [[3.5, 2.2, 'o'], [5.5, 2.2, 'o'], [4.5, 3.0, 'o']]),
    solution: [-651, -356, 112, 114],
  },
  {
    name: 'Peg Orchard',
    marbles: 8, par: 4,
    power: 'ghost',
    intro: [
      ['soko', 'Pegs everywhere! They light up when hit and pop once the shot is over.'],
      ['granny', 'Mind the gold ones, dear. Gold pegs pay bolts, and bolts buy upgrades in the workshop.'],
      ['soko', 'And a crate shoved onto a peg flattens it. Crunch!'],
    ],
    tip: 'Clear a path first, then shove. The steel pin on the right never pops, so bank off it. Green pegs charge a Ghost marble that sails through pegs.',
    map: [
      '.........',
      '.........',
      '.........',
      '.........',
      '....C....',
      '.........',
      '....P....',
      '......PC.',
      '.........',
      'PC.......',
      '.........',
      '.........',
      '.........',
      '.........',
    ],
    pegs: [].concat(
      ring(1.5, 9.5, 0.95, 8, 'o'),
      [[4.5, 5.5, 'O'], [4.5, 6.5, 'O'], [8.62, 6.35, 'x']],
      arc(4.5, 2.4, 1.7, 200, 340, 5, 'o'),
      ring(6.2, 11.2, 0.75, 7, 'o'), [[6.2, 11.2, '+']],
      [[3.2, 12.3, 'o'], [2.4, 11.7, 'o'], [4.0, 11.7, 'o']]),
    solution: [387, -456, -202, -598],
  },
  {
    name: 'Uphill Battle',
    marbles: 8, par: 4,
    power: 'split',
    intro: [
      ['granny', 'These three belong up on the top shelf. Uphill.'],
      ['soko', 'Crates never go uphill... unless a marble hits them from underneath. Those yellow kickers flip a rolling marble upward!'],
    ],
    tip: 'Chute, floor, kicker, crate. Once a crate is delivered, marbles bounce off it too, so follow the guide and see where they go next.',
    map: [
      '.........',
      '.........',
      '..#.#.#..',
      '.#P#P#P#.',
      '.#.#.#.#.',
      '..C.C.C..',
      '◣.◢...◣.◢',
      '####.####',
      '....B....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ],
    pegs: [].concat(
      arc(4.5, 9.0, 2.6, 30, 150, 7, 'o'),
      [[1.2, 9.2, 'O'], [7.8, 9.2, 'O'], [4.5, 12.4, '+']],
      [[2.0, 12.0, 'o'], [7.0, 12.0, 'o'], [3.2, 12.6, 'o'], [5.8, 12.6, 'o']],
      [[0.6, 1.2, 'o'], [8.4, 1.2, 'o'], [3.5, 1.3, 'o'], [5.5, 1.3, 'o']]),
    solution: [-660, -583, -756, 659, 594],
  },
  {
    name: 'Heavy Metal',
    marbles: 11, par: 6,
    power: 'heavy',
    intro: [
      ['granny', 'The iron crates. They only budge for a marble going flat out.'],
      ['soko', 'Long clean drops are fast. Every peg in the way slows me down.'],
    ],
    tip: 'A soft hit on iron just clangs. Clear the clogged chutes first, or grab the green peg for a Heavy marble that shoves anything.',
    map: [
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '....H....',
      '....P....',
      '◣HP...PH◢',
      '.#######.',
      '.........',
      '.........',
      '.........',
    ],
    pegs: [].concat(
      [[0.3, 6.6, 'o'], [0.72, 7.25, 'o'], [0.3, 7.9, 'o'], [0.72, 8.55, 'o']],
      [[8.7, 6.6, 'o'], [8.28, 7.25, 'o'], [8.7, 7.9, 'o'], [8.28, 8.55, 'o']],
      arc(4.5, 7.5, 1.2, 195, 345, 7, 'o'),
      [[4.5, 3.6, '+'], [2.5, 4.2, 'O'], [6.5, 4.2, 'O']],
      arc(4.5, 10.2, 2.4, 35, 145, 7, 'o')),
    solution: [-600, -139, -438, 156, 139, 431],
  },
  {
    name: 'Cold Storage',
    marbles: 7, par: 3,
    power: 'split',
    intro: [
      ['granny', 'The freezer floor is pure ice. A crate on ice glides until it hits something.'],
      ['soko', 'So the first crate I park becomes the wall that stops the next one...'],
    ],
    tip: 'A gliding crate only locks if it comes to rest on a pad. The dashed box shows exactly where it will stop. Undo is free, so experiment!',
    map: [
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.~~~~~~~.',
      '.~c~~~c~.',
      '.~~~~~~~.',
      '.~~~c~~~.',
      '◣~~PPP~~◢',
      '#########',
      '.........',
      '.........',
      '.........',
    ],
    pegs: [].concat(
      ring(4.5, 2.6, 0.9, 6, 'o'), [[4.5, 2.6, '+']],
      [[1.5, 2.2, 'o'], [7.5, 2.2, 'o'], [2.4, 3.4, 'O'], [6.6, 3.4, 'O']],
      arc(4.5, 10.0, 2.8, 30, 150, 8, 'o')),
    solution: [-803, -141, -790],
  },
  {
    name: 'Wormholes',
    marbles: 8, par: 4,
    power: 'ghost',
    intro: [
      ['soko', 'Granny... since when does the east wing have wormholes?'],
      ['tanuki', 'Since I moved in! Hee hee! A marble dives into one and pops out of its twin: same speed, same direction.'],
      ['soko', 'A tanuki. Of course. That explains the quake.'],
    ],
    tip: 'Portals with the same number are linked. Only marbles fit through, never crates.',
    map: [
      '.........',
      '.........',
      '.........',
      '..1...2..',
      '.........',
      '....3....',
      '#########',
      '#2CP#PC1#',
      '#########',
      '....P....',
      '...#.#...',
      '...#C#...',
      '...#3#...',
      '...###...',
    ],
    pegs: [].concat(
      arc(2.5, 3.5, 1.0, 200, 340, 4, 'o'), arc(6.5, 3.5, 1.0, 200, 340, 4, 'o'),
      [[4.5, 4.1, 'O'], [3.3, 5.3, 'o'], [5.7, 5.3, 'o']],
      [[1.5, 10.0, 'o'], [7.5, 10.0, 'o'], [1.0, 11.2, 'O'], [8.0, 11.2, 'o'], [2.0, 12.4, 'o'], [7.0, 12.4, 'o']]),
    solution: [-33, 0, 0, 305],
  },
  {
    name: 'Laser Locks',
    marbles: 8, par: 4,
    power: 'heavy',
    intro: [
      ['granny', 'The vault lasers stay on unless a crate sits on the red plate.'],
      ['tanuki', 'I may have... rearranged the vault. Just a little. Hee.'],
      ['soko', 'Park the key crate on the plate, empty the vault, deliver the key last.'],
    ],
    tip: 'A crate on the red plate holds the gate open for marbles. Crates themselves can never pass a gate.',
    map: [
      '.........',
      '.........',
      '.........',
      '.C.......',
      '.S.......',
      '.P.......',
      '####G####',
      '#.......#',
      '#..C.C..#',
      '#.P...P.#',
      '#########',
      '#########',
      '#########',
      '#########',
    ],
    // The right-hand bank shots into the laser door need a clear sky, so the pegs stay high.
    pegs: [[4.5, 9.6, 'O'], [0.5, 0.8, 'o'], [1.4, 1.3, 'o'], [8.5, 0.8, 'o'], [7.6, 1.3, 'o'], [4.5, 2.2, '+']],
    solution: [-539, 439, -82, 753, -773],
  },
  {
    name: 'The Inspection',
    marbles: 11, par: 6,
    power: 'heavy',
    intro: [
      ['tanuki', 'Okay, okay: the quake was me too. One last mess and I\'ll behave. Probably.'],
      ['granny', 'Dawn is breaking, Soko. Every trick you\'ve learned. Make it perfect.'],
    ],
    tip: 'Kicker, iron chute and ice lane all at once. On the ice, think about which crate has to stop the other.',
    map: [
      '.........',
      '.........',
      '.........',
      '..#......',
      '.#P#.....',
      '..C...PH◢',
      '◣.◢..###.',
      '####.....',
      '.........',
      '.........',
      '.~~c~~c~.',
      '◣~~~~PP~◢',
      '#########',
      '.........',
    ],
    pegs: [].concat(
      [[8.5, 1.6, 'o'], [8.25, 2.4, 'o'], [8.72, 3.2, 'o'], [8.3, 4.0, 'o']],
      arc(4.5, 8.0, 1.3, 20, 160, 6, 'o'), [[4.5, 8.45, '+']],
      [[4.5, 2.2, 'O'], [0.6, 9.0, 'O'], [2.4, 8.6, 'o'], [6.6, 8.6, 'o']]),
    solution: [507, 513, 303, -483, -365, -724, -741],
  },
];
}));


