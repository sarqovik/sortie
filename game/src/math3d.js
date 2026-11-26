// Small vector and matrix helpers, plus the noise the terrain is built from. Kept arithmetic-only:
// no allocation in the hot path, so the renderer can call these thousands of times a frame.

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Smoothstep, for terrain blending and fade curves. */
export function smooth(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a, k) {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function normalize(a) {
  const len = length(a);
  return len > 1e-9 ? { x: a.x / len, y: a.y / len, z: a.z / len } : { x: 0, y: 0, z: 0 };
}

/**
 * The camera basis from a position and a look-at target. Returns the three axes the projection
 * needs plus the focal length in pixels, so a caller never rebuilds the trigonometry per vertex.
 */
export function cameraBasis(position, target, fov, width) {
  const forward = normalize(sub(target, position));
  const worldUp = { x: 0, y: 1, z: 0 };
  let right = cross(forward, worldUp);
  // Looking straight up or down leaves no unique right vector; pick one and carry on.
  if (length(right) < 1e-6) right = { x: 1, y: 0, z: 0 };
  right = normalize(right);
  const up = normalize(cross(right, forward));
  const focal = width / 2 / Math.tan(fov / 2);
  return { position, forward, right, up, focal };
}

/**
 * Project a world point through a camera basis. Returns screen x/y, a depth, and whether the point
 * is in front of the near plane. Points behind it are flagged rather than clamped, so a caller can
 * clip a polygon instead of drawing a smear.
 */
export function project(basis, point, width, height, near) {
  const dx = point.x - basis.position.x;
  const dy = point.y - basis.position.y;
  const dz = point.z - basis.position.z;
  const depth = dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z;
  if (depth < near) return { x: 0, y: 0, depth, visible: false };
  const side = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
  const lift = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
  const inv = basis.focal / depth;
  return {
    x: width / 2 + side * inv,
    y: height / 2 - lift * inv,
    depth,
    visible: true,
  };
}

/** A cheap deterministic hash: the same seed and cell always give the same number in [0, 1). */
export function hash2(ix, iz, seed) {
  let h = ix * 374761393 + iz * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Value noise at a point, smoothed. Two octaves is enough for ridgelines at this scale and costs a
 * fraction of a full simplex implementation.
 */
export function noise2(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = lerp(a, b, ux);
  const bottom = lerp(c, d, ux);
  return lerp(top, bottom, uz);
}

/** Ridged noise: sharp crests instead of rolling hills, which reads as mountain country. */
export function ridge2(x, z, seed) {
  const n = noise2(x, z, seed);
  return 1 - Math.abs(n * 2 - 1);
}

/** A seeded generator for anything that must be reproducible: rings, clouds, the autopilot. */
export function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}
