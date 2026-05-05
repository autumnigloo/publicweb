import type { Level } from "./types";
import { EchoChamberLevel } from "./echoChamber";
import { MatrixHallwayLevel } from "./matrixHallway";

export function makeLevels(): Level[] {
  return [new EchoChamberLevel(), new MatrixHallwayLevel()];
}
