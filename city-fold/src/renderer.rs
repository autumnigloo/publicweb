use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{WebGlRenderingContext as GL, WebGlBuffer, WebGlProgram, WebGlShader, WebGlUniformLocation};
use js_sys::Float32Array;

use crate::math::Mat4;

const VERT_SHADER: &str = r#"
    attribute vec3 a_position;
    attribute vec3 a_normal;
    attribute vec3 a_color;

    uniform mat4 u_model;
    uniform mat4 u_view;
    uniform mat4 u_proj;
    uniform float u_fold_amount;
    uniform vec3 u_fold_axis;
    uniform vec3 u_fold_origin;
    uniform float u_fold_side; // 1.0 or -1.0 or 0.0 (no fold)
    uniform float u_highlight;

    varying vec3 v_normal;
    varying vec3 v_color;
    varying vec3 v_world_pos;
    varying float v_highlight;

    void main() {
        vec4 world_pos = u_model * vec4(a_position, 1.0);

        // Apply fold transform if this vertex is on the folding side
        if (u_fold_side != 0.0) {
            vec3 p = world_pos.xyz - u_fold_origin;
            float side_val = dot(p, u_fold_axis);

            if (sign(side_val) == u_fold_side) {
                // Fold: rotate around the fold line
                // Find fold line (perpendicular to axis in xz plane)
                vec3 fold_line = cross(u_fold_axis, vec3(0.0, 1.0, 0.0));
                if (length(fold_line) < 0.001) {
                    fold_line = cross(u_fold_axis, vec3(1.0, 0.0, 0.0));
                }
                fold_line = normalize(fold_line);

                // Distance from fold origin along fold axis
                float d = dot(p, u_fold_axis);

                // Rotate the component along fold_axis by fold_amount * PI
                float angle = u_fold_amount * 3.14159265;
                float ca = cos(angle);
                float sa = sin(angle);

                // Project p onto fold line and vertical
                vec3 along_line = dot(p, fold_line) * fold_line;
                vec3 vert = p - along_line;
                float vy = vert.y;
                float vx = dot(vert, u_fold_axis);

                vec3 new_vert = u_fold_axis * (vx * ca - vy * sa) + vec3(0.0, vx * sa + vy * ca, 0.0);
                world_pos.xyz = u_fold_origin + along_line + new_vert;
            }
        }

        v_world_pos = world_pos.xyz;

        // Transform normal
        mat3 normal_mat = mat3(u_model);
        v_normal = normalize(normal_mat * a_normal);
        v_color = a_color;
        v_highlight = u_highlight;

        gl_Position = u_proj * u_view * world_pos;
    }
"#;

const FRAG_SHADER: &str = r#"
    precision mediump float;

    varying vec3 v_normal;
    varying vec3 v_color;
    varying vec3 v_world_pos;
    varying float v_highlight;

    uniform vec3 u_light_dir;
    uniform vec3 u_light_dir2;
    uniform float u_time;

    void main() {
        vec3 norm = normalize(v_normal);

        // Primary light
        float diff = max(dot(norm, normalize(u_light_dir)), 0.0);
        // Secondary fill light
        float diff2 = max(dot(norm, normalize(u_light_dir2)), 0.0) * 0.3;

        float ambient = 0.25;
        float lighting = ambient + diff * 0.6 + diff2;

        vec3 color = v_color * lighting;

        // Highlight pulse for selected segments
        if (v_highlight > 0.5) {
            float pulse = 0.5 + 0.5 * sin(u_time * 3.0);
            color = mix(color, vec3(1.0, 0.9, 0.2), pulse * 0.4);
        }

        gl_FragColor = vec4(color, 1.0);
    }
"#;

// Ground/sky shader for background
const SKY_VERT: &str = r#"
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.999, 1.0);
    }
"#;

const SKY_FRAG: &str = r#"
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_level;
    void main() {
        // Night city sky gradient
        vec3 top = mix(vec3(0.02, 0.02, 0.08), vec3(0.05, 0.02, 0.1), u_level / 4.0);
        vec3 bottom = mix(vec3(0.08, 0.04, 0.02), vec3(0.02, 0.06, 0.12), u_level / 4.0);
        vec3 color = mix(bottom, top, v_uv.y);
        gl_FragColor = vec4(color, 1.0);
    }
"#;

pub struct Renderer {
    pub gl: GL,
    program: WebGlProgram,
    sky_program: WebGlProgram,
    sky_buffer: WebGlBuffer,
    // Uniform locations
    u_model: Option<WebGlUniformLocation>,
    u_view: Option<WebGlUniformLocation>,
    u_proj: Option<WebGlUniformLocation>,
    u_fold_amount: Option<WebGlUniformLocation>,
    u_fold_axis: Option<WebGlUniformLocation>,
    u_fold_origin: Option<WebGlUniformLocation>,
    u_fold_side: Option<WebGlUniformLocation>,
    u_highlight: Option<WebGlUniformLocation>,
    u_light_dir: Option<WebGlUniformLocation>,
    u_light_dir2: Option<WebGlUniformLocation>,
    u_time: Option<WebGlUniformLocation>,
    u_sky_level: Option<WebGlUniformLocation>,
}

impl Renderer {
    pub fn new(gl: GL) -> Result<Self, JsValue> {
        let program = create_program(&gl, VERT_SHADER, FRAG_SHADER)?;
        let sky_program = create_program(&gl, SKY_VERT, SKY_FRAG)?;

        // Sky quad
        let sky_buffer = gl.create_buffer().ok_or("failed to create buffer")?;
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&sky_buffer));
        let sky_verts: [f32; 12] = [
            -1.0, -1.0,  1.0, -1.0,  -1.0, 1.0,
             1.0, -1.0,   1.0, 1.0,   -1.0, 1.0,
        ];
        let sky_array = unsafe { Float32Array::view(&sky_verts) };
        gl.buffer_data_with_array_buffer_view(GL::ARRAY_BUFFER, &sky_array, GL::STATIC_DRAW);

        gl.use_program(Some(&program));
        let u_model = gl.get_uniform_location(&program, "u_model");
        let u_view = gl.get_uniform_location(&program, "u_view");
        let u_proj = gl.get_uniform_location(&program, "u_proj");
        let u_fold_amount = gl.get_uniform_location(&program, "u_fold_amount");
        let u_fold_axis = gl.get_uniform_location(&program, "u_fold_axis");
        let u_fold_origin = gl.get_uniform_location(&program, "u_fold_origin");
        let u_fold_side = gl.get_uniform_location(&program, "u_fold_side");
        let u_highlight = gl.get_uniform_location(&program, "u_highlight");
        let u_light_dir = gl.get_uniform_location(&program, "u_light_dir");
        let u_light_dir2 = gl.get_uniform_location(&program, "u_light_dir2");
        let u_time = gl.get_uniform_location(&program, "u_time");
        let u_sky_level = gl.get_uniform_location(&sky_program, "u_level");

        gl.enable(GL::DEPTH_TEST);
        gl.enable(GL::CULL_FACE);
        gl.cull_face(GL::BACK);

        Ok(Self {
            gl,
            program,
            sky_program,
            sky_buffer,
            u_model,
            u_view,
            u_proj,
            u_fold_amount,
            u_fold_axis,
            u_fold_origin,
            u_fold_side,
            u_highlight,
            u_light_dir,
            u_light_dir2,
            u_time,
            u_sky_level,
        })
    }

    pub fn begin_frame(&self, width: i32, height: i32, level: f32) {
        self.gl.viewport(0, 0, width, height);
        self.gl.clear(GL::COLOR_BUFFER_BIT | GL::DEPTH_BUFFER_BIT);
        self.gl.clear_color(0.02, 0.02, 0.08, 1.0);

        // Draw sky
        self.gl.use_program(Some(&self.sky_program));
        self.gl.disable(GL::DEPTH_TEST);
        self.gl.uniform1f(self.u_sky_level.as_ref(), level);

        let pos_loc = self.gl.get_attrib_location(&self.sky_program, "a_position") as u32;
        self.gl.bind_buffer(GL::ARRAY_BUFFER, Some(&self.sky_buffer));
        self.gl.enable_vertex_attrib_array(pos_loc);
        self.gl.vertex_attrib_pointer_with_i32(pos_loc, 2, GL::FLOAT, false, 0, 0);
        self.gl.draw_arrays(GL::TRIANGLES, 0, 6);
        self.gl.disable_vertex_attrib_array(pos_loc);

        self.gl.enable(GL::DEPTH_TEST);
        self.gl.use_program(Some(&self.program));
    }

    pub fn set_camera(&self, view: &Mat4, proj: &Mat4) {
        self.gl.uniform_matrix4fv_with_f32_array(self.u_view.as_ref(), false, &view.data);
        self.gl.uniform_matrix4fv_with_f32_array(self.u_proj.as_ref(), false, &proj.data);

        // Set lights
        self.gl.uniform3f(self.u_light_dir.as_ref(), 0.5, 1.0, 0.7);
        self.gl.uniform3f(self.u_light_dir2.as_ref(), -0.3, 0.2, -0.5);
    }

    pub fn set_time(&self, t: f32) {
        self.gl.uniform1f(self.u_time.as_ref(), t);
    }

    pub fn draw_mesh(
        &self,
        vertices: &[f32],
        model: &Mat4,
        fold_amount: f32,
        fold_axis: [f32; 3],
        fold_origin: [f32; 3],
        fold_side: f32,
        highlighted: bool,
    ) {
        let buffer = self.gl.create_buffer().unwrap();
        self.gl.bind_buffer(GL::ARRAY_BUFFER, Some(&buffer));
        let array = unsafe { Float32Array::view(vertices) };
        self.gl.buffer_data_with_array_buffer_view(GL::ARRAY_BUFFER, &array, GL::DYNAMIC_DRAW);

        // Stride: 3 pos + 3 normal + 3 color = 9 floats = 36 bytes
        let stride = 9 * 4;
        let pos_loc = self.gl.get_attrib_location(&self.program, "a_position") as u32;
        let norm_loc = self.gl.get_attrib_location(&self.program, "a_normal") as u32;
        let col_loc = self.gl.get_attrib_location(&self.program, "a_color") as u32;

        self.gl.enable_vertex_attrib_array(pos_loc);
        self.gl.vertex_attrib_pointer_with_i32(pos_loc, 3, GL::FLOAT, false, stride, 0);
        self.gl.enable_vertex_attrib_array(norm_loc);
        self.gl.vertex_attrib_pointer_with_i32(norm_loc, 3, GL::FLOAT, false, stride, 12);
        self.gl.enable_vertex_attrib_array(col_loc);
        self.gl.vertex_attrib_pointer_with_i32(col_loc, 3, GL::FLOAT, false, stride, 24);

        self.gl.uniform_matrix4fv_with_f32_array(self.u_model.as_ref(), false, &model.data);
        self.gl.uniform1f(self.u_fold_amount.as_ref(), fold_amount);
        self.gl.uniform3f(self.u_fold_axis.as_ref(), fold_axis[0], fold_axis[1], fold_axis[2]);
        self.gl.uniform3f(self.u_fold_origin.as_ref(), fold_origin[0], fold_origin[1], fold_origin[2]);
        self.gl.uniform1f(self.u_fold_side.as_ref(), fold_side);
        self.gl.uniform1f(self.u_highlight.as_ref(), if highlighted { 1.0 } else { 0.0 });

        let count = (vertices.len() / 9) as i32;
        self.gl.draw_arrays(GL::TRIANGLES, 0, count);

        self.gl.disable_vertex_attrib_array(pos_loc);
        self.gl.disable_vertex_attrib_array(norm_loc);
        self.gl.disable_vertex_attrib_array(col_loc);
    }
}

fn compile_shader(gl: &GL, shader_type: u32, src: &str) -> Result<WebGlShader, JsValue> {
    let shader = gl.create_shader(shader_type).ok_or("Could not create shader")?;
    gl.shader_source(&shader, src);
    gl.compile_shader(&shader);
    if gl.get_shader_parameter(&shader, GL::COMPILE_STATUS).as_bool().unwrap_or(false) {
        Ok(shader)
    } else {
        let log = gl.get_shader_info_log(&shader).unwrap_or_default();
        Err(JsValue::from_str(&format!("Shader compile error: {}", log)))
    }
}

fn create_program(gl: &GL, vert: &str, frag: &str) -> Result<WebGlProgram, JsValue> {
    let vs = compile_shader(gl, GL::VERTEX_SHADER, vert)?;
    let fs = compile_shader(gl, GL::FRAGMENT_SHADER, frag)?;
    let prog = gl.create_program().ok_or("Could not create program")?;
    gl.attach_shader(&prog, &vs);
    gl.attach_shader(&prog, &fs);
    gl.link_program(&prog);
    if gl.get_program_parameter(&prog, GL::LINK_STATUS).as_bool().unwrap_or(false) {
        Ok(prog)
    } else {
        let log = gl.get_program_info_log(&prog).unwrap_or_default();
        Err(JsValue::from_str(&format!("Program link error: {}", log)))
    }
}
