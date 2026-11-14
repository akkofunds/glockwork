// Persisted user settings.
import { isLowEndDevice, isTouchDevice } from './util.js';

const KEY = 'fp_settings_v1';
export const DEFAULTS = {
  name: '',
  quality: null, // auto
  sensitivity: 1.6,
  zoomSensitivity: 1.0,
  touchSensitivity: 1.0,
  fov: 90,
  vmFov: 68,
  volume: 0.8,
  invertY: false,
  showFps: false,
  speedometer: false,
  crosshair: { size: 5, gap: 2, thickness: 1.5, color: '#4cff6a', outline: true, dot: false, dynamic: true, alpha: 1 },
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { s = {}; }
  const out = { ...DEFAULTS, ...s, crosshair: { ...DEFAULTS.crosshair, ...(s.crosshair || {}) } };
  if (!out.quality) out.quality = isLowEndDevice() || isTouchDevice() ? 'low' : 'medium';
  if (!out.name) out.name = 'Operator' + Math.floor(Math.random() * 900 + 100);
  return out;
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
