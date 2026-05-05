import * as THREE from "three";
import type { Player } from "../player";
import type { BoxWorld } from "../world";

export interface LevelContext {
  scene: THREE.Scene;
  world: BoxWorld;
  player: Player;
  // Show a transient HUD message.
  message: (text: string, duration?: number) => void;
  // Update the ability label/value in the HUD.
  setAbility: (label: string, value: string) => void;
  // Mark this level finished and advance.
  complete: () => void;
}

export interface Level {
  name: string;
  blurb: string;
  abilityLabel: string;

  // Build geometry, lights, attach state to ctx. Player position should be set here.
  init(ctx: LevelContext): void;

  // Per-frame update. dt in seconds.
  update(dt: number, ctx: LevelContext): void;

  // Player pressed E.
  ability?(ctx: LevelContext): void;

  // Optional teardown (custom geometry, intervals, …).
  dispose?(ctx: LevelContext): void;
}
