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

Bundled in `assets/models/` (Draco geometry, 2048 px WebP textures):

| Model | Used for |
|---|---|
| `ak47.glb` | AK-47, M4A1-S, MP9, MAC-10 |
| `awp.glb` | AWP, SSG 08 |
| `glock17.glb` | Glock-17, USP-S, P250, Desert Eagle |
| `knife.glb` | Knife |

Grenades and the C4 are small built-in models.

**Map and Soldier:** open **ESC → Model & Map Manager**, choose the slot, and pick a `.glb` (file picker, drag-and-drop, or a path in the repo such as `assets/models/my_map.glb`). The file is stored in your browser (IndexedDB), so you only do it once per device.

- **Hosting a private match on a custom map:** the map file streams to the other players automatically.
- **Custom maps:**
  - The map is auto-scaled, centred and given spatial-hashed collision.
  - Set the T/CT spawns, bombsites A/B and the buy-zone radius in Practice using **Set … here**, with live markers.
- **Soldier models:**
  - Any humanoid `.glb` is normalised to 72 units tall and auto-rigged.
  - Bones named `RightHand`, `hand_r`, `mixamorigRightHand` and similar are used to calibrate the rig.
  - Weapons are held with two-bone IK at a socket in front of the chest, so they don't clip into the body.
- **Alignment Tuner:** X/Y/Z, pitch/yaw/roll and scale sliders for every slot, with a live preview.

With no custom files, the game uses the original built-in *Dunewatch* arena and a built-in operator.

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
