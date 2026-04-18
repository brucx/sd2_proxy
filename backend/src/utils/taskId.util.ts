import { randomBytes } from 'node:crypto';

// Task ID format: cgt-YYYYMMDDHHMMSS-<5 chars of [a-z0-9]>
// Matches Ark's official task ID shape (e.g. cgt-20250331175019-68d9t).
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function randomSuffix(len = 5): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function generateTaskId(): string {
  const d = new Date();
  const stamp =
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  return `cgt-${stamp}-${randomSuffix()}`;
}
