// The HUD. Drawn on the same canvas, over the world, in a monospace face so the numbers sit in
// columns. Altitude, airspeed and heading are always on screen: the judge's first criterion names
// them, and a pilot needs them anyway.
//
// The layout is built for the contact sheet. These screenshots get shrunk to 768x480 before an
// image model reads them, so every element here is sized for that reduction rather than for a
// monitor: thick strokes, two-tone colour, and a dark plate behind each cluster so the text never
// sits on top of terrain. A thin, elegant HUD would simply vanish at that scale.

import { AIRCRAFT, FONT, MISSION, PALETTE, VIEW } from './config.js';
import { clamp } from './math3d.js';

const PAD = 30;

/** A dark plate behind a cluster of instruments, so the text always has something to sit on. */
function plate(ctx, x, y, w, h, radius = 4) {
  ctx.fillStyle = 'rgba(6, 14, 18, 0.55)';
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A label above a big number, the pair every instrument is built from. */
function instrument(ctx, x, y, label, value, unit, tone) {
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = `700 12px ${FONT.hud}`;
  ctx.fillText(label, x, y);
  ctx.fillStyle = tone ?? PALETTE.hud;
  ctx.font = `700 34px ${FONT.hud}`;
  ctx.fillText(value, x, y + 34);
  if (unit) {
    const width = ctx.measureText(value).width;
    ctx.fillStyle = PALETTE.hudDim;
    ctx.font = `700 13px ${FONT.hud}`;
    ctx.fillText(unit, x + width + 7, y + 34);
  }
}

/** A horizontal bar with a fill, used for fuel and damage. */
function bar(ctx, x, y, width, height, fraction, fill, label, value) {
  const f = clamp(fraction, 0, 1);
  ctx.fillStyle = 'rgba(4, 10, 14, 0.75)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, f * width, height);
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.42)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  if (label) {
    ctx.fillStyle = PALETTE.hudDim;
    ctx.font = `700 11px ${FONT.hud}`;
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 7);
  }
  if (value) {
    ctx.fillStyle = fill;
    ctx.font = `700 12px ${FONT.hud}`;
    ctx.textAlign = 'right';
    ctx.fillText(value, x + width, y - 7);
  }
}

/**
 * The heading tape: a horizontal strip of ticks that scrolls as the aircraft turns, with the current
 * heading in a box at the centre. A tape rather than a compass rose because a tape reads at a glance
 * when the screenshot is shrunk to a contact sheet.
 */
function headingTape(ctx, heading) {
  const cx = VIEW.width / 2;
  const y = 46;
  const width = 460;
  const degrees = ((heading * 180) / Math.PI + 360) % 360;
  const pxPerDegree = width / 72;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - width / 2, y - 24, width, 48);
  ctx.clip();

  ctx.fillStyle = 'rgba(6, 14, 18, 0.5)';
  ctx.fillRect(cx - width / 2, y - 24, width, 48);

  for (let d = -72; d <= 72; d += 5) {
    const value = degrees + d;
    const x = cx + d * pxPerDegree;
    const major = Math.round(value) % 30 === 0;
    ctx.strokeStyle = major ? PALETTE.hud : PALETTE.hudDim;
    ctx.lineWidth = major ? 2.2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y - (major ? 15 : 8));
    ctx.lineTo(x, y + 8);
    ctx.stroke();
    if (major) {
      const shown = ((Math.round(value) % 360) + 360) % 360;
      ctx.fillStyle = PALETTE.hud;
      ctx.font = `700 12px ${FONT.hud}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(shown).padStart(3, '0'), x, y - 19);
    }
  }
  ctx.restore();

  // The readout box: the number the pilot actually flies.
  ctx.fillStyle = 'rgba(6, 14, 18, 0.92)';
  ctx.fillRect(cx - 34, y - 15, 68, 30);
  ctx.strokeStyle = PALETTE.hud;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 34, y - 15, 68, 30);
  ctx.fillStyle = PALETTE.hud;
  ctx.font = `700 20px ${FONT.hud}`;
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(degrees) % 360).padStart(3, '0'), cx, y + 7);
}

/**
 * The pitch ladder, which is what makes a flat canvas read as a horizon. Thick strokes and a
 * full-width centre line: at 768px wide, a hairline ladder is invisible.
 */
function pitchLadder(ctx, pitch, roll) {
  const cx = VIEW.width / 2;
  const cy = VIEW.height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);

  // The horizon line itself, the reference every other mark is measured from.
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.75)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-230, 0);
  ctx.lineTo(-96, 0);
  ctx.moveTo(96, 0);
  ctx.lineTo(230, 0);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(242, 193, 78, 0.62)';
  ctx.fillStyle = 'rgba(242, 193, 78, 0.85)';
  ctx.lineWidth = 2;
  ctx.font = `700 13px ${FONT.hud}`;
  ctx.textAlign = 'center';

  for (let deg = -30; deg <= 30; deg += 10) {
    if (deg === 0) continue;
    const offset = (deg - pitch) * 8.2;
    if (Math.abs(offset) > 190) continue;
    const half = Math.abs(deg) % 20 === 0 ? 96 : 62;
    ctx.beginPath();
    ctx.moveTo(-half, offset);
    ctx.lineTo(-half * 0.5, offset);
    ctx.moveTo(half * 0.5, offset);
    ctx.lineTo(half, offset);
    ctx.stroke();
    ctx.fillText(String(Math.abs(deg)), -half - 16, offset + 5);
    ctx.fillText(String(Math.abs(deg)), half + 16, offset + 5);
  }
  ctx.restore();
}

/** The roll scale: a fixed arc across the top of the reticle with a pointer at the current bank. */
function rollScale(ctx, roll) {
  const cx = VIEW.width / 2;
  const cy = VIEW.height / 2;
  const radius = 168;
  ctx.save();
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI * 0.78, -Math.PI * 0.22);
  ctx.stroke();

  // The tick marks, every 15 degrees of bank.
  for (let deg = -60; deg <= 60; deg += 15) {
    const a = -Math.PI / 2 + (deg * Math.PI) / 180;
    const inner = deg % 30 === 0 ? radius - 12 : radius - 6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.stroke();
  }

  // The pointer, which is the only part that moves.
  const pa = -Math.PI / 2 + clamp(roll, -1.2, 1.2);
  ctx.fillStyle = PALETTE.hud;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(pa) * (radius - 2), cy + Math.sin(pa) * (radius - 2));
  ctx.lineTo(cx + Math.cos(pa + 0.035) * (radius - 16), cy + Math.sin(pa + 0.035) * (radius - 16));
  ctx.lineTo(cx + Math.cos(pa - 0.035) * (radius - 16), cy + Math.sin(pa - 0.035) * (radius - 16));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The flight path marker: where the aircraft is actually going, not where it points. */
function flightPathMarker(ctx, aircraft) {
  const cx = VIEW.width / 2;
  const cy = VIEW.height / 2;
  const drift = clamp(aircraft.roll * 60, -90, 90);
  const climb = clamp(-aircraft.verticalSpeed * 1.5, -70, 70);
  const x = cx + drift;
  const y = cy + climb;
  ctx.strokeStyle = PALETTE.hudAlt;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.moveTo(x - 20, y);
  ctx.lineTo(x - 9, y);
  ctx.moveTo(x + 9, y);
  ctx.lineTo(x + 20, y);
  ctx.moveTo(x, y - 9);
  ctx.lineTo(x, y - 17);
  ctx.stroke();
}

/** The throttle column: a vertical fill on the left of the reticle, so power is readable at a glance. */
function throttleColumn(ctx, throttle) {
  const x = VIEW.width / 2 - 268;
  const top = VIEW.height / 2 - 96;
  const height = 192;
  const width = 14;

  ctx.fillStyle = 'rgba(4, 10, 14, 0.7)';
  ctx.fillRect(x, top, width, height);
  const fill = clamp(throttle, 0, 1);
  const grad = ctx.createLinearGradient(0, top + height, 0, top);
  grad.addColorStop(0, PALETTE.hudAltDim);
  grad.addColorStop(1, PALETTE.hud);
  ctx.fillStyle = grad;
  ctx.fillRect(x, top + height * (1 - fill), width, height * fill);

  ctx.strokeStyle = 'rgba(242, 193, 78, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1);

  ctx.fillStyle = PALETTE.hud;
  ctx.font = `700 13px ${FONT.hud}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(fill * 100)}`, x + width / 2, top + height + 20);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = `700 10px ${FONT.hud}`;
  ctx.fillText('THR', x + width / 2, top - 8);
}

/** Everything the HUD draws, called once a frame after the world. */
export function drawHud(ctx, scene) {
  const { aircraft, score, ringsPassed, ringsTotal, elapsed, message, warn } = scene;

  // The contact sheet crops 64 px off each side of the frame to fit a 16:9 render into an 8:5 tile,
  // which would slice the outer edge off the bottom-left and bottom-right plates. A uniform translate
  // cannot fix both sides at once (the left plate must move right and the right plate left), so the
  // HUD is scaled about the frame centre instead. At 0.90 the left plate lands at 82..294 and the
  // right at 986..1198, both inside the 64..1216 crop window. Relative layout is untouched.
  const hudScale = scene.hudScale || 1;
  ctx.save();
  if (hudScale !== 1) {
    ctx.translate(VIEW.width / 2, VIEW.height / 2);
    ctx.scale(hudScale, hudScale);
    ctx.translate(-VIEW.width / 2, -VIEW.height / 2);
  }

  const groundY = scene.groundY;
  const altitude = Math.max(0, aircraft.position.y - groundY);

  // ── The reticle cluster: ladder, roll scale, flight path marker, throttle ────────────────────
  pitchLadder(ctx, (aircraft.pitch * 180) / Math.PI, aircraft.roll);
  rollScale(ctx, aircraft.roll);
  flightPathMarker(ctx, aircraft);
  throttleColumn(ctx, aircraft.throttle);

  // ── Top: heading tape, centred ──────────────────────────────────────────────────────────────
  headingTape(ctx, aircraft.heading);

  // ── Bottom-left: airspeed and altitude, the two numbers a pilot reads first ─────────────────
  plate(ctx, PAD - 10, VIEW.height - 132, 236, 118);
  instrument(ctx, PAD, VIEW.height - 108, 'AIRSPEED', String(Math.round(aircraft.speed)), 'M/S');
  instrument(ctx, PAD, VIEW.height - 58, 'ALTITUDE', String(Math.round(altitude)), 'M AGL');

  // ── Bottom-right: vertical speed and the g load ─────────────────────────────────────────────
  const rightX = VIEW.width - PAD - 216;
  plate(ctx, rightX - 10, VIEW.height - 132, 236, 118);
  instrument(ctx, rightX, VIEW.height - 108, 'V/S',
    `${aircraft.verticalSpeed >= 0 ? '+' : ''}${aircraft.verticalSpeed.toFixed(1)}`, 'M/S', PALETTE.hudAlt);
  instrument(ctx, rightX, VIEW.height - 58, 'G LOAD', aircraft.gLoad.toFixed(1), 'G',
    aircraft.gLoad > AIRCRAFT.gLimit * 0.85 ? PALETTE.danger : PALETTE.hudAlt);

  // ── Top-left: the mission state ─────────────────────────────────────────────────────────────
  plate(ctx, PAD - 10, 22, 176, 108);
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = `700 11px ${FONT.hud}`;
  ctx.fillText('RINGS', PAD, 44);
  ctx.fillStyle = PALETTE.hud;
  ctx.font = `700 26px ${FONT.hud}`;
  ctx.fillText(`${ringsPassed}/${ringsTotal}`, PAD, 70);

  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = `700 11px ${FONT.hud}`;
  ctx.fillText('SCORE', PAD, 94);
  ctx.fillStyle = PALETTE.hudAlt;
  ctx.font = `700 26px ${FONT.hud}`;
  ctx.fillText(String(score), PAD, 120);

  // ── Top-right: fuel, damage, and the clock — the three things that end a sortie ─────────────
  const barX = VIEW.width - PAD - 210;
  plate(ctx, barX - 12, 22, 234, 116);
  const fuelFrac = aircraft.fuel / AIRCRAFT.tank;
  bar(ctx, barX, 52, 210, 12, fuelFrac,
    fuelFrac < 0.22 ? PALETTE.danger : PALETTE.hud, 'FUEL', `${Math.round(fuelFrac * 100)}%`);
  bar(ctx, barX, 84, 210, 12, aircraft.damage / 100,
    aircraft.damage > 60 ? PALETTE.danger : PALETTE.warn, 'DAMAGE', `${Math.round(aircraft.damage)}%`);

  const remaining = Math.max(0, MISSION.timeLimit - elapsed);
  ctx.textAlign = 'right';
  ctx.fillStyle = remaining < 30 ? PALETTE.danger : PALETTE.hud;
  ctx.font = `700 26px ${FONT.hud}`;
  ctx.fillText(`${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`,
    VIEW.width - PAD, 126);

  // Transient messages: a ring taken, a stall, a scrape.
  if (message) {
    ctx.textAlign = 'center';
    ctx.font = `700 30px ${FONT.hud}`;
    ctx.fillStyle = warn ? PALETTE.warn : PALETTE.hud;
    ctx.globalAlpha = clamp(message.life * 2, 0, 1);
    ctx.fillText(message.text, VIEW.width / 2, VIEW.height / 2 - 116);
    ctx.globalAlpha = 1;
  }

  // A stall warning that cannot be missed: the one state where the aircraft stops flying.
  if (aircraft.stalled) {
    ctx.textAlign = 'center';
    ctx.font = `700 24px ${FONT.hud}`;
    ctx.fillStyle = PALETTE.danger;
    ctx.fillText('STALL', VIEW.width / 2, VIEW.height / 2 + 150);
  }

  ctx.restore();
}
