// Level definitions
// Each level has 4 scenarios (stages build up: 1, 1+2, 1+2+3, 1+2+3+4)
//
// Legend:
//   # = wall       @ = player     O = box        F = flag (goal)
//   X = trap       K = key        L = locked door
//   r = red btn    g = green btn  b = blue btn
//   R = red barrier G = green barrier B = blue barrier
//   . = floor      (space) = void/empty

export interface LevelData {
  name: string;
  scenarios: string[];
}

export const LEVELS: LevelData[] = [
  {
    name: "First Steps",
    scenarios: [
      // S1: Simple navigation — go right, then down to the flag
      [
        "##########",
        "#@...#...#",
        "#.##.#.#.#",
        "#.##...#.#",
        "#....##..#",
        "#.##.....#",
        "#.##.###.#",
        "#........#",
        "#.######F#",
        "##########",
      ].join("\n"),

      // S2: Push box onto red button to open barrier
      [
        "##########",
        "#@.......#",
        "#.####...#",
        "#........#",
        "#.####.#.#",
        "#....O.#.#",
        "#.##.r.#.#",
        "#.##...R.#",
        "#.##....F#",
        "##########",
      ].join("\n"),

      // S3: Pick up key to open locked door
      [
        "##########",
        "#@.......#",
        "#.####...#",
        "#....K...#",
        "#.####...#",
        "#........#",
        "#.####.#.#",
        "#......L.#",
        "#.......F#",
        "##########",
      ].join("\n"),

      // S4: Navigate around traps
      [
        "##########",
        "#@.......#",
        "#..####..#",
        "#........#",
        "#..#X.#..#",
        "#..#..#..#",
        "#........#",
        "#..X.....#",
        "#.....X.F#",
        "##########",
      ].join("\n"),
    ],
  },
  {
    name: "Getting Serious",
    scenarios: [
      // S1: Two colored buttons and barriers
      [
        "##########",
        "#@.......#",
        "#.##.#.#.#",
        "#..O.#...#",
        "#.##.#.#.#",
        "#..r.#.R.#",
        "#.##.....#",
        "#........#",
        "#.####..F#",
        "##########",
      ].join("\n"),

      // S2: Key chain — two locked doors
      [
        "##########",
        "#@.......#",
        "#.#..##..#",
        "#.#K.....#",
        "#.#..##..#",
        "#....L...#",
        "#.####.#.#",
        "#...K..L.#",
        "#.......F#",
        "##########",
      ].join("\n"),

      // S3: Box + traps — push box over trap to make it safe
      [
        "##########",
        "#@.......#",
        "#.####...#",
        "#........#",
        "#.#..O...#",
        "#.#..X...#",
        "#.#......#",
        "#.#..#...#",
        "#........F",
        "##########",
      ].join("\n"),

      // S4: Multi-color buttons + keys combo
      [
        "##########",
        "#@.......#",
        "#.##.##..#",
        "#..O.....#",
        "#.##.##..#",
        "#..g...G.#",
        "#.##.##K.#",
        "#........#",
        "#....L..F#",
        "##########",
      ].join("\n"),
    ],
  },
];
