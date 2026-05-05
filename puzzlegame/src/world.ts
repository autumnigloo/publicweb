import * as THREE from "three";
import type { CollisionWorld } from "./player";

// Axis-aligned solid box used for collision and (often) rendering.
export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export function box(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number
): Box {
  return {
    min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  };
}

// Build a THREE.Mesh from a box using the given material.
export function boxMesh(b: Box, mat: THREE.Material): THREE.Mesh {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(
    (b.min.x + b.max.x) / 2,
    (b.min.y + b.max.y) / 2,
    (b.min.z + b.max.z) / 2
  );
  return m;
}

// Sphere-vs-AABB: closest point on box to sphere center, then distance check.
export function sphereHitsBox(
  pos: THREE.Vector3,
  radius: number,
  b: Box
): boolean {
  const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
  const cy = Math.max(b.min.y, Math.min(pos.y, b.max.y));
  const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const dz = pos.z - cz;
  return dx * dx + dy * dy + dz * dz < radius * radius;
}

export class BoxWorld implements CollisionWorld {
  solids: Box[] = [];

  add(b: Box) {
    this.solids.push(b);
  }

  collides(pos: THREE.Vector3, radius: number): boolean {
    for (const b of this.solids) {
      if (sphereHitsBox(pos, radius, b)) return true;
    }
    return false;
  }
}
