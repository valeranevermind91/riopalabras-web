import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import { backTarget } from '../lib/nav'
import { strings } from '../strings'
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
  const props: StepProps = { settings, saveSetting: noop, stepGoal: noop, onHow: noop }
  const entry = STEPS.find((s) => s.id === id)!
  return renderToStaticMarkup(createElement(entry.Body, props))
}

describe('the six steps', () => {
  it('are, in order: what this is, what is inside, translation language, the placement test, the daily goal, pronunciation', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['about', 'inside', 'translation', 'placement', 'goal', 'pronunciation'])
  })

  it('open on step 1 with a progress indicator: "Step 1 of 6" and a progress bar', () => {
    const html = shell('first')
    expect(html).toContain('Step 1 of 6')
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuemin="1"[^>]*aria-valuemax="6"[^>]*aria-valuenow="1"/)
    expect(html).toContain('style="width:16.666666666666664%"')
  })

  it('1: what this is: the app name in the display face and one sentence', () => {
    const html = step('about')
    expect(html).toContain('<h1 class="brand intro-brand">Riopalabras</h1>')
    expect(html).toContain('The Spanish actually spoken in Uruguay and Argentina, not textbook Spanish.')
  })

  it('2: what is inside: one short line per thing, Learn, Review, Matching, Cloze, the list and your own words', () => {
    const html = step('inside')
    expect([...html.matchAll(/<span class="intro-name is-(\w+)">([^<]+)<\/span><span class="intro-line">([^<]+)<\/span>/g)].map((m) => [m[2], m[1]])).toEqual([
      ['Learn', 'learn'],
      ['Review', 'learn'],
      ['Matching', 'practice'],
      ['Cloze', 'practice'],
      ['Words', 'learn'],
      ['Your own words', 'learn'],
    ])
    expect(html.match(/<li>/g)).toHaveLength(6)
  })

  it('3: translation language: Russian, English or both, on what is set (both by default)', () => {
    const checked = (html: string) => [...html.matchAll(/role="radio" aria-checked="(\w+)">([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`)
    expect(checked(step('translation'))).toEqual(['Russian:false', 'English:false', 'Both:true'])
    expect(checked(step('translation', { show_en_translation: false }))).toEqual(['Russian:true', 'English:false', 'Both:false'])
    expect(checked(step('translation', { show_ru_translation: false }))).toEqual(['Russian:false', 'English:true', 'Both:false'])
  })

  it('4: the placement test is a marked placeholder: one screen saying a short test will go here', () => {
    const html = step('placement')
    expect(html).toContain('data-step="placement"')
    expect(html).toContain('A short test will go here.')
    expect(readFileSync('src/screens/OnboardingPlacement.tsx', 'utf8')).toMatch(/PLACEMENT TEST/)
    expect(readFileSync('src/screens/onboardingSteps.ts', 'utf8')).toMatch(/PLACEMENT TEST GOES HERE/)
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
    // the steps are a list of { id, Body, canContinue? }; the placement test replaces the fourth Body and nothing else
    expect(STEPS.every((s) => typeof s.Body === 'function')).toBe(true)
    expect(STEPS[3].id).toBe('placement')
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
  const copy = JSON.stringify([strings.onboarding, strings.howItWorks])
  it('has no exclamation marks, no "remember", no "don\'t worry"', () => {
    expect(copy).not.toContain('!')
    expect(copy.toLowerCase()).not.toMatch(/remember|don't worry|do not worry|don’t worry|make sure|you should|you must|try to/)
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
