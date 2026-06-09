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
  // The collision body is a single sphere at `position`; the camera rides
  // this far above it so the standing eye height is radius + eyeOffset = 1.6m
  // (without the offset the eye sat at sphere-rest height, 0.35m — the whole
  // game looked like it was played at ankle height).
  readonly eyeOffset = 1.25;

  onGround = false;
  keys = new Set<string>();

  // Last reset position/yaw — used by the fall safety net so falling out of
  // the world returns you to the level's most recent spawn, not world origin.
  private spawnPos = new THREE.Vector3(0, 5, 0);
  private spawnYaw = 0;

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
    this.spawnPos.copy(pos);
    this.spawnYaw = yaw;
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.onGround = false;
    // Sync the camera immediately so the level renders correctly even before
    // the next physics tick (e.g. while pointer-lock is still being acquired
    // after a level transition — otherwise the new scene renders from the
    // previous level's last camera position and looks completely black).
    this.camera.position.set(pos.x, pos.y + this.eyeOffset, pos.z);
    this.camera.rotation.set(0, yaw, 0, "YXZ");
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
      this.reset(this.spawnPos, this.spawnYaw);
    }

    // Update camera transform.
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeOffset,
      this.position.z
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  forward(): THREE.Vector3 {
    const v = new THREE.Vector3(0, 0, -1);
    v.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    return v;
  }

  // World-space eye position (where the camera is).
  eyePos(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.eyeOffset,
      this.position.z
    );
  }
}
