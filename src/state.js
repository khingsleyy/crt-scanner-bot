import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KEEP_MS = 21 * 24 * 3600 * 1000;

// state[key] = { t, pre?: { at, dir }, done?, outcome?, backup? }
export function loadState(path) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      // older versions stored just a timestamp per alert
      out[k] = typeof v === 'number' ? { t: v, backup: v } : v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveState(path, state, now = Date.now()) {
  const pruned = Object.fromEntries(Object.entries(state).filter(([, v]) => now - (v.t || 0) < KEEP_MS));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pruned, null, 2) + '\n');
}
