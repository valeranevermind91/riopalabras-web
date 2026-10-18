import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { en } from '../strings'
import { ru } from '../strings.ru'
import { PlacementScale, type PlacementScaleProps } from './PlacementScale'

const LABELS = { frequent: 'Common words', rare: 'Rare words', start: 'Learn starts here' }
const draw = (over: Partial<PlacementScaleProps> = {}) =>
  renderToStaticMarkup(createElement(PlacementScale, { probes: [0.1, 0.3, 0.5, 0.7, 0.9], current: 2, done: [0, 1], settled: null, labels: LABELS, ...over }))
const probes = (html: string) => [...html.matchAll(/<span class="pscale-probe( is-(?:current|done))?" style="left:([\d.]+)%"/g)].map((m) => ({ state: (m[1] ?? '').trim().replace('is-', '') || 'upcoming', left: Number(m[2]) }))

describe('the placement scale: a search drawn on the dictionary, not a score', () => {
  it('draws one mark per probe at its position: the lit one is the current set, the asked ones are dimmed, the rest are plain', () => {
    expect(probes(draw())).toEqual([
      { state: 'done', left: 10 },
      { state: 'done', left: 30 },
      { state: 'current', left: 50 },
      { state: 'upcoming', left: 70 },
      { state: 'upcoming', left: 90 },
    ])
  })

  it('exactly one probe is lit at a time, and none when the test has finished', () => {
    expect(probes(draw()).filter((p) => p.state === 'current')).toHaveLength(1)
    const finished = probes(draw({ current: null, done: [0, 1, 2, 3, 4], settled: 0.6 }))
    expect(finished.filter((p) => p.state === 'current')).toHaveLength(0)
    expect(finished.every((p) => p.state === 'done')).toBe(true)
  })

  it('takes positions, not bands: probes can come in any order and any number (the adaptive test jumps about), and a lit probe wins over a dimmed one', () => {
    const html = draw({ probes: [0.5, 0.75, 0.25, 0.6], current: 3, done: [0, 1, 2, 3] })
    expect(probes(html)).toEqual([
      { state: 'done', left: 50 },
      { state: 'done', left: 75 },
      { state: 'done', left: 25 },
      { state: 'current', left: 60 }, // asked and current at once: lit
    ])
    expect(probes(draw({ probes: [0.5], current: 0, done: [] }))).toEqual([{ state: 'current', left: 50 }])
  })

  it('positions are kept on the scale: a stray one is held at an end, never drawn off it', () => {
    expect(probes(draw({ probes: [-0.2, 1.4], current: null, done: [] })).map((p) => p.left)).toEqual([0, 100])
  })

  it('the marker is there only once the search has settled, and sits at the settled position', () => {
    expect(draw({ settled: null })).not.toContain('pscale-start')
    expect(draw({ settled: null })).toContain('data-settled="false"')
    const html = draw({ settled: 0.6 })
    expect(html).toContain('data-settled="true"')
    expect(html).toMatch(/<span class="pscale-start" style="left:60%;--from:90%">/)
    expect(html).toContain('Learn starts here')
  })

  it('the marker settles in from the last probe, or from the one it is told', () => {
    expect(draw({ settled: 0.4, probes: [0.2, 0.8] })).toContain('--from:80%')
    expect(draw({ settled: 0.4, probes: [0.2, 0.8], settledFrom: 0.5 })).toContain('--from:50%')
  })

  it('its label hangs towards the middle of the scale, so it stays on screen at both ends', () => {
    expect(draw({ settled: 0 })).toContain('transform:translateX(-0%)') // left edge: the label starts at the marker
    expect(draw({ settled: 1 })).toContain('transform:translateX(-100%)') // right edge: it ends at the marker
    expect(draw({ settled: 0.5 })).toContain('transform:translateX(-50%)')
  })

  it('shows no number, no percentage and nothing that fills: only the two ends and the marker\'s label are text', () => {
    const html = draw({ settled: 0.6 })
    const text = html.replace(/<[^>]*>/g, '|').split('|').filter(Boolean)
    expect(text).toEqual(['Learn starts here', 'Common words', 'Rare words'])
    expect(text.join(' ')).not.toMatch(/\d|%/)
    expect(html).not.toMatch(/bar-fill|role="progressbar"|<progress|<meter/)
  })

  it('is decoration for the eye: hidden from screen readers, which are given the sentence by whoever draws it', () => {
    expect(draw()).toMatch(/^<div class="pscale" aria-hidden="true"/)
  })

  it('its words exist in both languages, with the ends named as frequent and rare, and no score or praise in them', () => {
    for (const labels of [en.onboarding.placement.scale, ru.onboarding.placement.scale]) {
      for (const text of Object.values(labels)) {
        expect(text.length).toBeGreaterThan(3)
        expect(text).not.toMatch(/\d|%|!|score|well done|great|correct|wrong|level|балл|уровень|правильно|молодец/i)
      }
    }
  })
})
