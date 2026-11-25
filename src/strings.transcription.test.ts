import { describe, expect, it } from 'vitest'
import { transcriptionText } from './data/transcription'
import { WHATS_NEW } from './data/whatsNew'
import { en } from './strings'
import { ru } from './strings.ru'

// The words of the Cyrillic transcription (data/transcription.ts). The Russian is the owner's where he wrote it; the rest is drafted for him to proofread.

describe('the Settings switch', () => {
  it('says, in Russian, what the owner wrote', () => {
    expect(ru.settings.transcription).toBe('Транскрипция кириллицей')
    expect(ru.settings.transcriptionHint).toBe('Произношение примерное — ориентир для начинающих. По-риоплатски ll и y звучат как «ш».')
  })

  it('has English too, drafted to match', () => {
    expect(en.settings.transcription).toBe('Cyrillic transcription')
    expect(en.settings.transcriptionHint).toBe('The pronunciation is approximate, a guide for beginners. In Rioplatense, ll and y sound like “sh”.')
  })
})

describe('How it works', () => {
  const learn = (map: { howItWorks: { sections: readonly { id: string; text: string }[] } }) => map.howItWorks.sections.find((s) => s.id === 'learn')!.text.split('\n\n')

  it('ends the Learn section with one line about the transcription: where it is, that it is approximate, that Settings turns it off', () => {
    const line = learn(ru).at(-1)!
    expect(line).toBe('В русском интерфейсе после слова в квадратных скобках стоит примерная транскрипция кириллицей, ударная гласная выделена. Отключить ее можно в настройках.')
    expect(learn(en).at(-1)).toBe('In the Russian interface a word is followed, in square brackets, by an approximate transcription in Cyrillic, with the stressed vowel marked. You can turn it off in Settings.')
  })
})

describe('the pronunciation memo in How it works', () => {
  const memo = (map: { howItWorks: { sections: readonly { id: string; heading: string; text: string }[] } }) => map.howItWorks.sections.find((s) => s.id === 'pronunciation')!

  it('is the section after Learn, in both languages, with the owner\'s points: approximate, stress highlighted, ll/y, b/v, x, l, final d', () => {
    for (const map of [ru, en]) expect(map.howItWorks.sections.map((s) => s.id).slice(0, 3)).toEqual(['learn', 'pronunciation', 'review'])
    expect(memo(ru).heading).toBe('Произношение')
    expect(memo(en).heading).toBe('Pronunciation')
    const ruText = memo(ru).text
    expect(ruText).toMatch(/примерная/)
    expect(ruText).toMatch(/Ударная гласная выделена/)
    expect(ruText).toMatch(/ll и y звучат примерно как «ш»/)
    expect(ruText).toMatch(/b и v читаются одинаково[^.]*между «б» и «в», ближе к «б»/)
    expect(ruText).toMatch(/x звучит как «кс»[^.]*нередко как «с»/)
    expect(ruText).toMatch(/l легче русского твердого «л»/)
    expect(ruText).toMatch(/Конечный d едва слышен, например в salud/)
    const enText = memo(en).text
    expect(enText).toMatch(/approximate/)
    expect(enText).toMatch(/stressed vowel is highlighted/)
    expect(enText).toMatch(/ll and y sound roughly like “sh”/)
    expect(enText).toMatch(/B and v are one sound, something between “б” and “в”, closer to “б”/)
    expect(enText).toMatch(/x is “кс”[^.]*often just “с”/)
    expect(enText).toMatch(/l is lighter than the hard Russian “л”/)
    expect(enText).toMatch(/final d is barely heard, as in salud/)
  })

  it('is three short paragraphs, and the examples in it are what the converter gives', () => {
    expect(memo(ru).text.split('\n\n')).toHaveLength(3)
    expect(memo(en).text.split('\n\n')).toHaveLength(3)
    expect(transcriptionText('llevar')!.replace(/\u0301/g, '')).toBe('шебар')
    expect(transcriptionText('yo')).toBe('шо')
  })

  it('the Settings link to it says "More on pronunciation"', () => {
    expect(ru.settings.transcriptionMore).toBe('Подробнее о произношении')
    expect(en.settings.transcriptionMore).toBe('More on pronunciation')
  })
})

describe('What\'s new', () => {
  const entry = WHATS_NEW.find((e) => e.id === 'transcription')

  it('has an entry for it, in both languages, that says it is approximate and can be turned off in Settings', () => {
    expect(entry).toBeDefined()
    expect(entry!.ru.title).toBe('Транскрипция кириллицей')
    expect(entry!.ru.text).toMatch(/примерн/)
    expect(entry!.ru.text).toMatch(/отключить[\s\S]*настройках/)
    expect(entry!.en.title).toBe('Cyrillic transcription')
    expect(entry!.en.text).toMatch(/approximate/)
    expect(entry!.en.text).toMatch(/turned off in Settings/)
  })

  it('is the newest entry', () => {
    expect(WHATS_NEW[0].id).toBe('transcription')
  })
})
