// Cone Wars — a Geometry-Wars-style shooter on a perfect 3D cone surface.
//
// Geometry: the cone has half-angle α (angle between axis and slant).
// We use α such that sin(α) = 0.5 → α = 30°. Unrolling the cone produces
// a flat sector of angle Φ = 2π·sin(α) = π (a half disk).
//
// All simulation happens in the unrolled flat plane (u, w). Geodesics on the
// cone are straight lines in this plane. The seam at φ=0 ≡ φ=Φ is handled by
// rotating positions and velocities by ±Φ when they cross.
//
// 3D mapping (s = slant distance from apex, θ = angle around cone):
//   s = sqrt(u² + w²), φ = atan2(w, u), θ = φ / sin(α)
//   x =  s·sin(α)·cos(θ)
//   y = -s·cos(α)
//   z =  s·sin(α)·sin(θ)

use std::cell::RefCell;
use wasm_bindgen::prelude::*;

const PI: f32 = std::f32::consts::PI;
const SIN_A: f32 = 0.5;            // sin(30°)
const COS_A: f32 = 0.8660254;      // cos(30°)
const SECTOR_PHI: f32 = PI;        // 2π·sin(α) = π
const R_MIN: f32 = 1.5;
const R_MAX: f32 = 24.0;

const PLAYER_SPEED: f32 = 7.0;
const PLAYER_RADIUS: f32 = 0.6;

const RED_INIT_SPEED: f32 = 1.5;
const RED_ACCEL: f32 = 0.45;
const RED_MAX_SPEED: f32 = 9.0;
const RED_RADIUS: f32 = 0.55;

const BLUE_SPEED: f32 = 5.0;
const BLUE_RADIUS: f32 = 0.7;
const BLUE_PERIOD: f32 = 2.0;
const BLUE_MOVE_FRAC: f32 = 0.5;   // first half = move, second half = pause

const NOVA_CHARGE_TIME: f32 = 10.0;
const NOVA_MAX_CHARGES: u32 = 2;

const SPAWN_BASE: f32 = 2.2;
const SPAWN_MIN: f32 = 0.35;
const SPAWN_RAMP: f32 = 0.025;     // per-second decrease in spawn interval

// ---------------------------------------------------------------------------
// math helpers

#[derive(Clone, Copy, Default)]
struct Vec2 {
    x: f32,
    y: f32,
}

impl Vec2 {
    fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
    fn len(self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
    fn rotated(self, angle: f32) -> Self {
        let (s, c) = (angle.sin(), angle.cos());
        Self::new(self.x * c - self.y * s, self.x * s + self.y * c)
    }
}

fn rng_seed(state: &mut u32) -> f32 {
    // xorshift32
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as f32 / u32::MAX as f32).clamp(0.0, 1.0)
}

// Wrap a position across the seam, rotating velocity to match.
fn wrap_seam(pos: &mut Vec2, vel: &mut Vec2) {
    let phi = pos.y.atan2(pos.x);
    let phi_norm = phi.rem_euclid(SECTOR_PHI);
    let delta = phi_norm - phi;
    if delta.abs() > 1e-6 {
        *pos = pos.rotated(delta);
        *vel = vel.rotated(delta);
    }
}

// Find the closest "image" of `target` to `from`, considering the cone's
// universal cover (replicas at ±SECTOR_PHI in unrolled φ).
fn closest_image(from: Vec2, target: Vec2) -> Vec2 {
    let candidates = [
        target,
        target.rotated(SECTOR_PHI),
        target.rotated(-SECTOR_PHI),
    ];
    let mut best = candidates[0];
    let mut best_d = f32::INFINITY;
    for c in candidates {
        let dx = c.x - from.x;
        let dy = c.y - from.y;
        let d = dx * dx + dy * dy;
        if d < best_d {
            best_d = d;
            best = c;
        }
    }
    best
}

// ---------------------------------------------------------------------------
// game entities

struct Player {
    pos: Vec2,
}

#[derive(Clone, Copy)]
enum EnemyKind {
    Red { speed: f32 },
    Blue { phase: f32, dir_idx: u8 },
}

struct Enemy {
    pos: Vec2,
    kind: EnemyKind,
}

// Hex direction unit vectors (in unrolled-flat coords).
const HEX_DIRS: [(f32, f32); 6] = [
    (1.0, 0.0),
    (0.5, 0.8660254),
    (-0.5, 0.8660254),
    (-1.0, 0.0),
    (-0.5, -0.8660254),
    (0.5, -0.8660254),
];

struct GameState {
    player: Player,
    enemies: Vec<Enemy>,
    time: f32,
    nova_charges: u32,
    nova_progress: f32,
    spawn_timer: f32,
    keys: u32, // bit 0 left, 1 right, 2 up, 3 down, 4 space
    rng: u32,
    game_over: bool,
    flash: f32, // visual flash on nova/death
}

impl GameState {
    fn new() -> Self {
        Self {
            player: Player {
                pos: Vec2::new((R_MIN + R_MAX) * 0.5, 0.5),
            },
            enemies: Vec::new(),
            time: 0.0,
            nova_charges: NOVA_MAX_CHARGES,
            nova_progress: 0.0,
            spawn_timer: 1.0,
            keys: 0,
            rng: 0xC0FFEEu32,
            game_over: false,
            flash: 0.0,
        }
    }

    fn reset(&mut self) {
        let new_rng = self.rng.wrapping_add(0x9E3779B9);
        *self = Self::new();
        self.rng = new_rng;
    }

    fn rand(&mut self) -> f32 {
        rng_seed(&mut self.rng)
    }

    // Spawn an enemy at a random location on the cone, away from the player.
    fn spawn_enemy(&mut self) {
        for _ in 0..16 {
            let r = R_MIN + self.rand() * (R_MAX - R_MIN);
            let phi = self.rand() * SECTOR_PHI;
            let pos = Vec2::new(r * phi.cos(), r * phi.sin());
            // distance to nearest player image
            let p = closest_image(pos, self.player.pos);
            let dx = p.x - pos.x;
            let dy = p.y - pos.y;
            if (dx * dx + dy * dy).sqrt() < 8.0 {
                continue;
            }
            // Choose kind: red 60%, blue 40%
            let kind = if self.rand() < 0.6 {
                EnemyKind::Red {
                    speed: RED_INIT_SPEED,
                }
            } else {
                EnemyKind::Blue {
                    phase: 0.0,
                    dir_idx: (self.rand() * 6.0) as u8 % 6,
                }
            };
            self.enemies.push(Enemy { pos, kind });
            return;
        }
    }

    fn step(&mut self, dt: f32) {
        if self.game_over {
            return;
        }
        let dt = dt.min(0.05); // clamp big frames

        self.time += dt;

        // Player input -> velocity in player-local frame
        let key_left = self.keys & 1 != 0;
        let key_right = self.keys & 2 != 0;
        let key_up = self.keys & 4 != 0;
        let key_down = self.keys & 8 != 0;

        let mut vr = 0.0f32;
        let mut vt = 0.0f32;
        if key_up {
            vr += 1.0;
        }
        if key_down {
            vr -= 1.0;
        }
        if key_right {
            vt += 1.0;
        }
        if key_left {
            vt -= 1.0;
        }
        let mag = (vr * vr + vt * vt).sqrt();
        if mag > 0.0 {
            vr /= mag;
            vt /= mag;
            let phi = self.player.pos.y.atan2(self.player.pos.x);
            let (sp, cp) = (phi.sin(), phi.cos());
            // radial = (cp, sp), tangent = (-sp, cp)
            let vu = vr * cp - vt * sp;
            let vw = vr * sp + vt * cp;
            self.player.pos.x += vu * PLAYER_SPEED * dt;
            self.player.pos.y += vw * PLAYER_SPEED * dt;
        }

        // Wrap & clamp player
        let mut zero = Vec2::default();
        wrap_seam(&mut self.player.pos, &mut zero);
        let r = self.player.pos.len();
        if r > R_MAX {
            self.player.pos.x *= R_MAX / r;
            self.player.pos.y *= R_MAX / r;
        } else if r < R_MIN {
            let s = R_MIN / r.max(0.001);
            self.player.pos.x *= s;
            self.player.pos.y *= s;
        }

        // Update enemies
        let player_pos = self.player.pos;
        for e in self.enemies.iter_mut() {
            match &mut e.kind {
                EnemyKind::Red { speed } => {
                    let target = closest_image(e.pos, player_pos);
                    let dx = target.x - e.pos.x;
                    let dy = target.y - e.pos.y;
                    let m = (dx * dx + dy * dy).sqrt().max(1e-4);
                    *speed = (*speed + RED_ACCEL * dt).min(RED_MAX_SPEED);
                    e.pos.x += dx / m * *speed * dt;
                    e.pos.y += dy / m * *speed * dt;
                }
                EnemyKind::Blue { phase, dir_idx } => {
                    let prev = *phase;
                    *phase += dt;
                    if *phase >= BLUE_PERIOD {
                        *phase -= BLUE_PERIOD;
                    }
                    let prev_moving = prev < BLUE_PERIOD * BLUE_MOVE_FRAC;
                    let now_moving = *phase < BLUE_PERIOD * BLUE_MOVE_FRAC;
                    // Pause→move transition: pick the hex direction that ends
                    // closest to the (closest image of the) player.
                    if !prev_moving && now_moving {
                        let target = closest_image(e.pos, player_pos);
                        let move_dist = BLUE_SPEED * (BLUE_PERIOD * BLUE_MOVE_FRAC);
                        let mut best_idx = 0u8;
                        let mut best_d = f32::INFINITY;
                        for (i, &(hx, hy)) in HEX_DIRS.iter().enumerate() {
                            let nx = e.pos.x + hx * move_dist;
                            let ny = e.pos.y + hy * move_dist;
                            let ddx = target.x - nx;
                            let ddy = target.y - ny;
                            let d = ddx * ddx + ddy * ddy;
                            if d < best_d {
                                best_d = d;
                                best_idx = i as u8;
                            }
                        }
                        *dir_idx = best_idx;
                    }
                    if now_moving {
                        let (dx, dy) = HEX_DIRS[*dir_idx as usize];
                        e.pos.x += dx * BLUE_SPEED * dt;
                        e.pos.y += dy * BLUE_SPEED * dt;
                    }
                }
            }
            let mut zero = Vec2::default();
            wrap_seam(&mut e.pos, &mut zero);
            // Clamp r softly so they stay on the cone
            let r = e.pos.len();
            if r > R_MAX {
                e.pos.x *= R_MAX / r;
                e.pos.y *= R_MAX / r;
            } else if r < R_MIN {
                let s = R_MIN / r.max(0.001);
                e.pos.x *= s;
                e.pos.y *= s;
            }
        }

        // Spawning
        self.spawn_timer -= dt;
        if self.spawn_timer <= 0.0 {
            self.spawn_enemy();
            let interval = (SPAWN_BASE - self.time * SPAWN_RAMP).max(SPAWN_MIN);
            self.spawn_timer = interval;
        }

        // Nova charges
        if self.nova_charges < NOVA_MAX_CHARGES {
            self.nova_progress += dt;
            if self.nova_progress >= NOVA_CHARGE_TIME {
                self.nova_progress -= NOVA_CHARGE_TIME;
                self.nova_charges += 1;
            }
        } else {
            self.nova_progress = 0.0;
        }

        // Collisions: any enemy too close to player
        for e in &self.enemies {
            let target = closest_image(e.pos, player_pos);
            let dx = target.x - e.pos.x;
            let dy = target.y - e.pos.y;
            let radius = match e.kind {
                EnemyKind::Red { .. } => RED_RADIUS,
                EnemyKind::Blue { .. } => BLUE_RADIUS,
            };
            let r = (dx * dx + dy * dy).sqrt();
            if r < radius + PLAYER_RADIUS {
                self.game_over = true;
                self.flash = 1.0;
                break;
            }
        }

        if self.flash > 0.0 {
            self.flash = (self.flash - dt * 2.0).max(0.0);
        }
    }

    fn fire_nova(&mut self) {
        if self.game_over {
            return;
        }
        if self.nova_charges == 0 {
            return;
        }
        self.nova_charges -= 1;
        self.enemies.clear();
        self.flash = 1.0;
    }
}

// ---------------------------------------------------------------------------
// wasm-bindgen API

#[wasm_bindgen]
pub struct Game {
    state: RefCell<GameState>,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Game {
        Game {
            state: RefCell::new(GameState::new()),
        }
    }

    pub fn reset(&self) {
        self.state.borrow_mut().reset();
    }

    pub fn set_keys(&self, mask: u32) {
        self.state.borrow_mut().keys = mask;
    }

    pub fn fire_nova(&self) {
        self.state.borrow_mut().fire_nova();
    }

    pub fn tick(&self, dt: f32) {
        self.state.borrow_mut().step(dt);
    }

    pub fn score(&self) -> f32 {
        self.state.borrow().time
    }

    pub fn game_over(&self) -> bool {
        self.state.borrow().game_over
    }

    pub fn nova_charges(&self) -> u32 {
        self.state.borrow().nova_charges
    }

    pub fn nova_progress(&self) -> f32 {
        let s = self.state.borrow();
        if s.nova_charges >= NOVA_MAX_CHARGES {
            1.0
        } else {
            s.nova_progress / NOVA_CHARGE_TIME
        }
    }

    pub fn flash(&self) -> f32 {
        self.state.borrow().flash
    }

    pub fn enemy_count(&self) -> usize {
        self.state.borrow().enemies.len()
    }

    /// Returns [x,y,z] for the player.
    pub fn player_xyz(&self) -> Vec<f32> {
        let s = self.state.borrow();
        let p = s.player.pos;
        let (x, y, z) = unrolled_to_3d(p);
        vec![x, y, z]
    }

    /// Returns [x,y,z, kind, x,y,z, kind, ...] where kind=0 red, 1 blue.
    pub fn enemies_data(&self) -> Vec<f32> {
        let s = self.state.borrow();
        let mut out = Vec::with_capacity(s.enemies.len() * 4);
        for e in &s.enemies {
            let (x, y, z) = unrolled_to_3d(e.pos);
            let k = match e.kind {
                EnemyKind::Red { .. } => 0.0,
                EnemyKind::Blue { .. } => 1.0,
            };
            out.push(x);
            out.push(y);
            out.push(z);
            out.push(k);
        }
        out
    }

    /// Cone parameters: [sin_a, cos_a, r_min, r_max, sector_phi]
    pub fn cone_params(&self) -> Vec<f32> {
        vec![SIN_A, COS_A, R_MIN, R_MAX, SECTOR_PHI]
    }
}

fn unrolled_to_3d(p: Vec2) -> (f32, f32, f32) {
    let r = p.len().max(0.0001);
    let phi = p.y.atan2(p.x);
    // theta in [0, 2π); ensure it's positive
    let theta = (phi.rem_euclid(SECTOR_PHI)) / SIN_A;
    let x = r * SIN_A * theta.cos();
    let y = -r * COS_A;
    let z = r * SIN_A * theta.sin();
    (x, y, z)
}
