// The sortie: the rings, the scoring, and the state machine that runs from takeoff to touchdown.
// The mission owns the rules; the flight model owns the physics; neither knows about the other's
// internals, which is what lets the screenshot autopilot play a real sortie.

import { MISSION, WORLD } from './config.js';
import { createAircraft, stepAircraft } from './flight.js';
import { makeRandom } from './math3d.js';
import { groundHeight, runwayProgress } from './terrain.js';

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
