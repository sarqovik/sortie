# Sortie

A flight game that runs in a desktop browser from its own files. You fly a sortie: take off from the
airfield, fly the ring course, then land. No network request, no build step, no library — plain ES
modules under `game/`, served by any static HTTP server.

## Play

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Open <http://localhost:8080> in Chrome. Arrow keys or WASD pitch and roll, E and Q set the throttle,
P or Escape pauses, R restarts. The mouse flies too: hold a button and the pointer's offset from
centre is the stick.

## What is in the box

```
main.ts                 hands the game in: copies game/ and screenshots/ to /output, writes dossier.json
serve.ts                a static server for game/ (development convenience)
game/index.html         the page: a canvas and the module entry
game/src/config.js      every tuning number in one place
game/src/math3d.js      vectors, camera basis, projection, value noise
game/src/terrain.js     the heightfield, its colours, prop scatter, the airfield
game/src/flight.js      the flight model: thrust, drag, lift, stall, g-load, ground contact
game/src/mission.js     the ring course, the scoring, the takeoff-to-touchdown state machine
game/src/aircraftMesh.js the airframe: a swept shell of 106 panels, built in code
game/src/hud.js         the instrument cluster: altitude, airspeed, heading, fuel, damage
game/src/render.js      the renderer: sky, terrain, rings, aircraft, shadow
game/src/input.js       keyboard and mouse
game/src/autopilot.js   the scripted pilot the screenshot scenes fly with
game/src/main.js        the fixed-step loop and the ?shot= scenes
game/test/              a node test that proves the mesh is symmetric
screenshots/            four real renders of the game's own code
tools/shoot.mjs         the screenshot driver (headless Chrome over CDP)
```

## The flight model

Not a six-degree-of-freedom simulation: a rate-controlled airframe with energy that matters. Throttle
sets thrust, drag rises with the square of airspeed, the wing trades airspeed for lift, and banking
turns the aircraft. Below the stall speed the wing stops carrying the aircraft and the nose drops;
dive and the airspeed climbs past the structural limit and the airframe takes damage. Fuel burns with
throttle, so a sortie is a decision about how hard to fly, not just where to point.

## The mesh

`game/src/aircraftMesh.js` builds the airframe as a swept shell: 12 stations along the fuselage, each
a ring of panels, plus the wing and the nozzle. It is generated in code, so it has no asset to load
and nothing to copy. `game/test/mesh-symmetry.test.js` checks the result — 273 assertions over panel
normals, winding, area and symmetry:

```sh
node game/test/mesh-symmetry.test.js
```

## Screenshots

`screenshots/` holds four JPEGs taken by `tools/shoot.mjs`, which drives headless Chrome over CDP and
reads the canvas back with `toDataURL`. Each scene is a real state of the flight model — the aircraft
is placed at a specific attitude and energy and the renderer draws it exactly as the game would:

```sh
node tools/shoot.mjs /tmp/shots sheet-runway sheet-bank sheet-low sheet-late
```

## Handing it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` beside itself into the output directory and writes
`dossier.json` with `buildDossier` from the vendored `vendor/makefun-game.ts`. Outside the grader,
`MAKEFUN_OUTPUT_DIR` stands in for `/output`.

## License

MIT — see `LICENSE`.