/**
 * Seeded PRNG. Variant selection must be reproducible: the same seed has to
 * rebuild the exact same run, because the variant ids are embedded in the
 * credential and an auditor has to be able to replay what the worker faced.
 */

/**
 * Avalanche a seed so that neighbouring seeds start from unrelated states.
 * Without this, variants 1..6 share visibly correlated first draws — the same
 * gas, the same shift — which would make a "randomised" certification look
 * rigged the first time anyone lined up six attempts and read across them.
 */
function scramble(seed: number): number {
  let a = seed >>> 0;
  a ^= a >>> 16;
  a = Math.imul(a, 0x21f0aaad);
  a ^= a >>> 15;
  a = Math.imul(a, 0x735a2d97);
  a ^= a >>> 15;
  return a >>> 0;
}

/** mulberry32 — small, fast, good enough distribution for content selection. */
export function makeRng(seed: number): () => number {
  let a = scramble(seed);
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[], weights?: readonly number[]): T {
  if (items.length === 0) throw new Error('pick() called with no items');
  if (!weights || weights.length !== items.length) {
    return items[Math.floor(rng() * items.length)]!;
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

export function pickNumber(
  rng: () => number,
  min: number,
  max: number,
  step = 1,
  precision = 0,
): number {
  // (19.2 - 15.4) / 0.1 is 37.99999999999999 in binary floating point, which
  // silently clips the top of every authored range. Absorb that before flooring.
  const steps = Math.floor((max - min) / step + 1e-9);
  const value = min + Math.floor(rng() * (steps + 1)) * step;
  return Number(value.toFixed(precision));
}

/** Non-cryptographic string hash, used to derive stable variant ids. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
