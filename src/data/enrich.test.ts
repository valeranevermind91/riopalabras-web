import { describe, expect, it } from 'vitest'
import { setLanguage } from '../lib/language'
import { enrichFailureMessage, enrichWord, hoursUntilReset, isRetryable, type EnrichDeps, type EnrichFailure } from './enrich'

const PROXY = 'https://proxy.test'
const entry = {
  word: 'tímido',
  en_translation: 'shy',
  ru_translation: 'застенчивый',
  es_rioplatense: null,
  is_rioplatense_variant: false,
  example_sentence: 'Es muy tímido.',
  example_translation_en: 'He is very shy.',
  example_translation_ru: 'Он очень застенчив.',
  es_standard: null,
  region: null,
  register: 'neutral',
  word_form_in_example: 'tímido',
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function deps(fetchImpl: typeof fetch, over: Partial<EnrichDeps> = {}): EnrichDeps & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  return {
    calls,
    proxyUrl: PROXY,
    getAccessToken: async () => 'token-123',
    isOffline: () => false,
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return fetchImpl(url, init)
    }) as typeof fetch,
    ...over,
  }
}

const failureOf = async (d: EnrichDeps, word = 'tímido', pos: string | null = 'adj'): Promise<EnrichFailure> => {
  const result = await enrichWord({ word, pos }, d)
  if (result.ok) throw new Error('expected a failure')
  return result.failure
}

describe('the request', () => {
  it('is POST /enrich with the Bearer token and { words: [{ word, pos }] }', async () => {
    const d = deps(async () => reply(200, { words: [entry] }))
    await enrichWord({ word: 'tímido', pos: 'adj' }, d)
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].url).toBe(`${PROXY}/enrich`)
    expect(d.calls[0].init.method).toBe('POST')
    expect(d.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-123', 'Content-Type': 'application/json' })
    expect(JSON.parse(d.calls[0].init.body as string)).toEqual({ words: [{ word: 'tímido', pos: 'adj' }] })
  })

  it('leaves pos out for Other (code custom) and when there is none, as the Flutter app does', async () => {
    for (const pos of ['custom', null]) {
      const d = deps(async () => reply(200, { words: [entry] }))
      await enrichWord({ word: 'tímido', pos }, d)
      expect(JSON.parse(d.calls[0].init.body as string)).toEqual({ words: [{ word: 'tímido' }] })
    }
  })

  it('tolerates a trailing slash on the proxy address', async () => {
    const d = deps(async () => reply(200, { words: [entry] }), { proxyUrl: `${PROXY}//` })
    await enrichWord({ word: 'tímido', pos: null }, d)
    expect(d.calls[0].url).toBe(`${PROXY}/enrich`)
  })
})

describe('a good answer', () => {
  it('gives the translations, the example and its translations, and the Rioplatense form', async () => {
    const d = deps(async () => reply(200, { words: [{ ...entry, es_rioplatense: ' chiquito ', is_rioplatense_variant: true }] }))
    expect(await enrichWord({ word: 'tímido', pos: 'adj' }, d)).toEqual({
      ok: true,
      value: {
        enTranslation: 'shy',
        ruTranslation: 'застенчивый',
        exampleSentence: 'Es muy tímido.',
        exampleTranslationEn: 'He is very shy.',
        exampleTranslationRu: 'Он очень застенчив.',
        esRioplatense: 'chiquito',
        isRioplatenseVariant: true,
        region: null,
        register: 'neutral',
        esStandard: null,
      },
    })
  })

  it('reads the marks: region, register and the standard equivalent', async () => {
    const answer = { ...entry, word: 'zapallito', is_rioplatense_variant: true, es_standard: ' calabacín ', region: 'uy', register: 'informal' }
    const result = await enrichWord({ word: 'zapallito', pos: 'n' }, deps(async () => reply(200, { words: [answer] })))
    expect(result.ok && result.value).toMatchObject({ isRioplatenseVariant: true, esStandard: 'calabacín', region: 'uy', register: 'informal' })
  })

  it('an answer from an older proxy (no marks), or with values outside the allowed ones, gives none', async () => {
    const old = { ...entry }
    delete (old as Partial<typeof entry>).es_standard
    delete (old as Partial<typeof entry>).region
    delete (old as Partial<typeof entry>).register
    const oldResult = await enrichWord({ word: 'tímido', pos: null }, deps(async () => reply(200, { words: [old] })))
    expect(oldResult.ok && oldResult.value).toMatchObject({ region: null, register: null, esStandard: null })
    const bad = await enrichWord({ word: 'tímido', pos: null }, deps(async () => reply(200, { words: [{ ...entry, region: 'br', register: 'rude', es_standard: '  ' }] })))
    expect(bad.ok && bad.value).toMatchObject({ region: null, register: null, esStandard: null })
  })

  it('ignores word_form_in_example: it has no column and is not synced', async () => {
    const result = await enrichWord({ word: 'tímido', pos: 'adj' }, deps(async () => reply(200, { words: [entry] })))
    expect(result.ok && Object.keys(result.value)).not.toContain('wordFormInExample')
    expect(JSON.stringify(result)).not.toContain('word_form')
  })

  it('finds the word among several by its lowercased form, and accepts the other shapes the proxy has used', async () => {
    const other = { ...entry, word: 'otro', en_translation: 'other' }
    for (const body of [{ words: [other, { ...entry, word: 'TÍMIDO' }] }, [other, entry], { results: [entry] }, { items: [entry] }]) {
      const result = await enrichWord({ word: ' Tímido ', pos: null }, deps(async () => reply(200, body)))
      expect(result.ok && result.value.enTranslation).toBe('shy')
    }
  })

  it('an answer with nothing for this word is its own case', async () => {
    expect(await failureOf(deps(async () => reply(200, { words: [{ ...entry, word: 'otro' }] })))).toEqual({ kind: 'no-result' })
    expect(await failureOf(deps(async () => reply(200, { words: [] })))).toEqual({ kind: 'no-result' })
    expect(await failureOf(deps(async () => reply(200, 'not json at all')))).toEqual({ kind: 'no-result' })
  })
})

describe('the spelling check (is_real_word and suggested_spelling)', () => {
  const champeones = { ...entry, word: 'champeones', en_translation: 'champions', ru_translation: 'чемпионы', example_sentence: 'Los campeones ganaron.', is_real_word: false, suggested_spelling: 'campeones' }
  const ask = (answer: Record<string, unknown>, word = 'champeones') => enrichWord({ word, pos: 'n' }, deps(async () => reply(200, { words: [answer] })))

  it('a word the proxy says is not real comes with its likely spelling; the fields are what the proxy answered', async () => {
    const result = await ask(champeones)
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ enTranslation: 'champions', ruTranslation: 'чемпионы', exampleSentence: 'Los campeones ganaron.' }),
      notRecognised: { suggestion: 'campeones' },
    })
  })

  it('not real with no usable suggestion: recognised as not real, nothing to offer', async () => {
    for (const bad of [null, undefined, '', '   ', 5, ['campeones'], 'dos palabras', 'champeones', 'CHAMPEONES', ' champeones ']) {
      const result = await ask({ ...champeones, suggested_spelling: bad })
      expect(result.ok && result.notRecognised, JSON.stringify(bad)).toEqual({ suggestion: null })
    }
    const missing = { ...champeones }
    delete (missing as Partial<typeof champeones>).suggested_spelling
    const noSuggestion = await ask(missing)
    expect(noSuggestion.ok && noSuggestion.notRecognised).toEqual({ suggestion: null }) // a missing suggestion is a null one
  })

  it('the suggestion is trimmed', async () => {
    const result = await ask({ ...champeones, suggested_spelling: '  campeones \n' })
    expect(result.ok && result.notRecognised).toEqual({ suggestion: 'campeones' })
  })

  it('a real word has nothing extra, whatever came with it: the result is exactly what it was', async () => {
    const real = await ask({ ...entry, word: 'tímido', is_real_word: true, suggested_spelling: 'tímida' }, 'tímido')
    expect(real.ok && 'notRecognised' in real).toBe(false)
    expect(Object.keys(real)).toEqual(['ok', 'value'])
  })

  it('an older proxy that sends neither field behaves as before', async () => {
    const result = await ask(entry, 'tímido')
    expect(Object.keys(result)).toEqual(['ok', 'value'])
    expect(result.ok && result.value.enTranslation).toBe('shy')
  })

  it('only an explicit false counts: a string, a number, null, or a missing flag is a real word', async () => {
    for (const unclear of ['false', 'no', 0, null, undefined, [], {}]) {
      const result = await ask({ ...champeones, is_real_word: unclear })
      expect(Object.keys(result), JSON.stringify(unclear)).toEqual(['ok', 'value'])
    }
  })

  it('the new fields do not leak into the values the form fills in', async () => {
    const result = await ask(champeones)
    expect(result.ok && Object.keys(result.value)).not.toContain('isRealWord')
    expect(result.ok && Object.keys(result.value)).not.toContain('suggestedSpelling')
  })
})

describe('every failure is a value with its own message, and the form stays usable', () => {
  it('offline fails at once: no request is made, no timeout is waited for', async () => {
    const d = deps(async () => reply(200, {}), { isOffline: () => true, timeoutMs: 60_000 })
    const started = Date.now()
    expect(await failureOf(d)).toEqual({ kind: 'offline' })
    expect(Date.now() - started).toBeLessThan(500)
    expect(d.calls).toHaveLength(0)
  })

  it('401, and no session at all (nothing is sent without a token)', async () => {
    expect(await failureOf(deps(async () => reply(401, { error: 'Invalid or expired token' })))).toEqual({ kind: 'unauthorized' })
    const none = deps(async () => reply(200, {}), { getAccessToken: async () => null })
    expect(await failureOf(none)).toEqual({ kind: 'unauthorized' })
    expect(none.calls).toHaveLength(0)
  })

  describe('a 401 signs in again once and asks again once', () => {
    /** A proxy that refuses the first `refusals` requests with 401 and then answers; tokens change with every sign-in. */
    function proxy(refusals: number, recover: EnrichDeps['recoverSession']) {
      let n = 0
      let token = 'old-token'
      const seen: string[] = []
      const d = deps(
        async (_url, init) => {
          seen.push(String(((init?.headers ?? {}) as Record<string, string>).Authorization))
          return n++ < refusals ? reply(401, { error: 'Invalid or expired token' }) : reply(200, { words: [entry] })
        },
        {
          getAccessToken: async () => token,
          recoverSession: async () => {
            const result = await recover!()
            if (result === true) token = 'new-token'
            return result
          },
        },
      )
      return { d, seen }
    }

    it('401, a successful sign-in, then the second request goes through with the new token', async () => {
      let recovered = 0
      const { d, seen } = proxy(1, async () => (recovered++, true))
      const result = await enrichWord({ word: 'tímido', pos: 'adj' }, d)
      expect(result.ok).toBe(true)
      expect(recovered).toBe(1)
      expect(seen).toEqual(['Bearer old-token', 'Bearer new-token'])
    })

    it('401 twice: one sign-in and two requests, then the message. Never a loop', async () => {
      let recovered = 0
      const { d } = proxy(99, async () => (recovered++, true))
      expect(await failureOf(d)).toEqual({ kind: 'unauthorized' })
      expect(recovered).toBe(1)
      expect(d.calls).toHaveLength(2)
    })

    it('a refused sign-in ends it at once: no second request', async () => {
      const { d } = proxy(99, async () => false)
      expect(await failureOf(d)).toEqual({ kind: 'unauthorized' })
      expect(d.calls).toHaveLength(1)
    })

    it('a sign-in that cannot be reached is a network failure, not a refusal', async () => {
      const { d } = proxy(99, async () => 'unreachable')
      expect(await failureOf(d)).toEqual({ kind: 'network' })
      expect(d.calls).toHaveLength(1)
    })

    it('no session at all is recovered the same way (nothing is sent before there is a token)', async () => {
      let token: string | null = null
      const d = deps(async () => reply(200, { words: [entry] }), {
        getAccessToken: async () => token,
        recoverSession: async () => {
          token = 'fresh'
          return true
        },
      })
      expect((await enrichWord({ word: 'tímido', pos: null }, d)).ok).toBe(true)
      expect(d.calls).toHaveLength(1)
      expect(d.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer fresh' })
    })

    it('without a way to sign in the 401 is just reported, and no other status triggers a sign-in', async () => {
      let recovered = 0
      for (const status of [429, 500, 503]) {
        const d = deps(async () => reply(status, {}), { recoverSession: async () => (recovered++, true) })
        await enrichWord({ word: 'tímido', pos: null }, d)
      }
      expect(recovered).toBe(0)
    })

    it('the app hands it the same sign-in the write queue uses', async () => {
      const { readFileSync } = await import('node:fs')
      expect(readFileSync('src/App.tsx', 'utf8')).toMatch(/enrichDepsFor\(client, recoverSession\)/)
    })
  })

  it('429 with usage and limit is the daily word quota, with the numbers the proxy sent: the app knows no limit of its own (ten today, whatever it is tomorrow)', async () => {
    const failure = await failureOf(deps(async () => reply(429, { error: 'Daily limit reached (10 words/day). Try again tomorrow.', code: 'daily_limit', usage: 10, limit: 10, resets_at: '2026-10-19T00:00:00.000Z' })))
    expect(failure).toEqual({ kind: 'daily-quota', usage: 10, limit: 10 })
    expect(enrichFailureMessage(failure)).toBe("You've used 10 of 10 automatic translations today. Type it yourself, or try again tomorrow.")
    // and any other number is said as it came
    const other = await failureOf(deps(async () => reply(429, { usage: 25, limit: 25 })))
    expect(enrichFailureMessage(other)).toContain('25 of 25')
    setLanguage('ru')
    try {
      expect(enrichFailureMessage(failure)).toBe('Сегодня использовано 10 из 10 автоматических переводов. Введите перевод сами или попробуйте завтра.')
    } finally {
      setLanguage('en')
    }
  })

  it('the app\'s source has no daily limit in it: the number is read from the answer', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/data/enrich.ts', 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(source).not.toMatch(/\b(100|10)\b.*(words|слов)/)
    expect(source).toMatch(/usage: body\.usage, limit: body\.limit/)
  })

  it('429 without them is the per-minute limit', async () => {
    expect(await failureOf(deps(async () => reply(429, { error: 'Too many requests. Limit is 10 requests per minute.' })))).toEqual({ kind: 'rate-limit' })
    expect(await failureOf(deps(async () => new Response('too many', { status: 429 })))).toEqual({ kind: 'rate-limit' })
  })

  it('503 with code capacity is the service\'s own daily cap, with the moment it starts again', async () => {
    const failure = await failureOf(deps(async () => reply(503, { error: 'Service temporarily at capacity. Please try again later.', code: 'capacity', resets_at: '2026-10-19T00:00:00.000Z' })))
    expect(failure).toEqual({ kind: 'capacity', resetsAt: Date.parse('2026-10-19T00:00:00.000Z') })
    // a missing or unreadable time is not an error: the client works it out from the UTC day
    expect(await failureOf(deps(async () => reply(503, { code: 'capacity' })))).toEqual({ kind: 'capacity', resetsAt: null })
    expect(await failureOf(deps(async () => reply(503, { code: 'capacity', resets_at: 'tomorrow-ish' })))).toEqual({ kind: 'capacity', resetsAt: null })
  })

  it('503 with code upstream_unavailable is the translation provider being out for now: not our cap, and not a minute\'s wait', async () => {
    expect(await failureOf(deps(async () => reply(503, { error: 'Automatic translation is unavailable for now.', code: 'upstream_unavailable' })))).toEqual({ kind: 'unavailable' })
  })

  it('any other 503 (the provider overloaded, an older proxy) is the service being busy, with no hours promised', async () => {
    expect(await failureOf(deps(async () => reply(503, { error: 'Upstream translation service is unavailable.', code: 'upstream_error' })))).toEqual({ kind: 'busy' })
    expect(await failureOf(deps(async () => reply(503, { error: 'Service temporarily at capacity.' })))).toEqual({ kind: 'busy' })
    expect(await failureOf(deps(async () => new Response('down', { status: 503 })))).toEqual({ kind: 'busy' })
  })

  it('anything else carries its status', async () => {
    expect(await failureOf(deps(async () => reply(500, { error: 'Internal server error.' })))).toEqual({ kind: 'other', status: 500 })
    expect(await failureOf(deps(async () => reply(502, { error: 'Upstream returned an unexpected format.' })))).toEqual({ kind: 'other', status: 502 })
    expect(await failureOf(deps(async () => reply(400, { error: 'Field "word" must be 50 characters or fewer.' })))).toEqual({ kind: 'other', status: 400 })
  })

  it('a request that cannot be made at all is a network failure', async () => {
    expect(await failureOf(deps(async () => Promise.reject(new TypeError('Failed to fetch'))))).toEqual({ kind: 'network' })
  })

  it('a request that never answers ends at the timeout, and is aborted', async () => {
    let signal: AbortSignal | null | undefined
    const d = deps(
      (_url, init) => {
        signal = init?.signal
        return new Promise<Response>(() => {}) // never answers
      },
      { timeoutMs: 30 },
    )
    const started = Date.now()
    expect(await failureOf(d)).toEqual({ kind: 'timeout' })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(signal?.aborted).toBe(true)
  })

  it('a body that never finishes arriving also ends at the timeout', async () => {
    const d = deps(async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) }) as unknown as Response, { timeoutMs: 30 })
    expect(await failureOf(d)).toEqual({ kind: 'timeout' })
  })

  it('has a different message for each kind, none of them empty', () => {
    const failures: EnrichFailure[] = [
      { kind: 'offline' },
      { kind: 'unauthorized' },
      { kind: 'daily-quota', usage: 9, limit: 10 },
      { kind: 'rate-limit' },
      { kind: 'capacity', resetsAt: Date.parse('2026-10-19T00:00:00Z') },
      { kind: 'unavailable' },
      { kind: 'busy' },
      { kind: 'timeout' },
      { kind: 'network' },
      { kind: 'no-result' },
      { kind: 'other', status: 500 },
    ]
    const messages = failures.map((f) => enrichFailureMessage(f, new Date('2026-10-18T19:30:00Z')))
    expect(new Set(messages).size).toBe(failures.length)
    for (const m of messages) expect(m.length).toBeGreaterThan(10)
    expect(enrichFailureMessage({ kind: 'daily-quota', usage: 9, limit: 10 })).toContain('9 of 10')
    // No raw status code in front of a person, and no "try again" where the form has nothing to press for it (only waiting out a limit does).
    expect(enrichFailureMessage({ kind: 'other', status: 500 })).not.toMatch(/\d/)
    for (const failure of [{ kind: 'timeout' }, { kind: 'network' }, { kind: 'other', status: 500 }] as EnrichFailure[]) expect(enrichFailureMessage(failure).toLowerCase()).not.toContain('try again')
  })

  it('in Russian: the same rule, and still a message each', () => {
    setLanguage('ru')
    try {
      const failures: EnrichFailure[] = [{ kind: 'timeout' }, { kind: 'network' }, { kind: 'other', status: 500 }, { kind: 'no-result' }]
      const messages = failures.map((f) => enrichFailureMessage(f))
      expect(new Set(messages).size).toBe(failures.length)
      for (const m of messages) {
        expect(m).not.toMatch(/\d/)
        expect(m).not.toContain('ещё раз')
      }
    } finally {
      setLanguage('en')
    }
  })
})

describe('what the person is told when a limit is reached', () => {
  const at = (iso: string) => new Date(iso)
  const reset = Date.parse('2026-10-19T00:00:00Z')

  it('the service\'s cap says roughly how many hours are left, computed from the reset, in English and in Russian, with the right plural', () => {
    const cases: [string, string, string][] = [
      ['2026-10-18T19:30:00Z', 'about 5 hours', 'примерно через 5 часов'], // 4.5 rounds to 5
      ['2026-10-18T22:00:00Z', 'about 2 hours', 'примерно через 2 часа'],
      ['2026-10-18T22:40:00Z', 'about 1 hour', 'примерно через 1 час'],
      ['2026-10-18T03:00:00Z', 'about 21 hours', 'примерно через 21 час'],
      ['2026-10-18T00:30:00Z', 'about 24 hours', 'примерно через 24 часа'],
      ['2026-10-18T23:40:00Z', 'less than an hour', 'меньше чем через час'],
    ]
    for (const [now, english, russian] of cases) {
      const failure: EnrichFailure = { kind: 'capacity', resetsAt: reset }
      expect(enrichFailureMessage(failure, at(now)), now).toContain(english)
      setLanguage('ru')
      try {
        expect(enrichFailureMessage(failure, at(now)), now).toContain(russian)
      } finally {
        setLanguage('en')
      }
    }
  })

  it('the whole sentence: used up for today, when it comes back, what to do', () => {
    expect(enrichFailureMessage({ kind: 'capacity', resetsAt: reset }, at('2026-10-18T19:30:00Z'))).toBe('Automatic translation is used up for today. It comes back in about 5 hours. Type it yourself, or try again then.')
    setLanguage('ru')
    try {
      expect(enrichFailureMessage({ kind: 'capacity', resetsAt: reset }, at('2026-10-18T19:30:00Z'))).toBe('Автоматический перевод на сегодня исчерпан. Он вернётся примерно через 5 часов. Введите перевод сами или попробуйте позже.')
    } finally {
      setLanguage('en')
    }
  })

  it('it never says "evening" or "tomorrow" or a clock time, because people are in different time zones', () => {
    for (const now of ['2026-10-18T01:00:00Z', '2026-10-18T12:00:00Z', '2026-10-18T23:50:00Z']) {
      for (const language of ['en', 'ru'] as const) {
        setLanguage(language)
        try {
          expect(enrichFailureMessage({ kind: 'capacity', resetsAt: reset }, at(now))).not.toMatch(/evening|tonight|tomorrow|midnight|UTC|\d\d:\d\d|вечер|завтра|полночь/i)
        } finally {
          setLanguage('en')
        }
      }
    }
  })

  it('without a time from the proxy the hours come from the next 00:00 UTC; a time already past reads as less than an hour', () => {
    expect(hoursUntilReset(null, at('2026-10-18T19:30:00Z'))).toBe(5)
    expect(hoursUntilReset(reset, at('2026-10-19T00:10:00Z'))).toBe(0)
    expect(enrichFailureMessage({ kind: 'capacity', resetsAt: null }, at('2026-10-18T19:30:00Z'))).toContain('about 5 hours')
    expect(enrichFailureMessage({ kind: 'capacity', resetsAt: reset }, at('2026-10-19T00:10:00Z'))).toContain('less than an hour')
  })

  it('the provider being out says automatic translation is unavailable for now, and not "wait a minute"', () => {
    expect(enrichFailureMessage({ kind: 'unavailable' })).toBe('Automatic translation is unavailable for now. Type the translation yourself.')
    expect(enrichFailureMessage({ kind: 'unavailable' })).not.toMatch(/minute|too many/i)
    setLanguage('ru')
    try {
      expect(enrichFailureMessage({ kind: 'unavailable' })).toBe('Автоматический перевод сейчас недоступен. Введите перевод сами.')
      expect(enrichFailureMessage({ kind: 'unavailable' })).not.toMatch(/минут/i)
    } finally {
      setLanguage('en')
    }
  })

  it('the per-minute message still says a minute, and only that one does', () => {
    expect(enrichFailureMessage({ kind: 'rate-limit' })).toMatch(/minute/)
    for (const failure of [{ kind: 'busy' }, { kind: 'unavailable' }, { kind: 'capacity', resetsAt: reset }] as EnrichFailure[]) expect(enrichFailureMessage(failure, at('2026-10-18T19:30:00Z'))).not.toMatch(/a minute|too many/i)
  })

  it('only a failure that asking again could cure offers a retry: not a used-up day, a used-up cap, or a provider that is out', () => {
    for (const failure of [{ kind: 'offline' }, { kind: 'unauthorized' }, { kind: 'rate-limit' }, { kind: 'busy' }, { kind: 'timeout' }, { kind: 'network' }, { kind: 'no-result' }, { kind: 'other', status: 500 }] as EnrichFailure[]) expect(isRetryable(failure), failure.kind).toBe(true)
    for (const failure of [{ kind: 'daily-quota', usage: 10, limit: 10 }, { kind: 'capacity', resetsAt: null }, { kind: 'unavailable' }] as EnrichFailure[]) expect(isRetryable(failure), failure.kind).toBe(false)
  })
})
