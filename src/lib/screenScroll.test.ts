import { describe, expect, it } from 'vitest'
import type { Screen } from './nav'
import { scrollTargetFor } from './screenScroll'

const saved = new Map<Screen, number>([
  ['settings', 730],
  ['home', 120],
  ['words', 40],
])

describe('where the page sits when one screen replaces another', () => {
  it('a screen opened from Settings starts at the top: "How it works", the news, Debug, the intro, the placement test', () => {
    for (const screen of ['how', 'whatsnew', 'debug', 'onboarding', 'placement'] as const) expect(scrollTargetFor('settings', screen, saved, null), screen).toBe(0)
  })

  it('the screen Back leads to gets its place back: Settings after "How it works", and after the intro or the placement test it was left for', () => {
    for (const from of ['how', 'whatsnew', 'debug', 'onboarding', 'placement'] as const) expect(scrollTargetFor(from, 'settings', saved, null), from).toBe(730)
  })

  it('Home keeps its place across the screens that lead back to it, and every screen opened from Home starts at the top', () => {
    for (const from of ['learn', 'review', 'matching', 'cloze', 'words', 'settings'] as const) expect(scrollTargetFor(from, 'home', saved, null), from).toBe(120)
    for (const to of ['learn', 'review', 'matching', 'cloze', 'words', 'settings'] as const) expect(scrollTargetFor('home', to, saved, null), to).toBe(0)
  })

  it('a word opens at the top, and Back goes where it was opened from, at the place that screen was left', () => {
    expect(scrollTargetFor('words', 'word', saved, null)).toBe(0)
    expect(scrollTargetFor('home', 'word', saved, null)).toBe(0)
    expect(scrollTargetFor('word', 'words', saved, 'words')).toBe(40)
    expect(scrollTargetFor('word', 'home', saved, 'home')).toBe(120)
  })

  it('a screen never visited has no place to restore: the top', () => {
    expect(scrollTargetFor('how', 'settings', new Map(), null)).toBe(0)
  })

  it('a move that is not a way back (Learn to Review, Review to Learn) is a new screen: the top', () => {
    expect(scrollTargetFor('learn', 'review', saved, null)).toBe(0)
    expect(scrollTargetFor('review', 'learn', saved, null)).toBe(0)
  })
})
