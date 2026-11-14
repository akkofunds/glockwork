# Flashpoint

A peer-to-peer tactical bomb-defusal FPS that runs in the browser. It's 100% PvP with no bots. It's a static site: no database, no API keys and no backend, so it deploys straight to Vercel.

## Deploy

1. Push this folder to a GitHub repository.
2. In Vercel, choose **New Project**, import the repo, set Framework to **Other**, leave the build command empty and the output directory as `/`.
3. Open the URL. That's it.

To test locally, serve the folder with any static server (for example `npx serve .`) and open `http://localhost:3000`. ES modules don't work from `file://`.

## How multiplayer works

- **Signalling:** the free PeerJS cloud broker introduces players. After that, all traffic is direct WebRTC between peers.
- **Parties:** *Create party* gives a 5-character code and an invite link (`?party=XXXXX`).
- **Public queues** (`1v1`, `2v2` Wingman, `5v5` Competitive): the first client to claim the queue's fixed coordinator ID matches everyone else. Parties always land on the same team.
- **Private match:** the party leader hosts, with any split from 1v1 to 5v5.
- **Host:** an elected browser runs the authoritative 64-tick simulation, including lag-compensated hit registration (500 ms rewind), economy and buy validation, rounds, bomb and grenades. Clients predict their own movement and weapons, reconcile with the host, and interpolate other players.
- **Disconnects:** a player who leaves is removed, never replaced by a bot. If a whole team leaves, the remaining team wins by forfeit.
- **Strict networks:** some mobile carriers and strict NATs need a TURN relay. Add one in `js/netconfig.js`. To self-host signalling, run `npx peerjs --port 9000` and open the game with `?signal=yourhost:9000`.

## Your models

The arsenal is built from the provided models, with real names:

| Weapon | Price | Model |
|---|---|---|
| Glock-17 | free default for both teams ($200 to rebuy) | `assets/models/glock17.glb` |
| AK-47 | $2,700 | `assets/models/ak47.glb` |
| AWP | $4,750 | `assets/models/awp.glb` |
| Knife | free | `assets/models/knife.glb` |

Kevlar ($650), Kevlar + Helmet ($1,000), Defuse Kit ($400), Flashbang, Smoke and HE grenades are also for sale.

### Make your soldier and map the default for everyone

1. Upload your soldier and map `.glb` files into `assets/models/` (on GitHub: **Add file → Upload files**).
2. Copy `assets/models/manifest.example.json` to `assets/models/manifest.json` and set the paths:
   ```json
   { "soldier": "assets/models/soldier.glb", "map": "assets/models/map.glb", "mapName": "My Map", "mapConfig": null }
   ```
3. Redeploy. Every player now loads your soldier and map automatically. Clients fetch the map from the site, and every map is verified by hash.
4. Set the spawns and bombsites:
   1. In **Practice**, open **ESC → Arsenal (Model & Map Manager) → Map**.
   2. Walk to each spot and press **Set T spawn / CT spawn / site A / site B here**.
   3. Press **Copy config for manifest.json** and paste the result as `"mapConfig"`.

Players can still override any slot just for themselves in the Model & Map Manager (file picker, drag-and-drop or repo path). The Alignment Tuner (X/Y/Z, pitch/yaw/roll, scale) has a live preview.

- **Custom maps:**
  - The map is auto-scaled and centred, with spatial-hashed collision.
  - Spawns land on the lowest standable floor.
- **Soldier models:**
  - Any humanoid `.glb` is normalised to 72 units tall and auto-rigged.
  - Bones named `RightHand`, `hand_r`, `mixamorigRightHand` and similar are used to calibrate the rig.
  - Weapons are held with two-bone IK at a socket in front of the chest, so they don't clip into the body.

With no manifest, the game uses the original built-in *Dunewatch* arena and a built-in operator.

## Lobby & queue

- **Lobby:** a 3D lineup of your party's operators with name plates and invite slots.
- **Modes:** Competitive 5v5, Wingman 2v2, Duel 1v1, Private and Practice.
- **Queue:** a searching bar with a timer and player count.
- **MATCH FOUND:** everyone must press **ACCEPT** within 15 s. Anyone who doesn't is removed from the queue, and players who did accept go back to searching.
- **Versus screen:** shows both teams and the map until the match starts.

## Performance

- **Competitive Low** (the default on phones, iPads and Chromebooks):
  - Pixel ratio is capped at 1.0, with no shadows.
  - Lambert shading, with model textures capped at 1024 px.
  - Adaptive resolution keeps the frame rate up.
- **Medium/High:** PCF shadows (1024²), ACES tone mapping and full 2048 px PBR textures.
- **General:**
  - The built-in map is about 8 draw calls.
  - Effects use fixed pools (tracers, decals, particles, shells, smoke), so there's no garbage-collection stutter mid-round.
  - The host simulation is driven by a Web Worker heartbeat, so a backgrounded host keeps ticking.

## Controls

| Action | Keys |
|---|---|
| Move | WASD |
| Jump | Space or mouse wheel (50 ms landing buffer for bhop) |
| Walk | Shift |
| Crouch | Ctrl or C |
| Fire / alt-fire | Mouse 1 / Mouse 2 |
| Reload | R |
| Use / defuse / swap weapon on the ground | E |
| Drop | G |
| Inspect | F |
| Buy menu | B |
| Scoreboard | Tab |
| Switch weapon | 1–5 |
| Last weapon | Q |
| Chat / team chat | T / U |
| Menu | Esc |

Touch screens get dual-thumb controls automatically.

## Project layout

```
index.html, css/style.css, vercel.json
assets/models/*.glb          bundled weapon models
js/main.js                   app, game loop, match lifecycle
js/config.js                 weapons, economy, movement, match rules
js/sim/                      deterministic shared simulation (movement, weapons, ballistics, grenades)
js/net/                      PeerJS links, matchmaking, protocol, host, client
js/world/                    collision hash, built-in arena, map manager, procedural textures
js/render/                   renderer, characters + auto-rig, viewmodel, effects, weapon library
js/ui/                       HUD, buy menu, menus
```

See `CREDITS.md` for model licences.
