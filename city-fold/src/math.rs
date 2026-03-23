/// 3D vector
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn zero() -> Self {
        Self::new(0.0, 0.0, 0.0)
    }

    pub fn length(&self) -> f32 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }

    pub fn normalize(&self) -> Self {
        let len = self.length();
        if len > 0.0001 {
            Self::new(self.x / len, self.y / len, self.z / len)
        } else {
            *self
        }
    }

    pub fn dot(&self, other: &Vec3) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn cross(&self, other: &Vec3) -> Vec3 {
        Vec3::new(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )
    }

    pub fn add(&self, other: &Vec3) -> Vec3 {
        Vec3::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }

    pub fn sub(&self, other: &Vec3) -> Vec3 {
        Vec3::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }

    pub fn scale(&self, s: f32) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }

    pub fn lerp(&self, other: &Vec3, t: f32) -> Vec3 {
        self.scale(1.0 - t).add(&other.scale(t))
    }
}

/// 4x4 column-major matrix
#[derive(Clone, Copy, Debug)]
pub struct Mat4 {
    pub data: [f32; 16],
}

impl Mat4 {
    pub fn identity() -> Self {
        let mut data = [0.0f32; 16];
        data[0] = 1.0;
        data[5] = 1.0;
        data[10] = 1.0;
        data[15] = 1.0;
        Self { data }
    }

    pub fn multiply(&self, other: &Mat4) -> Mat4 {
        let a = &self.data;
        let b = &other.data;
        let mut c = [0.0f32; 16];
        for i in 0..4 {
            for j in 0..4 {
                for k in 0..4 {
                    c[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
                }
            }
        }
        Mat4 { data: c }
    }

    pub fn perspective(fovy: f32, aspect: f32, near: f32, far: f32) -> Self {
        let f = 1.0 / (fovy / 2.0).tan();
        let mut data = [0.0f32; 16];
        data[0] = f / aspect;
        data[5] = f;
        data[10] = (far + near) / (near - far);
        data[11] = -1.0;
        data[14] = (2.0 * far * near) / (near - far);
        Self { data }
    }

    pub fn look_at(eye: &Vec3, center: &Vec3, up: &Vec3) -> Self {
        let f = center.sub(eye).normalize();
        let s = f.cross(up).normalize();
        let u = s.cross(&f);

        let mut data = [0.0f32; 16];
        data[0] = s.x;
        data[4] = s.y;
        data[8] = s.z;
        data[1] = u.x;
        data[5] = u.y;
        data[9] = u.z;
        data[2] = -f.x;
        data[6] = -f.y;
        data[10] = -f.z;
        data[12] = -s.dot(eye);
        data[13] = -u.dot(eye);
        data[14] = f.dot(eye);
        data[15] = 1.0;
        Self { data }
    }

    pub fn translation(tx: f32, ty: f32, tz: f32) -> Self {
        let mut m = Self::identity();
        m.data[12] = tx;
        m.data[13] = ty;
        m.data[14] = tz;
        m
    }

    pub fn scale(sx: f32, sy: f32, sz: f32) -> Self {
        let mut m = Self::identity();
        m.data[0] = sx;
        m.data[5] = sy;
        m.data[10] = sz;
        m
    }

    pub fn rotation_y(angle: f32) -> Self {
        let c = angle.cos();
        let s = angle.sin();
        let mut m = Self::identity();
        m.data[0] = c;
        m.data[2] = -s;
        m.data[8] = s;
        m.data[10] = c;
        m
    }

    pub fn rotation_x(angle: f32) -> Self {
        let c = angle.cos();
        let s = angle.sin();
        let mut m = Self::identity();
        m.data[5] = c;
        m.data[6] = s;
        m.data[9] = -s;
        m.data[10] = c;
        m
    }

    pub fn rotation_z(angle: f32) -> Self {
        let c = angle.cos();
        let s = angle.sin();
        let mut m = Self::identity();
        m.data[0] = c;
        m.data[1] = s;
        m.data[4] = -s;
        m.data[5] = c;
        m
    }

    pub fn transform_vec3(&self, v: &Vec3) -> Vec3 {
        let d = &self.data;
        Vec3::new(
            d[0] * v.x + d[4] * v.y + d[8] * v.z + d[12],
            d[1] * v.x + d[5] * v.y + d[9] * v.z + d[13],
            d[2] * v.x + d[6] * v.y + d[10] * v.z + d[14],
        )
    }
}

/// Quaternion for smooth rotations
#[derive(Clone, Copy, Debug)]
pub struct Quat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Quat {
    pub fn identity() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
    }

    pub fn from_axis_angle(axis: &Vec3, angle: f32) -> Self {
        let half = angle * 0.5;
        let s = half.sin();
        let a = axis.normalize();
        Self {
            x: a.x * s,
            y: a.y * s,
            z: a.z * s,
            w: half.cos(),
        }
    }

    pub fn to_mat4(&self) -> Mat4 {
        let x = self.x;
        let y = self.y;
        let z = self.z;
        let w = self.w;
        let mut m = Mat4::identity();
        m.data[0] = 1.0 - 2.0 * (y * y + z * z);
        m.data[1] = 2.0 * (x * y + w * z);
        m.data[2] = 2.0 * (x * z - w * y);
        m.data[4] = 2.0 * (x * y - w * z);
        m.data[5] = 1.0 - 2.0 * (x * x + z * z);
        m.data[6] = 2.0 * (y * z + w * x);
        m.data[8] = 2.0 * (x * z + w * y);
        m.data[9] = 2.0 * (y * z - w * x);
        m.data[10] = 1.0 - 2.0 * (x * x + y * y);
        m
    }

    pub fn slerp(&self, other: &Quat, t: f32) -> Quat {
        let mut dot = self.x * other.x + self.y * other.y + self.z * other.z + self.w * other.w;
        let other2 = if dot < 0.0 {
            dot = -dot;
            Quat { x: -other.x, y: -other.y, z: -other.z, w: -other.w }
        } else {
            *other
        };

        if dot > 0.9995 {
            return Quat {
                x: self.x + t * (other2.x - self.x),
                y: self.y + t * (other2.y - self.y),
                z: self.z + t * (other2.z - self.z),
                w: self.w + t * (other2.w - self.w),
            };
        }

        let theta0 = dot.acos();
        let theta = theta0 * t;
        let sin_theta = theta.sin();
        let sin_theta0 = theta0.sin();
        let s0 = theta.cos() - dot * sin_theta / sin_theta0;
        let s1 = sin_theta / sin_theta0;
        Quat {
            x: s0 * self.x + s1 * other2.x,
            y: s0 * self.y + s1 * other2.y,
            z: s0 * self.z + s1 * other2.z,
            w: s0 * self.w + s1 * other2.w,
        }
    }
}
