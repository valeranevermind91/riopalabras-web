import { describe, expect, it } from 'vitest'
import { enrichFailureMessage, enrichWord, type EnrichDeps, type EnrichFailure } from './enrich'

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

  it('429 with usage and limit is the daily word quota, with the numbers', async () => {
    const failure = await failureOf(deps(async () => reply(429, { error: 'Daily limit reached (100 words/day). Try again tomorrow.', usage: 100, limit: 100 })))
    expect(failure).toEqual({ kind: 'daily-quota', usage: 100, limit: 100 })
    expect(enrichFailureMessage(failure)).toContain('100 of 100')
  })

  it('429 without them is the per-minute limit', async () => {
    expect(await failureOf(deps(async () => reply(429, { error: 'Too many requests. Limit is 10 requests per minute.' })))).toEqual({ kind: 'rate-limit' })
    expect(await failureOf(deps(async () => new Response('too many', { status: 429 })))).toEqual({ kind: 'rate-limit' })
  })

  it('503 is the service being busy', async () => {
    expect(await failureOf(deps(async () => reply(503, { error: 'Service temporarily at capacity.' })))).toEqual({ kind: 'busy' })
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
      { kind: 'daily-quota', usage: 99, limit: 100 },
      { kind: 'rate-limit' },
      { kind: 'busy' },
      { kind: 'timeout' },
      { kind: 'network' },
      { kind: 'no-result' },
      { kind: 'other', status: 500 },
    ]
    const messages = failures.map(enrichFailureMessage)
    expect(new Set(messages).size).toBe(failures.length)
    for (const m of messages) expect(m.length).toBeGreaterThan(10)
    expect(enrichFailureMessage({ kind: 'daily-quota', usage: 99, limit: 100 })).toContain('99 of 100')
    expect(enrichFailureMessage({ kind: 'other', status: 500 })).toContain('500')
  })
})
