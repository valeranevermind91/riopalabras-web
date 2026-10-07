/** A small seeded generator (mulberry32): the same seed always gives the same sequence of numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A copy of `items` in a random order that depends only on `seed` (a Fisher-Yates shuffle: every order is equally likely,
 * which a random comparator passed to sort() is not). The same items and seed always give the same order.
 */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  const random = seededRandom(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A fresh seed (the only place the shuffle uses real randomness). */
export function newSeed(): number {
  return Math.floor(Math.random() * 4294967296)
}
