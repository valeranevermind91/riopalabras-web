import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeWord } from '../testing/makeWord'
import {
  MAX_WORD_LENGTH,
  addCustomWord,
  blankValues,
  checkSave,
  checkSpanish,
  createTombstoneClearer,
  deleteCustomWord,
  editCustomWord,
  findDuplicate,
  rowFromValues,
  tombstoneClearPatch,
  valuesOf,
  type CustomWordDeps,
  type WordValues,
} from './customWords'
import { customWordFromRow, mergeWords } from './words'
import { MAX_LEARN_PICKS } from './learnPicks'
import { applySettingsPatch, removeCustomWord, upsertCustomWord } from './mutations'
import { createQueueStore, type StorageLike } from './queueStore'
import { mirrorPending } from './startup'
import { parseSettings } from './settings'
import type { SettingsPatch, UserSettings, Word } from './types'
import { createSupabaseWriteQueue } from './writeQueue'

const NOW = Date.parse('2026-10-07T15:00:00Z')

const filled = (over: Partial<WordValues> = {}): WordValues => ({
  ...blankValues(),
  esWord: 'Zapallito',
  pos: 'n',
  enTranslation: 'little squash',
  ruTranslation: 'кабачок',
  ...over,
})

const rioForm = { type: 'replacement', form: 'pibe', altForm: 'piba', altRegion: null, region: 'uy', register: 'informal', notes: null, stdMeaning: null, translation: null, stdUsage: null, example: null, confidence: 'high' } as never
const dictionary: Word[] = [
  makeWord('chico', { rank: 1, rio: rioForm }), // overlay form: pibe
  makeWord('coger', { rank: 2, esRioplatense: 'agarrar' }), // legacy field
  makeWord('café', { rank: 3 }),
  makeWord('oculta', { rank: 4, isHidden: true }), // hidden words count too
]

describe('the typed word', () => {
  it('is trimmed, and must be one word of at most 50 characters', () => {
    expect(checkSpanish('  casa ')).toEqual({ ok: true, word: 'casa' })
    expect(checkSpanish('')).toEqual({ ok: false, problem: 'empty' })
    expect(checkSpanish('   ')).toEqual({ ok: false, problem: 'empty' })
    expect(checkSpanish('dos palabras')).toEqual({ ok: false, problem: 'spaces' })
    expect(checkSpanish('a\tb')).toEqual({ ok: false, problem: 'spaces' })
    expect(checkSpanish('a'.repeat(MAX_WORD_LENGTH))).toMatchObject({ ok: true })
    expect(checkSpanish('a'.repeat(MAX_WORD_LENGTH + 1))).toEqual({ ok: false, problem: 'too-long' })
  })

  it('keeps its casing as typed', () => {
    expect(checkSpanish(' Zapallito ')).toEqual({ ok: true, word: 'Zapallito' })
  })
})

describe('the duplicate check', () => {
  it('catches es_word, the legacy es_rioplatense and the overlay\'s own Rioplatense form, whatever the case or the spaces', () => {
    expect(findDuplicate(dictionary, 'CHICO')).toMatchObject({ via: 'es_word', word: { esWord: 'chico' } })
    expect(findDuplicate(dictionary, '  Agarrar ')).toMatchObject({ via: 'es_rioplatense', word: { esWord: 'coger' } })
    expect(findDuplicate(dictionary, 'Pibe')).toMatchObject({ via: 'overlay', word: { esWord: 'chico' } })
    expect(findDuplicate(dictionary, ' PIBA ')).toMatchObject({ via: 'overlay', word: { esWord: 'chico' } }) // the alternative Rioplatense form
    expect(findDuplicate(dictionary, 'OCULTA')).toMatchObject({ via: 'es_word' }) // hidden words are still there
  })

  it('does not fold accents (café is not cafe, as in the Flutter app), and finds nothing for a new word', () => {
    expect(findDuplicate(dictionary, 'cafe')).toBeNull()
    expect(findDuplicate(dictionary, 'café')).toMatchObject({ via: 'es_word' })
    expect(findDuplicate(dictionary, 'zapallito')).toBeNull()
    expect(findDuplicate(dictionary, '  ')).toBeNull()
  })

  it('finds a word the user already added', () => {
    const own = customWordFromRow(rowFromValues(filled()))
    expect(findDuplicate([...dictionary, own], 'ZAPALLITO')).toMatchObject({ via: 'es_word', word: { isCustom: true } })
  })
})

describe('what saving needs', () => {
  it('the word, a part of speech and BOTH translations; the example and its translations are optional', () => {
    expect(checkSave(filled())).toEqual({ ok: true })
    expect(checkSave(filled({ esWord: 'dos palabras' }))).toEqual({ ok: false, problem: 'word' })
    expect(checkSave(filled({ pos: null }))).toEqual({ ok: false, problem: 'pos' })
    expect(checkSave(filled({ enTranslation: '  ' }))).toEqual({ ok: false, problem: 'translations' })
    expect(checkSave(filled({ ruTranslation: '' }))).toEqual({ ok: false, problem: 'translations' })
    expect(checkSave(filled({ exampleSentence: '', exampleTranslationEn: '', exampleTranslationRu: '' }))).toEqual({ ok: true })
  })

  it('the row carries exactly the intended columns, the word as typed: no id, no created_at, no word_form_in_example, no user_id', () => {
    const row = rowFromValues(filled({ exampleSentence: ' Me gusta el zapallito. ', esRioplatense: ' zapallito ', isRioplatenseVariant: true }))
    expect(Object.keys(row).sort()).toEqual(['en_translation', 'es_rioplatense', 'es_word', 'example_sentence', 'example_translation_en', 'example_translation_ru', 'is_rioplatense_variant', 'pos', 'ru_translation'])
    expect(row).toEqual({
      es_word: 'Zapallito',
      es_rioplatense: 'zapallito',
      en_translation: 'little squash',
      ru_translation: 'кабачок',
      example_sentence: 'Me gusta el zapallito.',
      example_translation_en: '',
      example_translation_ru: '',
      is_rioplatense_variant: true,
      pos: 'n',
    })
  })

  it('without enrichment the Rioplatense columns are null and false', () => {
    expect(rowFromValues(filled())).toMatchObject({ es_rioplatense: null, is_rioplatense_variant: false })
  })
})

/** Deps with spies, to see what an action asks for and in what order. */
function spies(words: readonly Word[], raw: Record<string, unknown> = {}) {
  const calls: string[] = []
  let settings = parseSettings({ daily_new_word_limit: 10, some_future_key: { a: 1 }, ...raw })
  const patches: SettingsPatch[] = []
  const saves: unknown[] = []
  const deletes: string[] = []
  const progress: unknown[] = []
  const deps: CustomWordDeps = {
    words,
    getSettings: () => settings,
    applySettings: (p) => {
      calls.push('applySettings')
      settings = applySettingsPatch(settings, p)
    },
    upsertCustomWord: (w) => void calls.push(`upsert:${w.esWord}`),
    removeCustomWord: (e) => void calls.push(`remove:${e}`),
    queue: {
      enqueueSettings: (p) => {
        calls.push('settings')
        patches.push(p)
      },
      enqueueCustomWord: (r) => {
        calls.push(`save:${r.es_word}`)
        saves.push(r)
      },
      enqueueCustomDelete: (e) => {
        calls.push(`delete:${e}`)
        deletes.push(e)
      },
      ...({ enqueueProgress: (u: unknown) => progress.push(u) } as object),
    },
  }
  return { deps, calls, patches, saves, deletes, progress, settings: () => settings }
}

describe('adding a word', () => {
  it('saves the row, and in ONE settings patch clears a matching tombstone and appends the word to learn_picks', () => {
    const s = spies(dictionary, { pending_word_deletes: ['otra', 'zapallito'], learn_picks: ['chico'] })
    const result = addCustomWord(filled(), s.deps)
    expect(result).toEqual({ status: 'added', queue: 'queued' })
    expect(s.saves).toEqual([rowFromValues(filled())])
    expect(s.patches).toEqual([{ pending_word_deletes: ['otra'], learn_picks: ['chico', 'zapallito'] }]) // one patch, both keys
    expect(s.settings().raw.some_future_key).toEqual({ a: 1 }) // every other key is still there
  })

  it('with no tombstone the patch is only the queue', () => {
    const s = spies(dictionary)
    addCustomWord(filled(), s.deps)
    expect(s.patches).toEqual([{ learn_picks: ['zapallito'] }])
  })

  it('stores the key lowercased in learn_picks and the word as typed in the row', () => {
    const s = spies(dictionary)
    addCustomWord(filled({ esWord: 'Zapallito' }), s.deps)
    expect(s.saves).toMatchObject([{ es_word: 'Zapallito' }])
    expect(s.patches[0].learn_picks).toEqual(['zapallito'])
  })

  it('with the Learn queue at its cap the word is still saved, and not queued', () => {
    const others = Array.from({ length: MAX_LEARN_PICKS }, (_, i) => makeWord(`otra${i}`, { rank: 10 + i }))
    const s = spies([...dictionary, ...others], { learn_picks: others.map((w) => w.esWord) })
    const result = addCustomWord(filled(), s.deps)
    expect(result).toEqual({ status: 'added', queue: 'full' })
    expect(s.saves).toHaveLength(1)
    expect(s.patches).toEqual([]) // no tombstone either, so no settings write at all
  })

  it('at the cap a tombstone is still cleared', () => {
    const others = Array.from({ length: MAX_LEARN_PICKS }, (_, i) => makeWord(`otra${i}`, { rank: 10 + i }))
    const s = spies([...dictionary, ...others], { learn_picks: others.map((w) => w.esWord), pending_word_deletes: ['zapallito'] })
    addCustomWord(filled(), s.deps)
    expect(s.patches).toEqual([{ pending_word_deletes: [] }])
  })

  it('a duplicate writes NOTHING: no row, no settings, no change in memory', () => {
    for (const typed of ['CHICO', 'agarrar', 'Pibe', 'PIBA']) {
      const s = spies(dictionary)
      expect(addCustomWord(filled({ esWord: typed }), s.deps)).toMatchObject({ status: 'duplicate' })
      expect(s.calls).toEqual([])
    }
  })

  it('an incomplete form writes nothing either', () => {
    const s = spies(dictionary)
    expect(addCustomWord(filled({ ruTranslation: '' }), s.deps)).toEqual({ status: 'invalid', problem: 'translations' })
    expect(addCustomWord(filled({ pos: null }), s.deps)).toEqual({ status: 'invalid', problem: 'pos' })
    expect(addCustomWord(filled({ esWord: 'a b' }), s.deps)).toEqual({ status: 'invalid', problem: 'word' })
    expect(s.calls).toEqual([])
  })
})

describe('editing a word', () => {
  const own = customWordFromRow(rowFromValues(filled()))

  it('writes the same key with the typed casing, takes es_word from the word (it cannot be changed), and touches no progress', () => {
    const s = spies([...dictionary, own])
    const result = editCustomWord(own, filled({ esWord: 'zapallito', ruTranslation: 'тыква', pos: 'adj' }), s.deps)
    expect(result).toEqual({ status: 'saved' })
    expect(s.saves).toEqual([expect.objectContaining({ es_word: 'Zapallito', ru_translation: 'тыква', pos: 'adj' })])
    expect(s.progress).toEqual([])
    expect(s.calls).toEqual(['upsert:Zapallito', 'save:Zapallito']) // nothing else: no settings, no delete
  })

  it('still needs both translations', () => {
    const s = spies([own])
    expect(editCustomWord(own, filled({ enTranslation: '' }), s.deps)).toEqual({ status: 'invalid', problem: 'translations' })
    expect(s.calls).toEqual([])
  })

  it('keeps the word\'s progress and flags in memory, and changes only its content', () => {
    const learned = { ...own, repetitions: 3, interval: 6, easeFactor: 2.1, nextReview: new Date(NOW), isFavorite: true, isHidden: false }
    const [next] = upsertCustomWord([learned], customWordFromRow(rowFromValues(filled({ ruTranslation: 'тыква', exampleSentence: 'Un zapallito.' }))))
    expect(next).toMatchObject({ repetitions: 3, interval: 6, easeFactor: 2.1, isFavorite: true, ruTranslation: 'тыква', exampleSentence: 'Un zapallito.', isCustom: true })
    expect(next.nextReview).toEqual(new Date(NOW))
  })

  it('the form starts from the word as it is', () => {
    expect(valuesOf({ ...own, esRioplatense: 'zapallito', isRioplatenseVariant: true })).toMatchObject({ esWord: 'Zapallito', pos: 'n', esRioplatense: 'zapallito', isRioplatenseVariant: true })
    expect(valuesOf({ ...own, pos: 'custom' }).pos).toBe('custom')
  })
})

describe('deleting a word', () => {
  const own = customWordFromRow(rowFromValues(filled({ esWord: 'Zapallito' })))

  it('queues the tombstone (lowercased key) BEFORE the delete, and the delete uses the stored casing', () => {
    const s = spies([...dictionary, own], { pending_word_deletes: ['otra'] })
    expect(deleteCustomWord(own, s.deps)).toBe(true)
    expect(s.patches).toEqual([{ pending_word_deletes: ['otra', 'zapallito'] }])
    expect(s.deletes).toEqual(['Zapallito']) // not 'zapallito'
    expect(s.calls.indexOf('settings')).toBeLessThan(s.calls.indexOf('delete:Zapallito'))
    expect(s.calls).toContain('remove:Zapallito')
    expect(s.settings().raw.some_future_key).toEqual({ a: 1 })
  })

  it('also takes the word out of the Learn queue, in the same patch', () => {
    const s = spies([...dictionary, own], { learn_picks: ['chico', 'zapallito', 'coger'] })
    deleteCustomWord(own, s.deps)
    expect(s.patches).toEqual([{ learn_picks: ['chico', 'coger'], pending_word_deletes: ['zapallito'] }])
  })

  it('does not duplicate a tombstone that is already there', () => {
    const s = spies([own], { pending_word_deletes: ['zapallito'] })
    deleteCustomWord(own, s.deps)
    expect(s.patches).toEqual([{ pending_word_deletes: ['zapallito'] }])
  })

  it('never deletes a dictionary word', () => {
    const s = spies(dictionary)
    expect(deleteCustomWord(dictionary[0], s.deps)).toBe(false)
    expect(s.calls).toEqual([])
    expect(removeCustomWord(dictionary, 'chico')).toBe(dictionary)
  })

  it('leaves its progress, favourite and hidden rows alone: only user_words is asked to delete', () => {
    const s = spies([own])
    deleteCustomWord(own, s.deps)
    expect(s.calls.filter((c) => /progress|favorite|hidden/i.test(c))).toEqual([])
  })
})

describe('the tombstone clearing', () => {
  it('removes exactly the deleted keys (any case) and nothing else, or says there is nothing to do', () => {
    const settings = parseSettings({ pending_word_deletes: ['a', 'b', 'c'] })
    expect(tombstoneClearPatch(settings, ['B'])).toEqual({ pending_word_deletes: ['a', 'c'] })
    expect(tombstoneClearPatch(settings, ['z'])).toBeNull()
    expect(tombstoneClearPatch(null, ['a'])).toBeNull()
  })

  it('clears in memory too once the data is there, and not before', () => {
    const clearer = createTombstoneClearer()
    expect(clearer.clear(['a'])).toBeNull()
    let settings: UserSettings = parseSettings({ pending_word_deletes: ['a', 'b'], other: 1 })
    clearer.use({ read: () => settings, apply: (p) => void (settings = applySettingsPatch(settings, p)) })
    expect(clearer.clear(['a'])).toEqual({ pending_word_deletes: ['b'] })
    expect(settings.pendingWordDeletes).toEqual(['b'])
    expect(settings.raw.other).toBe(1)
  })
})

describe('loading: tombstoned words', () => {
  const row = (es_word: string) => ({ es_word, es_rioplatense: null, en_translation: 'x', ru_translation: 'y', example_sentence: null, example_translation_en: null, example_translation_ru: null, is_rioplatense_variant: false, pos: 'n' })
  const overlay = (customWords: ReturnType<typeof row>[], settings: Record<string, unknown> | null) => ({ customWords, progress: [], favorites: [], hidden: [], settings })

  it('does not show a custom word whose key Flutter has queued for deletion (its cloud row may still be there)', () => {
    const merged = mergeWords(dictionary, overlay([row('Zapallito'), row('lechuga')], { pending_word_deletes: ['zapallito'] }))
    expect(merged.words.filter((w) => w.isCustom).map((w) => w.esWord)).toEqual(['lechuga'])
  })

  it('shows everything without a tombstone, and a tombstone for a dictionary word hides nothing', () => {
    expect(mergeWords(dictionary, overlay([row('Zapallito')], null)).words.some((w) => w.esWord === 'Zapallito')).toBe(true)
    expect(mergeWords(dictionary, overlay([], { pending_word_deletes: ['chico'] })).words).toHaveLength(dictionary.length)
  })
})

describe('mirroring custom-word changes that are still waiting', () => {
  it('shows a waiting save and a waiting delete in the loaded words', () => {
    const calls: string[] = []
    mirrorPending(
      { progress: [], settings: null, hidden: [], favorites: [], words: [{ kind: 'save', row: rowFromValues(filled()) }, { kind: 'delete', esWord: 'Vieja', tombstone: 'vieja' }] },
      { applyProgress: () => {}, applySettings: () => {}, applyHidden: () => {}, applyFavorite: () => {}, upsertCustomWord: (w) => calls.push(`upsert:${w.esWord}`), removeCustomWord: (e) => calls.push(`remove:${e}`) },
    )
    expect(calls).toEqual(['upsert:Zapallito', 'remove:Vieja'])
  })
})

// ---- through the real write queue, the real supabase-js client and a fake server ----

function memoryStorage() {
  const items = new Map<string, string>()
  const storage: StorageLike & { items: Map<string, string> } = { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
  return storage
}

describe('through the write queue', () => {
  let server: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    server = createFakeServer({ now: () => NOW })
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  async function app(storage = memoryStorage(), blob: Record<string, unknown> = { daily_new_word_limit: 10, some_future_key: { a: 1 } }) {
    const { ensureSession } = await import('../lib/auth')
    const client = server.client()
    const auth = await ensureSession(client, initDataFor(5), 5)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    server.tables.set('user_settings', [{ user_id: auth.userId, settings: blob }])
    let settings = parseSettings(blob)
    const clearer = createTombstoneClearer()
    clearer.use({ read: () => settings, apply: (p) => void (settings = applySettingsPatch(settings, p)) })
    const queue = createSupabaseWriteQueue(client, auth.userId, () => settings, {
      store: createQueueStore(auth.userId, storage, () => NOW),
      now: () => NOW,
      retryDelaysMs: [1, 1, 1],
      sleep: async () => {},
      onWordsDeleted: clearer.clear,
    })
    let words: readonly Word[] = dictionary
    const deps: CustomWordDeps = {
      get words() {
        return words
      },
      getSettings: () => settings,
      applySettings: (p) => void (settings = applySettingsPatch(settings, p)),
      upsertCustomWord: (w) => void (words = upsertCustomWord(words, w)),
      removeCustomWord: (e) => void (words = removeCustomWord(words, e)),
      queue,
    }
    return { queue, deps, storage, client, userId: auth.userId, settings: () => settings, words: () => words }
  }
  const idle = (q: { getStatus: () => { unsaved: boolean } }) => vi.waitFor(() => expect(q.getStatus().unsaved).toBe(false))
  const userWords = () => server.rows('user_words')
  const blob = () => (server.rows('user_settings')[0].settings as Record<string, unknown>)

  it('an added word is ONE upsert on (user_id, es_word) with the typed casing and exactly the intended columns', async () => {
    const a = await app()
    expect(addCustomWord(filled({ esWord: 'Zapallito', exampleSentence: 'Un zapallito.' }), a.deps)).toEqual({ status: 'added', queue: 'queued' })
    await idle(a.queue)
    expect(userWords()).toEqual([
      {
        user_id: a.userId,
        es_word: 'Zapallito',
        es_rioplatense: null,
        en_translation: 'little squash',
        ru_translation: 'кабачок',
        example_sentence: 'Un zapallito.',
        example_translation_en: '',
        example_translation_ru: '',
        is_rioplatense_variant: false,
        pos: 'n',
      },
    ])
    expect(blob()).toEqual({ daily_new_word_limit: 10, some_future_key: { a: 1 }, learn_picks: ['zapallito'] })
  })

  it('adding clears a matching tombstone on the server in the same write that queues the word', async () => {
    const a = await app(memoryStorage(), { pending_word_deletes: ['zapallito', 'otra'], some_future_key: 1 })
    addCustomWord(filled(), a.deps)
    await idle(a.queue)
    expect(blob()).toEqual({ pending_word_deletes: ['otra'], some_future_key: 1, learn_picks: ['zapallito'] })
    expect(server.log.filter((l) => l.url === '/rest/v1/user_settings' && l.method === 'POST')).toHaveLength(1)
  })

  it('an edit upserts the same row (same key, same casing) and writes nothing to progress', async () => {
    const a = await app()
    addCustomWord(filled(), a.deps)
    await idle(a.queue)
    const own = a.words().find((w) => w.isCustom)!
    editCustomWord(own, filled({ ruTranslation: 'тыква', pos: 'adj' }), a.deps)
    await idle(a.queue)
    expect(userWords()).toHaveLength(1)
    expect(userWords()[0]).toMatchObject({ es_word: 'Zapallito', ru_translation: 'тыква', pos: 'adj' })
    expect(server.rows('user_progress')).toEqual([])
  })

  it('a delete of a capitalised word removes the row by its stored casing; the lowercased key would match nothing', async () => {
    const a = await app()
    addCustomWord(filled({ esWord: 'Zapallito' }), a.deps)
    await idle(a.queue)

    // the trap the recon found: a delete by the lowercased key answers success and removes no row
    const { error } = await a.client.from('user_words').delete().eq('user_id', a.userId).eq('es_word', 'zapallito')
    expect(error).toBeNull()
    expect(userWords()).toHaveLength(1)

    deleteCustomWord(a.words().find((w) => w.isCustom)!, a.deps)
    await idle(a.queue)
    expect(userWords()).toEqual([])
  })

  it('writes the tombstone BEFORE the delete, and clears it once the delete succeeded; the other settings keys stay', async () => {
    const a = await app(memoryStorage(), { learn_picks: ['zapallito', 'otra'], some_future_key: { a: 1 } })
    addCustomWord(filled({ esWord: 'Zapallito' }), a.deps)
    await idle(a.queue)
    expect(userWords()).toHaveLength(1)

    // what the server holds at the moment the DELETE arrives
    const atDelete: unknown[] = []
    server.spy.beforeRest = ({ method, table }) => {
      if (method === 'DELETE' && table === 'user_words') atDelete.push(blob().pending_word_deletes)
    }
    deleteCustomWord(a.words().find((w) => w.isCustom)!, a.deps)
    await idle(a.queue)

    expect(atDelete).toEqual([['zapallito']]) // already there when the row went
    expect(userWords()).toEqual([])
    expect(blob().pending_word_deletes).toEqual([]) // cleared again afterwards
    expect(blob().some_future_key).toEqual({ a: 1 })
    expect(blob().learn_picks).toEqual(['otra']) // it left the Learn queue too
    expect(a.settings().pendingWordDeletes).toEqual([]) // and in memory, so no later write brings the tombstone back
  })

  it('whatever order they were queued in, the tombstone goes out before the delete when both were waiting', async () => {
    const a = await app()
    addCustomWord(filled({ esWord: 'Zapallito' }), a.deps)
    await idle(a.queue)

    server.break.networkDown = true // the settings write and the delete are both waiting when the network comes back
    deleteCustomWord(a.words().find((w) => w.isCustom)!, a.deps)
    await vi.waitFor(() => expect(a.queue.getStatus().failed).toBe(true)) // the queue has given up for now: both are still waiting
    expect(a.queue.getStatus()).toMatchObject({ pendingSettings: true, pendingWords: 1 })
    server.break.networkDown = false

    const atDelete: unknown[] = []
    server.spy.beforeRest = ({ method, table }) => {
      if (method === 'DELETE' && table === 'user_words') atDelete.push(blob().pending_word_deletes)
    }
    expect(await a.queue.retry()).toBe(true)
    expect(atDelete).toEqual([['zapallito']])
    expect(userWords()).toEqual([])
    expect(blob().pending_word_deletes).toEqual([])
  })

  it('a word deleted while offline stays queued and persisted, and is deleted (and its tombstone cleared) after a restart', async () => {
    const storage = memoryStorage()
    const first = await app(storage)
    addCustomWord(filled({ esWord: 'Zapallito' }), first.deps)
    await idle(first.queue)

    server.break.networkDown = true
    const own = first.words().find((w) => w.isCustom)!
    deleteCustomWord(own, first.deps)
    expect(first.queue.getStatus().pendingWords).toBe(1)
    first.queue.persistNow()
    expect(first.queue.pending().words).toEqual([{ kind: 'delete', esWord: 'Zapallito', tombstone: 'zapallito' }])
    expect(userWords()).toHaveLength(1)

    // the webview is killed; the network is back; the next run restores and sends it
    server.break.networkDown = false
    const second = await app(storage, blob())
    expect(second.queue.restore().restored).toBeGreaterThan(0)
    await idle(second.queue)
    expect(userWords()).toEqual([])
  })

  it('a word added while offline is queued, persisted and shown, and reaches the server when the network is back', async () => {
    const storage = memoryStorage()
    const a = await app(storage)
    server.break.networkDown = true
    addCustomWord(filled(), a.deps)
    expect(a.queue.getStatus()).toMatchObject({ pendingWords: 1, unsaved: true })
    expect(a.words().some((w) => w.esWord === 'Zapallito')).toBe(true)
    server.break.networkDown = false
    expect(await a.queue.retry()).toBe(true)
    expect(userWords().map((r) => r.es_word)).toEqual(['Zapallito'])
  })

  it('the latest change per word wins: a delete followed by a save before anything is sent leaves just the save', async () => {
    const a = await app()
    server.break.networkDown = true
    a.queue.enqueueCustomDelete('Zapallito')
    a.queue.enqueueCustomWord(rowFromValues(filled()))
    expect(a.queue.pending().words).toEqual([{ kind: 'save', row: rowFromValues(filled()) }])
    server.break.networkDown = false
    await a.queue.retry()
    expect(userWords().map((r) => r.es_word)).toEqual(['Zapallito'])
  })
})
