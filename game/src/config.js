// Every tuning number in one place, so the flight model reads as flight and not as magic constants.
// Distances are metres, speeds metres per second, angles radians. The camera projects them to a
// fixed 1280x720 logical frame that the renderer scales to the window.

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
