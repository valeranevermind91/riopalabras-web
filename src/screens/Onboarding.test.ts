import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import { effectiveLanguage, languagePatch } from '../lib/language'
import { backTarget } from '../lib/nav'
import { en } from '../strings'
import { ru } from '../strings.ru'
import { HowItWorks } from './HowItWorks'
import { Onboarding } from './Onboarding'
import { STEPS, type StepProps } from './onboardingSteps'
import { SettingsScreen } from './Settings'

const noop = () => {}
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })

const shell = (mode: 'first' | 'replay', raw: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(Onboarding, { data: { settings: parseSettings(raw), getSettings: () => parseSettings(raw), applySettings: noop } as never, queue, mode }))

const step = (id: string, raw: Record<string, unknown> = {}) => {
  const settings = parseSettings(raw)
  const props: StepProps = { settings, saveSetting: noop, stepGoal: noop, onHow: noop, words: [], savePlacement: noop, advance: noop, retreat: noop, interceptBack: noop }
  const entry = STEPS.find((s) => s.id === id)!
  return renderToStaticMarkup(createElement(entry.Body, props))
}

describe('the seven steps', () => {
  it('are, in order: the language, what this is, what is inside, translations, the placement test, the daily goal, pronunciation', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['language', 'about', 'inside', 'translation', 'placement', 'goal', 'pronunciation'])
  })

  it('open on step 1 with a progress indicator: "Step 1 of 7" and a progress bar', () => {
    const html = shell('first')
    expect(html).toContain('Step 1 of 7')
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuemin="1"[^>]*aria-valuemax="7"[^>]*aria-valuenow="1"/)
    expect(html).toContain('style="width:14.285714285714285%"')
    expect(html).toContain('data-step="language"') // the first step is the language
  })

  it('1: the language: two large options, each in its own language, the one Telegram reports (here English) or the stored one selected', () => {
    const options = (html: string) => [...html.matchAll(/lang="(\w+)" class="lang-option[^"]*" role="radio" aria-checked="(\w+)">([^<]+)</g)].map((m) => `${m[3]}:${m[2]}`)
    expect(options(step('language'))).toEqual(['English:true', 'Русский:false'])
    expect(options(step('language', { ui_language: 'ru' }))).toEqual(['English:false', 'Русский:true'])
    expect(step('language')).toContain('role="radiogroup"')
  })

  it('1: what this is: the app name in the display face and one sentence', () => {
    const html = step('about')
    expect(html).toContain('<h1 class="brand intro-brand">Riopalabras</h1>')
    expect(html).toContain('The Spanish actually spoken in Uruguay and Argentina, not textbook Spanish.')
  })

  it('2: what is inside: Learn, Review, Matching and Cloze, Words, each with what to expect (the given text)', () => {
    const html = step('inside')
    expect([...html.matchAll(/<span class="intro-name is-(\w+)">([^<]+)<\/span><span class="intro-line">([^<]+)<\/span>/g)].map((m) => [m[2], m[1], m[3]])).toEqual([
      ['Learn', 'learn', 'new words, each shown in a real sentence rather than a bare list.'],
      ['Review', 'learn', 'self-check cards: you say whether you remembered, and the app decides when the word comes back.'],
      ['Matching and Cloze', 'practice', 'two other ways to go over what you know: pair words with their translations, or fill the missing word into a sentence.'],
      ['Words', 'learn', 'the whole dictionary, with search, filters, favourites, and words you add yourself.'],
    ])
    expect(html.match(/<li>/g)).toHaveLength(4)
  })

  it('3: translations: Russian, English or both, on what is set (both by default)', () => {
    const checked = (html: string) => [...html.matchAll(/role="radio" aria-checked="(\w+)">([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`)
    expect(checked(step('translation'))).toEqual(['Russian:false', 'English:false', 'Both:true'])
    expect(checked(step('translation', { show_en_translation: false }))).toEqual(['Russian:true', 'English:false', 'Both:false'])
    expect(checked(step('translation', { show_ru_translation: false }))).toEqual(['Russian:false', 'English:true', 'Both:false'])
  })

  it('4: the placement test is the real step: its own screen (here without enough words, so it says so), drawing its own buttons', () => {
    const html = step('placement')
    expect(html).toContain('data-step="placement"')
    expect(html).toContain('There are not enough new words left for a placement test.')
    expect(html).not.toContain('A short test will go here')
    const entry = STEPS.find((s) => s.id === 'placement')!
    expect(entry.ownsFooter).toBe(true)
    expect(STEPS.filter((s) => s.ownsFooter).map((s) => s.id)).toEqual(['placement'])
    expect(readFileSync('src/screens/OnboardingPlacement.tsx', 'utf8')).not.toMatch(/PLACEHOLDER/)
  })

  it('5: the daily goal: the shared stepper on the current value, 10 when nothing is stored', () => {
    const goal = (html: string) => html.match(/<output[^>]*>(\d+)<\/output>/)![1]
    expect(goal(step('goal'))).toBe('10')
    expect(goal(step('goal', { daily_new_word_limit: 14 }))).toBe('14')
    const html = step('goal')
    expect(html).toContain('aria-label="Decrease the daily goal"')
    expect(html).toContain('aria-label="Increase the daily goal"')
    expect(html).not.toContain('sessions of 10')
    expect(step('goal', { daily_new_word_limit: 18 })).toContain('split into sessions of 10')
  })

  it('6: pronunciation: two facts with the Spanish words in the display face, a link to "How it works"', () => {
    const html = step('pronunciation')
    expect([...html.matchAll(/<span class="intro-es">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(['ll', 'y', 'calle', 'yo', 'vos tenés', 'tú tienes'])
    expect(html).toContain('sound like the “sh” in “shoe”: ')
    expect(html).toContain('People say “')
    expect(html.match(/<li>/g)).toHaveLength(2)
    expect(html).toMatch(/<button type="button" class="link-btn intro-link">How it works<\/button>/)
  })

  it('the last step ends in Done, the others in Continue', () => {
    expect(shell('first')).toContain('>Continue</button>')
    expect(shell('first')).not.toContain('>Done<')
  })

  it('the shell is the same around any step: a step added or replaced does not change the flow', () => {
    // the steps are a list of { id, Body, canContinue?, ownsFooter?, onContinue? }
    expect(STEPS.every((s) => typeof s.Body === 'function')).toBe(true)
    expect(STEPS[4].id).toBe('placement')
  })
})

describe('Continue on the language step', () => {
  const first = STEPS[0]
  const run = (raw: Record<string, unknown>) => {
    const written: Record<string, unknown>[] = []
    first.onContinue!({ settings: parseSettings(raw), saveSetting: (patch) => void written.push(patch), stepGoal: noop, onHow: noop, words: [], savePlacement: noop, advance: noop, retreat: noop, interceptBack: noop })
    return written
  }

  it('is the first step, and has something to do on Continue', () => {
    expect(first.id).toBe('language')
    expect(typeof first.onContinue).toBe('function')
    expect(STEPS.slice(1).some((s) => s.onContinue)).toBe(false) // no other step writes just by being left
  })

  it('writes ui_language with the preselected language when none is stored (here English: no Telegram)', () => {
    expect(run({})).toEqual([{ ui_language: 'en' }])
  })

  it('writes nothing when a language is stored already', () => {
    expect(run({ ui_language: 'ru' })).toEqual([])
    expect(run({ ui_language: 'en' })).toEqual([])
  })

  it('is the same patch the option writes', () => {
    expect(run({})[0]).toEqual(languagePatch(effectiveLanguage(null)))
  })
})

describe('Back on the first step', () => {
  it('a first run has nowhere to go: no Back button at all', () => {
    const html = shell('first')
    expect(html).not.toContain('>Back<')
  })

  it('a replay has a Back button on step 1 (it leaves to Settings)', () => {
    expect(shell('replay')).toContain('>Back</button>')
  })

  it('the app sends Back from the intro and from "How it works" to Settings', () => {
    expect(backTarget('onboarding', null)).toBe('settings')
    expect(backTarget('how', null)).toBe('settings')
  })
})

describe('the tone: these screens inform, they do not instruct', () => {
  const copy = JSON.stringify([en.onboarding, en.howItWorks, ru.onboarding, ru.howItWorks])
  it('has no exclamation marks, no "remember", no "don\'t worry", in either language', () => {
    expect(copy).not.toContain('!')
    expect(copy.toLowerCase()).not.toMatch(/\bremember\b|don't worry|do not worry|don’t worry|make sure|you should|you must|try to|не забывайте|не волнуйтесь|не переживайте|убедитесь|обязательно/)
  })
})

describe('How it works', () => {
  it('has a paragraph for Learn, Review, Matching and Cloze, and one on why a word comes back', () => {
    const html = renderToStaticMarkup(createElement(HowItWorks, {}))
    expect(html).toContain('<h1>How it works</h1>')
    expect([...html.matchAll(/<h2 id="how-\w+">([^<]+)<\/h2>/g)].map((m) => m[1])).toEqual(['Learn', 'Review', 'Matching', 'Cloze', 'Why a word comes back'])
    expect(html.match(/<p>/g)).toHaveLength(5)
    expect(html).toContain('due the next day')
    expect(html).toContain('about a week')
  })

  it('uses only the words of the app\'s own buttons for the ratings', () => {
    const html = renderToStaticMarkup(createElement(HowItWorks, {}))
    for (const word of ['Again', 'Hard', 'Good', 'Easy', 'Finishing a batch']) expect(html).toContain(word)
  })
})

describe('Settings, About', () => {
  const about = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(SettingsScreen, { data: { settings: parseSettings({}), getSettings: () => parseSettings({}), applySettings: noop } as never, queue, theme: { choice: 'system', set: noop }, debugAllowed: false, onOpenDebug: noop, botUsername: '', ...props } as never),
    )

  it('has "How it works" and "Run the intro again" rows inside About, when the app gives it the ways to open them', () => {
    const html = about({ onOpenHow: noop, onRunIntro: noop })
    const aboutSection = html.slice(html.indexOf('id="settings-about"'))
    expect(aboutSection).toContain('How it works')
    expect(aboutSection).toContain('Run the intro again')
    expect(aboutSection.indexOf('How it works')).toBeLessThan(aboutSection.indexOf('Run the intro again'))
  })

  it('leaves them out without the callbacks', () => {
    const html = about({})
    expect(html).not.toContain('How it works')
    expect(html).not.toContain('Run the intro again')
  })

  it('no longer says there is no onboarding', () => {
    expect(about({})).not.toContain('no onboarding')
  })
})
