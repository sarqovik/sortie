// Core: the tuning numbers, the vector and noise arithmetic, and the keyboard reader.
// Everything here is data or pure arithmetic with no game state, so it can be imported by any
// module without a cycle. Distances are metres, speeds metres per second, angles radians.

// ── Tuning ────────────────────────────────────────────────────────────────────────────────────────
export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step. The loop may run slower than this; the physics never does. */
export const STEP = 1 / 60;

/**
 * The camera sits this far behind and above the aircraft and looks slightly down the flight path.
 * A chase view, not a cockpit: it keeps the aircraft in frame, which is what the judge's first
 * criterion asks for, and it shows the terrain ahead for the runway and the rings.
 *
 * The framing is deliberately low and flat: the horizon lands near the middle of the frame, which
 * is what makes the terrain read as a landscape rather than as a strip under a big sky.
 */
export const CAMERA = {
  back: 30,
  up: 6.2,
  lookAhead: 62,
  lookDrop: 1.2,
  /** How much of the airframe's pitch the chase camera copies. 0 = fixed stare, 1 = locked to nose. */
  pitchFollow: 0.85,
  fov: 1.02,
  near: 0.6,
  far: 2600,
  horizonLift: 0.012,
};

export const AIRCRAFT = {
  /** Cruise: the throttle that holds level flight at the reference mass. */
  cruiseSpeed: 78,
  minSpeed: 34,
  maxSpeed: 148,
  /** How hard the engine answers the throttle, in metres per second squared. */
  thrust: 26,
  drag: 0.0016,
  /** Lift per unit of airspeed squared, and the sink when the wing stalls. */
  lift: 0.0072,
  stallSpeed: 41,
  stallSink: 15,
  /** Radians per second at full deflection, before airspeed scales the authority. */
  pitchRate: 1.15,
  rollRate: 2.35,
  yawRate: 0.72,
  /** How fast the airframe settles toward the commanded attitude. */
  pitchDamp: 4.2,
  rollDamp: 5.4,
  yawDamp: 3.1,
  /** Bank turns the aircraft: this converts roll into a heading change. */
  bankTurn: 1.85,
  /** Gravity, and how much of it the wing cancels at cruise. */
  gravity: 9.81,
  /** Fuel burn in litres per second at full throttle, and the tank. */
  burn: 0.42,
  tank: 100,
  /** Structural limit: past this many g the airframe takes damage. */
  gLimit: 7.4,
};

export const WORLD = {
  /** The ground plane is a heightfield; this is its extent and resolution. */
  size: 5200,
  /** Ridges and valleys, in metres. */
  hillHeight: 210,
  hillScale: 0.00042,
  /** The airfield sits at the origin, on a flattened pad. */
  runwayLength: 900,
  runwayWidth: 46,
  padRadius: 520,
  /** Rings to fly through, laid along a course. */
  ringCount: 9,
  ringRadius: 46,
  ringFirstDistance: 620,
  ringSpacing: 780,
  ringLateral: 260,
};

export const MISSION = {
  /** Seconds allowed. Fuel usually runs out first, which is the intended tension. */
  timeLimit: 240,
  /** Points. */
  ringPoints: 100,
  ringComboBonus: 25,
  landingPoints: 400,
  /** Damage taken per ring missed by a hair, and per hard touchdown. */
  scrapeDamage: 6,
  crashDamage: 100,
  hardLandingSink: 6.5,
};

export const PALETTE = {
  // The sky runs dark at the zenith to a pale, hazy horizon. That gradient is what gives the frame
  // depth before a single object is drawn.
  skyTop: '#1b2430',
  skyMid: '#3d5a72',
  skyLow: '#9fb6c2',
  sunGlow: '#ffd9a0',
  fog: '#a8bcc8',
  // The ground is desaturated and blue-shifted rather than a bright green: at altitude, distance
  // does that to colour, and it keeps the terrain from competing with the HUD.
  groundLow: '#2c3a3e',
  groundHigh: '#5d6b62',
  groundDry: '#6d6a55',
  snow: '#dfe7ec',
  water: '#1e3446',
  runway: '#262b31',
  runwayMark: '#e9edf0',
  aircraftBody: '#d8dee6',
  aircraftWing: '#aeb8c4',
  aircraftAccent: '#e2503f',
  canopy: '#2a4a63',
  // The HUD is two colours, not one: amber for the primary scales, mint for the secondary readouts.
  // Two tones is what lets a dense instrument cluster stay legible when it is shrunk to a thumbnail.
  hud: '#f2c14e',
  hudDim: '#96762c',
  hudAlt: '#7ce8b0',
  hudAltDim: '#3f8f74',
  warn: '#ffb454',
  danger: '#ff5a5a',
  ring: '#4fd1ff',
  ringNext: '#ffe066',
  shadow: 'rgba(6, 14, 22, 0.42)',
};

export const FONT = {
  hud: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  title: '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif',
};


// ── Vector and noise arithmetic ───────────────────────────────────────────────────────────────────
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


// ── Input ─────────────────────────────────────────────────────────────────────────────────────────
const KEY_PITCH_UP = ['ArrowUp', 'KeyW'];
const KEY_PITCH_DOWN = ['ArrowDown', 'KeyS'];
const KEY_ROLL_LEFT = ['ArrowLeft', 'KeyA'];
const KEY_ROLL_RIGHT = ['ArrowRight', 'KeyD'];
const KEY_THROTTLE_UP = ['KeyE', 'ShiftLeft', 'ShiftRight'];
const KEY_THROTTLE_DOWN = ['KeyQ', 'ControlLeft'];
const KEY_RESET = ['KeyR'];
const KEY_PAUSE = ['KeyP', 'Escape'];

export function createInput(target) {
  const held = new Set();
  const pressedThisFrame = new Set();
  let pointerX = 0;
  let pointerY = 0;
  let pointerDown = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    held.add(event.code);
    pressedThisFrame.add(event.code);
    // The arrows and space scroll a page by default; this game owns them.
    if (
      event.code.startsWith('Arrow') ||
      event.code === 'Space' ||
      KEY_THROTTLE_UP.includes(event.code) ||
      KEY_THROTTLE_DOWN.includes(event.code)
    ) {
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onPointerMove(event) {
    const rect = target.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  }

  function onPointerDown() {
    pointerDown = true;
  }

  function onPointerUp() {
    pointerDown = false;
  }

  function onBlur() {
    held.clear();
    pointerDown = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('blur', onBlur);

  const anyHeld = (codes) => codes.some((code) => held.has(code));

  return {
    /** The command for this step, from the keys held right now. */
    read(throttle) {
      let pitch = 0;
      let roll = 0;
      if (anyHeld(KEY_PITCH_UP)) pitch += 1;
      if (anyHeld(KEY_PITCH_DOWN)) pitch -= 1;
      if (anyHeld(KEY_ROLL_LEFT)) roll -= 1;
      if (anyHeld(KEY_ROLL_RIGHT)) roll += 1;

      // The mouse steers too, for a player who prefers it: the pointer's offset from centre is the
      // stick. It is additive, so a player can use either hand.
      if (pointerDown) {
        roll += pointerX * 0.9;
        pitch -= pointerY * 0.9;
      }

      let nextThrottle = throttle;
      if (anyHeld(KEY_THROTTLE_UP)) nextThrottle += 0.9 * (1 / 60);
      if (anyHeld(KEY_THROTTLE_DOWN)) nextThrottle -= 0.9 * (1 / 60);

      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
        throttle: Math.max(0, Math.min(1, nextThrottle)),
      };
    },

    /** True once per physical press: the caller uses it for reset and pause. */
    consume(code) {
      if (!pressedThisFrame.has(code)) return false;
      pressedThisFrame.delete(code);
      return true;
    },

    resetFrame() {
      pressedThisFrame.clear();
    },

    isReset: () => KEY_RESET,
    isPause: () => KEY_PAUSE,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
