import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { newSeed, seededRandom, shuffled } from './random'

describe('seededRandom', () => {
  it('gives the same numbers for the same seed, different ones for another, always in [0, 1)', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    const run = (r: () => number) => Array.from({ length: 50 }, r)
    const first = run(a)
    expect(run(b)).toEqual(first)
    expect(run(seededRandom(8))).not.toEqual(first)
    for (const n of first) expect(n >= 0 && n < 1).toBe(true)
  })
})

describe('shuffled (Fisher-Yates, seeded)', () => {
  const items = Array.from({ length: 200 }, (_, i) => i)

  it('is identical for the same seed', () => {
    expect(shuffled(items, 123)).toEqual(shuffled(items, 123))
  })

  it('is different for a different seed, and different from the input order', () => {
    expect(shuffled(items, 123)).not.toEqual(shuffled(items, 124))
    expect(shuffled(items, 123)).not.toEqual(items)
  })

  it('has every item exactly once, whatever the seed, and does not touch its input', () => {
    const copy = [...items]
    for (const seed of [0, 1, 2, 99, 4294967295]) {
      const out = shuffled(items, seed)
      expect(out).toHaveLength(items.length)
      expect(new Set(out).size).toBe(items.length)
      expect([...out].sort((x, y) => x - y)).toEqual(items)
    }
    expect(items).toEqual(copy)
  })

  it('copes with nothing and with one', () => {
    expect(shuffled([], 5)).toEqual([])
    expect(shuffled(['a'], 5)).toEqual(['a'])
  })

  it('is unbiased: over many seeds every item lands in every position about equally often', () => {
    const trials = 6000
    const counts = Array.from({ length: 4 }, () => new Array<number>(4).fill(0)) // counts[item][position]
    for (let seed = 0; seed < trials; seed++) shuffled([0, 1, 2, 3], seed).forEach((item, position) => counts[item][position]++)
    const expected = trials / 4
    for (const row of counts) for (const n of row) expect(Math.abs(n - expected)).toBeLessThan(expected * 0.12)
  })

  it('a new seed is an integer in range', () => {
    for (let i = 0; i < 20; i++) {
      const seed = newSeed()
      expect(Number.isInteger(seed) && seed >= 0 && seed < 4294967296).toBe(true)
    }
  })
})

describe('no random comparator anywhere', () => {
  it('nothing in the app sorts with a random comparator (the Words shuffle only picks its seed with Math.random)', () => {
    expect(readFileSync('src/data/wordList.ts', 'utf8')).not.toContain('Math.random')
    const dirs = ['src/lib', 'src/data', 'src/screens', 'src/components']
    for (const dir of dirs) {
      for (const file of readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))) {
        const text = readFileSync(`${dir}/${file}`, 'utf8')
        expect(text, `${dir}/${file}`).not.toMatch(/\.sort\([^)]*(Math\.random|random\(\))/)
      }
    }
  })
})
