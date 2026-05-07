import type { Level } from "./types";
import { EchoChamberLevel } from "./echoChamber";
import { MatrixHallwayLevel } from "./matrixHallway";
import { TimeSliceLevel } from "./timeSlice";

export function makeLevels(): Level[] {
  return [new EchoChamberLevel(), new MatrixHallwayLevel(), new TimeSliceLevel()];
}
