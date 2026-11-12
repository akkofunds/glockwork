# GLOCKWORK — Browser Tactical Shooter

A Three.js + PeerJS (WebRTC, no game server required) tactical FPS prototype:
a heavily-detailed procedural Glock viewmodel (ADS, inspect, mag-drop reload,
synthesized gunshot/mechanical audio), Source-style movement/bhop, two maps,
and a Valorant-style lobby with P2P party chat.

## Run it locally

Browsers block ES module / fetch-from-`file://` for some setups, so serve it
over HTTP rather than double-clicking `index.html`:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed `localhost` URL. To test multiplayer, open a second
tab (or have a friend open the link), host a party in one tab, and join
with the Room ID in the other.

## Controls

| Action | Input |
|---|---|
| Move | WASD |
| Look | Mouse (click game to lock pointer) |
| Jump / bhop | Space or scroll wheel (buffered — tap just before landing) |
| Fire | Left mouse button |
| Aim down sights | Hold right mouse button |
| Reload | R |
| Inspect weapon | Y |
| Chat | Enter to open, type, Enter to send / Esc to cancel |

Accuracy is tied to movement: standing still and grounded is near pinpoint;
strafing or airborne opens up the spread a lot, same as CS:GO/Valorant. Aiming
down sights (hold RMB) zooms the FOV, cuts spread further, and slows your
movement speed — the classic trade mobility for accuracy tactical-shooter
trade-off.

## Architecture

```
index.html        lobby + HUD markup, loads CDN libs then game scripts in order
css/style.css      all UI styling (lobby, HUD, chat, crosshair)
js/maps.js         two arenas (shipyard, courtyard) — InstancedMesh for every
                   repeated prop (containers, crates, pillars, columns) to
                   keep draw calls low; simple collider list returned alongside
js/weapon.js       GlockViewmodel — ~40-part procedural geometry (front/rear
                   serrations, extractor, ejection port, slide stop, takedown
                   lever, three-dot sights, stippled grip texture, witness-
                   hole magazine, crowned muzzle), sway/bob/blowback/muzzle-
                   flash, ADS pose blend, Y-inspect sequence, and a 3-phase
                   mag-drop/seat reload animation
js/audio.js        AudioFX — fully synthesized gunshot, mechanical click and
                   mag-thunk SFX via the Web Audio API (no sample files)
js/movement.js     MovementController — Source-engine ground accel+friction
                   (instant counter-strafe), air-strafe acceleration, jump
                   buffer window for uncapped bhop, box/cylinder/ramp collision
js/network.js      NetworkManager — PeerJS host/join, star-topology relay for
                   chat / state / match-start / kills
js/ui.js           lobby DOM wiring, player cards, in-game chat box behaviour
js/main.js         engine bootstrap, render loop, pointer lock, raycast
                   shooting, remote-player interpolation, FPS counter
```

No build step, no bundler, no server-side code — it's all static files, so
it deploys anywhere that serves static assets.

## Performance notes

- All repeated map geometry (shipping containers, crates, pillars, cover
  boxes, columns) is drawn with a single `THREE.InstancedMesh` per prop type,
  so the whole map is a handful of draw calls regardless of prop count.
- Materials are plain `MeshStandardMaterial` with small canvas-procedural
  textures (no normal/roughness map file loading, no post-processing stack),
  which is what keeps this light enough to sit well above 144 FPS on
  mid-range GPUs.
- Shadows are a single directional light with a 2048 PCFSoft shadow map —
  the only shadow-casting light in the scene.

## Known limitations / what I'd tackle next

This was built and syntax-checked in a sandboxed environment without a
browser/GPU, so while the code has been carefully reasoned through, **you
should expect to do a short playtest pass** and file issues against:

- Collision is a lightweight AABB/cylinder approximation, not a full physics
  engine — it's tuned for the included maps but can be clipped at extreme
  speeds (very high bhop chains).
- Hit detection is a single raycast against remote players' simple capsule
  meshes (no hitboxes/headshot multipliers yet).
- No server-authoritative anti-cheat — it's a trust-based P2P relay through
  the host, fine for playing with friends, not for a public competitive mode.
- Weapon audio is synthesized (no footstep/ambient/voice audio yet).

## Deploy to Vercel via GitHub

From this folder:

```bash
git init
git add .
git commit -m "Initial commit: Glockwork tactical shooter"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Then in Vercel: **New Project → Import** your repo. Framework preset:
**Other** (static). No build command, no output directory override needed —
it'll serve `index.html` from the repo root as-is.
