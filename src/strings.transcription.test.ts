import { describe, expect, it } from 'vitest'
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
