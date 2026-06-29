// The single place that touches storage.
// Tonight: a local JSON file. Later: swap this file for Firestore, nothing else changes.
//
// Exposes get(key) and save(key, value). The backing file is created if missing
// and an empty or corrupt file never crashes the server, it is treated as {}.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data.json');

function readAll() {
  if (!existsSync(DATA_FILE)) {
    return {};
  }
  let raw;
  try {
    raw = readFileSync(DATA_FILE, 'utf8');
  } catch {
    return {};
  }
  if (!raw || raw.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Corrupt file, do not crash. Start from empty.
    return {};
  }
}

function writeAll(data) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function get(key) {
  const data = readAll();
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
}

export function save(key, value) {
  const data = readAll();
  data[key] = value;
  writeAll(data);
  return value;
}
