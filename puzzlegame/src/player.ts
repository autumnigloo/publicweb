import * as THREE from "three";

export interface CollisionWorld {
  // Returns true if a sphere at `pos` with `radius` collides with anything solid.
  // Used for axis-by-axis collision in move().
  collides(pos: THREE.Vector3, radius: number): boolean;
}

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3(0, 1.6, 0);
  readonly velocity = new THREE.Vector3();

  yaw = 0;
  pitch = 0;

  // Tunables
  readonly radius = 0.35;
  readonly height = 1.6;
  readonly walkSpeed = 4.5;
  readonly jumpVel = 5.6;
  readonly gravity = 18;

  onGround = false;
  keys = new Set<string>();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.05,
      300
    );
  }

  reset(pos: THREE.Vector3, yaw = 0) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.onGround = false;
  }

  installInput(canvas: HTMLElement) {
    document.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code) &&
        document.pointerLockElement === canvas
      ) {
        e.preventDefault();
      }
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));

    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas) return;
      const sens = 0.0022;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.01;
      if (this.pitch > lim) this.pitch = lim;
      if (this.pitch < -lim) this.pitch = -lim;
    });
  }

  update(dt: number, world: CollisionWorld) {
    // Build movement vector in local space, then rotate by yaw.
    const fwd = new THREE.Vector3();
    if (this.keys.has("KeyW")) fwd.z -= 1;
    if (this.keys.has("KeyS")) fwd.z += 1;
    if (this.keys.has("KeyA")) fwd.x -= 1;
    if (this.keys.has("KeyD")) fwd.x += 1;
    if (fwd.lengthSq() > 0) fwd.normalize();
    fwd.applyEuler(new THREE.Euler(0, this.yaw, 0, "YXZ"));

    this.velocity.x = fwd.x * this.walkSpeed;
    this.velocity.z = fwd.z * this.walkSpeed;

    // Gravity
    this.velocity.y -= this.gravity * dt;

    // Jump
    if (this.onGround && this.keys.has("Space")) {
      this.velocity.y = this.jumpVel;
      this.onGround = false;
    }

    // Axis-by-axis collision against world.
    const tryMove = (axis: "x" | "y" | "z") => {
      const before = this.position[axis];
      this.position[axis] += this.velocity[axis] * dt;
      if (world.collides(this.position, this.radius)) {
        this.position[axis] = before;
        if (axis === "y") {
          if (this.velocity.y < 0) this.onGround = true;
          this.velocity.y = 0;
        } else {
          this.velocity[axis] = 0;
        }
      } else if (axis === "y") {
        this.onGround = false;
      }
    };

    tryMove("x");
    tryMove("z");
    tryMove("y");

    // Hard floor safety net.
    if (this.position.y < -50) {
      this.position.set(0, 5, 0);
      this.velocity.set(0, 0, 0);
    }

    // Update camera transform.
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  forward(): THREE.Vector3 {
    const v = new THREE.Vector3(0, 0, -1);
    v.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    return v;
  }
}
