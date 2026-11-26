// Screenshot the game's staged scenes.
//
// The plain `--screenshot` flag captures whatever the compositor has at that instant, which for a
// module-script page can be before the module has even parsed. This driver instead waits for the
// page to set `window.__sortieReady`, then reads the canvas out with toDataURL and writes the PNG
// itself. That makes the capture deterministic: the file always contains a frame the game drew.
//
// Two modes:
//   node tools/shoot.mjs <outDir> [scene ...]        one PNG per scene, at 1280x720
//   node tools/shoot.mjs --sheet <outDir>            one 768x480 contact sheet, 2x2 grid
//
// The contact sheet is assembled inside the page with a 2D canvas: each 1280x720 frame is drawn into
// a 384x240 tile with the aspect ratio preserved, so the sheet is exactly 768x480 with no letterbox.

import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const SHEET_MODE = args.includes('--sheet');
const positional = args.filter((a) => a !== '--sheet');

const OUT = positional[0] || (SHEET_MODE ? '/tmp/contact-sheet' : '/tmp/shots');
const scenes = positional.slice(1).length ? positional.slice(1) : ['start', 'play', 'approach'];
const PORT = process.env.PORT || 8099;
const CHROME = process.env.CHROME ||
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;

// The four tiles, in reading order. Each entry is the scene the game stages and the label that goes
// in the sheet's corner. The order matters: tile 0 is top-left, tile 3 is bottom-right.
const SHEET_TILES = [
  { scene: 'sheet-runway', label: '1 · RUNWAY · FUEL 100% · DMG 0%' },
  { scene: 'sheet-bank', label: '2 · BANKING · RING AHEAD' },
  { scene: 'sheet-low', label: '3 · LOW & FAST · TERRAIN' },
  { scene: 'sheet-late', label: '4 · LATE SORTIE · FUEL 35% · DMG 26%' },
];

const SHEET_W = 768;
const SHEET_H = 480;
const TILE_W = 384;
const TILE_H = 240;

mkdirSync(OUT, { recursive: true });

/** Start Chrome with a debugging port so the driver can talk CDP to it. */
function launch() {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--remote-debugging-port=9333',
    '--window-size=1280,720',
    'about:blank',
  ];
  const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  return child;
}

/** A minimal CDP client over the DevTools websocket. */
async function connect() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json/version');
      const info = await res.json();
      const ws = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      return ws;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Chrome did not expose a debugging port');
}

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
}

const chrome = launch();
try {
  const ws = await connect();
  const send = rpc(ws);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');

  /**
   * Load one scene and hand back its frame as a data URL. The wait on `window.__sortieReady` is what
   * makes this deterministic: the game sets that flag only after it has drawn its frame, so the
   * readback can never catch a blank canvas or the previous scene's pixels.
   */
  async function captureScene(scene) {
    const url = `http://localhost:${PORT}/?shot=${scene}`;
    await call('Page.navigate', { url });

    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(100);
      const { result } = await call('Runtime.evaluate', {
        expression: 'window.__sortieReady === true',
        returnByValue: true,
      });
      if (result.value === true) {
        ready = true;
        break;
      }
    }
    if (!ready) throw new Error(`${scene}: the page never signalled readiness`);

    // Two animation frames after readiness, so the compositor has the final pixels.
    await call('Runtime.evaluate', {
      expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
      awaitPromise: true,
    });

    const { result } = await call('Runtime.evaluate', {
      expression: "document.getElementById('game').toDataURL('image/png')",
      returnByValue: true,
    });
    const dataUrl = result.value;
    if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error(`${scene}: canvas readback failed`);
    }
    return dataUrl;
  }

  if (SHEET_MODE) {
    // Capture the four tiles in order, then compose them in the page.
    const frames = [];
    for (const tile of SHEET_TILES) {
      const dataUrl = await captureScene(tile.scene);
      frames.push({ dataUrl, label: tile.label });
      console.log(`  captured ${tile.scene}`);
    }

    // Compose on a fresh page: a 768x480 canvas, four 384x240 tiles, each source frame scaled with
    // its aspect ratio preserved. The label goes in a dark strip at the tile's bottom edge.
    await call('Page.navigate', { url: 'about:blank' });
    const composeExpression = `(async () => {
      const W = ${SHEET_W}, H = ${SHEET_H}, TW = ${TILE_W}, TH = ${TILE_H};
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b1116';
      ctx.fillRect(0, 0, W, H);

      const frames = ${JSON.stringify(frames)};

      // Load every frame first, so the tiles are drawn in one pass.
      const images = await Promise.all(frames.map((f) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = f.dataUrl;
      })));

      for (let i = 0; i < images.length; i += 1) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = col * TW;
        const y = row * TH;
        const img = images[i];

        // Cover-fit: scale so the source fills the tile, centre-cropping the overflow. The source is
        // 1280x720 (16:9) and the tile is 384x240 (8:5), so the crop is horizontal.
        const scale = Math.max(TW / img.width, TH / img.height);
        const sw = TW / scale;
        const sh = TH / scale;
        const sx = (img.width - sw) / 2;
        const sy = (img.height - sh) / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, TW, TH);
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sh, x, y, TW, TH);
        ctx.restore();

        // A hairline between tiles, so the grid reads as a grid. It is drawn on the gutter rather than
        // as a strokeRect on the tile edge: a 2px stroke inside the tile ate the top two rows of the
        // frame, which read as a black band above the sky.
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        if (col === 1) ctx.fillRect(x - 1, y, 2, TH);
        if (row === 1) ctx.fillRect(x, y - 1, TW, 2);

        // The label sits in the bottom-centre gutter. The HUD's bottom plates are inset to x 140..376
        // and x 1134..1370 in source space, and the crop keeps x 64..1216, so the centre band is free.
        // A left-aligned strip would have landed on AIRSPEED and ALTITUDE.
        const label = frames[i].label;
        ctx.save();
        ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const textW = ctx.measureText(label).width;
        const stripW = Math.min(TW - 20, textW + 16);
        const stripX = x + (TW - stripW) / 2;
        const stripY = y + TH - 21;
        ctx.fillStyle = 'rgba(6,12,16,0.86)';
        ctx.fillRect(stripX, stripY, stripW, 15);
        ctx.fillStyle = '#f2c14e';
        ctx.fillText(label, x + TW / 2, stripY + 8);
        ctx.restore();
      }

      return canvas.toDataURL('image/png');
    })()`;

    const { result } = await call('Runtime.evaluate', {
      expression: composeExpression,
      awaitPromise: true,
      returnByValue: true,
    });
    const dataUrl = result.value;
    if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('contact sheet composition failed');
    }
    const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    const path = `${OUT}/contact-sheet.png`;
    writeFileSync(path, bytes);
    console.log(`contact sheet: ${bytes.length} bytes -> ${path} (${SHEET_W}x${SHEET_H})`);
  } else {
    for (const scene of scenes) {
      try {
        const dataUrl = await captureScene(scene);
        const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
        const path = `${OUT}/${scene}.png`;
        writeFileSync(path, bytes);
        console.log(`${scene}: ${bytes.length} bytes -> ${path}`);
      } catch (error) {
        console.error(error.message);
      }
    }
  }

  ws.close();
} finally {
  chrome.kill('SIGTERM');
}
