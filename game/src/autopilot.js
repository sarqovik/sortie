// The autopilot. It flies the real mission through the real flight model, so a screenshot is a
// frame of a sortie that actually happened rather than a posed scene. Two pilots: one careful, for
// the play shots, and one hurried, which is what makes a crash shot honest.

import { AIRCRAFT, WORLD } from './config.js';
import { clamp } from './math3d.js';
import { nextRing, stepMission } from './mission.js';

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
