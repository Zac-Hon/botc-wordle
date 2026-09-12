/**
 * Deterministic seeded randomness.
 *
 * Every player must see the same daily character and the same hangman reveal
 * order, so nothing in the game may use Math.random. These are the standard
 * xmur3 / mulberry32 pair: small, fast, and stable across engines, which
 * matters because the daily seeding script and the browser must agree.
 */

/** Hashes a string into a 32-bit seed. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

/** PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Convenience: a seeded PRNG from any string. */
export function rngFrom(seed: string): () => number {
  return mulberry32(xmur3(seed)())
}

/** Fisher-Yates using a supplied PRNG. Returns a new array. */
export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
