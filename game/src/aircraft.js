// Aircraft: the airframe as geometry, and the flight model that moves it. The mesh is a swept shell
// of cross-sections mirrored about the centreline, so the aircraft is symmetric by construction;
// the model is the forces, the stall, the g load and the ground contact that turn it into a plane.

import { AIRCRAFT, clamp, cross, dot, normalize, sub } from './core.js';

// ── Airframe geometry ────────────────────────────────────────────────────────────────────────────

/** Panel colours, named once so the palette reads as an airframe rather than as hex codes. */
const COLOUR = {
  // The fuselage is a dark maroon that reads as painted metal: the strips run from a lit top
  // surface through the flank to a shadowed belly, which is what gives the body its curve.
  bodyTop: '#8a3139',
  bodyUpper: '#752730',
  bodyFlank: '#5e1e26',
  bodyBelly: '#3f1319',
  // The nose cone and spinner carry the same maroon, one step lighter where the light hits.
  noseTop: '#96363f',
  noseUnder: '#4e171e',
  spinner: '#2b2f36',
  // The vertical stabiliser is the one bright surface: white, so the tail reads against the terrain
  // at any distance and the aircraft's heading is legible from behind.
  finWhite: '#f4f6f8',
  finShade: '#c9d0d8',
  // Wings: light grey upper surface, darker grey underside, dark blue wingtip accents.
  wingTop: '#c8d0d9',
  wingUnder: '#6e7783',
  wingtip: '#1d3f63',
  wingtipLit: '#2a5a8a',
  // Canopy: dark glass with a highlight along the spine.
  glass: '#1f3d52',
  glassLit: '#5f93b4',
  // Tailplane, same family as the wings.
  tailTop: '#c8d0d9',
  tailUnder: '#6e7783',
  // The engine nozzle: a dark ring with a hot inner lip.
  nozzle: '#2a2e35',
  nozzleLip: '#5a626b',
};

/**
 * Build one panel. The normal is given, not computed, and is normalised here so callers can pass any
 * convenient magnitude.
 */
function panel(name, colour, normal, points) {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return {
    name,
    colour,
    normal: [normal[0] / len, normal[1] / len, normal[2] / len],
    points,
  };
}

/**
 * Mirror a panel across the X axis. The points flip sign in X, the normal flips sign in X, and the
 * name gets its side swapped. Because the normal is carried rather than recomputed, the mirrored
 * panel faces the correct way regardless of what the vertex order does to the cross product.
 */
function mirrorX(source) {
  const swapped = source.name.replace(/Right/g, 'Left').replace(/right/g, 'left');
  return panel(
    swapped,
    source.colour,
    [-source.normal[0], source.normal[1], source.normal[2]],
    source.points.map(([x, y, z]) => [-x, y, z]),
  );
}

// ── The fuselage shell ─────────────────────────────────────────────────────────────────────────
// A station is one cross-section along the spine: a half-width, a top height, a bottom height, and a
// shoulder height where the flank turns into the top deck. Sweeping stations from nose to tail and
// wrapping a band of quads between consecutive ones gives a closed, tapered body with no gap between
// the left and right sides, because each band is a single continuous ring.

const STATIONS = [
  // z,     halfWidth, top,   bottom, shoulder
  { z: 10.40, w: 0.12, top: 0.07, bottom: -0.03, shoulder: 0.03 }, // spinner tip
  { z: 9.60, w: 0.62, top: 0.34, bottom: -0.16, shoulder: 0.14 },  // nose cone
  { z: 8.40, w: 1.18, top: 0.66, bottom: -0.34, shoulder: 0.30 },
  { z: 7.20, w: 1.52, top: 0.90, bottom: -0.48, shoulder: 0.46 },  // windscreen base
  { z: 5.40, w: 1.72, top: 1.06, bottom: -0.56, shoulder: 0.56 },
  { z: 3.20, w: 1.84, top: 1.14, bottom: -0.58, shoulder: 0.62 },  // wing root station
  { z: 0.60, w: 1.86, top: 1.16, bottom: -0.58, shoulder: 0.64 },  // widest
  { z: -1.60, w: 1.80, top: 1.14, bottom: -0.56, shoulder: 0.62 },
  { z: -3.60, w: 1.62, top: 1.06, bottom: -0.50, shoulder: 0.56 },
  { z: -5.40, w: 1.34, top: 0.92, bottom: -0.42, shoulder: 0.46 },
  { z: -6.60, w: 1.02, top: 0.74, bottom: -0.32, shoulder: 0.34 },
  { z: -7.40, w: 0.74, top: 0.56, bottom: -0.22, shoulder: 0.24 }, // nozzle ring
];

/**
 * The eight points of one cross-section, in a fixed order that wraps around the body. The order is
 * the same at every station, which is what lets consecutive stations be joined without the band
 * twisting: point i of one station always pairs with point i of the next.
 *
 * Index 0 is the top centre, then clockwise seen from behind: right shoulder, right flank, right
 * belly, bottom centre, left belly, left flank, left shoulder.
 */
function sectionPoints(station) {
  const { z, w, top, bottom, shoulder } = station;
  return [
    [0, top, z],               // 0 top centre
    [w * 0.72, shoulder, z],   // 1 right shoulder
    [w, shoulder * 0.35, z],   // 2 right flank
    [w * 0.62, bottom, z],     // 3 right belly
    [0, bottom, z],            // 4 bottom centre
    [-w * 0.62, bottom, z],    // 5 left belly
    [-w, shoulder * 0.35, z],  // 6 left flank
    [-w * 0.72, shoulder, z],  // 7 left shoulder
  ];
}

/**
 * The outward normal of a band face, oriented away from the spine at that station.
 *
 * The three sample points are chosen so the cross product is taken in the same rotational direction
 * for every band, including the one that closes the ring. Using the quad's first three corners
 * directly would reverse the cross product on the closing band, because that band's corners wrap
 * from index 7 back to index 0 — and a reversed normal on one band of a mirrored pair is exactly the
 * asymmetry this file exists to prevent.
 */
function bandNormal(a, b, c, stationMid) {
  // The section points are plain arrays; the vector helpers take {x, y, z}. Convert at the boundary
  // rather than teaching the helpers about arrays, so the rest of the code keeps one representation.
  const va = { x: a[0], y: a[1], z: a[2] };
  const vb = { x: b[0], y: b[1], z: b[2] };
  const vc = { x: c[0], y: c[1], z: c[2] };
  const n = cross(sub(vb, va), sub(vc, va));
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  let nx = n.x / len;
  let ny = n.y / len;
  let nz = n.z / len;
  // Orient it outward: the face's centroid minus the spine at that station is the outward direction
  // for a convex section. If the cross product disagrees with that, flip it.
  const cx = (a[0] + b[0] + c[0]) / 3;
  const cy = (a[1] + b[1] + c[1]) / 3;
  const outwardX = cx;
  const outwardY = cy - stationMid;
  if (nx * outwardX + ny * outwardY < 0) {
    nx = -nx; ny = -ny; nz = -nz;
  }
  return [nx, ny, nz];
}

/**
 * The normal of a band, computed from the quad's *geometry* rather than from the order its corners
 * happen to be listed in.
 *
 * The two diagonals of the quad give the same plane regardless of which corner comes first, and the
 * sign is then fixed by pointing the result away from the section's spine. That makes the normal a
 * property of the shape, so the band that closes the ring — whose corners wrap from index 7 to 0 —
 * produces the same normal as every other band instead of a mirrored one.
 */
function quadNormal(p0, p1, p2, p3, stationMid) {
  const d1 = { x: p2[0] - p0[0], y: p2[1] - p0[1], z: p2[2] - p0[2] };
  const d2 = { x: p3[0] - p1[0], y: p3[1] - p1[1], z: p3[2] - p1[2] };
  const n = cross(d1, d2);
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  let nx = n.x / len;
  let ny = n.y / len;
  let nz = n.z / len;
  // Point it away from the spine: the quad's centroid, minus the spine at that station.
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
  const cy = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  const outwardX = cx;
  const outwardY = cy - stationMid;
  if (nx * outwardX + ny * outwardY < 0) {
    nx = -nx; ny = -ny; nz = -nz;
  }
  return [nx, ny, nz];
}

/** Colour a band by where it sits around the section: top deck, shoulder, flank, or belly. */
function bandColour(index) {
  switch (index) {
    case 0: return COLOUR.bodyTop;    // top centre -> right shoulder
    case 1: return COLOUR.bodyUpper;  // right shoulder -> right flank
    case 2: return COLOUR.bodyFlank;  // right flank -> right belly
    case 3: return COLOUR.bodyBelly;  // right belly -> bottom centre
    case 4: return COLOUR.bodyBelly;  // bottom centre -> left belly
    case 5: return COLOUR.bodyFlank;  // left belly -> left flank
    case 6: return COLOUR.bodyUpper;  // left flank -> left shoulder
    case 7: return COLOUR.bodyTop;    // left shoulder -> top centre
    default: return COLOUR.bodyFlank;
  }
}

/** Build the swept fuselage: one band of quads per station pair, per section segment. */
function buildFuselage() {
  const panels = [];
  for (let s = 0; s < STATIONS.length - 1; s += 1) {
    const a = sectionPoints(STATIONS[s]);
    const b = sectionPoints(STATIONS[s + 1]);
    const stationMid = ((STATIONS[s].top + STATIONS[s].bottom) + (STATIONS[s + 1].top + STATIONS[s + 1].bottom)) / 4;

    for (let i = 0; i < 8; i += 1) {
      const j = (i + 1) % 8;
      const quad = [a[i], a[j], b[j], b[i]];
      const n = quadNormal(a[i], a[j], b[j], b[i], stationMid);
      panels.push(panel(`body${s}_${i}`, bandColour(i), n, quad));
    }
  }
  // The tail cap: the last station closed off, so the body does not end in an open ring. Its normal
  // points aft, which is the direction the nozzle faces.
  const last = sectionPoints(STATIONS[STATIONS.length - 1]);
  panels.push(panel('tailCap', COLOUR.bodyBelly, [0, 0, -1], [last[0], last[1], last[2], last[3], last[4], last[5], last[6], last[7]]));
  // The nose cap: the first station closed off, facing forward.
  const first = sectionPoints(STATIONS[0]);
  panels.push(panel('noseCap', COLOUR.spinner, [0, 0, 1], [first[7], first[6], first[5], first[4], first[3], first[2], first[1], first[0]]));
  return panels;
}

const FUSELAGE = buildFuselage();

// ── The right half of the airframe ─────────────────────────────────────────────────────────────
// Everything here is the starboard side or a centreline part. The port side is generated below by
// mirroring, so the two halves cannot drift apart.

const CENTRE_PANELS = [
  // Canopy: dark glass, a highlight along the top of the bubble. It sits on the body's top deck.
  panel('canopyGlass', COLOUR.glass, [0, 1, 0],
    [[-1.02, 1.16, 4.6], [1.02, 1.16, 4.6], [0.86, 1.58, 1.2], [-0.86, 1.58, 1.2]]),
  panel('canopyHighlight', COLOUR.glassLit, [0, 1, 0],
    [[-0.86, 1.58, 1.2], [0.86, 1.58, 1.2], [0.52, 1.66, 2.8], [-0.52, 1.66, 2.8]]),

  // The vertical stabiliser: white, the brightest surface on the aircraft. Its root sits inside the
  // body's top deck at the tail station, so it grows out of the fuselage rather than floating above.
  panel('fin', COLOUR.finWhite, [1, 0, 0],
    [[-0.30, 0.62, -5.2], [0.30, 0.62, -5.2], [0.26, 3.90, -6.9], [-0.26, 3.90, -6.9]]),
  panel('finTop', COLOUR.finShade, [0, 1, 0],
    [[-0.26, 3.90, -6.9], [0.26, 3.90, -6.9], [0.24, 4.18, -6.96], [-0.24, 4.18, -6.96]]),
];

const RIGHT_PANELS = [
  // Right wing. The root chord starts inside the body's half-width at that station (1.84 m), so the
  // wing grows out of the fuselage instead of butting against it and leaving a seam.
  panel('wingRightTop', COLOUR.wingTop, [0, 1, 0],
    [[0.90, 0.66, 2.6], [14.5, 0.15, 0.6], [14.5, 0.15, 3.0], [0.90, 0.66, 4.2]]),
  panel('wingRightUnder', COLOUR.wingUnder, [0, -1, 0],
    [[0.90, 0.66, 2.6], [14.5, 0.15, 0.6], [14.5, 0.15, 3.0], [0.90, 0.66, 4.2]]),
  // The wingtip accent: dark blue, on the outboard end of the wing.
  panel('wingtipRight', COLOUR.wingtip, [0, 1, 0],
    [[13.0, 0.2, 0.85], [14.5, 0.15, 0.6], [14.5, 0.15, 3.0], [13.0, 0.2, 2.9]]),
  panel('wingtipRightLit', COLOUR.wingtipLit, [0.05, 0.99, 0],
    [[13.0, 0.2, 0.85], [13.6, 0.19, 0.78], [13.6, 0.19, 2.94], [13.0, 0.2, 2.9]]),

  // Right tailplane. The root chord is tucked into the body at the tail station, so the stabiliser
  // meets the fuselage rather than hovering beside it.
  panel('tailplaneRight', COLOUR.tailTop, [0, 1, 0],
    [[0.50, 0.72, -5.6], [5.6, 0.86, -6.6], [5.6, 0.86, -5.0], [0.50, 0.72, -4.4]]),
  panel('tailplaneRightUnder', COLOUR.tailUnder, [0, -1, 0],
    [[0.50, 0.72, -5.6], [5.6, 0.86, -6.6], [5.6, 0.86, -5.0], [0.50, 0.72, -4.4]]),
];

/**
 * The full panel list. The port side is the starboard side mirrored, so the airframe is symmetric
 * by construction: for every panel at +x there is one at -x with the same colour and the mirrored
 * normal, and no coordinate is typed twice.
 */
const PANELS = [
  ...FUSELAGE,
  ...CENTRE_PANELS,
  ...RIGHT_PANELS,
  ...RIGHT_PANELS.map(mirrorX),
];

/** The sun, shared with the sky so the shading and the glow agree. */
const SUN = normalize({ x: -0.42, y: 0.62, z: -0.66 });

/** The colour of a panel under the sun, with a rim term so the airframe keeps an edge against sky. */
export function shadePanel(colour, normal, toCamera) {
  const lit = Math.max(0, dot(normal, SUN));
  const ambient = 0.42;
  const diffuse = 0.58 * lit;
  const rim = Math.max(0, 1 - Math.abs(dot(normal, toCamera))) * 0.16;
  const factor = Math.min(1.45, ambient + diffuse + rim);
  const r = parseInt(colour.slice(1, 3), 16);
  const g = parseInt(colour.slice(3, 5), 16);
  const b = parseInt(colour.slice(5, 7), 16);
  return {
    r: Math.min(255, Math.round(r * factor)),
    g: Math.min(255, Math.round(g * factor)),
    b: Math.min(255, Math.round(b * factor)),
  };
}

/** The panel's declared outward normal, in body coordinates. */
export function panelNormal(panelOrPoints) {
  if (panelOrPoints && panelOrPoints.normal) {
    const [x, y, z] = panelOrPoints.normal;
    return { x, y, z };
  }
  const p = panelOrPoints;
  const a = { x: p[0][0], y: p[0][1], z: p[0][2] };
  const b = { x: p[1][0], y: p[1][1], z: p[1][2] };
  const c = { x: p[2][0], y: p[2][1], z: p[2][2] };
  return normalize(cross(sub(b, a), sub(c, a)));
}

/**
 * Transform a body-frame point into the world. The rotation is applied about the aircraft's own
 * origin, which is the centre of mass, so no vertex is displaced by the attitude change.
 * The order is roll, then pitch, then heading, matching how the flight model integrates them.
 */
export function bodyToWorld(point, aircraft) {
  const cosH = Math.cos(aircraft.heading);
  const sinH = Math.sin(aircraft.heading);
  const cosP = Math.cos(aircraft.pitch);
  const sinP = Math.sin(aircraft.pitch);
  const cosR = Math.cos(aircraft.roll);
  const sinR = Math.sin(aircraft.roll);

  const [lx, ly, lz] = point;
  const rx = lx * cosR - ly * sinR;
  const ry = lx * sinR + ly * cosR;
  const py = ry * cosP - lz * sinP;
  const pz = ry * sinP + lz * cosP;
  return {
    x: aircraft.position.x + rx * cosH + pz * sinH,
    y: aircraft.position.y + py,
    z: aircraft.position.z - rx * sinH + pz * cosH,
  };
}

/** Rotate a body-frame direction into the world, without the translation. */
export function bodyDirectionToWorld(dir, aircraft) {
  const cosH = Math.cos(aircraft.heading);
  const sinH = Math.sin(aircraft.heading);
  const cosP = Math.cos(aircraft.pitch);
  const sinP = Math.sin(aircraft.pitch);
  const cosR = Math.cos(aircraft.roll);
  const sinR = Math.sin(aircraft.roll);
  const [lx, ly, lz] = dir;
  const rx = lx * cosR - ly * sinR;
  const ry = lx * sinR + ly * cosR;
  const py = ry * cosP - lz * sinP;
  const pz = ry * sinP + lz * cosP;
  return { x: rx * cosH + pz * sinH, y: py, z: -rx * sinH + pz * cosH };
}

/**
 * The exhaust: where it leaves the airframe, in body coordinates, and how wide the nozzle ring is.
 * The renderer draws the plume from here so the flame comes out of the engine rather than hanging
 * under the aircraft.
 */
export const NOZZLE = { x: 0, y: 0.17, z: -7.45, radius: 0.74 };

export { PANELS, SUN, COLOUR, STATIONS, sectionPoints };


// ── Flight model ─────────────────────────────────────────────────────────────────────────────────

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

