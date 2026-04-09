/* tslint:disable */
/* eslint-disable */

export class Game {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Cone parameters: [sin_a, cos_a, r_min, r_max, sector_phi]
     */
    cone_params(): Float32Array;
    /**
     * Returns [x,y,z, kind, x,y,z, kind, ...] where kind=0 red, 1 blue.
     */
    enemies_data(): Float32Array;
    enemy_count(): number;
    fire_nova(): void;
    flash(): number;
    game_over(): boolean;
    constructor();
    nova_charges(): number;
    nova_progress(): number;
    /**
     * Returns [x,y,z] for the player.
     */
    player_xyz(): Float32Array;
    reset(): void;
    score(): number;
    set_keys(mask: number): void;
    tick(dt: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_game_free: (a: number, b: number) => void;
    readonly game_cone_params: (a: number) => [number, number];
    readonly game_enemies_data: (a: number) => [number, number];
    readonly game_enemy_count: (a: number) => number;
    readonly game_fire_nova: (a: number) => void;
    readonly game_flash: (a: number) => number;
    readonly game_game_over: (a: number) => number;
    readonly game_new: () => number;
    readonly game_nova_charges: (a: number) => number;
    readonly game_nova_progress: (a: number) => number;
    readonly game_player_xyz: (a: number) => [number, number];
    readonly game_reset: (a: number) => void;
    readonly game_score: (a: number) => number;
    readonly game_set_keys: (a: number, b: number) => void;
    readonly game_tick: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
