import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { blankValues, fillBlanks, rowFromValues, valuesOf, type WordValues } from './customWords'
import { highlightTarget } from './headword'
import { createQueueStore, type StorageLike } from './queueStore'
import { customWordFromRow } from './words'
import type { CustomWordRow } from './types'
import type { UserWordRow } from './overlay'

// word_form_in_example on user_words: the word as it stands in a custom word's example ("Tengo" for tener), so the card can highlight an inflected form. It comes from the
// lookup, rides with the word to the database and back, and is dropped the moment the sentence it belongs to is edited away from it. sql/user_words_word_form.sql adds the
// column; until it has been run, nothing here may stop a word from loading or saving.

const filled = (over: Partial<WordValues> = {}): WordValues => ({ ...blankValues(), esWord: 'tener', pos: 'v', enTranslation: 'to have', ruTranslation: 'иметь', ...over })
const stored = (over: Partial<UserWordRow> = {}): UserWordRow => ({
  es_word: 'tener', es_rioplatense: null, en_translation: 'to have', ru_translation: 'иметь', example_sentence: 'Tengo hambre.', example_translation_en: 'I am hungry.', example_translation_ru: 'Я голоден.',
  is_rioplatense_variant: false, pos: 'v', ...over,
})

describe('the row that is written', () => {
  it('carries the form while it still stands in the sentence as it will be saved', () => {
    expect(rowFromValues(filled({ exampleSentence: 'Tengo hambre.', wordFormInExample: 'Tengo' })).word_form_in_example).toBe('Tengo')
    expect(rowFromValues(filled({ exampleSentence: '  Tengo hambre.  ', wordFormInExample: ' Tengo ' })).word_form_in_example).toBe('Tengo')
  })

  it('drops it when the sentence was edited so that it no longer stands there, or the sentence is empty, or there was none', () => {
    expect(rowFromValues(filled({ exampleSentence: 'Tenía hambre.', wordFormInExample: 'Tengo' })).word_form_in_example).toBeNull()
    expect(rowFromValues(filled({ exampleSentence: '', wordFormInExample: 'Tengo' })).word_form_in_example).toBeNull()
    expect(rowFromValues(filled({ exampleSentence: 'Tengo hambre.', wordFormInExample: null })).word_form_in_example).toBeNull()
    expect(rowFromValues(filled({ exampleSentence: 'Tengo hambre.', wordFormInExample: '   ' })).word_form_in_example).toBeNull()
  })

  it('is exact: another case is another text', () => {
    expect(rowFromValues(filled({ exampleSentence: 'Tengo hambre.', wordFormInExample: 'tengo' })).word_form_in_example).toBeNull()
  })
})

describe('the form belongs to the sentence it came with', () => {
  it('a lookup that fills the sentence brings its form; a sentence that was already there keeps its own', () => {
    expect(fillBlanks(filled(), { exampleSentence: 'Tengo hambre.', wordFormInExample: 'Tengo' })).toMatchObject({ exampleSentence: 'Tengo hambre.', wordFormInExample: 'Tengo' })
    const mine = filled({ exampleSentence: 'Mi propia oración.', wordFormInExample: null })
    expect(fillBlanks(mine, { exampleSentence: 'Tengo hambre.', wordFormInExample: 'Tengo' })).toMatchObject({ exampleSentence: 'Mi propia oración.', wordFormInExample: null })
    const kept = filled({ exampleSentence: 'Tengo sed.', wordFormInExample: 'Tengo' })
    expect(fillBlanks(kept, { exampleSentence: 'Otra.', wordFormInExample: 'Otra' })).toMatchObject({ exampleSentence: 'Tengo sed.', wordFormInExample: 'Tengo' })
  })

  it('a lookup with no sentence leaves no form behind', () => {
    expect(fillBlanks(filled(), { exampleSentence: '', wordFormInExample: null })).toMatchObject({ wordFormInExample: null })
  })

  it('editing a word starts from the form it has', () => {
    const word = customWordFromRow(stored({ word_form_in_example: 'Tengo' }))
    expect(valuesOf(word).wordFormInExample).toBe('Tengo')
    expect(rowFromValues(valuesOf(word)).word_form_in_example).toBe('Tengo') // and saving it unedited writes it back
  })
})

describe('the word that is read', () => {
  it('has the stored form while it stands in the sentence', () => {
    expect(customWordFromRow(stored({ word_form_in_example: 'Tengo' })).wordFormInExample).toBe('Tengo')
  })

  it('has none for a row from before the column, a null, a blank, or a form that is not in the sentence', () => {
    for (const row of [stored(), stored({ word_form_in_example: null }), stored({ word_form_in_example: '  ' }), stored({ word_form_in_example: 'Tenía' }), stored({ example_sentence: null, word_form_in_example: 'Tengo' })]) {
      expect(customWordFromRow(row).wordFormInExample).toBeNull()
    }
  })

  it('then highlights an inflected form that no guess from the headword would find: tener / Tengo, poder / puedo, a conjugated reflexive', () => {
    const shown = (row: UserWordRow) => {
      const r = highlightTarget(customWordFromRow(row))
      return r.range ? r.sentence.slice(r.range.start, r.range.end) : null
    }
    expect(shown(stored())).toBeNull() // before: nothing highlighted
    expect(shown(stored({ word_form_in_example: 'Tengo' }))).toBe('Tengo')
    expect(shown(stored({ es_word: 'poder', example_sentence: 'No puedo ir.', word_form_in_example: 'puedo' }))).toBe('puedo')
    expect(shown(stored({ es_word: 'encurdelarse', example_sentence: 'Anoche se encurdeló con los amigos.', word_form_in_example: 'encurdeló' }))).toBe('encurdeló')
  })
})

describe('a save queued before the column existed', () => {
  it('reads back with no form (the queue keeps what it has on the device across versions)', async () => {
    const items = new Map<string, string>()
    const storage: StorageLike = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
    const now = Date.parse('2026-10-25T12:00:00Z')
    const old = { ...rowFromValues(filled({ exampleSentence: 'Tengo hambre.', exampleTranslationEn: 'I am hungry.', exampleTranslationRu: 'Я голоден.' })) } as Partial<CustomWordRow>
    delete old.word_form_in_example
    const store = createQueueStore('u1', storage, () => now)
    const snapshot = (row: CustomWordRow) => ({ progress: [], hidden: [], favorites: [], settings: null, metrics: [], log: [], words: [{ value: { kind: 'save' as const, row }, at: now }] })
    const readBack = () => {
      const op = store.load()?.snapshot.words[0]?.value
      return op && op.kind === 'save' ? op.row : null
    }
    store.save(snapshot(old as CustomWordRow))
    expect(readBack()).toMatchObject({ es_word: 'tener', word_form_in_example: null })
    store.save(snapshot({ ...old, word_form_in_example: 'Tengo' } as CustomWordRow))
    expect(readBack()).toMatchObject({ es_word: 'tener', word_form_in_example: 'Tengo' })
  })
})

describe('against the database, before and after the column', () => {
  let server: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    server = createFakeServer()
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  async function signedIn() {
    const { ensureSession } = await import('../lib/auth')
    const client = server.client()
    const auth = await ensureSession(client, initDataFor(3), 3)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    return { client, userId: auth.userId }
  }
  const save = (over: Partial<CustomWordRow> = {}): { kind: 'save'; row: CustomWordRow } => ({ kind: 'save', row: { ...rowFromValues(filled({ exampleSentence: 'Tengo hambre.', wordFormInExample: 'Tengo' })), ...over } })

  it('with the column: the form is written, and read back by the same select the app makes', async () => {
    const { client, userId } = await signedIn()
    const { writeCustomWords } = await import('./writes')
    const { fetchCustomWords } = await import('./overlay')
    await writeCustomWords(client, userId, [save()])
    expect(server.rows('user_words')[0]).toMatchObject({ es_word: 'tener', word_form_in_example: 'Tengo' })
    const rows = await fetchCustomWords(client, userId)
    expect(rows[0].word_form_in_example).toBe('Tengo')
  })

  it('without the column (the migration not run): the words still load, only without the form', async () => {
    const { client, userId } = await signedIn()
    const { fetchCustomWords } = await import('./overlay')
    const { word_form_in_example: _later, ...before } = rowFromValues(filled({ exampleSentence: 'Tengo hambre.' }))
    server.tables.set('user_words', [{ user_id: userId, ...before }]) // a row as the table has it before the column
    server.break.missingColumn = 'word_form_in_example'
    const rows = await fetchCustomWords(client, userId)
    expect(rows.map((r) => r.es_word)).toEqual(['tener'])
    expect(rows[0].word_form_in_example).toBeUndefined()
    expect(server.log.filter((l) => l.url === '/rest/v1/user_words' && l.method === 'GET').map((l) => l.status)).toEqual([400, 200, 200]) // refused by name, then read again without it (a page of rows, then the empty page that ends the read)
  })

  it('without the column: a save is refused by name and made again without it, so the word is saved and nothing else is lost', async () => {
    const { client, userId } = await signedIn()
    const { writeCustomWords } = await import('./writes')
    server.break.missingColumn = 'word_form_in_example'
    await writeCustomWords(client, userId, [save(), save({ es_word: 'poder', example_sentence: 'No puedo ir.', word_form_in_example: 'puedo' })])
    expect(server.rows('user_words').map((r) => r.es_word).sort()).toEqual(['poder', 'tener'])
    expect(server.rows('user_words').every((r) => !('word_form_in_example' in r))).toBe(true)
    expect(server.rows('user_words')[0]).toMatchObject({ en_translation: 'to have', example_sentence: 'Tengo hambre.' })
  })

  it('any other refusal of a save is still a failure: only a complaint about this column is worked around', async () => {
    const { client, userId } = await signedIn()
    const { writeCustomWords } = await import('./writes')
    server.break.forbidTable = 'user_words'
    await expect(writeCustomWords(client, userId, [save()])).rejects.toThrow(/user_words/)
    expect(server.log.filter((l) => l.url === '/rest/v1/user_words' && l.method === 'POST')).toHaveLength(1) // and not tried a second time without the form
  })

  it('a database error that is not about the column does not make the read fall back', async () => {
    const { client, userId } = await signedIn()
    const { fetchCustomWords } = await import('./overlay')
    server.break.failReadsOf = 'user_words'
    await expect(fetchCustomWords(client, userId)).rejects.toThrow()
    expect(server.log.filter((l) => l.url === '/rest/v1/user_words' && l.method === 'GET')).toHaveLength(1)
  })
})

describe('sql/user_words_word_form.sql', () => {
  const sql = readFileSync('sql/user_words_word_form.sql', 'utf8')
  const statements = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--') && l.trim() !== '')
    .join(' ')
    .split(';')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)

  it('is one statement: add the column, nullable, with nothing else on it, and safe to run twice', () => {
    expect(statements).toEqual(['alter table public.user_words add column if not exists word_form_in_example text'])
  })

  it('says it must be run before the version that reads the column is deployed, and that nothing in the repo runs it', () => {
    expect(sql).toMatch(/NOT RUN BY THE REPOSITORY/)
    expect(sql).toMatch(/before .* deploy/i)
  })

  it('names the column the app reads and writes', () => {
    expect(sql).toContain('word_form_in_example')
    expect(readFileSync('src/data/overlay.ts', 'utf8')).toContain('word_form_in_example')
  })
})
