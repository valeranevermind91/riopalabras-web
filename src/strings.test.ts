import { readFileSync, readdirSync, statSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveLanguage, getLanguage, languageFromCode, languagePatch, parseUiLanguage, setLanguage, telegramLanguage, type UiLanguage } from './lib/language'
import { en, plural, strings } from './strings'
import { ru } from './strings.ru'

afterEach(() => {
  setLanguage('en')
  vi.unstubAllGlobals()
})

/** Every path in a map, one per leaf: objects by key, arrays by index (and length), a function as a leaf with its arity. */
function shape(node: unknown, path = ''): string[] {
  if (typeof node === 'function') return [`${path} ()${node.length}`]
  if (Array.isArray(node)) return [`${path}[] ${node.length}`, ...node.flatMap((item, i) => shape(item, `${path}[${i}]`))]
  if (node !== null && typeof node === 'object') return Object.keys(node).sort().flatMap((key) => shape((node as Record<string, unknown>)[key], path ? `${path}.${key}` : key))
  return [`${path} ${node === null ? 'null' : typeof node}`]
}

describe('the two maps', () => {
  it('have exactly the same keys, in both directions', () => {
    const inEn = new Set(shape(en).map((s) => s.replace(/ (string|null|object)$/, '').replace(/ \(\)\d+$/, '')))
    const inRu = new Set(shape(ru).map((s) => s.replace(/ (string|null|object)$/, '').replace(/ \(\)\d+$/, '')))
    const missingInRu = [...inEn].filter((k) => !inRu.has(k))
    const missingInEn = [...inRu].filter((k) => !inEn.has(k))
    expect(missingInRu, 'in en but not in ru').toEqual([])
    expect(missingInEn, 'in ru but not in en').toEqual([])
  })

  it('agree on what each entry is: the same kind of value, the same function arity, the same list length', () => {
    const kinds = (map: unknown) => Object.fromEntries(shape(map).map((s) => [s.replace(/ (string|null|object|\(\)\d+|\d+)$/, '').replace(/ \(\)\d+$/, ''), s.match(/ (\(\)\d+|\d+)$/)?.[1] ?? '']))
    const a = kinds(en)
    const b = kinds(ru)
    for (const key of Object.keys(a)) expect(b[key], key).toBe(a[key]) // arity of functions, length of arrays
  })

  it('a missing key would be caught: the check is real', () => {
    const broken = JSON.parse(JSON.stringify(en)) as Record<string, Record<string, unknown>>
    delete broken.settings.title
    expect(shape(broken).some((s) => s.startsWith('settings.title'))).toBe(false)
    expect(shape(en).some((s) => s.startsWith('settings.title'))).toBe(true)
  })

  it('every entry that is text is non-empty in Russian, and every function returns text', () => {
    const empty: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string' && node.trim() === '') empty.push(path)
      else if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`))
      else if (node && typeof node === 'object' && typeof node !== 'function') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
    }
    walk(ru, 'ru')
    expect(empty).toEqual([])
  })

  it('the groups that are the same in both languages are the very same objects (Debug stays English)', () => {
    expect(ru.debug).toBe(en.debug)
    expect(ru.card).toBe(en.card)
    expect(ru.wordContent).toBe(en.wordContent)
    expect(ru.appTitle).toBe(en.appTitle)
  })

  it('a Russian string is Russian: no English words are left in the interface, except the names of the app\'s own screens and Spanish examples', () => {
    const allowed = new Set(['Learn', 'Review', 'Matching', 'Cloze', 'Words', 'Riopalabras', 'Debug', 'English', 'Telegram', 'calabacín', 'zapallito', 'palabra', 'del', 'día', 'aprender', 'repasar', 'parejas', 'completar', 'calle', 'yo', 'vos', 'tenés', 'tú', 'tienes'])
    const leftovers: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        for (const word of node.match(/\p{Script=Latin}{3,}/gu) ?? []) if (!allowed.has(word)) leftovers.push(`${path}: ${word}`)
      } else if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`))
      else if (node && typeof node === 'object') {
        // ids and tones are keys for the code, and `es` pieces are the Spanish words in a sentence: neither is interface text
        for (const [k, v] of Object.entries(node)) if (!['id', 'tone', 'es'].includes(k) && (!['debug', 'wordContent', 'card'].includes(k) || path !== 'ru')) walk(v, `${path}.${k}`)
      }
    }
    walk(ru, 'ru')
    // functions: call them with sample arguments and look at what comes out
    const calls: [string, () => string][] = [
      ['loadFailed', () => ru.common.loadFailed('x')],
      ['degraded', () => ru.home.degraded(['a', 'b'])],
      ['streak', () => ru.home.streak(5)],
      ['queuedAt', () => ru.words.queuedAt(3)],
      ['queueFull', () => ru.words.queueFull(50)],
      ['dailyQuota', () => ru.words.enrich.dailyQuota(99, 100)],
      ['other', () => ru.words.enrich.other(500)],
      ['practice.wrong', () => ru.practice.wrong('x')],
      ['duplicate', () => ru.words.form.duplicate('a', 'b', 'overlay')],
      ['spelling', () => [ru.words.form.spelling.didYouMean('a'), ru.words.form.spelling.notRecognised('a'), ru.words.form.spelling.notRecognisedSave('a'), ru.words.form.spelling.use('a'), ru.words.form.spelling.keep('a')].join(' ')],
      ['interval', () => `${ru.interval.minutes(10)} ${ru.interval.days(3)} ${ru.interval.months(2)} ${ru.interval.years(1)}`],
    ]
    setLanguage('ru')
    for (const [name, call] of calls) for (const word of call().match(/\p{Script=Latin}{3,}/gu) ?? []) if (!allowed.has(word)) leftovers.push(`${name}(): ${word}`)
    expect(leftovers).toEqual([])
  })
})

describe('strings reads the current language at the moment it is used', () => {
  it('switches every kind of value: text, functions, nested groups, lists', () => {
    expect(strings.settings.title).toBe('Settings')
    expect(strings.words.sheet.close).toBe('Close')
    expect(strings.home.streak(3)).toBe('3-day streak')
    expect(strings.home.weekdays.join('')).toBe('MTWTFSS')
    expect(strings.onboarding.inside.items.map((i) => i.id)).toEqual(['learn', 'review', 'practice', 'words'])
    setLanguage('ru')
    expect(strings.settings.title).toBe('Настройки')
    expect(strings.words.sheet.close).toBe('Закрыть')
    expect(strings.home.streak(3)).toBe('3 дня подряд')
    expect(strings.home.weekdays.join('')).toBe('ПВСЧПСВ')
    expect(strings.onboarding.inside.items[2].name).toBe('Matching и Cloze')
  })

  it('a group captured at the top of a file follows the language too (the files do this: `const t = strings.words`)', () => {
    const t = strings.words
    const sheet = strings.words.sheet
    expect(t.title).toBe('Words')
    expect(sheet.filtersTitle).toBe('Filters')
    setLanguage('ru')
    expect(t.filtersButton).toBe('Фильтры')
    expect(sheet.filtersTitle).toBe('Фильтры')
    setLanguage('en')
    expect(t.filtersButton).toBe('Filters')
  })

  it('the same keys come out: listing a group lists the same entries in both languages', () => {
    const keys = () => Object.keys(strings.words).sort()
    const inEn = keys()
    setLanguage('ru')
    expect(keys()).toEqual(inEn)
  })

  it('word content does not follow the interface language: the Cloze nudge and the EN / RU labels are picked by the translation flags', () => {
    setLanguage('ru')
    expect(strings.wordContent.en.inSentence('x')).toBe('in this sentence: x')
    expect(strings.wordContent.ru.inSentence('x')).toBe('в этом предложении: x')
    expect(strings.card).toEqual({ en: 'EN', ru: 'RU' })
  })

  it('Debug stays English in a Russian interface', () => {
    setLanguage('ru')
    expect(strings.debug.title).toBe('Debug')
    expect(strings.debug.signedInAs('Ana')).toBe('Signed in as Ana')
  })

  it('the names of the app\'s own screens stay in Latin in Russian', () => {
    setLanguage('ru')
    expect([strings.home.tiles.learn.label, strings.home.tiles.review.label, strings.home.tiles.matching.label, strings.home.tiles.cloze.label, strings.words.title]).toEqual(['Learn', 'Review', 'Matching', 'Cloze', 'Words'])
  })

  it('the language names are each in their own language, in both', () => {
    expect(strings.settings.uiLanguageNames).toEqual({ en: 'English', ru: 'Русский' })
    setLanguage('ru')
    expect(strings.settings.uiLanguageNames).toEqual({ en: 'English', ru: 'Русский' })
  })
})

describe('plurals: English has two forms, Russian three', () => {
  const ruWords = (n: number) => {
    setLanguage('ru')
    return strings.words.count(n)
  }

  it('Russian: 1 слово, 2 слова, 5 слов, 21 слово', () => {
    expect([1, 2, 5, 21].map(ruWords)).toEqual(['1 слово', '2 слова', '5 слов', '21 слово'])
  })

  it('Russian: the teens are "слов", and 22 to 24 are "слова", and 0 and 100 are "слов", 101 is "слово"', () => {
    expect([0, 11, 12, 13, 14, 22, 24, 25, 100, 101, 111].map(ruWords)).toEqual(['0 слов', '11 слов', '12 слов', '13 слов', '14 слов', '22 слова', '24 слова', '25 слов', '100 слов', '101 слово', '111 слов'])
  })

  it('English: 1 word, anything else words', () => {
    expect([0, 1, 2, 5, 21].map((n) => strings.words.count(n))).toEqual(['0 words', '1 word', '2 words', '5 words', '21 words'])
  })

  it('every string with a count in it uses the right form, in both languages', () => {
    expect([1, 2, 5, 21].map((n) => strings.words.filtersActive(n))).toEqual(['1 filter on', '2 filters on', '5 filters on', '21 filters on'])
    setLanguage('ru')
    expect([1, 2, 5, 21].map((n) => strings.home.streak(n))).toEqual(['1 день подряд', '2 дня подряд', '5 дней подряд', '21 день подряд'])
    expect([1, 2, 5, 21].map((n) => strings.words.queueFull(n))).toEqual([
      'Очередь заполнена (1 слово). Уберите одно слово, чтобы добавить другое.',
      'Очередь заполнена (2 слова). Уберите одно слово, чтобы добавить другое.',
      'Очередь заполнена (5 слов). Уберите одно слово, чтобы добавить другое.',
      'Очередь заполнена (21 слово). Уберите одно слово, чтобы добавить другое.',
    ])
    expect(strings.words.addedNotQueued(50)).toContain('(50 слов)')
    expect(strings.words.enrich.dailyQuota(99, 100)).toContain('из 100 автоматических переводов')
    expect(strings.words.enrich.dailyQuota(1, 21)).toContain('из 21 автоматического перевода')
    expect(strings.words.enrich.dailyQuota(1, 3)).toContain('из 3 автоматических переводов')
  })

  it('plural() falls back to "other", then "many", then "one" when a language lacks a form', () => {
    expect(plural(2, { one: 'a', other: 'b' })).toBe('b')
    expect(plural(5, { one: 'a', many: 'c' })).toBe('c') // English wants "other": missing, so "many"
    expect(plural(5, { one: 'a' })).toBe('a') // and with no "many" either, "one"
    setLanguage('ru')
    expect(plural(5, { one: 'a', other: 'b' })).toBe('b') // Russian "many" missing → other
    expect(plural(5, { one: 'a' })).toBe('a')
  })

  it('no string writes "слов(о)" or an English "(s)"', () => {
    expect(JSON.stringify(ru)).not.toMatch(/\(о\)|\(а\)|\(ов\)/)
    expect(JSON.stringify(en)).not.toMatch(/word\(s\)|\(s\)/)
  })
})

describe('the interface language setting', () => {
  it('follows Telegram\'s language when nothing is chosen: ru for anything starting with "ru", else en', () => {
    for (const code of ['ru', 'RU', 'ru-RU', 'ru_UA', 'Ru']) expect(languageFromCode(code), code).toBe('ru')
    for (const code of ['en', 'es', 'uk', 'be', 'pt-BR', 'rn', 'r', '', undefined, null]) expect(languageFromCode(code), String(code)).toBe('en')
  })

  it('is read from the Telegram WebApp object', () => {
    vi.stubGlobal('window', { Telegram: { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1, first_name: 'A', language_code: 'ru' } } } } })
    expect(telegramLanguage()).toBe('ru')
    vi.stubGlobal('window', { Telegram: { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1, first_name: 'A', language_code: 'es' } } } } })
    expect(telegramLanguage()).toBe('en')
    vi.stubGlobal('window', { Telegram: { WebApp: { initData: 'x', initDataUnsafe: {} } } })
    expect(telegramLanguage()).toBe('en') // no user, no language
  })

  it('a stored choice wins over Telegram; with none stored, Telegram\'s decides', () => {
    vi.stubGlobal('window', { Telegram: { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1, first_name: 'A', language_code: 'ru' } } } } })
    expect(effectiveLanguage(null)).toBe('ru')
    expect(effectiveLanguage('en')).toBe('en')
    expect(effectiveLanguage('ru')).toBe('ru')
  })

  it('the setting is ui_language, "en" or "ru", and nothing else is accepted', () => {
    expect(languagePatch('ru')).toEqual({ ui_language: 'ru' })
    expect(languagePatch('en')).toEqual({ ui_language: 'en' })
    for (const bad of ['EN', 'es', '', null, undefined, 1, {}]) expect(parseUiLanguage(bad)).toBeNull()
    expect(parseUiLanguage('en')).toBe('en')
    expect(parseUiLanguage('ru')).toBe('ru')
  })

  it('setting the language changes it, once, and tells whoever listens', async () => {
    const { subscribeLanguage } = await import('./lib/language')
    let notified = 0
    const off = subscribeLanguage(() => notified++)
    setLanguage('ru')
    setLanguage('ru') // no change: no news
    setLanguage('en')
    off()
    setLanguage('ru')
    expect(notified).toBe(2)
    expect(getLanguage()).toBe('ru')
  })

  it('Telegram\'s language is read for this default and for nothing else: it is not used for identity or sign-in', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(path)
      }
    }
    walk('src')
    const users = files.filter((f) => /language_code/.test(readFileSync(f, 'utf8'))).sort()
    expect(users).toEqual(['src/lib/language.ts', 'src/lib/telegram.ts']) // the type that names it, and the one place that reads it
  })
})

describe('the language of the page', () => {
  it('is a UiLanguage', () => {
    const languages: UiLanguage[] = ['en', 'ru']
    expect(languages).toContain(getLanguage())
  })
})
