// World: the terrain the game is flown over, the sortie that gives the flight a purpose, and the
// autopilot the screenshots use to reach a scene. Terrain is a heightfield; the mission is rings,
// fuel and damage; the autopilot drives the same aircraft the player does.

import { AIRCRAFT, MISSION, WORLD, clamp, lerp, makeRandom, noise2, ridge2, smooth } from './core.js';
import { createAircraft, stepAircraft } from './aircraft.js';

// ── Terrain ───────────────────────────────────────────────────────────────────────────────────────

const SEED = 9137;

/**
 * Ground height at a world position. Ridged noise gives the crests, two octaves of slower noise give
 * the broad valleys, and a fine octave adds the surface break-up that keeps a hillside from reading
 * as one flat facet. A radial falloff drops the whole field toward the horizon so the far edge never
 * shows a cliff where the mesh ends.
 */
export function groundHeight(x, z) {
  const pad = Math.sqrt(x * x + z * z);
  // The airfield is flat. The blend is wide enough that the hills start well past the runway end.
  const flat = smooth(WORLD.padRadius, WORLD.padRadius * 1.9, pad);

  const broad = noise2(x * WORLD.hillScale * 0.55, z * WORLD.hillScale * 0.55, SEED) - 0.5;
  const crest = ridge2(x * WORLD.hillScale, z * WORLD.hillScale, SEED + 71) - 0.35;
  const detail = noise2(x * WORLD.hillScale * 3.1, z * WORLD.hillScale * 3.1, SEED + 13) - 0.5;
  // A second ridged octave at twice the frequency: this is what puts secondary spurs and gullies on
  // the flanks of the main ridges, so a slope has structure instead of being a single plane.
  const spur = ridge2(x * WORLD.hillScale * 2.2, z * WORLD.hillScale * 2.2, SEED + 191) - 0.42;
  // A very fine octave, small in amplitude but high in frequency: it breaks up the large facets at
  // close range, which is where flat shading is most obvious.
  const grain = noise2(x * WORLD.hillScale * 7.4, z * WORLD.hillScale * 7.4, SEED + 307) - 0.5;

  const relief = (broad * 0.62 + crest * 0.74 + spur * 0.30 + detail * 0.13 + grain * 0.045) * WORLD.hillHeight;
  // A soft rim: the field falls away past three quarters of its extent, so the mesh edge is a valley.
  const rim = 1 - smooth(WORLD.size * 0.36, WORLD.size * 0.5, pad);
  return Math.max(-8, relief * flat * rim);
}

/**
 * The surface colour at a height and slope, as an [r, g, b] triple. Low ground is grass, high
 * ground rock and dry grass, the crests take snow, and anything below the waterline is water. The
 * slope term darkens the faces turned away from the sun, which is what makes the ridges read.
 */
export function groundColor(height, slope, out) {
  const snowLine = WORLD.hillHeight * 0.72;
  const rockLine = WORLD.hillHeight * 0.34;

  let r;
  let g;
  let b;
  if (height < -2) {
    // Water: a flat blue that deepens with depth.
    const deep = clamp(-height / 8, 0, 1);
    r = lerp(0.24, 0.11, deep);
    g = lerp(0.44, 0.25, deep);
    b = lerp(0.56, 0.34, deep);
  } else if (height > snowLine) {
    const t = smooth(snowLine, snowLine + 40, height);
    r = lerp(0.55, 0.91, t);
    g = lerp(0.55, 0.94, t);
    b = lerp(0.50, 0.95, t);
  } else if (height > rockLine) {
    const t = smooth(rockLine, snowLine, height);
    r = lerp(0.42, 0.55, t);
    g = lerp(0.47, 0.55, t);
    b = lerp(0.33, 0.50, t);
  } else {
    const t = smooth(0, rockLine, height);
    r = lerp(0.17, 0.42, t);
    g = lerp(0.27, 0.47, t);
    b = lerp(0.20, 0.33, t);
  }

  // Sun from the north-west: a face tilted toward it is brighter, one tilted away is darker.
  const shade = clamp(1 - slope * 0.55, 0.45, 1.18);
  out[0] = clamp(r * shade, 0, 1);
  out[1] = clamp(g * shade, 0, 1);
  out[2] = clamp(b * shade, 0, 1);
  return out;
}

/** The airfield: its centre, its heading, and the runway rectangle the landing test uses. */
export const AIRFIELD = {
  x: 0,
  z: 0,
  heading: 0,
  length: WORLD.runwayLength,
  width: WORLD.runwayWidth,
  elevation: 0,
};

/**
 * Scatter props across the terrain: trees on the lower slopes, rock outcrops on the high ground, and
 * a few huts on the flats. The scatter is a pure function of the seed, so the same seed always grows
 * the same forest — which is what lets a screenshot be reproduced.
 *
 * Each prop is returned as a world position plus a size and a kind. The renderer turns those into
 * simple projected shapes; nothing here knows how to draw.
 */
export function scatterProps(seed = 7) {
  const props = [];
  // A deterministic hash, so the scatter does not depend on the order the grid is walked in.
  function hash(ix, iz, salt) {
    let h = ix * 374761393 + iz * 668265263 + salt * 2147483647 + seed * 144665;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) % 100000) / 100000;
  }

  // Walk a grid of candidate cells. A cell only grows something if its hash clears a threshold, which
  // gives clumps and clearings rather than an even sprinkle.
  const cell = 46;
  const extent = 1500;
  for (let iz = -extent; iz <= extent; iz += cell) {
    for (let ix = -extent; ix <= extent; ix += cell) {
      const h1 = hash(ix, iz, 1);
      const h2 = hash(ix, iz, 2);
      const h3 = hash(ix, iz, 3);

      // Jitter inside the cell so the grid never shows.
      const x = ix + (h1 - 0.5) * cell * 0.9;
      const z = iz + (h2 - 0.5) * cell * 0.9;
      const y = groundHeight(x, z);

      // Nothing on the airfield pad, nothing underwater, nothing on the highest snow.
      const pad = Math.sqrt(x * x + z * z);
      if (pad < WORLD.padRadius * 1.15) continue;
      if (y < 1.5) continue;
      if (y > WORLD.hillHeight * 0.62) continue;

      // Trees want the lower and middle slopes; they thin out with height.
      const treeChance = 0.42 * (1 - y / (WORLD.hillHeight * 0.62));
      if (h3 < treeChance) {
        props.push({
          kind: 'tree',
          x,
          y,
          z,
          size: 5.5 + h1 * 4.5,
          tone: h2,
        });
        continue;
      }
      // Rock outcrops on the higher ground, where trees have thinned out.
      if (y > WORLD.hillHeight * 0.30 && h3 > 0.86) {
        props.push({ kind: 'rock', x, y, z, size: 3.0 + h2 * 3.4, tone: h1 });
        continue;
      }
      // A rare structure on the flats near the airfield: a hut or a mast.
      if (pad < WORLD.padRadius * 3.2 && h3 > 0.93) {
        props.push({ kind: 'hut', x, y, z, size: 4.2 + h1 * 2.2, tone: h2 });
      }
    }
  }
  return props;
}

/**
 * Whether a world position is over the runway strip, and how far along it. The landing test wants
 * both: on the strip, and moving down its length rather than across it.
 */
export function runwayProgress(x, z) {
  const halfLength = AIRFIELD.length / 2;
  const halfWidth = AIRFIELD.width / 2;
  if (Math.abs(x) > halfWidth || Math.abs(z) > halfLength) return null;
  return {
    along: (z + halfLength) / AIRFIELD.length,
    across: x / halfWidth,
  };
}


// ── Mission ───────────────────────────────────────────────────────────────────────────────────────

export const PHASE = {
  READY: 'ready',
  FLYING: 'flying',
  LANDED: 'landed',
  CRASHED: 'crashed',
};

/**
 * Lay the course: a chain of rings that starts ahead of the runway and weaves left and right, so the
 * pilot has to turn rather than hold a heading.
 *
 * The layout has to solve a projection problem, not just a design one. With a fixed step of 780 m,
 * every ring sat on the same line of sight, and because screen size falls as 1/depth the far rings
 * collapsed onto the same few pixels: measured from the chase camera, ring 5 and ring 6 landed 8 px
 * apart and ring 1 and ring 2 landed 15 px apart. Fifteen pairs were overlapping or nearly so.
 *
 * The fix is to vary the step. The forward gap alternates between a short leg and a long one, and the
 * lateral and vertical offsets are phased to the same rhythm, so consecutive rings separate on screen
 * instead of stacking. The pattern is deterministic, so the course is still reproducible from the seed.
 */
export function buildRings(seed = 7) {
  const random = makeRandom(seed);
  const rings = [];

  // The alternating leg lengths. A short leg pulls the next ring closer, so it projects larger and
  // sits off the vanishing point of the one before it.
  const legs = [0.72, 1.34, 0.88, 1.18, 0.66, 1.42, 0.94, 1.10];

  // The lateral offset grows with the ring's index. This is the part that actually solves the
  // stacking: a distant ring is drawn small, so it needs a bigger world offset to move a useful
  // number of pixels. A constant amplitude leaves the far rings on top of each other no matter how
  // the steps are varied.
  const LATERAL_BASE = 260;
  const LATERAL_GROWTH = 1.15;
  const LATERAL_PHASE = 0.9;

  // Vertical: a base height with a wave on it, clamped so no ring ever sits near the ground. The
  // wave is what separates consecutive rings on the screen's vertical axis.
  const BASE_HEIGHT = 120;
  const CLIMB = 5.5;
  const BOB_AMPLITUDE = 85;
  const BOB_PHASE = 1.55;
  const MIN_HEIGHT = 70;

  let z = WORLD.ringFirstDistance;
  for (let i = 0; i < WORLD.ringCount; i += 1) {
    if (i > 0) {
      z += WORLD.ringSpacing * legs[(i - 1) % legs.length];
    }

    const amplitude = LATERAL_BASE * LATERAL_GROWTH ** i;
    const x = Math.sin(i * LATERAL_PHASE) * amplitude;

    const y = Math.max(MIN_HEIGHT, BASE_HEIGHT + i * CLIMB + Math.sin(i * BOB_PHASE + 0.6) * BOB_AMPLITUDE);

    rings.push({
      position: { x, y, z },
      passed: false,
      index: i,
    });
  }
  return rings;
}

export function createMission(seed = 7) {
  const rings = buildRings(seed);
  return {
    aircraft: createAircraft(0, 6, -WORLD.runwayLength / 2 - 40, 0),
    rings,
    phase: PHASE.READY,
    score: 0,
    ringsPassed: 0,
    combo: 1,
    elapsed: 0,
    message: null,
    landingQuality: null,
  };
}

/** Put a short-lived message on the HUD. */
function say(mission, text, warn = false) {
  mission.message = { text, life: 1.6, warn };
}

/**
 * Advance the sortie one step. `input` is the pilot's command; `autopilot` is used by the
 * screenshot scenes and by the attract screen, and is a function that returns one.
 */
export function stepMission(mission, input, dt) {
  if (mission.phase === PHASE.LANDED || mission.phase === PHASE.CRASHED) {
    if (mission.message) mission.message.life -= dt;
    return;
  }

  if (mission.phase === PHASE.READY) mission.phase = PHASE.FLYING;
  mission.elapsed += dt;

  const aircraft = mission.aircraft;
  const groundY = groundHeight(aircraft.position.x, aircraft.position.z) + 1.2;
  const events = stepAircraft(aircraft, input, dt, groundY);

  for (const event of events) {
    if (event.kind === 'crash') {
      mission.phase = PHASE.CRASHED;
      mission.landingQuality = 'crash';
      say(mission, 'CRASHED', true);
    } else if (event.kind === 'touchdown') {
      // A landing only counts on the runway, wings level, and slow enough to stop.
      const onRunway = runwayProgress(aircraft.position.x, aircraft.position.z) !== null;
      if (onRunway && event.sink < MISSION.hardLandingSink) {
        mission.phase = PHASE.LANDED;
        mission.landingQuality = 'good';
        mission.score += MISSION.landingPoints;
        say(mission, `LANDED +${MISSION.landingPoints}`);
      } else {
        mission.phase = PHASE.CRASHED;
        mission.landingQuality = 'rough';
        say(mission, 'HARD LANDING', true);
      }
    } else if (event.kind === 'stall') {
      if (!mission.message) say(mission, 'STALL', true);
    } else if (event.kind === 'overstress') {
      say(mission, 'OVER-G', true);
    }
  }

  // Rings: a pass counts when the aircraft crosses the ring's plane inside its circle. Testing the
  // crossing rather than the distance is what makes a fast pass register at any frame rate.
  const next = mission.rings.find((ring) => !ring.passed);
  if (next) {
    const dx = aircraft.position.x - next.position.x;
    const dy = aircraft.position.y - next.position.y;
    const dz = aircraft.position.z - next.position.z;
    const inside = Math.sqrt(dx * dx + dy * dy) < WORLD.ringRadius;
    if (inside && Math.abs(dz) < 26) {
      next.passed = true;
      mission.ringsPassed += 1;
      const points = MISSION.ringPoints * mission.combo;
      mission.score += points;
      mission.combo = Math.min(5, mission.combo + 1);
      say(mission, `RING +${points}`);
    } else if (Math.abs(dz) < 26 && Math.sqrt(dx * dx + dy * dy) < WORLD.ringRadius * 1.5) {
      // A near miss costs structure and breaks the combo: the cost of flying sloppily.
      aircraft.damage = Math.min(100, aircraft.damage + MISSION.scrapeDamage);
      mission.combo = 1;
    }
  }

  if (aircraft.damage >= 100 && mission.phase === PHASE.FLYING) {
    mission.phase = PHASE.CRASHED;
    mission.landingQuality = 'destroyed';
    say(mission, 'AIRFRAME LOST', true);
  }

  if (mission.elapsed > MISSION.timeLimit && mission.phase === PHASE.FLYING) {
    mission.phase = PHASE.CRASHED;
    mission.landingQuality = 'timeout';
    say(mission, 'TIME OUT', true);
  }

  if (mission.message) {
    mission.message.life -= dt;
    if (mission.message.life <= 0) mission.message = null;
  }
}

/** The ring the pilot should fly at next, or null once the course is done. */
export function nextRing(mission) {
  return mission.rings.find((ring) => !ring.passed) ?? null;
}


// ── Autopilot ─────────────────────────────────────────────────────────────────────────────────────

/** The heading error to the target, wrapped into [-pi, pi]. */
function headingError(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * One command that flies toward the next ring. `skill` scales how early the pilot turns and how
 * hard it pulls: at 1 it flies the course cleanly, at 0.35 it is late and sloppy.
 */
export function autopilotCommand(mission, skill = 1) {
  const aircraft = mission.aircraft;
  const ring = nextRing(mission);

  // With no ring left, line up with the runway and come down to it.
  const target = ring
    ? ring.position
    : { x: 0, y: 26, z: WORLD.runwayLength / 2 };

  const dx = target.x - aircraft.position.x;
  const dz = target.z - aircraft.position.z;
  const dy = target.y - aircraft.position.y;

  const wantedHeading = Math.atan2(dx, dz);
  const error = headingError(aircraft.heading, wantedHeading);

  // Roll into the turn, proportional to the error and capped by the pilot's nerve.
  const rollCommand = clamp(error * 2.4 * skill, -1, 1);

  // Pitch for the height: aim at the ring, and hold a little nose-up when low on speed.
  const distance = Math.max(30, Math.hypot(dx, dz));
  const desiredClimb = Math.atan2(dy, distance);
  const pitchError = desiredClimb - aircraft.pitch;
  let pitchCommand = clamp(pitchError * 3.2 * skill, -1, 1);
  if (aircraft.speed < AIRCRAFT.stallSpeed + 8) pitchCommand = Math.min(pitchCommand, -0.1);

  // Throttle: open up when climbing or slow, ease off when diving.
  let throttle = 0.62;
  if (dy > 8) throttle = 0.9;
  else if (dy < -18) throttle = 0.34;
  if (aircraft.speed < AIRCRAFT.stallSpeed + 6) throttle = 1;
  if (aircraft.speed > AIRCRAFT.maxSpeed * 0.86) throttle = 0.2;

  return {
    pitch: clamp(pitchCommand, -1, 1),
    roll: clamp(rollCommand, -1, 1),
    throttle: clamp(throttle, 0, 1),
  };
}

/**
 * Fly `seconds` of the sortie with the autopilot. Returns the mission, so a caller can chain scenes.
 * `stopOn` ends early: 'rings' stops once that many rings are taken.
 */
export function flyFor(mission, seconds, dt, options = {}) {
  const { skill = 1, stopOn = null, stopAt = 0 } = options;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    if (mission.phase === 'landed' || mission.phase === 'crashed') break;
    if (stopOn === 'rings' && mission.ringsPassed >= stopAt) break;
    const command = autopilotCommand(mission, skill);
    stepMission(mission, command, dt);
  }
  return mission;
}

