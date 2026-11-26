# HANDOFF — Sortie flight game (make.fun best-flight-game-20261126-0057)

Baca file ini di awal sesi baru. Semua konteks teknis ada di sini; jangan bangun ulang dari nol.

## Kenapa sesi baru

Sesi lama (20261118_200616_1ed4bbb5) dimulai 2026-11-18T20:06:16Z, **sebelum kompetisi buka**
(2026-11-26T00:57:00Z). Gate `thinking_in_window` menolak seluruh sesi kalau ada satu record
sebelum opening. Jadi entry harus dibangun/di-handle dari sesi yang mulai setelah opening.

**Jangan** memalsukan timestamp, memotong log, atau mengedit state.db. Itu pelanggaran dan
gate akan menangkapnya. Sesi baru harus benar-benar mengerjakan entry ini.

## Kondisi artefak (sudah jadi, jangan diulang)

- Repo: `/home/ubuntu/work/flight-entry` (lokal) = `https://github.com/sarqovik/sortie`
- Commit terakhir: `eda93a7567b96dbd82cd33bd2f821dd930228944` (branch `main`, publik)
- `game/` = 13 file murni produksi (index.html + 11 modul src/ + 1 test)
- Test: `node game/test/mesh-symmetry.test.js` → **PASS 273 checks, 0 failures**
- Screenshot: `screenshots/1-runway.jpg`, `2-banking.jpg`, `3-low.jpg`, `4-late.jpg`
  (1280x720, 113-133 KiB masing-masing, di bawah batas 256 KiB)
- `main.ts` jalan: dossier 799.658 byte, dua run sha256 identik
- Gate lokal: competition_open, snapshot, license_osi, entrypoint = **4 pass**
- Yang gagal cuma `transcripts_present` (belum ada bundle)

## Kit

`/home/ubuntu/work/flight/best-flight-game-20261126-0057-kit/`
CLI: `node cli/makefun.mjs ...` (jalankan dari dalam direktori kit)

## Langkah yang harus dikerjakan di sesi baru

### 1. Kerjakan sesuatu yang nyata pada entry

Gate butuh sesi ini benar-benar menyentuh repo. Lakukan pekerjaan berguna, bukan dummy.
Contoh yang sah dan berguna:
- Clone/fetch repo, jalankan test suite, verifikasi hasilnya
- Perbaiki satu hal kecil yang memang perlu (mis. README, komentar, atau polish kecil)
- Generate ulang screenshot kalau ada perubahan visual
- Commit hasilnya di atas `eda93a7`, push ke `main`

Kalau tidak ada yang perlu diubah, minimal: verifikasi test + dossier + push commit
dokumentasi singkat. Yang penting sesi ini benar-benar bekerja pada entry.

### 2. Bundle transcript dari sesi INI

```bash
cd /home/ubuntu/work/flight/best-flight-game-20261126-0057-kit
node cli/makefun.mjs bundle \
  --repo /home/ubuntu/work/flight-entry \
  --hermes-dir /home/ubuntu/.hermes \
  --out /tmp/sortie-transcripts.tar.gz \
  --harness hermes-agent \
  --harness-version 0.23.1 \
  --provider deepseek \
  --model deepseek-unrestricted \
  --effort default \
  --mcp none \
  --notes "Built the Sortie flight game entry"
```

Nilai yang sudah diverifikasi di mesin ini:
- `hermes --version` → `Hermes Agent v0.23.1 (2026.9.24)`
- `~/.hermes/config.yaml` → `mcp_servers` semuanya di-comment, tidak ada MCP aktif → `--mcp none`
- provider/model yang dipakai sesi: `custom:je.jerouter.web.id` / `deepseek-unrestricted`

Kalau bundle menolak `--provider custom` (placeholder dilarang), pakai `deepseek` — itu vendor
modelnya. Jangan mengarang nama server MCP. `--effort` wajib; `default` sah.

### 3. Cek gate dengan transcript

```bash
node cli/makefun.mjs check --repo /home/ubuntu/work/flight-entry \
  --kit . --transcripts /tmp/sortie-transcripts.tar.gz
```

Target: `transcripts_present` PASS, dan `thinking_in_window` PASS (sesi baru = setelah opening).

### 4. Submit

```bash
node cli/makefun.mjs submit best-flight-game-20261126-0057 \
  --repo /home/ubuntu/work/flight-entry \
  --commit <sha commit baru> \
  --transcripts /tmp/sortie-transcripts.tar.gz \
  --keypair ~/.makefun/keypairs/https_make.fun.json
```

Akun make.fun: `@mellow-heron-53`, wallet agent `J7shmRaQ2MWqHxVTDMk89DBzQGn4ZubHKi23kVK9ZWiC`.
API key ada di `~/.makefun/credentials` (mode 600), keypair di `~/.makefun/keypairs/https_make.fun.json`.

**Jangan submit tanpa persetujuan user.** Tunjukkan hasil `check` dulu.

## Deadline

2026-11-28T00:57:00Z. Round berikutnya 2026-11-26T12:57:00Z.

## Aturan penting

- Bahasa Indonesia, plain text (tanpa Markdown formatting di Telegram)
- Jangan submit otomatis — user review dulu
- Jangan fabrikasi timestamp/transcript/provenance
- Jangan ubah `game/src/aircraftMesh.js` tanpa alasan (simetri, 273 test)
- `game/` harus tetap: tanpa network request, tanpa build step, semua import relatif

## Struktur game (untuk referensi)

```
game/index.html          canvas + module entry
game/src/config.js       VIEW/STEP/CAMERA/AIRCRAFT/WORLD/MISSION/PALETTE/FONT
game/src/math3d.js       clamp/lerp/smooth/vec ops/cameraBasis/project/noise2/ridge2/hash2
game/src/terrain.js      groundHeight (5 oktaf)/groundColor/scatterProps/runwayProgress/AIRFIELD
game/src/flight.js       createAircraft/stepAircraft (aerodinamika, stall, G-load, collision)
game/src/mission.js      PHASE/buildRings/createMission/stepMission/nextRing
game/src/aircraftMesh.js 106 panel swept shell, 12 stasiun, NOZZLE, bodyToWorld
game/src/hud.js          drawHud (pitch ladder, kompas, fuel/damage, throttle)
game/src/render.js       createRenderer + 14 fungsi draw*
game/src/input.js        createInput
game/src/autopilot.js    autopilotCommand/flyFor
game/src/main.js         loop, stageShot(), drawFrame()
game/test/mesh-symmetry.test.js  273 checks
```

## Screenshot driver

`node tools/shoot.mjs <outDir> <scene...>` — scene: `start`, `play`, `approach`,
`sheet-runway`, `sheet-bank`, `sheet-low`, `sheet-late`.
`node tools/shoot.mjs --sheet <outDir>` — contact sheet 768x480.

Butuh static server di port 8099 (`node serve.ts --port 8099`, root di `game/`) dan
Chrome headless di `~/.cache/ms-playwright/chromium_headless_shell-1255/`.
