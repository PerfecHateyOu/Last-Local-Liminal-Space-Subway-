# LAST LOCAL

A first-person liminal horror ride on the NYC G train, from Hoyt–Schermerhorn to Court Square, 13 stops, with your parents. Notice what changes in the car, hide that you noticed, and learn which doors are safe.

Built with React, TypeScript, Three.js, and Vite. The game logic follows the master design document, build v5.3. (The game was called Court Sq-Bound until October 2026.)

## Run it

Requires Node 20.19+ or 22.12+ (Vite 8), or Bun.

```bash
bun install        # or: npm install
bun run dev        # or: npm run dev   → http://localhost:3000
```

Other scripts:

| Script | What it does |
|---|---|
| `build` | Production build into `dist/` |
| `build:offline` | The offline copy: `dist-offline/Last-Local/index.html` (one file that opens from a double-click) and `dist-offline/Last-Local-offline.zip` |
| `preview` | Serve the production build with Vite |
| `start` | Serve `dist/` on `0.0.0.0:$PORT` (Render's start command). Run `build` first. |
| `lint` | Type-check with `tsc --noEmit` |
| `test` | Browser tests (Playwright); `test:ui` opens them interactively |

No environment variables are required.

### Tests

The browser tests in `e2e/` play the game in headless Chromium and check each system: flags and restart, the ride and pause music, heartbeat, haptics, intercom, screen glitch, breathing, the tape recorder, chapters and endings, and the Psychological Log. They build a test-mode copy of the game into `dist-test/` (the only build that exposes the engine to the tests) and serve it on port 4190.

Playwright lives in `e2e/` with its own `package.json` and `bun.lock`, so install it there too:

```bash
cd e2e && bun install && npx playwright install chromium && cd ..   # once
bun run test                                                        # or: npm test
```

GitHub Actions runs the type-check, the build, and the full browser suite on every pull request and push to `main`. If a test fails, its Playwright trace is attached to the run.

### Google AI Studio and bun.lock

Google AI Studio puts back its original starter `bun.lock` every time it syncs to GitHub. So the root `package.json` keeps the starter's packages (`@google/genai`, `express`, `dotenv`, `motion`, `@types/express`, `autoprefixer`, `esbuild`, `tsx`) even though the game doesn't import them; they never reach the built game. Don't remove them, or the next sync breaks CI again. If a sync ever brings a different lock, CI's "Check bun.lock matches package.json" step fails and says what changed. When a push to `main` leaves either lockfile missing or out of step with its `package.json`, the Lockfile repair workflow (`.github/workflows/lockfile-repair.yml`) puts it back from the commit before and opens a PR with the fix; merge that PR. To run the same repair locally: `scripts/repair-lockfiles.sh <last good commit>`.

## Deploy to Cloud Run

The `Dockerfile` builds the game and serves it with nginx on port 8080. From Google Cloud Shell:

```bash
git clone https://github.com/PerfecHateyOu/Last-Local-Liminal-Space-Subway- && cd Last-Local-Liminal-Space-Subway-
gcloud run deploy court-sq-bound --source . --region us-central1 --allow-unauthenticated
```

The Cloud Run service keeps the old `court-sq-bound` name, so the deployed URL keeps working. To ship an update later, `git pull` in that folder and run the same `gcloud run deploy` line. No environment variables or API keys are needed; nothing from `.env` goes into the image.

## Deploy to Render

The web service is `Last-Local-Liminal-Space-Subway-`. `render.yaml` is the same setup as a Blueprint; an existing service that is not synced from that file needs these dashboard settings (Settings → Build & Deploy, and Environment):

| Field | Value |
|---|---|
| Language | Node |
| Build Command | `npm install --include=dev --no-audit --no-fund && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/` |
| `NODE_VERSION` | `22.22.0` (or delete it and let `.node-version` apply). Vite 8 needs Node 22.12+ or 20.19+. |

`npm start` serves `dist/` on `0.0.0.0:$PORT`. Render's default `PORT` is `10000`. No other environment variables are required.

If Language is **Docker** instead, leave Docker Command empty so the image's nginx starts, and redeploy. nginx listens on `$PORT` over IPv4. A `listen [::]` line used to abort startup on Render, which fails the deploy after the image has already built.

## Offline copy

`bun run build:offline` (or `npm run build:offline`) builds the whole game into one `index.html` that opens from a double-click, with no internet, server or install. Scripts, styles and fonts are all inlined; the fonts come from `offline/fonts.css`, so the build doesn't need the internet either. The folder is zipped with a short `README.txt` from `offline/README.txt`.

It's built from the same code as the web version, so every change applies to both. CI rebuilds it on every pull request and push, tests it with the network blocked (`e2e/offline.spec.ts`), and attaches it to the run: open the run on GitHub's **Actions** tab and download **Last-Local-offline** under *Artifacts*.

## How to play

1. **Notice.** When something in the car changes, look at it and hold Flag. Flags are private.
2. **Don't show it.** Staring at something wrong, or whipping your head around, while a parent is looking at you raises their suspicion. When they talk to you, answer like nothing is wrong.
3. **Read the doors.** At every stop you can stay on or step off. Stepping off is usually a trap.

After the Safe Haven, Dad gives you his old tape recorder. Tune it and you'll pick up voices, and some carriers that are only tones. What it hears has nothing to do with what's wrong in the car, and holding it up where your parents can see is a reaction too. Tapes you record can be played back from the Evidence Log or the report. During the ride, though, your parents can hear them too.

On Android phones, the train arrives at each stop with a soft vibration for every anomaly you caught on the way in ("Vibrate for catches" in Settings). iPhones don't support web vibration.

The ride is told in three chapters, announced by a rollsign as each one begins. At Court Square you choose your way out. How the ride ends depends on how you rode it (your composure, your sanity, what you caught, how you got through the restraint, and what's on your tapes), and the report keeps a case file of the endings you've reached. One ending puts you back where you started; its report offers **Get back on** instead of Ride Again.

A run takes about 10 minutes and ends with a travel report scoring sanity retained, mask integrity, and anomaly accuracy, plus a Psychological Log: a case file of the 13 anomaly types that fills in across rides.

**Nightmare mode** unlocks after your first finished ride (any ending): tick it on the start screen. Same ride, harder: a faster train and shorter gaps between stations, single ceiling tubes that flicker mid-ride (never the whole car, never on the approach, and not with Reduced screen effects), parents who look your way more often and for longer, and faster sanity loss within each stop's limits. The report marks Nightmare rides. Tuning lives in `NIGHTMARE` in `src/constants.ts`.

**Chapter select** unlocks at the same time: pick **Start from** on the start screen. Chapter I is the full ride from Hoyt–Schermerhorn. Chapter II (from Bedford–Nostrand Avs, into the Stop 6 Safe Haven) and Chapter III (from Nassau Av: the restraint, then the trestle, with Dad's recorder already in hand) are **practice runs**: they play exactly like the real ride, but nothing is saved. No endings, badges, Case Files entries, tapes, prints or ride history, and they don't count toward unlocks; the report and the pause menu say so. Ride Again keeps the chapter (and Nightmare) until you choose again. Where each chapter starts is `CHAPTER_START_SEGMENT` in `src/game/practice.ts`.

**Music:** one tune, coming over the train's speakers, comes apart as the ride goes on. It never gets scarier or louder, just less like itself.
- **Stops 1–3:** clean, with warm electric piano, pad, bass and soft brushes.
- **Stops 4–6:** the opening phrase's long note goes a little flat (more each stop), notes now and then land late, and an electrical hum creeps in.
- **Stops 7–9:** the brushes are gone. Notes go missing or hang on too long, the opening phrase comes back at the wrong time, and the tempo drifts out of step with the train.
- **Stops 10–13:** only pieces of the opening phrase are left. Greenpoint Av goes silent from the chapter card until the restraint is over, and when the tune returns it has turned minor. The last stretch cuts out completely before Court Sq.

The music steps back for the doors at each stop, nearly vanishes under PA announcements (they use the same speakers), and drops while you listen to the recorder. The pause menu plays the same tune clean, as a pocket of normal. Pausing freezes the ride's version where it was, and resuming carries on from there. Mute and the Music volume in Settings cover both.

**Full screen:** boarding the train goes full screen (where the browser allows it; turn it off in Settings). Leave with Esc or the pause menu, which pauses the ride. On wide screens there's also a full-screen button in the top bar. iPhones don't let web pages go full screen: tap Share, then **Add to Home Screen**, and the game opens full screen from there.

**Settings** (from the start screen or the pause menu): look speed, invert vertical look, game and music volume, screen effects (match your device's reduced-motion setting, always on, or reduced), full screen when boarding, vibration, and erasing saved progress. Settings are saved on the device.

### Controls

| Action | Desktop | Touch |
|---|---|---|
| Look | Mouse (click to capture), or arrow keys | Drag |
| Walk between cars | WASD | WALK stick (bottom left) |
| Open a gangway door | E or click it | Tap it |
| Polaroid camera | C to raise, click / Space / Enter to shoot | Camera button, then the shutter |
| Tape recorder (after Stop 6) | R to raise; [ ] or wheel to tune; hold Space to record | Recorder button; drag the tuning strip; hold REC |
| Evidence log (Polaroids, tapes) | Tab | Evidence button |
| Route lines | L (again, or Esc, to close) | Route button |
| Flag | Hold F | Hold the Flag button |
| Answer / choose | 1, 2, 3 or click | Tap |
| Hold during the restraint moment | Hold Space | Hold the Hold button |
| Pause | P or Esc | Pause button |
| Mute | M | Sound button |
| Close a dialog or confirmation | Esc | Close / Cancel button |
| Debug overlay (spoilers; development builds only) | Backquote, in `bun run dev` | None (compiled out of the released game) |

## Export models to Blender (dev only)

All geometry is built in code (`src/graphics/*Builder.ts`, `passingTrain.ts`); there are no model files. To get it into Blender:

```bash
cd e2e && bun install && bunx playwright install chromium && cd ..   # once
bun run export:glb
```

This writes one `.glb` per part to `exports/` (gitignored), plus `exports/previews/<name>.png` for each file and `exports/LAST_LOCAL-contact-sheet.png`:

| Files | What |
| --- | --- |
| `subway_car` | cars A/B/C, gangways and tunnel together, in game coordinates |
| `car_A_interior`, `car_C_interior` | the lead and rear cars on their own, centred |
| `gangway_bellows_A_B`, `gangway_bellows_B_C` | the two bellows between cars |
| `tunnel` | walls, piers, lamps and signals laid out at rest |
| `station_01_Hoyt_Schermerhorn` … `station_13_Court_Sq` | one per stop (same platform, own sign); `station_12_21_St_open_air` is the elevated variant |
| `station_platform`, `station_platform_open_air` | the two platform variants in game coordinates |
| `trestle_steel`, `trestle_rain`, `trestle_scenery` | Newtown Creek trestle: bents and rails, rain strips, sky/skyline/water/beacons |
| `character_*` | one per passenger and parent |
| `passing_train`, `trial_room` | the other-track train and the Trial room |

Canvas textures (signs, ads, tiles, cloth grain) are embedded as PNGs. Each file is reloaded with GLTFLoader as a check. With `bun run dev` running you can also open <http://localhost:3000/dev/export.html> and click to download them. To render previews and a contact sheet for `.glb` files you edited elsewhere: `bun run export:glb -- --previews path/to/dir`.

The exporter lives in `src/dev/glbExport.ts` and is only reached from `dev/export.html`, which the production and offline builds never include.

**Importing:** in Blender, *File > Import > glTF 2.0 (.glb/.gltf)*. Defaults are fine. Nodes and materials keep their names (for example `carB_mid_Box_12`, `Lambert_c8c2b4_tex`). Units are metres with Y up, which the importer converts to Blender's Z-up. Notes:
- Lambert materials come in as Principled BSDF (roughness 1); basic (unlit) materials use `KHR_materials_unlit` and come in as emission-only.
- The trestle sky is a custom shader in the game. It exports as a flat placeholder colour, so repaint it in Blender.
- Ceiling point lights come in as lights. In the game they are hidden and a small pool of real lights follows the camera, so expect a brighter car in Blender.

## Project layout

| Path | Contents |
|---|---|
| `src/constants.ts` | All tuning values: sanity bands, drift, deltas, the 13-stop segment table, dialogue |
| `src/game/gameState.ts` | Game engine: ride loop, doors, mask checks, suspicion, sanity, the False Stop Trial, restraint, scoring |
| `src/game/anomalyManager.ts` | Anomaly catalog by sanity tier |
| `src/graphics/` | Procedural subway car, characters, textures, and the Trial space |
| `src/audio/audioEngine.ts` | WebAudio bed, chimes, screech, whispers |
| `src/audio/theme.ts` | The game's one tune (melody, chords, instruments), shared by the ride and the pause menu |
| `src/audio/rideMusic.ts` | Ride music: the tune over the train's speakers, going wrong stop by stop (per-stop settings in `STOP_MUSIC`) |
| `src/audio/pauseMusic.ts` | Pause-menu music: the same tune, clean and calm at any sanity tier |
| `src/audio/intercom.ts` | Background intercom: garbled announcements whose pitch and pace drop with sanity |
| `src/game/evpManager.ts`, `src/audio/evpAudio.ts`, `src/audio/tapePlayback.ts` | EVP tape recorder: broadcasts and decoy carriers per stretch (shuffled every ride), tuning, tapes kept on the device |
| `src/game/routeText.ts` | Place names per route (first and last stop, streets, the bait stop) for endings, announcements, Trial signs and broadcasts |
| `src/game/endings.ts` | Endings: the priority rules (`resolveEnding`, a pure function) and the endings archive |
| `src/game/psychLog.ts` | Psychological Log: case-file entries for each anomaly type, kept across rides on the device |
| `src/graphics/trestleBuilder.ts` | The Newtown Creek trestle: sky, skyline, rain and steel for the open-air stretch between Greenpoint Av and Court Sq (G route, Critical) |
| `src/graphics/glitchPass.ts` | Brief screen tearing and chromatic aberration, used for Critical anomalies and for decoy glitches at low sanity |
| `src/settings.ts` | Player settings store (saved on the device) |
| `src/components/` | React HUD, start, pause, settings, and report screens |
| `e2e/` | Playwright browser tests; `e2e/game.ts` has the shared setup and helpers |
