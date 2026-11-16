import { describe, expect, it } from 'vitest'
import { HINTS_SEEN_KEY, TOUR_FLAGS, hasProgress, hintSeenPatch, hintsResetPatch, homeHint, parseHintsSeen, wordQueueHint } from './hints'
import { applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import { makeWord } from '../testing/makeWord'

// The one-time hints (the tour on Home, the bubble on the Word of the day row, the bubble on a word's queue button) remember what was shown in one key of the settings blob,
// a list of ids, like whats_new_seen: it follows the account, and a person who reset it sees the hints again.

const settings = (hints?: unknown) => parseSettings({ ui_language: 'ru', ...(hints === undefined ? {} : { [HINTS_SEEN_KEY]: hints }) })
const fresh = [makeWord('casa'), makeWord('perro')]
const started = [makeWord('casa', { repetitions: 1, interval: 1 }), makeWord('perro')]

describe('the hints_seen list in the settings blob', () => {
  it('is in the blob under hints_seen, and absent means none seen', () => {
    expect(HINTS_SEEN_KEY).toBe('hints_seen')
    expect(settings().hintsSeen).toEqual([])
  })

  it('reads a list of ids, once each, ignoring anything that is not a string', () => {
    expect(settings(['tour', 'word-queue', 'tour', 7, null, { a: 1 }]).hintsSeen).toEqual(['tour', 'word-queue'])
  })

  it('reads anything that is not a list as none (a key another app wrote in another shape never breaks the screen)', () => {
    for (const junk of ['tour', 3, true, { tour: true }, null]) expect(settings(junk).hintsSeen).toEqual([])
    expect(parseHintsSeen(undefined)).toEqual([])
  })

  it('keeps ids this version does not know (a later version may add some)', () => {
    expect(settings(['tour', 'some-future-hint']).hintsSeen).toEqual(['tour', 'some-future-hint'])
  })

  it('marking a hint seen adds its id to the list and nothing else', () => {
    const before = settings(['word-queue'])
    const patch = hintSeenPatch(before, 'home-wotd')!
    expect(patch).toEqual({ hints_seen: ['word-queue', 'home-wotd'] })
    expect(applySettingsPatch(before, patch).hintsSeen).toEqual(['word-queue', 'home-wotd'])
    expect(applySettingsPatch(before, patch).raw.ui_language).toBe('ru') // the rest of the blob is kept
  })

  it('marks several at once, each once, and there is nothing to write when all are already seen', () => {
    expect(hintSeenPatch(settings(['tour']), 'tour', 'home-wotd')).toEqual({ hints_seen: ['tour', 'home-wotd'] })
    expect(hintSeenPatch(settings(['tour', 'home-wotd']), 'tour', 'home-wotd')).toBeNull()
  })

  it('keeps the ids it does not know when it adds one', () => {
    expect(hintSeenPatch(settings(['some-future-hint']), 'tour')).toEqual({ hints_seen: ['some-future-hint', 'tour'] })
  })

  it('the reset removes the key from the blob, whatever was in it', () => {
    expect(hintsResetPatch()).toEqual({ hints_seen: null })
    const after = applySettingsPatch(settings(['tour', 'home-wotd', 'word-queue']), hintsResetPatch())
    expect(after.hintsSeen).toEqual([])
    expect('hints_seen' in after.raw).toBe(false)
  })

  it('the tour, once seen or skipped, covers the Word of the day bubble too', () => {
    expect(TOUR_FLAGS).toEqual(['tour', 'home-wotd'])
  })
})

describe('progress: whether a person has started learning', () => {
  it('is a word with repetitions; hiding words, starring them and an empty list are not progress', () => {
    expect(hasProgress(fresh)).toBe(false)
    expect(hasProgress([])).toBe(false)
    expect(hasProgress(started)).toBe(true)
    expect(hasProgress([makeWord('casa', { isHidden: true }), makeWord('perro', { isFavorite: true })])).toBe(false)
  })
})

describe('what Home shows once: the tour for a new person, the bubble on the Word of the day for one who already learns', () => {
  it('a person with no progress who has not seen the tour is given the tour', () => {
    expect(homeHint({ words: fresh, settings: settings(), replay: false })).toBe('tour')
  })

  it('a person with progress who has seen neither is given the bubble on the Word of the day (the tour is for new people only)', () => {
    expect(homeHint({ words: started, settings: settings(), replay: false })).toBe('wotd')
  })

  it('nothing once it has been shown: the tour seen (also covers the bubble), the bubble seen', () => {
    expect(homeHint({ words: fresh, settings: settings(['tour']), replay: false })).toBeNull()
    expect(homeHint({ words: started, settings: settings(['tour']), replay: false })).toBeNull() // had the tour, then learned: no bubble for the same row
    expect(homeHint({ words: started, settings: settings(['home-wotd']), replay: false })).toBeNull()
    expect(homeHint({ words: fresh, settings: settings(['home-wotd']), replay: false })).toBe('tour') // the bubble seen on its own does not stand for the tour
  })

  it('"Show hints again" replays the tour whatever the progress (the reset cleared the list)', () => {
    expect(homeHint({ words: started, settings: settings(), replay: true })).toBe('tour')
    expect(homeHint({ words: fresh, settings: settings(['tour']), replay: true })).toBe('tour')
  })
})

describe('the bubble on a word\'s queue button', () => {
  const settingsSeen = settings(['word-queue'])
  it('is shown on a word that can be queued and is not, the first time only', () => {
    expect(wordQueueHint({ word: makeWord('casa'), settings: settings() })).toBe(true)
    expect(wordQueueHint({ word: makeWord('casa'), settings: settingsSeen })).toBe(false)
  })

  it('is not shown where there is no button: a word already in the queue, one Learn cannot teach (learned, hidden, reference-only)', () => {
    const none = settings()
    expect(wordQueueHint({ word: makeWord('casa', { isFavorite: true }), settings: none })).toBe(false)
    expect(wordQueueHint({ word: makeWord('casa', { repetitions: 2, interval: 3 }), settings: none })).toBe(false)
    expect(wordQueueHint({ word: makeWord('casa', { isHidden: true }), settings: none })).toBe(false)
    expect(wordQueueHint({ word: makeWord('de', { pos: 'prep' }), settings: none })).toBe(false)
  })
})
