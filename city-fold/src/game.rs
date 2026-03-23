use wasm_bindgen::prelude::*;
use web_sys::{WebGlRenderingContext as GL, HtmlCanvasElement};

use crate::math::{Vec3, Mat4};
use crate::renderer::Renderer;

// ---- Building geometry helpers ----

/// Generate a box mesh with per-face normals and color.
/// Outputs: [x,y,z, nx,ny,nz, r,g,b] per vertex (36 vertices for a box).
fn box_mesh(x: f32, y: f32, z: f32, w: f32, h: f32, d: f32, color: [f32; 3]) -> Vec<f32> {
    let x0 = x - w * 0.5;
    let x1 = x + w * 0.5;
    let y0 = y;
    let y1 = y + h;
    let z0 = z - d * 0.5;
    let z1 = z + d * 0.5;

    let r = color[0];
    let g = color[1];
    let b = color[2];

    // Each face: 2 triangles, 6 vertices
    let mut v = Vec::new();

    // Helper: push a triangle
    macro_rules! tri {
        ($p0:expr, $p1:expr, $p2:expr, $n:expr) => {
            for p in [$p0, $p1, $p2] {
                v.extend_from_slice(&p);
                v.extend_from_slice(&$n);
                v.push(r); v.push(g); v.push(b);
            }
        }
    }

    // +Y top
    tri!([x0,y1,z0],[x1,y1,z0],[x0,y1,z1],[0.0,1.0,0.0]);
    tri!([x1,y1,z0],[x1,y1,z1],[x0,y1,z1],[0.0,1.0,0.0]);
    // -Y bottom
    tri!([x0,y0,z1],[x1,y0,z1],[x0,y0,z0],[0.0,-1.0,0.0]);
    tri!([x1,y0,z1],[x1,y0,z0],[x0,y0,z0],[0.0,-1.0,0.0]);
    // +X right
    tri!([x1,y0,z0],[x1,y0,z1],[x1,y1,z0],[1.0,0.0,0.0]);
    tri!([x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[1.0,0.0,0.0]);
    // -X left
    tri!([x0,y0,z1],[x0,y0,z0],[x0,y1,z1],[-1.0,0.0,0.0]);
    tri!([x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[-1.0,0.0,0.0]);
    // +Z front
    tri!([x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[0.0,0.0,1.0]);
    tri!([x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0.0,0.0,1.0]);
    // -Z back
    tri!([x1,y0,z0],[x0,y0,z0],[x1,y1,z0],[0.0,0.0,-1.0]);
    tri!([x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0.0,0.0,-1.0]);

    v
}

// ---- City building types ----

#[derive(Clone)]
pub struct Building {
    pub x: f32,
    pub z: f32,
    pub width: f32,
    pub depth: f32,
    pub height: f32,
    pub color: [f32; 3],
    pub segment: usize, // which city quarter this belongs to
    pub mesh_cache: Vec<f32>,
}

impl Building {
    pub fn new(x: f32, z: f32, w: f32, d: f32, h: f32, color: [f32; 3], seg: usize) -> Self {
        let mesh = box_mesh(x, 0.0, z, w, h, d, color);
        Self { x, z, width: w, depth: d, height: h, color, segment: seg, mesh_cache: mesh }
    }
}

// ---- Fold state ----

#[derive(Clone, Debug)]
pub struct FoldPlane {
    pub axis: Vec3,        // normalized axis of fold (which half to fold)
    pub origin: Vec3,      // a point on the fold plane
    pub fold_amount: f32,  // 0.0 = flat, 1.0 = folded 180deg
    pub target: f32,
    pub segment: usize,    // which segment is being folded
    pub side: f32,         // +1.0 or -1.0 which side of the axis
}

impl FoldPlane {
    pub fn new(axis: Vec3, origin: Vec3, segment: usize, side: f32) -> Self {
        Self {
            axis,
            origin,
            fold_amount: 0.0,
            target: 0.0,
            segment,
            side,
        }
    }
}

// ---- Level objectives ----

#[derive(Clone, Debug)]
pub enum Objective {
    /// Connect two city segments by folding them to touch
    ConnectSegments { seg_a: usize, seg_b: usize },
    /// Fold segment to match a shadow/footprint shape
    MatchShadow { segment: usize, target_angle: f32 },
    /// Fold multiple segments into a tower
    BuildTower { segments: Vec<usize> },
    /// Create a bridge by folding segments horizontally
    CreateBridge { segments: Vec<usize> },
    /// Fold the whole city inside-out (all segments)
    CityInversion,
}

#[derive(Clone, Debug)]
pub struct Level {
    pub number: usize,
    pub name: &'static str,
    pub description: &'static str,
    pub city_size: f32,
    pub segments: usize,
    pub objective: Objective,
    pub solution_folds: Vec<(usize, f32)>, // (segment_idx, target_angle)
    pub hint: &'static str,
}

fn define_levels() -> Vec<Level> {
    vec![
        Level {
            number: 1,
            name: "The Bridge Fold",
            description: "Connect the two halves of the divided city by folding the left quarter up",
            city_size: 12.0,
            segments: 2,
            objective: Objective::ConnectSegments { seg_a: 0, seg_b: 1 },
            solution_folds: vec![(0, 0.5)],
            hint: "Click the LEFT half and drag UP to fold it",
        },
        Level {
            number: 2,
            name: "The Skyscraper",
            description: "Stack the four city quarters into a vertical tower formation",
            city_size: 16.0,
            segments: 4,
            objective: Objective::BuildTower { segments: vec![0, 1, 2, 3] },
            solution_folds: vec![(0, 0.5), (2, 0.5)],
            hint: "Fold North and South sections upward",
        },
        Level {
            number: 3,
            name: "The Inception Loop",
            description: "Create an impossible loop — fold each quarter 90° to form a cube city",
            city_size: 20.0,
            segments: 4,
            objective: Objective::MatchShadow { segment: 0, target_angle: 0.25 },
            solution_folds: vec![(0, 0.25), (1, 0.25), (2, 0.25), (3, 0.25)],
            hint: "Each quarter folds 90° inward — fold them all",
        },
        Level {
            number: 4,
            name: "The Möbius District",
            description: "Fold the city into a figure-8 — each half flips over the other",
            city_size: 24.0,
            segments: 6,
            objective: Objective::CreateBridge { segments: vec![0,1,2,3,4,5] },
            solution_folds: vec![(0, 0.5), (3, 0.5), (1, 0.25), (4, 0.75)],
            hint: "Fold alternating segments in opposite directions",
        },
        Level {
            number: 5,
            name: "Total Inversion",
            description: "The ultimate fold: collapse the entire city inward on itself",
            city_size: 30.0,
            segments: 8,
            objective: Objective::CityInversion,
            solution_folds: vec![(0,1.0),(1,1.0),(2,1.0),(3,1.0),(4,1.0),(5,1.0),(6,1.0),(7,1.0)],
            hint: "Fold all 8 districts — the city must fold completely inside-out",
        },
    ]
}

// ---- Game state machine ----

#[derive(Clone, PartialEq, Debug)]
pub enum GameState {
    Playing,
    FoldingAnimation,
    LevelComplete,
    ShowingHint,
}

pub struct Game {
    renderer: Renderer,
    canvas: HtmlCanvasElement,
    buildings: Vec<Building>,
    folds: Vec<FoldPlane>,
    levels: Vec<Level>,
    current_level: usize,
    state: GameState,

    // Camera
    cam_yaw: f32,
    cam_pitch: f32,
    cam_dist: f32,
    cam_target: Vec3,

    // Input
    mouse_down: bool,
    last_mouse_x: f32,
    last_mouse_y: f32,
    drag_start_x: f32,
    drag_start_y: f32,
    selected_segment: Option<usize>,

    // Timing
    time: f32,
    last_timestamp: f64,

    // Progress
    complete_timer: f32,
    hint_timer: f32,
    fold_progress: f32, // for animating folds

    // Completion tracking
    segments_completed: Vec<bool>,
    level_complete_show: bool,
}

impl Game {
    pub fn new(gl: GL, canvas: HtmlCanvasElement) -> Result<Self, JsValue> {
        let renderer = Renderer::new(gl)?;
        let levels = define_levels();
        let mut game = Self {
            renderer,
            canvas,
            buildings: vec![],
            folds: vec![],
            levels,
            current_level: 0,
            state: GameState::Playing,
            cam_yaw: 0.5,
            cam_pitch: 0.6,
            cam_dist: 30.0,
            cam_target: Vec3::zero(),
            mouse_down: false,
            last_mouse_x: 0.0,
            last_mouse_y: 0.0,
            drag_start_x: 0.0,
            drag_start_y: 0.0,
            selected_segment: None,
            time: 0.0,
            last_timestamp: 0.0,
            complete_timer: 0.0,
            hint_timer: 0.0,
            fold_progress: 0.0,
            segments_completed: vec![],
            level_complete_show: false,
        };
        game.load_level(0);
        Ok(game)
    }

    pub fn load_level(&mut self, level: usize) {
        self.current_level = level;
        self.buildings.clear();
        self.folds.clear();
        self.selected_segment = None;
        self.state = GameState::Playing;
        self.complete_timer = 0.0;
        self.hint_timer = 3.0; // show hint for 3s
        self.level_complete_show = false;

        let lvl = &self.levels[level];
        let size = lvl.city_size;
        let segs = lvl.segments;

        self.segments_completed = vec![false; segs];

        // Generate city based on level
        self.generate_city(size, segs, level);
        self.generate_folds(size, segs);

        // Camera
        self.cam_dist = size * 2.2;
        self.cam_yaw = 0.5;
        self.cam_pitch = 0.55;
        self.cam_target = Vec3::zero();

        // Update UI
        self.update_level_complete_ui(false);
    }

    fn generate_city(&mut self, size: f32, segs: usize, level: usize) {
        let half = size * 0.5;

        // Color palettes per level (night city neons)
        let palettes: &[&[[f32; 3]]] = &[
            // Level 1: blue/cyan
            &[[0.1,0.3,0.8],[0.0,0.6,0.9],[0.15,0.25,0.7],[0.2,0.5,0.95]],
            // Level 2: purple/magenta
            &[[0.6,0.1,0.8],[0.9,0.0,0.5],[0.5,0.0,0.9],[0.8,0.2,0.6]],
            // Level 3: green/teal
            &[[0.0,0.8,0.4],[0.1,0.7,0.6],[0.0,0.9,0.2],[0.2,0.6,0.5]],
            // Level 4: orange/red
            &[[0.9,0.4,0.0],[0.8,0.1,0.2],[0.95,0.6,0.1],[0.7,0.2,0.1]],
            // Level 5: full spectrum
            &[[0.9,0.1,0.1],[0.1,0.9,0.1],[0.1,0.1,0.9],[0.9,0.9,0.0]],
        ];
        let palette = palettes[level.min(4)];

        let grid_per_seg = 4usize; // buildings per side per segment

        // Divide city into segments arranged around center
        // For 2 segs: left/right split
        // For 4 segs: quadrants
        // For 6 segs: 2 rows of 3
        // For 8 segs: 2 rows of 4

        let (cols, rows) = match segs {
            2 => (2, 1),
            4 => (2, 2),
            6 => (3, 2),
            8 => (4, 2),
            _ => (2, 1),
        };

        let seg_w = size / cols as f32;
        let seg_d = size / rows as f32;

        for seg in 0..segs {
            let col = seg % cols;
            let row = seg / cols;
            let sx = -half + col as f32 * seg_w;
            let sz = -half + row as f32 * seg_d;

            let col_idx = seg % palette.len();
            let base_color = palette[col_idx];

            // Ground plane for this segment (thin box)
            let ground = box_mesh(
                sx + seg_w * 0.5, 0.0, sz + seg_d * 0.5,
                seg_w - 0.3, 0.05, seg_d - 0.3,
                [base_color[0]*0.3, base_color[1]*0.3, base_color[2]*0.3],
            );
            self.buildings.push(Building {
                x: sx + seg_w * 0.5, z: sz + seg_d * 0.5,
                width: seg_w, depth: seg_d, height: 0.05,
                color: [base_color[0]*0.3, base_color[1]*0.3, base_color[2]*0.3],
                segment: seg,
                mesh_cache: ground,
            });

            // Buildings in grid
            let cell_w = (seg_w - 1.0) / grid_per_seg as f32;
            let cell_d = (seg_d - 1.0) / grid_per_seg as f32;

            for bx in 0..grid_per_seg {
                for bz in 0..grid_per_seg {
                    // Skip center sometimes for plazas
                    if bx == grid_per_seg/2 && bz == grid_per_seg/2 && seg % 2 == 0 { continue; }

                    let cx = sx + 0.5 + bx as f32 * cell_w + cell_w * 0.5;
                    let cz = sz + 0.5 + bz as f32 * cell_d + cell_d * 0.5;

                    // Vary height with pseudo-random based on position
                    let seed = (bx * 7 + bz * 13 + seg * 31) as f32;
                    let h = 1.0 + (seed * 0.17 + seed.sin() * 2.0).abs() % (2.5 + level as f32 * 0.5);
                    let w = cell_w * 0.65;
                    let d = cell_d * 0.65;

                    // Color variation
                    let hue_shift = (seed * 0.03).sin() * 0.15;
                    let color = [
                        (base_color[0] + hue_shift).clamp(0.0, 1.0),
                        (base_color[1] - hue_shift * 0.5).clamp(0.0, 1.0),
                        (base_color[2] + hue_shift * 0.3).clamp(0.0, 1.0),
                    ];

                    let mesh = box_mesh(cx, 0.0, cz, w, h, d, color);
                    self.buildings.push(Building {
                        x: cx, z: cz, width: w, depth: d, height: h,
                        color, segment: seg, mesh_cache: mesh,
                    });

                    // Antenna on tall buildings
                    if h > 3.0 {
                        let ant_color = [1.0, 0.3, 0.1];
                        let ant = box_mesh(cx, h, cz, 0.05, 0.6, 0.05, ant_color);
                        self.buildings.push(Building {
                            x: cx, z: cz, width: 0.05, depth: 0.05, height: 0.6,
                            color: ant_color, segment: seg, mesh_cache: ant,
                        });
                    }
                }
            }

            // Roads between buildings (thin flat boxes)
            for bx in 0..=grid_per_seg {
                let rx = sx + 0.5 + bx as f32 * cell_w;
                let road = box_mesh(rx, 0.0, sz + seg_d * 0.5, 0.25, 0.02, seg_d - 1.0, [0.15, 0.15, 0.15]);
                self.buildings.push(Building {
                    x: rx, z: sz + seg_d * 0.5, width: 0.25, depth: seg_d, height: 0.02,
                    color: [0.15, 0.15, 0.15], segment: seg, mesh_cache: road,
                });
            }
        }
    }

    fn generate_folds(&mut self, size: f32, segs: usize) {
        let half = size * 0.5;
        let (cols, rows) = match segs {
            2 => (2, 1),
            4 => (2, 2),
            6 => (3, 2),
            8 => (4, 2),
            _ => (2, 1),
        };
        let seg_w = size / cols as f32;
        let seg_d = size / rows as f32;

        // Create a fold for each segment along its outer edge
        for seg in 0..segs {
            let col = seg % cols;
            let row = seg / cols;
            let sx = -half + col as f32 * seg_w;
            let sz = -half + row as f32 * seg_d;
            let cx = sx + seg_w * 0.5;
            let cz = sz + seg_d * 0.5;

            // Fold axis: segments fold along the edge closest to center
            let fold_origin = Vec3::new(cx, 0.0, cz);

            // Primary fold: rotate around X axis (north-south fold)
            // The fold axis determines which direction the segment folds
            let axis = if col % 2 == 0 {
                Vec3::new(0.0, 0.0, 1.0) // fold along Z (east-west axis)
            } else {
                Vec3::new(1.0, 0.0, 0.0) // fold along X (north-south axis)
            };

            let side = if col < cols / 2 { -1.0 } else { 1.0 };

            self.folds.push(FoldPlane::new(axis, fold_origin, seg, side));
        }
    }

    pub fn update(&mut self, timestamp: f64) {
        let dt = if self.last_timestamp == 0.0 {
            0.016
        } else {
            ((timestamp - self.last_timestamp) / 1000.0) as f32
        };
        self.last_timestamp = timestamp;
        self.time += dt;

        // Animate fold targets
        for fold in &mut self.folds {
            let diff = fold.target - fold.fold_amount;
            if diff.abs() > 0.001 {
                fold.fold_amount += diff * dt * 4.0;
            } else {
                fold.fold_amount = fold.target;
            }
        }

        // Update hint timer
        if self.hint_timer > 0.0 {
            self.hint_timer -= dt;
        }

        // Check completion
        if self.state == GameState::Playing {
            self.check_completion();
        }

        // Complete timer
        if self.level_complete_show {
            self.complete_timer += dt;
        }

        self.update_ui();
    }

    fn check_completion(&mut self) {
        let lvl = self.current_level;
        let level = &self.levels[lvl];
        let solution = level.solution_folds.clone();

        let mut all_done = true;
        for (seg_idx, target) in &solution {
            if let Some(fold) = self.folds.get(*seg_idx) {
                let diff = (fold.fold_amount - target).abs();
                if diff > 0.08 {
                    all_done = false;
                    break;
                }
            }
        }

        if all_done && !self.level_complete_show {
            self.level_complete_show = true;
            self.complete_timer = 0.0;
            self.update_level_complete_ui(true);
        }
    }

    pub fn render(&self) {
        let w = self.canvas.width() as i32;
        let h = self.canvas.height() as i32;

        self.renderer.begin_frame(w, h, self.current_level as f32);
        self.renderer.set_time(self.time);

        // Camera
        let eye = Vec3::new(
            self.cam_target.x + self.cam_dist * self.cam_yaw.sin() * self.cam_pitch.cos(),
            self.cam_target.y + self.cam_dist * self.cam_pitch.sin(),
            self.cam_target.z + self.cam_dist * self.cam_yaw.cos() * self.cam_pitch.cos(),
        );
        let view = Mat4::look_at(&eye, &self.cam_target, &Vec3::new(0.0, 1.0, 0.0));
        let aspect = w as f32 / h as f32;
        let proj = Mat4::perspective(0.8, aspect, 0.5, 500.0);

        self.renderer.set_camera(&view, &proj);

        let model = Mat4::identity();

        // Draw all buildings grouped by segment
        for building in &self.buildings {
            let seg = building.segment;
            let fold = self.folds.get(seg);
            let (fold_amount, fold_axis, fold_origin, fold_side) = if let Some(f) = fold {
                (f.fold_amount, [f.axis.x, f.axis.y, f.axis.z], [f.origin.x, f.origin.y, f.origin.z], f.side)
            } else {
                (0.0, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0], 0.0)
            };

            let highlighted = self.selected_segment == Some(seg);

            self.renderer.draw_mesh(
                &building.mesh_cache,
                &model,
                fold_amount,
                fold_axis,
                fold_origin,
                fold_side,
                highlighted,
            );
        }
    }

    pub fn on_mouse_down(&mut self, event: web_sys::MouseEvent) {
        self.mouse_down = true;
        self.last_mouse_x = event.client_x() as f32;
        self.last_mouse_y = event.client_y() as f32;
        self.drag_start_x = self.last_mouse_x;
        self.drag_start_y = self.last_mouse_y;

        // Pick segment based on mouse position (simplified: divide canvas into regions)
        self.pick_segment(event.client_x() as f32, event.client_y() as f32);
    }

    pub fn on_mouse_up(&mut self, _event: web_sys::MouseEvent) {
        self.mouse_down = false;
    }

    pub fn on_mouse_move(&mut self, event: web_sys::MouseEvent) {
        let x = event.client_x() as f32;
        let y = event.client_y() as f32;
        let dx = x - self.last_mouse_x;
        let dy = y - self.last_mouse_y;

        if self.mouse_down {
            if event.shift_key() || self.selected_segment.is_none() {
                // Rotate camera
                self.cam_yaw += dx * 0.01;
                self.cam_pitch = (self.cam_pitch - dy * 0.01).clamp(0.1, 1.4);
            } else if let Some(seg) = self.selected_segment {
                // Fold the selected segment
                if let Some(fold) = self.folds.get_mut(seg) {
                    let drag_dist = (x - self.drag_start_x) + (self.drag_start_y - y);
                    fold.target = (drag_dist / 200.0).clamp(0.0, 1.0);
                }
            }
        }

        self.last_mouse_x = x;
        self.last_mouse_y = y;
    }

    pub fn on_wheel(&mut self, event: web_sys::WheelEvent) {
        self.cam_dist = (self.cam_dist + event.delta_y() as f32 * 0.05).clamp(8.0, 80.0);
    }

    pub fn on_key_down(&mut self, event: web_sys::KeyboardEvent) {
        match event.key().as_str() {
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" => {
                let seg = event.key().parse::<usize>().unwrap() - 1;
                if seg < self.folds.len() {
                    self.selected_segment = Some(seg);
                    self.update_status(&format!("Selected segment {}", seg + 1));
                }
            }
            "ArrowUp" => {
                if let Some(seg) = self.selected_segment {
                    if let Some(fold) = self.folds.get_mut(seg) {
                        fold.target = (fold.target + 0.1).clamp(0.0, 1.0);
                    }
                }
            }
            "ArrowDown" => {
                if let Some(seg) = self.selected_segment {
                    if let Some(fold) = self.folds.get_mut(seg) {
                        fold.target = (fold.target - 0.1).clamp(0.0, 1.0);
                    }
                }
            }
            "r" | "R" => {
                // Reset folds
                for fold in &mut self.folds {
                    fold.target = 0.0;
                }
                self.level_complete_show = false;
                self.state = GameState::Playing;
                self.update_level_complete_ui(false);
            }
            "n" | "N" | "Enter" => {
                if self.level_complete_show && self.current_level < 4 {
                    self.load_level(self.current_level + 1);
                }
            }
            "Escape" => {
                self.selected_segment = None;
            }
            _ => {}
        }
    }

    fn pick_segment(&mut self, x: f32, y: f32) {
        let w = self.canvas.width() as f32;
        let h = self.canvas.height() as f32;
        let nx = x / w;
        let ny = y / h;

        let segs = self.folds.len();
        if segs == 0 { return; }

        let (cols, _rows) = match segs {
            2 => (2usize, 1usize),
            4 => (2, 2),
            6 => (3, 2),
            8 => (4, 2),
            _ => (2, 1),
        };

        // Map screen position to rough segment
        let col = (nx * cols as f32) as usize;
        let rows = (segs + cols - 1) / cols;
        let row = (ny * rows as f32) as usize;
        let seg = (row.min(rows - 1)) * cols + col.min(cols - 1);
        let seg = seg.min(segs - 1);

        self.selected_segment = Some(seg);
        self.update_status(&format!("Segment {} selected — drag to fold", seg + 1));
    }

    fn update_status(&self, msg: &str) {
        if let Some(window) = web_sys::window() {
            if let Some(doc) = window.document() {
                if let Some(el) = doc.get_element_by_id("status") {
                    el.set_inner_html(msg);
                }
            }
        }
    }

    fn update_ui(&self) {
        if let Some(window) = web_sys::window() {
            if let Some(doc) = window.document() {
                // Update fold sliders display
                for (i, fold) in self.folds.iter().enumerate() {
                    let id = format!("fold-{}", i);
                    if let Some(el) = doc.get_element_by_id(&id) {
                        let pct = (fold.fold_amount * 100.0) as i32;
                        el.set_inner_html(&format!("{}%", pct));
                    }
                }
            }
        }
    }

    fn update_level_complete_ui(&self, show: bool) {
        if let Some(window) = web_sys::window() {
            if let Some(doc) = window.document() {
                if let Some(el) = doc.get_element_by_id("level-complete") {
                    if show {
                        let lvl = &self.levels[self.current_level];
                        el.set_inner_html(&format!(
                            "<h2>Level {} Complete!</h2><p>{}</p>{}",
                            lvl.number,
                            lvl.name,
                            if self.current_level < 4 {
                                "<p>Press N or Enter for next level</p>"
                            } else {
                                "<p>You've folded the entire city! Reality is yours to bend.</p>"
                            }
                        ));
                        let _ = el.set_attribute("style", "display:block");
                    } else {
                        let _ = el.set_attribute("style", "display:none");
                    }
                }

                // Update level name and hint
                let lvl = &self.levels[self.current_level];
                if let Some(el) = doc.get_element_by_id("level-name") {
                    el.set_inner_html(&format!("Level {}: {}", lvl.number, lvl.name));
                }
                if let Some(el) = doc.get_element_by_id("level-desc") {
                    el.set_inner_html(lvl.description);
                }
                if let Some(el) = doc.get_element_by_id("hint") {
                    el.set_inner_html(lvl.hint);
                }
            }
        }
    }
}
