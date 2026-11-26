// The flight model. Not a full six-degree-of-freedom simulation: a rate-controlled airframe with
// energy that matters. Throttle sets thrust, drag fights it, the wing trades airspeed for lift, and
// banking turns the aircraft. Fly too slow and the wing stalls and the nose drops; dive and the
// airspeed climbs past the structural limit. That is the whole decision space, and it is enough for
// a sortie to read as flying rather than as steering a cursor.

import { AIRCRAFT } from './config.js';
import { clamp } from './math3d.js';

export function createAircraft(x, y, z, heading) {
  return {
    position: { x, y, z },
    heading,
    pitch: 0,
    roll: 0,
    /** Commanded attitude, which the airframe chases: this is what gives the controls weight. */
    pitchCmd: 0,
    rollCmd: 0,
    speed: AIRCRAFT.cruiseSpeed,
    throttle: 0.62,
    fuel: AIRCRAFT.tank,
    damage: 0,
    /** Load factor, in g. Shown on the HUD and the reason a hard pull costs structure. */
    gLoad: 1,
    stalled: false,
    onGround: false,
    verticalSpeed: 0,
  };
}

/**
 * Advance the airframe one step. `input` carries pitch, roll and throttle in [-1, 1]; the caller
 * has already applied any autopilot. Returns the events this step produced, so the caller can score
 * them without the model knowing what a score is.
 */
export function stepAircraft(aircraft, input, dt, groundY) {
  const events = [];

  // Fuel: the engine is the only thing that burns it, and a dry tank leaves a glider.
  const burning = aircraft.fuel > 0;
  if (burning) {
    aircraft.fuel = Math.max(0, aircraft.fuel - AIRCRAFT.burn * (0.25 + aircraft.throttle * 0.75) * dt);
  }
  aircraft.throttle = burning ? clamp(input.throttle, 0, 1) : 0;

  // Attitude: the stick commands a rate, the airframe damps toward it. Airspeed scales authority,
  // so the aircraft feels heavy at the bottom of the envelope and crisp near cruise.
  const authority = clamp(aircraft.speed / AIRCRAFT.cruiseSpeed, 0.45, 1.5);
  aircraft.pitchCmd = clamp(input.pitch, -1, 1);
  aircraft.rollCmd = clamp(input.roll, -1, 1);

  const pitchTarget = aircraft.pitchCmd * AIRCRAFT.pitchRate * authority;
  const rollTarget = aircraft.rollCmd * AIRCRAFT.rollRate * authority;
  aircraft.pitch += (pitchTarget - aircraft.pitch) * clamp(AIRCRAFT.pitchDamp * dt, 0, 1);
  aircraft.roll += (rollTarget - aircraft.roll) * clamp(AIRCRAFT.rollDamp * dt, 0, 1);

  // A bank turns the aircraft: the horizontal component of lift curves the flight path. This is
  // why a hard turn loses altitude unless the pilot pulls.
  const bankTurn = Math.sin(aircraft.roll) * AIRCRAFT.bankTurn * authority;
  aircraft.heading += bankTurn * dt;

  // Energy: thrust in, drag out. Drag rises with the square of airspeed, so the top speed is finite.
  const thrust = aircraft.throttle * AIRCRAFT.thrust;
  const drag = AIRCRAFT.drag * aircraft.speed * aircraft.speed;
  const gravityAlong = Math.sin(aircraft.pitch) * AIRCRAFT.gravity * 2.1;
  aircraft.speed = Math.max(0, aircraft.speed + (thrust - drag - gravityAlong) * dt);
  aircraft.speed = clamp(aircraft.speed, 0, AIRCRAFT.maxSpeed * 1.25);

  // Lift: the wing holds the aircraft up in proportion to airspeed squared. Below the stall speed
  // it cannot, and the nose falls.
  const liftRatio = (aircraft.speed * aircraft.speed) / (AIRCRAFT.stallSpeed * AIRCRAFT.stallSpeed);
  aircraft.stalled = liftRatio < 1 && !aircraft.onGround;

  let climb = Math.sin(aircraft.pitch) * aircraft.speed;
  if (aircraft.stalled) {
    climb -= AIRCRAFT.stallSink * (1 - liftRatio);
    events.push({ kind: 'stall' });
  }
  // Gravity pulls the flight path down while the wing is not carrying it.
  climb -= (1 - clamp(liftRatio, 0, 1)) * AIRCRAFT.gravity * 0.4;
  aircraft.verticalSpeed = climb;

  // Load factor: how hard the wing is working, which is what the pilot feels and the airframe pays.
  const turnLoad = Math.abs(Math.sin(aircraft.roll)) / Math.max(0.12, Math.cos(aircraft.pitch));
  aircraft.gLoad = 1 + turnLoad * 2.6 + Math.abs(aircraft.pitchCmd) * 1.4;
  if (aircraft.gLoad > AIRCRAFT.gLimit) {
    const over = aircraft.gLoad - AIRCRAFT.gLimit;
    aircraft.damage = Math.min(100, aircraft.damage + over * 7 * dt);
    events.push({ kind: 'overstress', amount: over });
  }

  // Integrate. Heading 0 flies toward +z, which is the direction the runway points.
  const forward = { x: Math.sin(aircraft.heading), y: 0, z: Math.cos(aircraft.heading) };
  aircraft.position.x += forward.x * aircraft.speed * dt;
  aircraft.position.z += forward.z * aircraft.speed * dt;
  aircraft.position.y += climb * dt;

  // The ground: contact is a landing when the sink rate is gentle and the wings are level, and a
  // crash when it is not. Either way the aircraft stops descending.
  if (aircraft.position.y <= groundY) {
    aircraft.position.y = groundY;
    if (!aircraft.onGround) {
      const sink = -climb;
      const level = Math.abs(aircraft.roll) < 0.28 && Math.abs(aircraft.pitch) < 0.3;
      if (sink > 6.5 || !level) {
        events.push({ kind: 'crash', sink, level });
        aircraft.damage = 100;
      } else {
        events.push({ kind: 'touchdown', sink });
      }
      aircraft.onGround = true;
    }
    aircraft.verticalSpeed = 0;
    aircraft.speed = Math.max(0, aircraft.speed - 34 * dt);
    aircraft.pitch *= 0.86;
    aircraft.roll *= 0.86;
  } else if (aircraft.onGround) {
    aircraft.onGround = false;
    events.push({ kind: 'liftoff' });
  }

  aircraft.damage = clamp(aircraft.damage, 0, 100);
  return events;
}
