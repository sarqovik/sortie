// The terrain: a heightfield the aircraft flies over, with a flattened airfield pad at the origin
// so the runway sits on level ground. Height is a pure function of position, so the flight model,
// the collision test and the renderer all agree without storing a grid.

import { WORLD } from './config.js';
import { clamp, lerp, noise2, ridge2, smooth } from './math3d.js';

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
