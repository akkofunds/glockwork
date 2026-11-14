// Binary wire format for the 64 Hz unreliable channel (user commands and world snapshots).
// Reliable events travel as JSON strings on a separate ordered channel.
import { BinaryWriter, BinaryReader } from '../util.js';

export const MSG = { CMD: 1, SNAP: 2 };

export const PF = {
  ALIVE: 1, GROUND: 2, WALK: 4, SCOPED: 8, PLANTING: 16, DEFUSING: 32, RELOADING: 64, C4: 128,
  HELMET: 256, NADE: 512, TEAM_T: 1024, DEFUSER: 2048, FIRING: 4096,
};

const cw = new BinaryWriter(512);
export function encodeCmds(cmds) {
  cw.reset();
  cw.u8(MSG.CMD);
  cw.u8(cmds.length);
  for (const c of cmds) {
    cw.u32(c.seq); cw.u16(c.buttons); cw.f32(c.yaw); cw.f32(c.pitch); cw.f32(c.viewTick); cw.u8(c.wpn || 0);
  }
  return cw.result();
}
export function decodeCmds(r) {
  const n = r.u8();
  const out = [];
  for (let i = 0; i < n; i++) out.push({ seq: r.u32(), buttons: r.u16(), yaw: r.f32(), pitch: r.f32(), viewTick: r.f32(), wpn: r.u8() });
  return out;
}

const sw = new BinaryWriter(4096);
/*
 snap = { tick, ackSeq, phase, phaseEnd, round, scoreCT, scoreT,
          bomb:{state,x,y,z,end,defuser,defuseEnd,site}, own:string|null, players:[{num,flags,x,y,z,yaw,pitch,duck,wpn,hp,armor}] }
*/
export function encodeSnapshot(s) {
  sw.reset();
  sw.u8(MSG.SNAP);
  sw.u32(s.tick); sw.u32(s.ackSeq); sw.u8(s.phase); sw.u32(s.phaseEnd); sw.u8(s.round); sw.u8(s.scoreCT); sw.u8(s.scoreT);
  const b = s.bomb;
  sw.u8(b.state); sw.f32(b.x); sw.f32(b.y); sw.f32(b.z); sw.u32(b.end); sw.u8(b.defuser); sw.u32(b.defuseEnd); sw.u8(b.site); sw.u8(b.carrier);
  if (s.own) { sw.u8(1); sw.str(s.own); } else sw.u8(0);
  sw.u8(s.players.length);
  for (const p of s.players) {
    sw.u8(p.num); sw.u16(p.flags); sw.f32(p.x); sw.f32(p.y); sw.f32(p.z);
    sw.i16(p.yaw * 10000); sw.i16(p.pitch * 10000); sw.u8(Math.round(p.duck * 255)); sw.u8(p.wpn); sw.u8(Math.max(0, Math.min(255, p.hp))); sw.u8(p.armor);
  }
  return sw.result();
}
export function decodeSnapshot(r) {
  const s = { tick: r.u32(), ackSeq: r.u32(), phase: r.u8(), phaseEnd: r.u32(), round: r.u8(), scoreCT: r.u8(), scoreT: r.u8() };
  s.bomb = { state: r.u8(), x: r.f32(), y: r.f32(), z: r.f32(), end: r.u32(), defuser: r.u8(), defuseEnd: r.u32(), site: r.u8(), carrier: r.u8() };
  s.own = r.u8() ? r.str() : null;
  const n = r.u8();
  s.players = [];
  for (let i = 0; i < n; i++) {
    s.players.push({ num: r.u8(), flags: r.u16(), x: r.f32(), y: r.f32(), z: r.f32(), yaw: r.i16() / 10000, pitch: r.i16() / 10000, duck: r.u8() / 255, wpn: r.u8(), hp: r.u8(), armor: r.u8() });
  }
  return s;
}

export function readMessage(buf) {
  const r = new BinaryReader(buf);
  const type = r.u8();
  return { type, r };
}
