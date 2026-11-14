// Flashpoint — core gameplay constants. All distances are in game units (1u ≈ 1 inch), time in seconds.

// Bump on every release that changes gameplay/netcode: mismatched clients can't join each other.
export const GAME_VERSION = 4;

export const TICK_RATE = 64;
export const DT = 1 / TICK_RATE;
export const LAG_COMP_TICKS = 32; // 500 ms rewind window
export const INTERP_TICKS = 6; // ~94 ms remote interpolation delay

export const TEAM = { NONE: 0, CT: 1, T: 2 };
export const TEAM_NAME = { 1: 'Counter-Terrorists', 2: 'Terrorists' };
export const TEAM_SHORT = { 1: 'CT', 2: 'T' };

export const MOVE = {
  gravity: 800,
  jumpImpulse: 301.993377,
  friction: 5.2,
  stopSpeed: 80,
  accelerate: 5.5,
  airAccelerate: 12,
  maxAirWishSpeed: 30,
  maxBhopSpeed: 360,
  bhopGain: 1.035, // speed multiplier per clean hop (capped at maxBhopSpeed)
  airControl: 3.2, // rad/s the air velocity turns toward where you aim (easy strafing, great on mobile)
  walkableNormal: 0.6, // ~53 degree slopes are walkable
  stepSize: 22,
  radius: 16,
  standHeight: 72,
  crouchHeight: 54,
  eyeStand: 64,
  eyeCrouch: 46,
  walkMult: 0.52,
  crouchMult: 0.34,
  duckSpeed: 8, // duck fraction per second before fatigue
  jumpBufferTicks: 4, // ~50 ms landing buffer
  fallDamageSpeed: 580,
  fatalFallSpeed: 1024,
  accuracyThreshold: 0.34, // fraction of max speed below which movement inaccuracy is 0
  maxVelocity: 3500,
};

export const MATCH = {
  freezeTime: 10,
  buyTime: 25, // counted from freeze start (10 s freeze + 15 s live)
  roundTime: 115,
  postRoundTime: 6,
  halftimeTime: 10,
  matchEndTime: 15,
  warmupTime: 8,
  maxRounds: 12,
  winRounds: 7,
  halfRound: 6,
  bombTimer: 40,
  plantTime: 3.2,
  defuseTime: 10,
  defuseKitTime: 5,
  defuseRange: 64,
  bombRadius: 1100,
  bombDamage: 500,
  buyZoneRadius: 650,
  connectTimeout: 25,
};

export const TDM = { scoreLimit: 50, timeLimit: 600, respawnDelay: 2, spawnProtect: 1.5 };

export const ECON = {
  startMoney: 800,
  maxMoney: 16000,
  winElim: 3250,
  winBomb: 3500,
  lossBonus: [1400, 1900, 2400, 2900, 3400],
  plantBonus: 800,
  planterReward: 300,
  defuserReward: 300,
  teamKillPenalty: -300,
};

// Hitgroups
export const HG = { GENERIC: 0, HEAD: 1, CHEST: 2, STOMACH: 3, ARM: 4, LEG: 5 };
export const HG_MULT = { 0: 1, 1: 4.0, 2: 1.0, 3: 1.25, 4: 1.0, 5: 0.75 };
export const HG_NAME = { 0: 'Body', 1: 'Head', 2: 'Chest', 3: 'Stomach', 4: 'Arm', 5: 'Leg' };

// Deterministic spray patterns. Each entry = cumulative [yawDeg(+right), pitchDeg(+up)] offset of shot N.
const AK_PATTERN = [
  [0, 0], [0.02, 0.35], [-0.05, 0.95], [0.05, 1.7], [0.1, 2.6], [-0.1, 3.5], [-0.3, 4.3], [-0.6, 5.0], [-0.9, 5.6], [-1.3, 6.0],
  [-1.6, 6.3], [-1.5, 6.5], [-0.9, 6.6], [-0.2, 6.7], [0.6, 6.75], [1.3, 6.8], [1.9, 6.85], [2.3, 6.9], [2.4, 6.95], [2.1, 7.0],
  [1.6, 7.0], [1.2, 7.05], [0.8, 7.1], [1.1, 7.15], [1.6, 7.2], [2.0, 7.2], [1.8, 7.25], [1.2, 7.3], [0.6, 7.3], [0.2, 7.35],
];
const linearPattern = (n, pitchPer, yawAmp, cap) => {
  const p = [];
  for (let i = 0; i < n; i++) p.push([Math.sin(i * 1.7) * yawAmp * Math.min(1, i / 3), Math.min(cap, i * pitchPer)]);
  return p;
};
export const PATTERNS = {
  ak: AK_PATTERN,
  glock: linearPattern(20, 0.55, 0.35, 4),
  awp: linearPattern(5, 3.0, 0.3, 6),
};

/*
 Weapon table.
 inaccuracy values are cone half-angles in radians.
 rangeMod: damage multiplier per 500 units travelled.
 pen: maximum wall thickness (units) the round can pass through.
*/
export const WEAPONS = {
  knife: {
    name: 'Tactical Knife', slot: 3, cls: 'knife', price: 0, team: 0, reward: 1500, speed: 250,
    drawTime: 0.6, slash: { front: 40, back: 90, range: 48, cycle: 0.4 }, stab: { front: 65, back: 180, range: 34, cycle: 1.0 },
    armorPen: 0.85, model: 'knife',
  },
  glock: {
    name: 'Glock-17', slot: 2, cls: 'pistol', price: 200, team: 0, reward: 300, speed: 240,
    damage: 30, armorPen: 0.47, rangeMod: 0.85, range: 4096, rpm: 400, mag: 20, reserve: 120, reloadTime: 2.2, drawTime: 0.6,
    auto: false, burst: true, pen: 8,
    inacc: { stand: 0.0085, crouch: 0.0065, move: 0.022, air: 0.14, fire: 0.028, max: 0.07, recovery: 0.28 },
    pattern: 'glock', recover: 6, model: 'glock17', sound: 'pistol',
  },
  ak47: {
    name: 'AK-47', slot: 1, cls: 'rifle', price: 2700, team: 0, reward: 300, speed: 215,
    damage: 36, armorPen: 0.775, rangeMod: 0.98, range: 8192, rpm: 600, mag: 30, reserve: 90, reloadTime: 2.45, drawTime: 1.0,
    auto: true, pen: 26,
    inacc: { stand: 0.0042, crouch: 0.003, move: 0.11, air: 0.36, fire: 0.0072, max: 0.065, recovery: 0.36 },
    pattern: 'ak', recover: 7.5, model: 'ak47', sound: 'rifle',
  },
  awp: {
    name: 'AWP', slot: 1, cls: 'sniper', price: 4750, team: 0, reward: 100, speed: 200, scopedSpeed: 100,
    damage: 115, armorPen: 0.975, rangeMod: 0.99, range: 8192, rpm: 41, mag: 5, reserve: 30, reloadTime: 3.6, drawTime: 1.15,
    auto: false, pen: 42, scope: [40, 10], stationary: 15,
    inacc: { stand: 0.085, scoped: 0.0006, crouch: 0.0005, move: 0.28, air: 0.5, fire: 0.1, max: 0.3, recovery: 0.6 },
    pattern: 'awp', recover: 2, model: 'awp', sound: 'awp',
  },
  he: { name: 'HE Grenade', slot: 4, cls: 'grenade', price: 300, team: 0, reward: 300, speed: 245, drawTime: 0.5, fuse: 1.6, model: 'he' },
  flash: { name: 'Flashbang', slot: 4, cls: 'grenade', price: 200, team: 0, reward: 300, speed: 245, drawTime: 0.5, fuse: 1.5, max: 2, model: 'flash' },
  smoke: { name: 'Smoke Grenade', slot: 4, cls: 'grenade', price: 300, team: 0, reward: 300, speed: 245, drawTime: 0.5, fuse: 1.8, duration: 18, radius: 144, model: 'smoke' },
  c4: { name: 'C4 Explosive', slot: 5, cls: 'c4', price: 0, team: 2, reward: 0, speed: 250, drawTime: 0.6, model: 'c4' },
};
// Both teams start with a free Glock-17.
export const DEFAULT_PISTOL = { 1: 'glock', 2: 'glock' };

export const GEAR = {
  kevlar: { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Kevlar + Helmet', price: 1000, upgrade: 350 },
  defuser: { name: 'Defuse Kit', price: 400, team: 1 },
};

// Stable numeric codes for network encoding
export const WEAPON_IDS = ['none', 'knife', 'glock', 'ak47', 'awp', 'he', 'flash', 'smoke', 'c4'];
export const WEAPON_CODE = Object.fromEntries(WEAPON_IDS.map((id, i) => [id, i]));

// The arsenal is built from the provided models: Glock-17, AK-47, AWP (sniper) and the knife.
export const BUY_MENU = [
  { cat: 'Pistols', items: ['glock'] },
  { cat: 'Rifles', items: ['ak47'] },
  { cat: 'Snipers', items: ['awp'] },
  { cat: 'Gear', items: ['kevlar', 'vesthelm', 'defuser'] },
  { cat: 'Grenades', items: ['flash', 'smoke', 'he'] },
];
export const BUYABLE = new Set(BUY_MENU.flatMap((c) => c.items));

export const GRENADE_PHYS = { gravity: 800 * 0.4 * 1.6, elasticity: 0.45, throwSpeed: 750, underhandSpeed: 380, radius: 2 };

export const HE = { maxDamage: 98, armorFactor: 57 / 98, radius: 350 };
export const FLASH = { maxDuration: 4.9, range: 1800 };

// Real-world approximate model lengths in game units, used to auto-normalise any .glb weapon
export const WEAPON_LENGTH = { ak47: 35, awp: 47, glock17: 12.5, knife: 12 };

export const SOLDIER_HEIGHT = 72;
