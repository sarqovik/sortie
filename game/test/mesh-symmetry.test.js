// A geometry audit for the aircraft mesh. Run with: node game/test/mesh-symmetry.test.js
//
// This asserts the properties the broken render violated, and fails loudly if any regress.
//
//   1. Symmetry. The panel set is invariant under (x,y,z) -> (-x,y,z), applied to both points and
//      normals. Corners are compared as a *set*, so a panel whose corners are listed in a different
//      order still matches — which is the point, because winding order is what used to break the
//      normals in the first place.
//   2. Normals are unit length and face away from the body. Each panel declares which way it faces;
//      the test checks that the declared normal agrees with the panel's position on the airframe:
//      a panel sitting above the body's centreline must not face down, one below must not face up,
//      one outboard must not face inboard, and so on.
//   3. No culling hole. From the chase camera the aircraft is seen from behind and above, so both
//      wing upper surfaces must survive the backface test. The original bug culled exactly one.

import { PANELS } from '../src/aircraft.js';

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** A corner-set key that ignores the order the corners were listed in. */
function cornerSet(points) {
  return points.map(([x, y, z]) => `${r6(x)},${r6(y)},${r6(z)}`).sort().join('|');
}

// ── 1. Symmetry ────────────────────────────────────────────────────────────────────────────────
console.log('1. Symmetry across the X axis (points and normals mirror together)');

const index = new Map();
for (const p of PANELS) {
  const k = `${p.colour}#${cornerSet(p.points)}`;
  if (!index.has(k)) index.set(k, []);
  index.get(k).push(p);
}

let paired = 0;
let centre = 0;
const matched = new Set();

for (const p of PANELS) {
  if (matched.has(p.name)) continue;

  const mirrored = p.points.map(([x, y, z]) => [-x, y, z]);
  const selfMirror = cornerSet(mirrored) === cornerSet(p.points);

  if (selfMirror) {
    // A panel whose corners map onto themselves is symmetric about the centreline. Its normal must
    // be either purely lateral (a fin has two faces, one each side) or have no lateral component at
    // all; what it must not do is lean to one side, which would be an asymmetry.
    centre += 1;
    matched.add(p.name);
    const lateral = Math.abs(p.normal[0]);
    check(`${p.name} centreline normal is lateral or axial, never diagonal`,
      close(lateral, 0) || close(lateral, 1),
      `normal = (${p.normal.join(', ')})`);
    continue;
  }

  const candidates = index.get(`${p.colour}#${cornerSet(mirrored)}`) || [];
  const partner = candidates.find((q) => !matched.has(q.name) && q.name !== p.name);
  check(`${p.name} has a mirrored partner`, Boolean(partner),
    partner ? '' : `no panel with mirrored corners and colour ${p.colour}`);
  if (!partner) continue;

  matched.add(p.name);
  matched.add(partner.name);
  paired += 1;

  check(`${p.name} and ${partner.name} have mirrored normals`,
    close(partner.normal[0], -p.normal[0], 1e-4) &&
    close(partner.normal[1], p.normal[1], 1e-4) &&
    close(partner.normal[2], p.normal[2], 1e-4),
    `(${p.normal.join(',')}) vs (${partner.normal.join(',')})`);
}
console.log(`   ${PANELS.length} panels: ${paired} mirrored pairs, ${centre} centreline`);

const rightTip = Math.max(...PANELS.filter((p) => p.name.startsWith('wingRight')).flatMap((p) => p.points.map(([x]) => x)));
const leftTip = Math.min(...PANELS.filter((p) => p.name.startsWith('wingLeft')).flatMap((p) => p.points.map(([x]) => x)));
check('wing span is symmetric', close(rightTip, -leftTip), `right tip ${rightTip}, left tip ${leftTip}`);

for (const p of PANELS) {
  if (!/Right/.test(p.name)) continue;
  const twin = p.name.replace('Right', 'Left');
  check(`${p.name} has a port twin named ${twin}`, PANELS.some((q) => q.name === twin));
}

// ── 2. Normals ────────────────────────────────────────────────────────────────────────────────
// Each panel declares a normal. The test asks whether that normal is consistent with where the
// panel actually sits on the airframe. The rules are the ones a modeller would state out loud:
//   - a panel whose centroid is above the body's mid-height must not face down;
//   - a panel below must not face up;
//   - a panel outboard on the right must not face inboard (and vice versa);
//   - a panel forward of the body's mid-length must not face backwards.
// This catches a flipped normal without needing a watertight solid to test against.
console.log('2. Normals are unit length and face the way the panel sits');

const allPoints = PANELS.flatMap((p) => p.points);
// The vertical mid-line is taken from the fuselage, not from the whole bounding box: the fin reaches
// four metres up and would drag the mid-line above every other panel, making them all read as "low".
const fuselagePoints = PANELS.filter((p) => p.name.startsWith('fuselage')).flatMap((p) => p.points);
const midY = (Math.min(...fuselagePoints.map((p) => p[1])) + Math.max(...fuselagePoints.map((p) => p[1]))) / 2;
const midZ = (Math.min(...allPoints.map((p) => p[2])) + Math.max(...allPoints.map((p) => p[2]))) / 2;

for (const p of PANELS) {
  const len = Math.hypot(...p.normal);
  check(`${p.name} normal is unit length`, close(len, 1, 1e-6), `|n| = ${len}`);

  const c = p.points
    .reduce((acc, [x, y, z]) => [acc[0] + x, acc[1] + y, acc[2] + z], [0, 0, 0])
    .map((v) => v / p.points.length);
  const [nx, ny, nz] = p.normal;

  // Vertical consistency, only where the panel is clearly above or below the mid-line and is not an
  // explicitly-named underside: a wing or tailplane has both a top and a bottom surface at the same
  // height, so the height alone cannot decide which way each one should face.
  const isUnderside = /Under/.test(p.name);
  if (c[1] > midY + 0.35 && !isUnderside) {
    check(`${p.name} sits high and does not face down`, ny > -0.1,
      `centroid y=${c[1].toFixed(2)}, normal.y=${ny}`);
  }
  if (c[1] < midY - 0.35) {
    check(`${p.name} sits low and does not face up`, ny < 0.1,
      `centroid y=${c[1].toFixed(2)}, normal.y=${ny}`);
  }

  // Lateral consistency, only where the panel is clearly outboard.
  if (c[0] > 2.0) {
    check(`${p.name} sits outboard right and does not face inboard`, nx > -0.1,
      `centroid x=${c[0].toFixed(2)}, normal.x=${nx}`);
  }
  if (c[0] < -2.0) {
    check(`${p.name} sits outboard left and does not face inboard`, nx < 0.1,
      `centroid x=${c[0].toFixed(2)}, normal.x=${nx}`);
  }

  // Longitudinal consistency, only where the panel is clearly forward.
  if (c[2] > midZ + 4.0) {
    check(`${p.name} sits forward and does not face aft`, nz > -0.1,
      `centroid z=${c[2].toFixed(2)}, normal.z=${nz}`);
  }
}

// ── 3. No culling hole from the chase camera ───────────────────────────────────────────────────
console.log('3. Backface test from the chase camera');
const toCamera = { x: 0, y: 0.2, z: -1 };
const tl = Math.hypot(toCamera.x, toCamera.y, toCamera.z);
toCamera.x /= tl; toCamera.y /= tl; toCamera.z /= tl;

const visible = PANELS.filter((p) => (p.normal[0] * toCamera.x + p.normal[1] * toCamera.y + p.normal[2] * toCamera.z) >= -0.05);
const names = new Set(visible.map((p) => p.name));
console.log(`   ${visible.length} of ${PANELS.length} panels survive the backface test`);

check('right wing upper surface is visible', names.has('wingRightTop'));
check('left wing upper surface is visible', names.has('wingLeftTop'));
check('both wing uppers are visible together',
  names.has('wingRightTop') && names.has('wingLeftTop'),
  'the original bug culled exactly one of these');
// The fuselage is a swept shell now, so its top deck is a band rather than one named panel. The test
// asks whether any visible panel faces up and sits over the body's spine, which is the property that
// matters: a body with no top surface was exactly the bug.
const bodyTopVisible = visible.some((p) => {
  if (!p.name.startsWith('body')) return false;
  const cy = p.points.reduce((s, q) => s + q[1], 0) / p.points.length;
  return p.normal[1] > 0.5 && cy > 0.5;
});
check('the fuselage has a visible top surface', bodyTopVisible,
  'no upward-facing body band survived the backface test');
check('fin is visible', names.has('fin'));
check('canopy is visible', names.has('canopyGlass'));
// The belly must be culled from above: if it were not, the renderer would draw it over the wings.
// The test looks at panels that face clearly downward, not merely downward-ish: a band on the
// flank-belly corner of a tapered tail legitimately faces down-and-back, and the chase camera sees
// that corner. What must never happen is a panel that faces straight down being drawn.
const bellyVisible = visible.some((p) => p.name.startsWith('body') && p.normal[1] < -0.9);
check('the fuselage belly is culled from above', !bellyVisible,
  'a downward-facing body band survived the backface test');
check('wing undersides are culled from above',
  !names.has('wingRightUnder') && !names.has('wingLeftUnder'));

const level = { x: 0, y: 0, z: -1 };
const levelVisible = new Set(
  PANELS.filter((p) => p.normal[0] * level.x + p.normal[1] * level.y + p.normal[2] * level.z >= -0.05)
    .map((p) => p.name),
);
check('both wing uppers visible from level behind', levelVisible.has('wingRightTop') && levelVisible.has('wingLeftTop'));

// ── Report ────────────────────────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log(`PASS  ${checks} checks, 0 failures`);
} else {
  console.error(`FAIL  ${failures} of ${checks} checks failed`);
  process.exitCode = 1;
}
