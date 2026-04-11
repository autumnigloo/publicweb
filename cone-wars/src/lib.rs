// Cone Wars — a Geometry-Wars-style shooter on a perfect 3D cone surface.
//
// Geometry: the cone has half-angle α with sin(α) = 0.5, α = 30°.
// Unrolling the cone produces a flat sector of angle Φ = 2π·sin(α) = π.
// All lateral-surface simulation happens in the unrolled flat plane (u, w).
//
// The cone also has a circular base (disk) at y = -R_MAX·cos(α). The player
// can step over the rim and walk on the disk. Enemies stay on the lateral.

use std::cell::RefCell;
use wasm_bindgen::prelude::*;

const PI: f32 = std::f32::consts::PI;
const SIN_A: f32 = 0.5;
const COS_A: f32 = 0.8660254;
const SECTOR_PHI: f32 = PI;
const R_MIN: f32 = 1.5;
const R_MAX: f32 = 24.0;
const R_DISK: f32 = R_MAX * SIN_A;     // 12.0 — radius of the base disk
const DISK_Y: f32 = -R_MAX * COS_A;    // ≈ −20.78 — y position of the disk
const R_DISK_MIN: f32 = 0.5;           // clamp distance from disk center

const PLAYER_SPEED: f32 = 7.0;
const PLAYER_RADIUS: f32 = 0.6;

const RED_THRUST: f32 = 3.5;           // acceleration magnitude per second
const RED_MAX_SPEED: f32 = 9.0;
const RED_RADIUS: f32 = 0.55;

const BLUE_SPEED: f32 = 5.0;
const BLUE_RADIUS: f32 = 0.7;
const BLUE_PERIOD: f32 = 2.0;
const BLUE_MOVE_FRAC: f32 = 0.5;

const NOVA_CHARGE_TIME: f32 = 10.0;
const NOVA_MAX_CHARGES: u32 = 2;

const SPAWN_BASE: f32 = 2.2;
const SPAWN_MIN: f32 = 0.35;
const SPAWN_RAMP: f32 = 0.025;

// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Default)]
struct Vec2 { x: f32, y: f32 }

impl Vec2 {
    fn new(x: f32, y: f32) -> Self { Self { x, y } }
    fn len(self) -> f32 { (self.x * self.x + self.y * self.y).sqrt() }
    fn rotated(self, angle: f32) -> Self {
        let (s, c) = (angle.sin(), angle.cos());
        Self::new(self.x * c - self.y * s, self.x * s + self.y * c)
    }
}

fn rng_seed(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    *state = x;
    (x as f32 / u32::MAX as f32).clamp(0.0, 1.0)
}

fn wrap_seam(pos: &mut Vec2, vel: &mut Vec2) {
    let phi = pos.y.atan2(pos.x);
    let phi_norm = phi.rem_euclid(SECTOR_PHI);
    let delta = phi_norm - phi;
    if delta.abs() > 1e-6 {
        *pos = pos.rotated(delta);
        *vel = vel.rotated(delta);
    }
}

fn closest_image(from: Vec2, target: Vec2) -> Vec2 {
    let candidates = [target, target.rotated(SECTOR_PHI), target.rotated(-SECTOR_PHI)];
    let mut best = candidates[0];
    let mut best_d = f32::INFINITY;
    for c in candidates {
        let d = (c.x - from.x).powi(2) + (c.y - from.y).powi(2);
        if d < best_d { best_d = d; best = c; }
    }
    best
}

// ---------------------------------------------------------------------------
// Entities

#[derive(Clone, Copy, PartialEq)]
enum Patch { Lateral, Disk }

struct Player {
    patch: Patch,
    pos: Vec2,          // (u,w) for Lateral; (x,z) for Disk
    prev_3d: [f32; 3],  // previous frame 3D position (for velocity indicator)
    vel_3d: [f32; 3],   // smoothed 3D velocity direction (unit length or zero)
}

#[derive(Clone, Copy)]
enum EnemyKind {
    Red { vel: Vec2 },
    Blue { phase: f32, dir_idx: u8 },
}

struct Enemy {
    pos: Vec2,
    kind: EnemyKind,
}

const HEX_DIRS: [(f32, f32); 6] = [
    (1.0, 0.0), (0.5, 0.8660254), (-0.5, 0.8660254),
    (-1.0, 0.0), (-0.5, -0.8660254), (0.5, -0.8660254),
];

struct GameState {
    player: Player,
    enemies: Vec<Enemy>,
    time: f32,
    nova_charges: u32,
    nova_progress: f32,
    spawn_timer: f32,
    keys: u32,
    rng: u32,
    game_over: bool,
    flash: f32,
}

impl GameState {
    fn new() -> Self {
        let init_pos = Vec2::new((R_MIN + R_MAX) * 0.5, 0.5);
        let p3d = lateral_to_3d(init_pos);
        Self {
            player: Player {
                patch: Patch::Lateral,
                pos: init_pos,
                prev_3d: p3d,
                vel_3d: [0.0, 0.0, 0.0],
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
        let rng = self.rng.wrapping_add(0x9E3779B9);
        *self = Self::new();
        self.rng = rng;
    }

    fn rand(&mut self) -> f32 { rng_seed(&mut self.rng) }

    fn spawn_enemy(&mut self) {
        let player_pos_lateral = match self.player.patch {
            Patch::Lateral => self.player.pos,
            Patch::Disk => {
                // approximate player as being at the rim for distance check
                let theta = self.player.pos.y.atan2(self.player.pos.x);
                let phi = theta * SIN_A;
                Vec2::new(R_MAX * phi.cos(), R_MAX * phi.sin())
            }
        };
        for _ in 0..16 {
            let r = R_MIN + self.rand() * (R_MAX - R_MIN);
            let phi = self.rand() * SECTOR_PHI;
            let pos = Vec2::new(r * phi.cos(), r * phi.sin());
            let p = closest_image(pos, player_pos_lateral);
            if ((p.x - pos.x).powi(2) + (p.y - pos.y).powi(2)).sqrt() < 8.0 { continue; }
            let kind = if self.rand() < 0.6 {
                EnemyKind::Red { vel: Vec2::default() }
            } else {
                EnemyKind::Blue { phase: 0.0, dir_idx: (self.rand() * 6.0) as u8 % 6 }
            };
            self.enemies.push(Enemy { pos, kind });
            return;
        }
    }

    fn step(&mut self, dt: f32) {
        if self.game_over { return; }
        let dt = dt.min(0.05);
        self.time += dt;

        let key_left  = self.keys & 1 != 0;
        let key_right = self.keys & 2 != 0;
        let key_up    = self.keys & 4 != 0;
        let key_down  = self.keys & 8 != 0;

        // ── Player movement ────────────────────────────────────────────
        match self.player.patch {
            Patch::Lateral => {
                let mut vr = 0.0f32;
                let mut vt = 0.0f32;
                if key_up   { vr -= 1.0; }
                if key_down { vr += 1.0; }
                if key_left { vt += 1.0; }
                if key_right{ vt -= 1.0; }
                let mag = (vr * vr + vt * vt).sqrt();
                if mag > 0.0 {
                    let (vr, vt) = (vr / mag, vt / mag);
                    let phi = self.player.pos.y.atan2(self.player.pos.x);
                    let (sp, cp) = (phi.sin(), phi.cos());
                    let vu = vr * cp - vt * sp;
                    let vw = vr * sp + vt * cp;
                    self.player.pos.x += vu * PLAYER_SPEED * dt;
                    self.player.pos.y += vw * PLAYER_SPEED * dt;
                }
                let mut zero = Vec2::default();
                wrap_seam(&mut self.player.pos, &mut zero);
                let r = self.player.pos.len();
                if r < R_MIN {
                    let s = R_MIN / r.max(0.001);
                    self.player.pos.x *= s;
                    self.player.pos.y *= s;
                }
                // Check transition to disk
                if r > R_MAX {
                    let phi = self.player.pos.y.atan2(self.player.pos.x);
                    let theta = phi / SIN_A;
                    let ct = theta.cos();
                    let st = theta.sin();
                    self.player.patch = Patch::Disk;
                    self.player.pos = Vec2::new(R_DISK * ct, R_DISK * st);
                }
            }
            Patch::Disk => {
                // Local frame: radial_outward from disk center, tangent around it.
                let dr = self.player.pos.len().max(0.001);
                let ct = self.player.pos.x / dr;
                let st = self.player.pos.y / dr;
                // Up = inward (toward center), Down = outward, Left = +tangent, Right = -tangent
                let mut vr = 0.0f32;
                let mut vt = 0.0f32;
                if key_up   { vr -= 1.0; } // inward
                if key_down { vr += 1.0; } // outward
                if key_left { vt += 1.0; }
                if key_right{ vt -= 1.0; }
                let mag = (vr * vr + vt * vt).sqrt();
                if mag > 0.0 {
                    let (vr, vt) = (vr / mag, vt / mag);
                    // outward = (ct, st), tangent = (-st, ct)
                    let vx = vr * ct - vt * st;
                    let vz = vr * st + vt * ct;
                    self.player.pos.x += vx * PLAYER_SPEED * dt;
                    self.player.pos.y += vz * PLAYER_SPEED * dt;
                }
                let dr2 = self.player.pos.len();
                if dr2 < R_DISK_MIN {
                    let s = R_DISK_MIN / dr2.max(0.001);
                    self.player.pos.x *= s;
                    self.player.pos.y *= s;
                }
                // Check transition back to lateral
                if dr2 > R_DISK {
                    let theta = self.player.pos.y.atan2(self.player.pos.x);
                    let phi = theta * SIN_A;
                    self.player.patch = Patch::Lateral;
                    self.player.pos = Vec2::new(R_MAX * phi.cos(), R_MAX * phi.sin());
                }
            }
        }

        // ── Update smoothed velocity indicator ─────────────────────────
        let cur_3d = self.player_xyz_internal();
        let dx = cur_3d[0] - self.player.prev_3d[0];
        let dy = cur_3d[1] - self.player.prev_3d[1];
        let dz = cur_3d[2] - self.player.prev_3d[2];
        let dmag = (dx * dx + dy * dy + dz * dz).sqrt();
        if dmag > 0.001 {
            let k = 1.0 - (-10.0 * dt).exp();
            let target = [dx / dmag, dy / dmag, dz / dmag];
            for i in 0..3 {
                self.player.vel_3d[i] += k * (target[i] - self.player.vel_3d[i]);
            }
            // re-normalize
            let vl = (self.player.vel_3d[0].powi(2) + self.player.vel_3d[1].powi(2) + self.player.vel_3d[2].powi(2)).sqrt();
            if vl > 0.001 {
                for v in &mut self.player.vel_3d { *v /= vl; }
            }
        }
        self.player.prev_3d = cur_3d;

        // ── Update enemies (lateral only) ──────────────────────────────
        let player_lateral = match self.player.patch {
            Patch::Lateral => self.player.pos,
            Patch::Disk => {
                let theta = self.player.pos.y.atan2(self.player.pos.x);
                let phi = theta * SIN_A;
                Vec2::new(R_MAX * phi.cos(), R_MAX * phi.sin())
            }
        };

        for e in self.enemies.iter_mut() {
            match &mut e.kind {
                EnemyKind::Red { vel } => {
                    let target = closest_image(e.pos, player_lateral);
                    let dx = target.x - e.pos.x;
                    let dy = target.y - e.pos.y;
                    let m = (dx * dx + dy * dy).sqrt().max(1e-4);
                    // Apply thrust toward target, accumulating into velocity
                    vel.x += dx / m * RED_THRUST * dt;
                    vel.y += dy / m * RED_THRUST * dt;
                    let spd = vel.len();
                    if spd > RED_MAX_SPEED {
                        vel.x *= RED_MAX_SPEED / spd;
                        vel.y *= RED_MAX_SPEED / spd;
                    }
                    e.pos.x += vel.x * dt;
                    e.pos.y += vel.y * dt;
                    // Seam wrap must also rotate the stored velocity
                    wrap_seam(&mut e.pos, vel);
                }
                EnemyKind::Blue { phase, dir_idx } => {
                    let prev = *phase;
                    *phase += dt;
                    if *phase >= BLUE_PERIOD { *phase -= BLUE_PERIOD; }
                    let prev_moving = prev < BLUE_PERIOD * BLUE_MOVE_FRAC;
                    let now_moving = *phase < BLUE_PERIOD * BLUE_MOVE_FRAC;
                    if !prev_moving && now_moving {
                        let target = closest_image(e.pos, player_lateral);
                        let move_dist = BLUE_SPEED * (BLUE_PERIOD * BLUE_MOVE_FRAC);
                        let mut best_idx = 0u8;
                        let mut best_d = f32::INFINITY;
                        for (i, &(hx, hy)) in HEX_DIRS.iter().enumerate() {
                            let ddx = target.x - (e.pos.x + hx * move_dist);
                            let ddy = target.y - (e.pos.y + hy * move_dist);
                            let d = ddx * ddx + ddy * ddy;
                            if d < best_d { best_d = d; best_idx = i as u8; }
                        }
                        *dir_idx = best_idx;
                    }
                    if now_moving {
                        let (dx, dy) = HEX_DIRS[*dir_idx as usize];
                        e.pos.x += dx * BLUE_SPEED * dt;
                        e.pos.y += dy * BLUE_SPEED * dt;
                    }
                    let mut zero = Vec2::default();
                    wrap_seam(&mut e.pos, &mut zero);
                }
            }
            let r = e.pos.len();
            if r > R_MAX { e.pos.x *= R_MAX / r; e.pos.y *= R_MAX / r; }
            else if r < R_MIN { let s = R_MIN / r.max(0.001); e.pos.x *= s; e.pos.y *= s; }
        }

        // ── Spawning ───────────────────────────────────────────────────
        self.spawn_timer -= dt;
        if self.spawn_timer <= 0.0 {
            self.spawn_enemy();
            self.spawn_timer = (SPAWN_BASE - self.time * SPAWN_RAMP).max(SPAWN_MIN);
        }

        // ── Nova charges ───────────────────────────────────────────────
        if self.nova_charges < NOVA_MAX_CHARGES {
            self.nova_progress += dt;
            if self.nova_progress >= NOVA_CHARGE_TIME {
                self.nova_progress -= NOVA_CHARGE_TIME;
                self.nova_charges += 1;
            }
        } else {
            self.nova_progress = 0.0;
        }

        // ── Collisions (only when player is on lateral) ────────────────
        if self.player.patch == Patch::Lateral {
            for e in &self.enemies {
                let ci = closest_image(e.pos, self.player.pos);
                let dx = ci.x - e.pos.x;
                let dy = ci.y - e.pos.y;
                let radius = match e.kind {
                    EnemyKind::Red { .. } => RED_RADIUS,
                    EnemyKind::Blue { .. } => BLUE_RADIUS,
                };
                if (dx * dx + dy * dy).sqrt() < radius + PLAYER_RADIUS {
                    self.game_over = true;
                    self.flash = 1.0;
                    break;
                }
            }
        }

        if self.flash > 0.0 { self.flash = (self.flash - dt * 2.0).max(0.0); }
    }

    fn fire_nova(&mut self) {
        if self.game_over || self.nova_charges == 0 { return; }
        self.nova_charges -= 1;
        self.enemies.clear();
        self.flash = 1.0;
    }

    fn player_xyz_internal(&self) -> [f32; 3] {
        match self.player.patch {
            Patch::Lateral => {
                let p = lateral_to_3d(self.player.pos);
                p
            }
            Patch::Disk => {
                [self.player.pos.x, DISK_Y, self.player.pos.y]
            }
        }
    }
}

fn lateral_to_3d(p: Vec2) -> [f32; 3] {
    let r = p.len().max(0.0001);
    let phi = p.y.atan2(p.x).rem_euclid(SECTOR_PHI);
    let theta = phi / SIN_A;
    [r * SIN_A * theta.cos(), -r * COS_A, r * SIN_A * theta.sin()]
}

// ---------------------------------------------------------------------------
// wasm-bindgen API

#[wasm_bindgen]
pub struct Game { state: RefCell<GameState> }

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Game { Game { state: RefCell::new(GameState::new()) } }

    pub fn reset(&self) { self.state.borrow_mut().reset(); }
    pub fn set_keys(&self, mask: u32) { self.state.borrow_mut().keys = mask; }
    pub fn fire_nova(&self) { self.state.borrow_mut().fire_nova(); }
    pub fn tick(&self, dt: f32) { self.state.borrow_mut().step(dt); }
    pub fn score(&self) -> f32 { self.state.borrow().time }
    pub fn game_over(&self) -> bool { self.state.borrow().game_over }
    pub fn nova_charges(&self) -> u32 { self.state.borrow().nova_charges }
    pub fn flash(&self) -> f32 { self.state.borrow().flash }
    pub fn enemy_count(&self) -> usize { self.state.borrow().enemies.len() }

    pub fn nova_progress(&self) -> f32 {
        let s = self.state.borrow();
        if s.nova_charges >= NOVA_MAX_CHARGES { 1.0 } else { s.nova_progress / NOVA_CHARGE_TIME }
    }

    pub fn player_xyz(&self) -> Vec<f32> {
        let s = self.state.borrow();
        let p = s.player_xyz_internal();
        vec![p[0], p[1], p[2]]
    }

    /// 0 = lateral, 1 = disk
    pub fn player_patch(&self) -> u32 {
        match self.state.borrow().player.patch { Patch::Lateral => 0, Patch::Disk => 1 }
    }

    /// Smoothed unit velocity direction in 3D [dx, dy, dz].
    pub fn player_vel_dir(&self) -> Vec<f32> {
        let s = self.state.borrow();
        vec![s.player.vel_3d[0], s.player.vel_3d[1], s.player.vel_3d[2]]
    }

    pub fn enemies_data(&self) -> Vec<f32> {
        let s = self.state.borrow();
        let mut out = Vec::with_capacity(s.enemies.len() * 4);
        for e in &s.enemies {
            let p = lateral_to_3d(e.pos);
            let k = match e.kind { EnemyKind::Red { .. } => 0.0, EnemyKind::Blue { .. } => 1.0 };
            out.push(p[0]); out.push(p[1]); out.push(p[2]); out.push(k);
        }
        out
    }

    /// [sin_a, cos_a, r_min, r_max, sector_phi, r_disk, disk_y]
    pub fn cone_params(&self) -> Vec<f32> {
        vec![SIN_A, COS_A, R_MIN, R_MAX, SECTOR_PHI, R_DISK, DISK_Y]
    }
}
