// The renderer. A software 3D pipeline on a 2D canvas: the terrain is a grid of quads projected
// through the camera basis, drawn back to front, and everything else is sorted into the same depth
// order. No WebGL, no library, no shader: the whole thing is arithmetic and fillRect, which keeps
// the file small and the frame time predictable on a software rasteriser.

import { CAMERA, PALETTE, VIEW, WORLD } from './config.js';
import { PANELS, NOZZLE, bodyDirectionToWorld, bodyToWorld, shadePanel } from './aircraftMesh.js';
import { cameraBasis, clamp, dot, lerp, normalize, project, sub } from './math3d.js';
import { AIRFIELD, groundColor, groundHeight } from './terrain.js';

/** The sun, fixed in the sky: the shading and the sky gradient both read from it. */
const SUN = normalize({ x: -0.42, y: 0.62, z: -0.66 });

/**
 * The terrain grid, in camera-relative cells. Rather than meshing the whole 5,200 m field, the
 * renderer walks a fan of cells outward from the aircraft: coarse far away, fine nearby. That is
 * what keeps the frame count stable while still showing the horizon.
 *
 * The near band is deliberately fine. A cell is only allowed to be as large as the distance at which
 * its own shading stops being visible: at 24 m the near ground broke into obvious squares, because a
 * single flat colour covered a patch of hillside several hundred pixels across. At 11 m the same
 * patch is split into four, and the facet edges fall below the threshold where the eye reads them as
 * blocks. The band boundaries overlap, so there is no seam where one resolution hands over to the
 * next.
 */
const RINGS = [
  { distance: 46, step: 11 },
  { distance: 120, step: 22 },
  { distance: 300, step: 46 },
  { distance: 720, step: 108 },
  { distance: 1600, step: 250 },
  { distance: 2900, step: 520 },
];

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const shade = [0, 0, 0];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(VIEW.width * dpr);
    canvas.height = Math.round(VIEW.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  /** The sky: a vertical gradient, a low sun, and a haze band that melts the horizon. */
  function drawSky(basis) {
    // The horizon is where a horizontal ray at infinite distance lands on screen. It has to come from
    // the camera basis, not from a fixed fraction of the height: a nose-up attitude drops the horizon
    // line, and a hard-coded one painted sky over ground the terrain had already drawn.
    const horizon = VIEW.height / 2 - (0 - basis.forward.y) / basis.forward.z * basis.focal;
    const skyBottom = clamp(horizon, 0, VIEW.height);
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(skyBottom, 1));
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(0.45, PALETTE.skyMid);
    sky.addColorStop(0.82, '#a8c6dd');
    sky.addColorStop(1, PALETTE.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW.width, skyBottom + 4);

    // Fill everything below the horizon with haze before the terrain goes down. The terrain is drawn
    // as a grid of quads around the aircraft, so when the camera sits high and looks slightly up (the
    // late-sortie tile), the horizon line can land above the far edge of that grid and leave a bare
    // band between sky and ground. Haze there reads as distance, which is what it is.
    if (skyBottom + 4 < VIEW.height) {
      const haze = ctx.createLinearGradient(0, skyBottom, 0, VIEW.height);
      haze.addColorStop(0, PALETTE.fog);
      haze.addColorStop(0.18, '#8fa8b6');
      haze.addColorStop(1, '#5a6d76');
      ctx.fillStyle = haze;
      ctx.fillRect(0, skyBottom, VIEW.width, VIEW.height - skyBottom);
    }

    // The sun sits where its direction projects, so the glow moves with the camera.
    const sunPoint = {
      x: basis.position.x + SUN.x * 4000,
      y: basis.position.y + SUN.y * 4000,
      z: basis.position.z + SUN.z * 4000,
    };
    const sun = project(basis, sunPoint, VIEW.width, VIEW.height, CAMERA.near);
    if (sun.visible) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, 340);
      glow.addColorStop(0, 'rgba(255, 244, 214, 0.95)');
      glow.addColorStop(0.18, 'rgba(255, 226, 170, 0.55)');
      glow.addColorStop(0.5, 'rgba(255, 205, 145, 0.18)');
      glow.addColorStop(1, 'rgba(255, 200, 130, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sun.x - 340, sun.y - 340, 680, 680);
    }

    // The horizon haze: three stacked bands, each softer than the last, so the terrain edge never
    // lands on a hard line.
    for (let i = 0; i < 3; i += 1) {
      const top = horizon - 60 + i * 26;
      const band = ctx.createLinearGradient(0, top, 0, top + 96);
      band.addColorStop(0, 'rgba(178, 202, 220, 0)');
      band.addColorStop(0.55, `rgba(178, 202, 220, ${0.42 + i * 0.16})`);
      band.addColorStop(1, 'rgba(150, 178, 200, 0.9)');
      ctx.fillStyle = band;
      ctx.fillRect(0, top, VIEW.width, 96);
    }
  }

  /** One terrain quad, filled with its shaded ground colour. */
  function drawQuad(basis, ax, az, bx, bz, cx, cz, dx, dz) {
    const ay = groundHeight(ax, az);
    const by = groundHeight(bx, bz);
    const cy = groundHeight(cx, cz);
    const dy = groundHeight(dx, dz);

    const pa = project(basis, { x: ax, y: ay, z: az }, VIEW.width, VIEW.height, CAMERA.near);
    const pb = project(basis, { x: bx, y: by, z: bz }, VIEW.width, VIEW.height, CAMERA.near);
    const pc = project(basis, { x: cx, y: cy, z: cz }, VIEW.width, VIEW.height, CAMERA.near);
    const pd = project(basis, { x: dx, y: dy, z: dz }, VIEW.width, VIEW.height, CAMERA.near);
    if (!pa.visible || !pb.visible || !pc.visible || !pd.visible) return;

    // Slope from the quad's own gradient: a steep face is shaded darker, which is what makes the
    // ridgelines read as ridges rather than as a painted gradient.
    const slope = clamp(Math.abs(by - ay) / Math.max(1, Math.hypot(bx - ax, bz - az)) * 2.4, 0, 1.5);
    groundColor((ay + by + cy + dy) / 4, slope, shade);

    // Distance fade into the haze, so the far cells match the sky at the horizon.
    const depth = (pa.depth + pc.depth) / 2;
    const fade = clamp((depth - 620) / 1750, 0, 0.88);
    const r = Math.round(lerp(shade[0], 0.70, fade) * 255);
    const g = Math.round(lerp(shade[1], 0.79, fade) * 255);
    const b = Math.round(lerp(shade[2], 0.86, fade) * 255);

    // A flat fill per quad is what made the near ground read as squares: one colour covered the
    // whole cell, so every cell edge was a visible step. Instead the quad is filled with a gradient
    // running from its near edge to its far edge, and the far colour is biased toward the haze. Two
    // adjacent cells then meet at almost the same colour, and the step disappears.
    const nearY = (pa.y + pb.y) / 2;
    const farY = (pc.y + pd.y) / 2;
    const nearX = (pa.x + pb.x) / 2;
    const farX = (pc.x + pd.x) / 2;

    // The far end of the cell is a little deeper, so it takes a little more haze.
    const farFade = clamp(fade + 0.05, 0, 0.9);
    const fr = Math.round(lerp(shade[0], 0.70, farFade) * 255);
    const fg = Math.round(lerp(shade[1], 0.79, farFade) * 255);
    const fb = Math.round(lerp(shade[2], 0.86, farFade) * 255);

    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.lineTo(pc.x, pc.y);
    ctx.lineTo(pd.x, pd.y);
    ctx.closePath();

    // A degenerate gradient (near and far points coincident) throws in some browsers, so fall back
    // to a flat fill when the cell projects too small to have a direction.
    if (Math.abs(farY - nearY) + Math.abs(farX - nearX) < 0.5) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
    } else {
      const grad = ctx.createLinearGradient(nearX, nearY, farX, farY);
      grad.addColorStop(0, `rgb(${r},${g},${b})`);
      grad.addColorStop(1, `rgb(${fr},${fg},${fb})`);
      ctx.fillStyle = grad;
    }
    ctx.fill();
  }

  /**
   * The terrain, near cells last so they cover the coarse ones behind them.
   *
   * Each band is drawn out to a little past its own radius, so it overlaps the band behind it. Without
   * the overlap the handover is a hard line: the fine cells stop, the coarse cells begin, and the two
   * resolutions meet at a visible seam. The overlap is one cell of the coarser band, which is enough
   * for the fine cells to cover the join completely.
   */
  function drawTerrain(basis, aircraft) {
    const cx = aircraft.position.x;
    const cz = aircraft.position.z;
    const heading = aircraft.heading;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    for (let ring = RINGS.length - 1; ring >= 0; ring -= 1) {
      const { distance, step } = RINGS[ring];
      // Overlap the next coarser band by one of its cells, so the finer band always covers the join.
      const outer = ring < RINGS.length - 1 ? RINGS[ring + 1].step * 1.15 : 0;
      const reach = distance + outer;
      const span = Math.ceil(reach / step);
      for (let ix = -span; ix <= span; ix += 1) {
        for (let iz = -span; iz <= span; iz += 1) {
          const lx = ix * step;
          const lz = iz * step;
          if (Math.abs(lx) > reach || Math.abs(lz) > reach) continue;
          const wx = cx + lx * cosH + lz * sinH;
          const wz = cz - lx * sinH + lz * cosH;
          const hx = step * 0.5;
          drawQuad(basis, wx - hx, wz - hx, wx + hx, wz - hx, wx + hx, wz + hx, wx - hx, wz + hx);
        }
      }
    }
  }

  /** The runway: a dark strip with centreline dashes, threshold bars and a lit edge. */
  function drawRunway(basis) {
    const half = AIRFIELD.length / 2;
    const w = AIRFIELD.width / 2;
    const corners = [
      project(basis, { x: -w, y: 0.5, z: -half }, VIEW.width, VIEW.height, CAMERA.near),
      project(basis, { x: w, y: 0.5, z: -half }, VIEW.width, VIEW.height, CAMERA.near),
      project(basis, { x: w, y: 0.5, z: half }, VIEW.width, VIEW.height, CAMERA.near),
      project(basis, { x: -w, y: 0.5, z: half }, VIEW.width, VIEW.height, CAMERA.near),
    ];
    if (!corners.every((c) => c.visible)) return;

    // The strip, with a subtle lengthwise gradient so it does not read as flat paint.
    const depthNear = corners[0].depth;
    const depthFar = corners[3].depth;
    const grad = ctx.createLinearGradient(corners[0].x, corners[0].y, corners[3].x, corners[3].y);
    grad.addColorStop(0, depthNear < depthFar ? '#23272d' : '#33383f');
    grad.addColorStop(1, depthNear < depthFar ? '#33383f' : '#23272d');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();

    // Edge lines: two thin bright strips down the sides.
    ctx.strokeStyle = 'rgba(233, 237, 240, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.moveTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.stroke();

    // Centreline dashes, spaced in world units so they foreshorten correctly.
    ctx.fillStyle = PALETTE.runwayMark;
    for (let d = -half + 40; d < half - 40; d += 54) {
      const a = project(basis, { x: -1.8, y: 0.6, z: d }, VIEW.width, VIEW.height, CAMERA.near);
      const b = project(basis, { x: 1.8, y: 0.6, z: d + 26 }, VIEW.width, VIEW.height, CAMERA.near);
      if (!a.visible || !b.visible) continue;
      const width = Math.max(1.5, Math.abs(b.x - a.x));
      ctx.fillRect(a.x - width / 2, Math.min(a.y, b.y), width, Math.abs(b.y - a.y) + 1);
    }

    // Threshold bars at each end: the detail that makes a runway read as a runway from the air.
    for (const end of [-half + 8, half - 8]) {
      for (let i = -4; i <= 4; i += 1) {
        const a = project(basis, { x: i * 5.0 - 1.4, y: 0.6, z: end - 10 }, VIEW.width, VIEW.height, CAMERA.near);
        const b = project(basis, { x: i * 5.0 + 1.4, y: 0.6, z: end + 10 }, VIEW.width, VIEW.height, CAMERA.near);
        if (!a.visible || !b.visible) continue;
        const width = Math.max(1.5, Math.abs(b.x - a.x));
        ctx.fillRect(a.x - width / 2, Math.min(a.y, b.y), width, Math.abs(b.y - a.y) + 1);
      }
    }
  }

  /**
   * The hangar and the tower beside the runway. Two boxes with shaded faces: they give the eye a
   * known size to measure the aircraft and the terrain against, which is what makes the scale read.
   */
  function drawBuildings(basis) {
    const structures = [
      { x: -78, z: -180, w: 46, d: 34, h: 17, colour: '#8d99a6' },
      { x: -78, z: -120, w: 46, d: 34, h: 17, colour: '#8d99a6' },
      { x: 74, z: 40, w: 13, d: 13, h: 34, colour: '#b9c4cf' },
      { x: 74, z: 40, w: 21, d: 21, h: 7, colour: '#d6dee6' },
    ];
    for (const s of structures) {
      const base = groundHeight(s.x, s.z);
      const c = [
        { x: s.x - s.w / 2, y: base, z: s.z - s.d / 2 },
        { x: s.x + s.w / 2, y: base, z: s.z - s.d / 2 },
        { x: s.x + s.w / 2, y: base, z: s.z + s.d / 2 },
        { x: s.x - s.w / 2, y: base, z: s.z + s.d / 2 },
      ];
      const p = c.map((v) => project(basis, v, VIEW.width, VIEW.height, CAMERA.near));
      if (!p.every((v) => v.visible)) continue;
      const top = c.map((v) => project(basis, { x: v.x, y: v.y + s.h, z: v.z }, VIEW.width, VIEW.height, CAMERA.near));
      if (!top.every((v) => v.visible)) continue;

      // Four walls, each shaded by how it faces the sun.
      const faces = [
        { a: 0, b: 1, shade: 0.78 },
        { a: 1, b: 2, shade: 0.62 },
        { a: 2, b: 3, shade: 0.52 },
        { a: 3, b: 0, shade: 0.70 },
      ];
      for (const f of faces) {
        const k = f.shade;
        const r = Math.round(parseInt(s.colour.slice(1, 3), 16) * k);
        const g = Math.round(parseInt(s.colour.slice(3, 5), 16) * k);
        const b = Math.round(parseInt(s.colour.slice(5, 7), 16) * k);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.moveTo(p[f.a].x, p[f.a].y);
        ctx.lineTo(p[f.b].x, p[f.b].y);
        ctx.lineTo(top[f.b].x, top[f.b].y);
        ctx.lineTo(top[f.a].x, top[f.a].y);
        ctx.closePath();
        ctx.fill();
      }
      // The roof, the brightest face.
      ctx.fillStyle = '#e2e9ef';
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y);
      for (let i = 1; i < 4; i += 1) ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * The props: trees, rocks and huts scattered over the terrain. Each is drawn as a small projected
   * shape whose size falls off with distance, and each is skipped once it is smaller than a couple of
   * pixels — at that point it is noise on the terrain colour, not an object.
   *
   * Props are drawn before the rings and the aircraft, so anything in the air is always in front of
   * the ground clutter.
   */
  function drawProps(basis, aircraft, props) {
    if (!props) return;

    for (const p of props) {
      // Cull by distance first: this is the cheapest test and it removes most of the list.
      const dx = p.x - aircraft.position.x;
      const dz = p.z - aircraft.position.z;
      if (dx * dx + dz * dz > 1400 * 1400) continue;

      const base = project(basis, { x: p.x, y: p.y, z: p.z }, VIEW.width, VIEW.height, CAMERA.near);
      if (!base.visible) continue;
      const scale = basis.focal / Math.max(8, base.depth);
      const height = p.size * scale;
      if (height < 1.6) continue;

      const top = project(basis, { x: p.x, y: p.y + p.size, z: p.z }, VIEW.width, VIEW.height, CAMERA.near);
      if (!top.visible) continue;

      if (p.kind === 'tree') {
        // A trunk and a canopy: two shapes, which is enough to read as a tree at any distance.
        const canopy = Math.max(1.2, p.size * 0.42 * scale);
        const dark = Math.round(38 + p.tone * 26);
        const green = Math.round(62 + p.tone * 34);
        ctx.fillStyle = `rgb(${Math.round(dark * 0.7)},${Math.round(green * 0.72)},${Math.round(dark * 0.66)})`;
        ctx.fillRect(base.x - Math.max(0.7, canopy * 0.14), top.y, Math.max(1.4, canopy * 0.28), base.y - top.y);
        ctx.fillStyle = `rgb(${dark},${green},${Math.round(dark * 0.72)})`;
        ctx.beginPath();
        ctx.moveTo(base.x, top.y);
        ctx.lineTo(base.x + canopy, base.y - height * 0.28);
        ctx.lineTo(base.x - canopy, base.y - height * 0.28);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'rock') {
        const w = Math.max(1.2, p.size * 0.5 * scale);
        ctx.fillStyle = `rgb(${Math.round(96 + p.tone * 30)},${Math.round(98 + p.tone * 30)},${Math.round(102 + p.tone * 30)})`;
        ctx.beginPath();
        ctx.moveTo(base.x - w, base.y);
        ctx.lineTo(base.x - w * 0.4, top.y);
        ctx.lineTo(base.x + w * 0.5, top.y + height * 0.12);
        ctx.lineTo(base.x + w, base.y);
        ctx.closePath();
        ctx.fill();
      } else {
        // A hut: a box with a roof, the one man-made shape out here.
        const w = Math.max(1.4, p.size * 0.55 * scale);
        ctx.fillStyle = '#b9b2a4';
        ctx.fillRect(base.x - w, top.y + height * 0.35, w * 2, height * 0.65);
        ctx.fillStyle = '#6d6357';
        ctx.beginPath();
        ctx.moveTo(base.x - w * 1.15, top.y + height * 0.38);
        ctx.lineTo(base.x, top.y);
        ctx.lineTo(base.x + w * 1.15, top.y + height * 0.38);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** A ring in the air: a thick torus, gold for the live target and cyan for the rest. */
  function drawRing(basis, ring, isNext) {
    const steps = 44;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      points.push(
        project(
          basis,
          {
            x: ring.position.x + Math.cos(a) * WORLD.ringRadius,
            y: ring.position.y + Math.sin(a) * WORLD.ringRadius,
            z: ring.position.z,
          },
          VIEW.width,
          VIEW.height,
          CAMERA.near,
        ),
      );
    }
    const spans = points.filter((p) => p.visible);
    if (spans.length < 2) return;
    const width = Math.max(...spans.map((p) => p.x)) - Math.min(...spans.map((p) => p.x));
    if (width < 6) return;

    const stroke = isNext ? PALETTE.ringNext : PALETTE.ring;
    const thickness = Math.max(4, width * (isNext ? 0.062 : 0.042));

    // A wide, faint halo first: it separates the ring from the terrain at any distance.
    ctx.save();
    ctx.globalAlpha = ring.passed ? 0.1 : isNext ? 0.3 : 0.16;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = thickness * 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let halo = false;
    for (const p of points) {
      if (!p.visible) {
        halo = false;
        continue;
      }
      if (!halo) {
        ctx.moveTo(p.x, p.y);
        halo = true;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();

    // The torus body, with a lighter inner line so it reads as a tube rather than a drawn circle.
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = ring.passed ? 0.22 : isNext ? 1 : 0.72;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    let drawing = false;
    for (const p of points) {
      if (!p.visible) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        ctx.moveTo(p.x, p.y);
        drawing = true;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    if (isNext && !ring.passed) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#fff6d0';
      ctx.lineWidth = Math.max(1.2, thickness * 0.28);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The afterburner. A short, tight plume that leaves the nozzle ring and tapers to a point, drawn as
   * a stack of slices along the exhaust axis.
   *
   * The dimensions are deliberately small. The airframe is 1.86 m wide at its widest, so a plume that
   * starts at the nozzle radius and only reaches about twice that at full throttle reads as an engine
   * exhaust; anything wider reads as a curtain hanging under the tail. Length is capped at a little
   * over two body-lengths for the same reason.
   *
   * The colour runs the other way round from a cooling flame: white-hot blue at the nozzle, where the
   * gas is hottest, shading through yellow and orange to a dull red at the tip, where it has cooled.
   * That is what the eye expects from a jet pipe, and it keeps the bright part where the engine is.
   */
  function drawThrust(basis, aircraft) {
    if (aircraft.throttle < 0.04) return;

    const nozzle = bodyToWorld([NOZZLE.x, NOZZLE.y, NOZZLE.z], aircraft);
    const back = bodyDirectionToWorld([0, 0, -1], aircraft);

    // A compact plume: 1.6 m at idle, 3.8 m at full throttle. The nozzle radius is 0.74 m, so the
    // flame stays in proportion to the pipe it comes out of while still being long enough to read as
    // a plume at 768x480, where a shorter one vanished behind the tail.
    const length = 1.6 + aircraft.throttle * 2.2;
    // The plume starts at the pipe's own radius and swells only slightly before tapering.
    const baseRadius = NOZZLE.radius * (0.78 + aircraft.throttle * 0.32);

    const start = project(basis, nozzle, VIEW.width, VIEW.height, CAMERA.near);
    if (!start.visible) return;

    const slices = 14;
    const alpha = 0.48 + aircraft.throttle * 0.44;

    // Colour ramp, nozzle outward: [t, r, g, b, alphaScale]. Blue-white core, red tail.
    const ramp = [
      [0.00, 236, 248, 255, 1.00], // blue-white at the lip
      [0.16, 168, 214, 255, 0.94], // pale blue
      [0.36, 255, 236, 176, 0.86], // warm white
      [0.58, 255, 186, 92, 0.72],  // amber
      [0.80, 238, 118, 58, 0.52],  // orange
      [1.00, 168, 52, 38, 0.00],   // dull red, gone
    ];

    function rampAt(t) {
      for (let i = 0; i < ramp.length - 1; i += 1) {
        const a = ramp[i];
        const b = ramp[i + 1];
        if (t >= a[0] && t <= b[0]) {
          const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
          return [
            Math.round(lerp(a[1], b[1], k)),
            Math.round(lerp(a[2], b[2], k)),
            Math.round(lerp(a[3], b[3], k)),
            lerp(a[4], b[4], k),
          ];
        }
      }
      return [168, 52, 38, 0];
    }

    // Draw from the far end back towards the nozzle, so nearer slices cover farther ones.
    for (let i = slices - 1; i >= 0; i -= 1) {
      const t = i / slices;
      const tNext = (i + 1) / slices;

      // The profile: a slight swell just behind the pipe, then a taper. The taper is gentler than a
      // pure cone (0.88 rather than 0.94) so the orange-red tail keeps some width instead of
      // collapsing to a point, which is what made it unreadable at contact-sheet size.
      const profile = (u) => {
        const swell = 1 + 0.20 * Math.sin(Math.min(1, u / 0.28) * Math.PI * 0.5);
        return (1 - u * 0.88) * swell;
      };
      const rHere = baseRadius * profile(t);
      const rNext = baseRadius * profile(tNext);

      const pHere = {
        x: nozzle.x + back.x * length * t,
        y: nozzle.y + back.y * length * t,
        z: nozzle.z + back.z * length * t,
      };
      const pNext = {
        x: nozzle.x + back.x * length * tNext,
        y: nozzle.y + back.y * length * tNext,
        z: nozzle.z + back.z * length * tNext,
      };

      const a = project(basis, pHere, VIEW.width, VIEW.height, CAMERA.near);
      const b = project(basis, pNext, VIEW.width, VIEW.height, CAMERA.near);
      if (!a.visible || !b.visible) continue;

      const scaleHere = basis.focal / Math.max(4, a.depth);
      const scaleNext = basis.focal / Math.max(4, b.depth);
      const wa = Math.max(0.5, rHere * scaleHere);
      const wb = Math.max(0.3, rNext * scaleNext);

      const [cr, cg, cb, ca] = rampAt(t);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${(ca * alpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x - wa, a.y);
      ctx.lineTo(a.x + wa, a.y);
      ctx.lineTo(b.x + wb, b.y);
      ctx.lineTo(b.x - wb, b.y);
      ctx.closePath();
      ctx.fill();
    }

    // The hot ring at the nozzle lip: a small blue-white disc exactly the size of the pipe, which is
    // what anchors the plume to the engine instead of letting it float.
    const lipRadius = Math.max(1.2, NOZZLE.radius * (basis.focal / Math.max(4, start.depth)));
    const lip = ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, lipRadius * 1.25);
    lip.addColorStop(0, `rgba(248, 252, 255, ${(0.92 * alpha).toFixed(3)})`);
    lip.addColorStop(0.40, `rgba(150, 205, 255, ${(0.62 * alpha).toFixed(3)})`);
    lip.addColorStop(0.75, `rgba(255, 200, 130, ${(0.30 * alpha).toFixed(3)})`);
    lip.addColorStop(1, 'rgba(255, 170, 90, 0)');
    ctx.fillStyle = lip;
    ctx.beginPath();
    ctx.arc(start.x, start.y, lipRadius * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Wingtip vapour: a short streak off each tip, longer the harder the aircraft is pulling. */
  function drawWingtipTrails(basis, aircraft) {
    const load = clamp((aircraft.gLoad - 1.4) / 3.2, 0, 1);
    const speed = clamp((aircraft.speed - 70) / 70, 0, 1);
    const strength = Math.max(load, speed * 0.55);
    if (strength < 0.08) return;

    for (const side of [-1, 1]) {
      const tip = bodyToWorld([side * 14.5, 0.2, 1.8], aircraft);
      const back = bodyDirectionToWorld([0, 0, -1], aircraft);
      const length = 6 + strength * 22;
      const end = {
        x: tip.x + back.x * length,
        y: tip.y + back.y * length - 0.6,
        z: tip.z + back.z * length,
      };
      const a = project(basis, tip, VIEW.width, VIEW.height, CAMERA.near);
      const b = project(basis, end, VIEW.width, VIEW.height, CAMERA.near);
      if (!a.visible || !b.visible) continue;
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, `rgba(240, 250, 255, ${0.42 * strength})`);
      grad.addColorStop(1, 'rgba(240, 250, 255, 0)');
      ctx.strokeStyle = grad;
      // A trail is a line on screen, so its width is in pixels and does not scale with depth. Scaling
      // it by focal/depth made it ~87 px wide at chase distance, which drew a bright bar across the
      // airframe instead of a wisp off the wingtip.
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  /** Engine smoke when the airframe is hurt: the visual proof that damage is a real mechanic. */
  function drawDamageSmoke(basis, aircraft) {
    // Smoke starts at 20% damage: a visibly hurt airframe should be trailing something, and the
    // late-sortie tile sits at 26%. The old floor of 32 meant that tile drew no smoke at all.
    if (aircraft.damage < 20) return;
    const severity = clamp((aircraft.damage - 20) / 60, 0.35, 1);
    const tail = bodyToWorld([0, 0.5, -6.2], aircraft);
    const back = bodyDirectionToWorld([0, 0, -1], aircraft);
    const start = project(basis, tail, VIEW.width, VIEW.height, CAMERA.near);
    if (!start.visible) return;

    // Eleven puffs over a longer trail, each larger and more opaque than before, so the plume still
    // reads once the frame is scaled down to a 384x240 tile.
    const puffs = 11;
    for (let i = 0; i < puffs; i += 1) {
      const t = i / puffs;
      const puff = {
        x: tail.x + back.x * (3 + t * 22),
        y: tail.y + back.y * (3 + t * 22) + t * 3.2,
        z: tail.z + back.z * (3 + t * 22),
      };
      const p = project(basis, puff, VIEW.width, VIEW.height, CAMERA.near);
      if (!p.visible) continue;
      // Puff size in metres, projected to pixels. The metres are small (0.5-2.2 m) because these
      // puffs sit only a few tens of metres from the camera: at focal/depth ~34 a 3.4 m sphere would
      // cover a 114 px radius and swamp the frame. This keeps the plume a plume.
      const metres = 0.5 + t * 1.7;
      const radius = (metres * basis.focal) / Math.max(20, p.depth);
      // A dark core that lightens and thins as it drifts aft. The range is kept low (38 -> 92) so the
      // plume stays clearly darker than the haze and sky behind it, which is what makes it read at
      // 384x240 where everything is a third of its drawn size.
      const shade = Math.round(38 + t * 54);
      const alpha = (0.68 - t * 0.30) * severity;
      ctx.fillStyle = `rgba(${shade}, ${shade + 3}, ${shade + 7}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The aircraft's shadow on the ground: an ellipse where the sun would put it. */
  function drawShadow(basis, aircraft) {
    const groundY = groundHeight(aircraft.position.x, aircraft.position.z);
    const height = Math.max(0, aircraft.position.y - groundY);
    const spread = 9 + height * 0.08;
    const fade = clamp(1 - height / 420, 0.04, 1);
    const p = project(
      basis,
      { x: aircraft.position.x, y: groundY + 0.7, z: aircraft.position.z },
      VIEW.width,
      VIEW.height,
      CAMERA.near,
    );
    if (!p.visible) return;
    const radius = (spread * basis.focal) / Math.max(20, p.depth);
    ctx.save();
    ctx.globalAlpha = 0.32 * fade;
    ctx.fillStyle = '#050d14';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, radius, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * The aircraft, as shaded panels. Each panel's normal is rotated into the world and lit by the
   * sun, so the airframe turns from lit to shadowed across its curve. Panels are sorted back to
   * front by their centroid depth, which is enough for a convex-ish body at this size.
   */
  function drawAircraft(basis, aircraft) {
    const toCamera = normalize(sub(basis.position, aircraft.position));
    const drawn = [];

    for (const panel of PANELS) {
      // The panel carries its own outward normal, so the backface test is a property of the design
      // rather than of the order its corners happen to be listed in.
      const n = panel.normal;
      const normalWorld = bodyDirectionToWorld([n[0], n[1], n[2]], aircraft);
      // A back-facing panel is hidden by the body; skipping it is what keeps the mesh from
      // showing its own far side through the near one.
      if (dot(normalWorld, toCamera) < -0.05) continue;

      const worldPoints = panel.points.map((pt) => bodyToWorld(pt, aircraft));
      const projected = worldPoints.map((w) => project(basis, w, VIEW.width, VIEW.height, CAMERA.near));
      if (!projected.every((p) => p.visible)) continue;

      const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
      const lit = shadePanel(panel.colour, normalWorld, toCamera);
      drawn.push({ projected, depth, lit });
    }

    // Back to front, so a near panel covers a far one.
    drawn.sort((a, b) => b.depth - a.depth);

    for (const panel of drawn) {
      ctx.fillStyle = `rgb(${panel.lit.r},${panel.lit.g},${panel.lit.b})`;
      ctx.beginPath();
      ctx.moveTo(panel.projected[0].x, panel.projected[0].y);
      for (let i = 1; i < panel.projected.length; i += 1) {
        ctx.lineTo(panel.projected[i].x, panel.projected[i].y);
      }
      ctx.closePath();
      ctx.fill();
      // A hairline seam between panels: this is what makes the panels read as separate surfaces
      // rather than as one flat shape, and it survives being shrunk to a contact sheet.
      ctx.strokeStyle = 'rgba(24, 34, 46, 0.42)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  /**
   * Draw a whole frame. `scene` carries the aircraft, the rings and the ground height under it; the
   * camera is derived here so the caller never has to know how the view is framed.
   */
  function render(scene) {
    const { aircraft, rings, nextRing } = scene;
    // A scene may override the chase camera. The contact-sheet tiles use this: a banked airframe is
    // taller on screen than a level one, and the default rig put the low wingtip past the bottom edge.
    const cam = scene.camera ? { ...CAMERA, ...scene.camera } : CAMERA;
    const forward = { x: Math.sin(aircraft.heading), y: 0, z: Math.cos(aircraft.heading) };
    const cameraPos = {
      x: aircraft.position.x - forward.x * cam.back,
      y: aircraft.position.y + cam.up,
      z: aircraft.position.z - forward.z * cam.back,
    };
    // The look point follows the airframe's pitch, damped. Without this the camera always stares at a
    // fixed drop below the aircraft, so a nose-up attitude still framed mostly ground and the horizon
    // sank to the top of the screen. The damping keeps the chase cam from whipping when the nose moves.
    const pitchLift = Math.sin(aircraft.pitch) * cam.lookAhead * cam.pitchFollow;
    const target = {
      x: aircraft.position.x + forward.x * cam.lookAhead,
      y: aircraft.position.y - cam.lookDrop + pitchLift,
      z: aircraft.position.z + forward.z * cam.lookAhead,
    };
    const basis = cameraBasis(cameraPos, target, cam.fov, VIEW.width);

    drawSky(basis);
    drawTerrain(basis, aircraft);
    drawRunway(basis);
    drawBuildings(basis);
    drawProps(basis, aircraft, scene.props);
    drawShadow(basis, aircraft);
    for (const ring of rings) drawRing(basis, ring, ring === nextRing);
    drawWingtipTrails(basis, aircraft);
    drawAircraft(basis, aircraft);
    // The plume is drawn after the airframe. It leaves the nozzle at the tail and streams aft, so from
    // a chase camera it is partly behind the body; drawing it last lets the visible part sit on top
    // instead of being hidden by the fuselage that encloses the nozzle.
    drawThrust(basis, aircraft);
    drawDamageSmoke(basis, aircraft);

    return basis;
  }

  return { render, resize, ctx };
}
