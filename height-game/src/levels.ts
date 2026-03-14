export interface Level {
  name: string;
  formula: string; // display formula
  fn: (x: number, y: number, params: number[]) => number;
  targetParams: number[]; // 5 values each in [-1, 1] step 0.1
}

export const levels: Level[] = [
  {
    name: "Ripple Field",
    formula: "z = A·sin(B·x + C·y) + D·cos(E·x·y)",
    fn: (x, y, [A, B, C, D, E]) =>
      A * Math.sin(B * x + C * y) + D * Math.cos(E * x * y),
    targetParams: [0.8, 0.6, -0.4, 0.5, 0.3],
  },
  {
    name: "Twisted Peaks",
    formula: "z = A·(x²+y²) + B·sin(C·x)·cos(D·y) + E·x·y",
    fn: (x, y, [A, B, C, D, E]) =>
      A * (x * x + y * y) + B * Math.sin(C * x) * Math.cos(D * y) + E * x * y,
    targetParams: [-0.3, 0.7, 0.8, -0.5, 0.4],
  },
  {
    name: "Wave Interference",
    formula: "z = A·sin(B·x)·sin(C·y) + D·cos(E·√(x²+y²))",
    fn: (x, y, [A, B, C, D, E]) =>
      A * Math.sin(B * x) * Math.sin(C * y) +
      D * Math.cos(E * Math.sqrt(x * x + y * y)),
    targetParams: [0.6, -0.7, 0.5, 0.8, -0.6],
  },
  {
    name: "Saddle Spiral",
    formula: "z = A·(x²−B·y²) + C·sin(D·x+E·y²)",
    fn: (x, y, [A, B, C, D, E]) =>
      A * (x * x - B * y * y) + C * Math.sin(D * x + E * y * y),
    targetParams: [0.4, 0.6, -0.8, 0.7, -0.3],
  },
  {
    name: "Fractal Valleys",
    formula: "z = A·sin(B·x²) + C·cos(D·y²) + E·sin(x·y)",
    fn: (x, y, [A, B, C, D, E]) =>
      A * Math.sin(B * x * x) + C * Math.cos(D * y * y) + E * Math.sin(x * y),
    targetParams: [-0.5, 0.9, 0.6, -0.4, 0.7],
  },
];
