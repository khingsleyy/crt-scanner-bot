import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KEEP_MS = 21 * 24 * 3600 * 1000;

export function loadState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function saveState(path, state, now = Date.now()) {
  const pruned = Object.fromEntries(Object.entries(state).filter(([, t]) => now - t < KEEP_MS));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pruned, null, 2) + '\n');
}
