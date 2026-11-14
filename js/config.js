// Flashpoint — core gameplay constants. All distances are in game units (1u ≈ 1 inch), time in seconds.

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
  maxBhopSpeed: 320,
  stepSize: 18,
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
const M4_PATTERN = [
  [0, 0], [0.02, 0.3], [-0.03, 0.8], [0.04, 1.4], [-0.1, 2.1], [-0.25, 2.8], [-0.45, 3.4], [-0.6, 3.9], [-0.5, 4.3], [-0.2, 4.6],
  [0.15, 4.8], [0.5, 4.95], [0.8, 5.05], [0.9, 5.15], [0.7, 5.2], [0.4, 5.25], [0.2, 5.3], [0.4, 5.35], [0.6, 5.4], [0.5, 5.45],
];
const SMG_PATTERN = (() => {
  const p = [];
  for (let i = 0; i < 32; i++) {
    const pitch = Math.min(3.6, i * 0.32 - Math.max(0, i - 8) * 0.22);
    const yaw = Math.sin(i * 0.9) * Math.min(1.2, i * 0.08);
    p.push([yaw, Math.max(0, pitch)]);
  }
  return p;
})();
const linearPattern = (n, pitchPer, yawAmp, cap) => {
  const p = [];
  for (let i = 0; i < n; i++) p.push([Math.sin(i * 1.7) * yawAmp * Math.min(1, i / 3), Math.min(cap, i * pitchPer)]);
  return p;
};
export const PATTERNS = {
  ak: AK_PATTERN,
  m4: M4_PATTERN,
  smg: SMG_PATTERN,
  glock: linearPattern(20, 0.55, 0.35, 4),
  usp: linearPattern(12, 0.9, 0.3, 5),
  p250: linearPattern(13, 1.1, 0.35, 6),
  deagle: linearPattern(7, 3.4, 0.8, 10),
  scout: linearPattern(10, 2.2, 0.3, 6),
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
    name: 'Glock-17', slot: 2, cls: 'pistol', price: 200, team: 2, reward: 300, speed: 240,
    damage: 30, armorPen: 0.47, rangeMod: 0.85, range: 4096, rpm: 400, mag: 20, reserve: 120, reloadTime: 2.2, drawTime: 0.6,
    auto: false, burst: true, pen: 8,
    inacc: { stand: 0.0085, crouch: 0.0065, move: 0.022, air: 0.14, fire: 0.028, max: 0.07, recovery: 0.28 },
    pattern: 'glock', recover: 6, model: 'glock17', sound: 'pistol',
  },
  usp: {
    name: 'USP-S', slot: 2, cls: 'pistol', price: 200, team: 1, reward: 300, speed: 240,
    damage: 35, armorPen: 0.505, rangeMod: 0.91, range: 4096, rpm: 352, mag: 12, reserve: 24, reloadTime: 2.2, drawTime: 0.6,
    auto: false, suppressed: true, pen: 8,
    inacc: { stand: 0.0042, crouch: 0.0032, move: 0.03, air: 0.2, fire: 0.04, max: 0.08, recovery: 0.32 },
    pattern: 'usp', recover: 5, model: 'usp', sound: 'pistol_s',
  },
  p250: {
    name: 'P250', slot: 2, cls: 'pistol', price: 300, team: 0, reward: 300, speed: 240,
    damage: 38, armorPen: 0.64, rangeMod: 0.85, range: 4096, rpm: 400, mag: 13, reserve: 26, reloadTime: 2.2, drawTime: 0.6,
    auto: false, pen: 10,
    inacc: { stand: 0.0068, crouch: 0.0052, move: 0.034, air: 0.2, fire: 0.05, max: 0.09, recovery: 0.3 },
    pattern: 'p250', recover: 5, model: 'p250', sound: 'pistol',
  },
  deagle: {
    name: 'Desert Eagle', slot: 2, cls: 'pistol', price: 700, team: 0, reward: 300, speed: 230,
    damage: 53, armorPen: 0.932, rangeMod: 0.86, range: 4096, rpm: 267, mag: 7, reserve: 35, reloadTime: 2.2, drawTime: 0.7,
    auto: false, pen: 20,
    inacc: { stand: 0.005, crouch: 0.0038, move: 0.09, air: 0.3, fire: 0.12, max: 0.16, recovery: 0.55 },
    pattern: 'deagle', recover: 2.2, model: 'deagle', sound: 'deagle',
  },
  mac10: {
    name: 'MAC-10', slot: 1, cls: 'smg', price: 1050, team: 2, reward: 600, speed: 240,
    damage: 29, armorPen: 0.57, rangeMod: 0.8, range: 4096, rpm: 800, mag: 30, reserve: 100, reloadTime: 2.6, drawTime: 0.9,
    auto: true, pen: 8,
    inacc: { stand: 0.013, crouch: 0.01, move: 0.032, air: 0.07, fire: 0.0065, max: 0.06, recovery: 0.3 },
    pattern: 'smg', recover: 9, model: 'mac10', sound: 'smg',
  },
  mp9: {
    name: 'MP9', slot: 1, cls: 'smg', price: 1250, team: 1, reward: 600, speed: 240,
    damage: 26, armorPen: 0.6, rangeMod: 0.87, range: 4096, rpm: 857, mag: 30, reserve: 120, reloadTime: 2.1, drawTime: 0.9,
    auto: true, pen: 8,
    inacc: { stand: 0.011, crouch: 0.0085, move: 0.028, air: 0.07, fire: 0.006, max: 0.055, recovery: 0.28 },
    pattern: 'smg', recover: 9, model: 'mp9', sound: 'smg',
  },
  ak47: {
    name: 'AK-47', slot: 1, cls: 'rifle', price: 2700, team: 2, reward: 300, speed: 215,
    damage: 36, armorPen: 0.775, rangeMod: 0.98, range: 8192, rpm: 600, mag: 30, reserve: 90, reloadTime: 2.45, drawTime: 1.0,
    auto: true, pen: 26,
    inacc: { stand: 0.0042, crouch: 0.003, move: 0.11, air: 0.36, fire: 0.0072, max: 0.065, recovery: 0.36 },
    pattern: 'ak', recover: 7.5, model: 'ak47', sound: 'rifle',
  },
  m4a1s: {
    name: 'M4A1-S', slot: 1, cls: 'rifle', price: 2900, team: 1, reward: 300, speed: 225,
    damage: 38, armorPen: 0.70, rangeMod: 0.94, range: 8192, rpm: 600, mag: 20, reserve: 80, reloadTime: 3.05, drawTime: 1.0,
    auto: true, suppressed: true, pen: 24,
    inacc: { stand: 0.003, crouch: 0.0022, move: 0.09, air: 0.32, fire: 0.0058, max: 0.05, recovery: 0.32 },
    pattern: 'm4', recover: 7.5, model: 'm4a1s', sound: 'rifle_s',
  },
  ssg08: {
    name: 'SSG 08', slot: 1, cls: 'sniper', price: 1700, team: 0, reward: 300, speed: 230, scopedSpeed: 230,
    damage: 70, armorPen: 0.85, rangeMod: 0.98, range: 8192, rpm: 48, mag: 10, reserve: 90, reloadTime: 3.7, drawTime: 1.1,
    auto: false, pen: 30, scope: [40, 15],
    inacc: { stand: 0.03, scoped: 0.0012, crouch: 0.0011, move: 0.12, air: 0.03, airSlow: 0.004, fire: 0.05, max: 0.15, recovery: 0.4 },
    pattern: 'scout', recover: 3, model: 'ssg08', sound: 'sniper',
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
// Glock's T default and USP's CT default are free in the starting loadout.
export const DEFAULT_PISTOL = { 1: 'usp', 2: 'glock' };

export const GEAR = {
  kevlar: { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Kevlar + Helmet', price: 1000, upgrade: 350 },
  defuser: { name: 'Defuse Kit', price: 400, team: 1 },
};

// Stable numeric codes for network encoding
export const WEAPON_IDS = ['none', 'knife', 'glock', 'usp', 'p250', 'deagle', 'mac10', 'mp9', 'ak47', 'm4a1s', 'ssg08', 'awp', 'he', 'flash', 'smoke', 'c4'];
export const WEAPON_CODE = Object.fromEntries(WEAPON_IDS.map((id, i) => [id, i]));

export const BUY_MENU = [
  { cat: 'Pistols', items: ['glock', 'usp', 'p250', 'deagle'] },
  { cat: 'SMGs', items: ['mac10', 'mp9'] },
  { cat: 'Rifles', items: ['ak47', 'm4a1s'] },
  { cat: 'Snipers', items: ['ssg08', 'awp'] },
  { cat: 'Gear', items: ['kevlar', 'vesthelm', 'defuser'] },
  { cat: 'Grenades', items: ['flash', 'smoke', 'he'] },
];

export const GRENADE_PHYS = { gravity: 800 * 0.4 * 1.6, elasticity: 0.45, throwSpeed: 750, underhandSpeed: 380, radius: 2 };

export const HE = { maxDamage: 98, armorFactor: 57 / 98, radius: 350 };
export const FLASH = { maxDuration: 4.9, range: 1800 };

// Real-world approximate model lengths in game units, used to auto-normalise any .glb weapon
export const WEAPON_LENGTH = { ak47: 35, m4a1s: 37, awp: 47, ssg08: 43, glock17: 12.5, usp: 11, p250: 7.5, deagle: 10.5, mac10: 12, mp9: 15, knife: 12 };

export const SOLDIER_HEIGHT = 72;
