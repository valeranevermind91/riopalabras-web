import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyRow } from '../data/metrics'
import { WriteError } from '../data/writes'
import { createWriteQueue } from '../data/writeQueue'
import { browserOnline } from '../lib/online'
import { MetricsSection } from './MetricsSection'

describe('Debug: today\'s metrics section', () => {
  const render = (props: Partial<Parameters<typeof MetricsSection>[0]> = {}) =>
    renderToStaticMarkup(createElement(MetricsSection, { queue: null, metrics: null, client: null, userId: null, ...props }))

  it('shows every field of the row recorded today', () => {
    const row = { ...emptyRow('2026-10-04'), newWords: 3, reviewsDone: 12, reviewsLapsed: 2, dueAtStart: 15, learnPool: 4000, dailyLimit: 10, active: true }
    const html = render({ metrics: { today: () => row } })
    for (const [name, value] of Object.entries({ date: '2026-10-04', newWords: '3', reviewsDone: '12', reviewsLapsed: '2', dueAtStart: '15', learnPool: '4000', dailyLimit: '10', active: 'true' })) {
      expect(html).toContain(`<dt>${name}</dt><dd>${value}</dd>`)
    }
  })

  it('says so when nothing was recorded, and shows how many metrics rows are waiting in the queue', () => {
    const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} }) // no metrics sender: the row just waits
    queue.enqueueMetrics(emptyRow('2026-10-04'))
    const html = render({ queue, metrics: { today: () => null } })
    expect(html).toContain('Nothing recorded on this device today.')
    expect(html).toContain('<dt>Rows waiting</dt><dd>1</dd>')
    expect(html).toContain('<dt>Last error</dt><dd>none</dd>')
    expect(html).toContain('Check server copy')
  })

  it('shows the metrics lane state: a failure with its error, attempts and that it gave up, and the seeding result', async () => {
    const queue = createWriteQueue(
      { sendProgress: async () => {}, sendSettings: async () => {}, sendMetrics: async () => { throw new Error('user_daily_metrics: boom') } },
      { retryDelaysMs: [], metricsRetryDelaysMs: [], sleep: () => Promise.resolve() },
    )
    queue.enqueueMetrics(emptyRow('2026-10-04'))
    await vi.waitFor(() => expect(queue.getStatus().metricsGaveUp).toBe(true))
    const html = render({ queue, metrics: { today: () => null, seedStatus: () => ({ state: 'failed', detail: 'permission denied' }) } })
    expect(html).toContain('<dt>Metrics lane</dt><dd>gave up (idle until the next change or retry)</dd>')
    expect(html).toContain('<dt>Send attempts</dt><dd>1</dd>')
    expect(html).toContain('<dt>Last error</dt><dd>user_daily_metrics: boom</dd>')
    expect(html).toContain('Server seed: failed (permission denied)')
  })

  describe('the save queue, next to the metrics lane', () => {
    const NOW = Date.parse('2026-10-25T20:00:00Z')
    const failing = (...errors: unknown[]) => {
      const pending = [...errors]
      return createWriteQueue(
        { sendProgress: async () => {}, sendSettings: async () => { const next = pending.shift(); if (next) throw next } },
        { retryDelaysMs: [], sleep: () => Promise.resolve(), now: () => NOW },
      )
    }
    const saveLane = (html: string) => html.match(/<dl data-testid="save-lane">.*?<\/dl>/)![0]

    it('says idle, nothing waiting and no error when everything is saved', () => {
      const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
      const lane = saveLane(render({ queue }))
      expect(lane).toContain('<dt>Save queue</dt><dd>idle (everything is saved)</dd>')
      expect(lane).toContain('<dt>Waiting to be saved</dt><dd>0 ratings · settings no · 0 hidden · 0 starred · 0 own words</dd>')
      expect(lane).toContain('<dt>Last save error</dt><dd>none</dd>')
      for (const [name, value] of [['Failed request', 'none'], ['HTTP status', 'none'], ['Error code', 'none'], ['Failed at', 'never']]) expect(lane).toContain(`<dt>${name}</dt><dd>${value}</dd>`)
    })

    it('says what the browser reports about the network, because "no" there stops every save before a request is made', () => {
      expect(browserOnline({ onLine: true })).toBe('yes')
      expect(browserOnline({ onLine: false })).toBe('NO (saves are refused before any request is sent)')
      expect(browserOnline({})).toBe('unknown')
      expect(browserOnline(undefined)).toBe('unknown')
      const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
      expect(saveLane(render({ queue }))).toMatch(/<dt>Browser says online<\/dt><dd>(yes|unknown|NO \(saves are refused before any request is sent\))<\/dd>/)
    })

    it('is drawn before the metrics lane, and not at all without a queue', () => {
      const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
      const html = render({ queue })
      expect(html.indexOf('data-testid="save-lane"')).toBeGreaterThan(-1)
      expect(html.indexOf('data-testid="save-lane"')).toBeLessThan(html.indexOf('data-testid="metrics-lane"'))
      expect(render({ queue: null })).not.toContain('save-lane')
    })

    it('when a save fails for good: stuck, what is waiting, and the error, the request, the HTTP status, the database code and the time, one to a row', async () => {
      const queue = failing(new WriteError('user_settings', 'null value in column "x" violates not-null constraint', 400, '23502'))
      queue.enqueueSettings({ ui_language: 'ru' })
      await vi.waitFor(() => expect(queue.getStatus().stuck).toBe(true))
      const lane = saveLane(render({ queue }))
      expect(lane).toContain('<dt>Save queue</dt><dd>stuck (automatic retries ran out; trying again in the background)</dd>')
      expect(lane).toContain('<dt>Waiting to be saved</dt><dd>0 ratings · settings yes · 0 hidden · 0 starred · 0 own words</dd>')
      expect(lane).toContain('<dt>Last save error</dt><dd>user_settings: null value in column &quot;x&quot; violates not-null constraint</dd>')
      expect(lane).toContain('<dt>Failed request</dt><dd>user_settings</dd>')
      expect(lane).toContain('<dt>HTTP status</dt><dd>400</dd>')
      expect(lane).toContain('<dt>Error code</dt><dd>23502</dd>')
      expect(lane).toContain('<dt>Failed at</dt><dd>2026-10-25T20:00:00.000Z</dd>')
    })

    it('a refusal for who is asking says so', async () => {
      const queue = failing(new WriteError('user_settings', 'new row violates row-level security policy', 403, '42501'))
      queue.enqueueSettings({ a: 1 })
      await vi.waitFor(() => expect(queue.getStatus().authRejected).toBe(true))
      expect(saveLane(render({ queue }))).toContain('<dt>Save queue</dt><dd>refused (the server will not take writes from this sign-in)</dd>')
    })

    it('keeps the error after the queue recovers: idle again, and what went wrong still on the screen', async () => {
      const queue = failing(new Error('no answer after 20000 ms'))
      queue.enqueueSettings({ a: 1 })
      await vi.waitFor(() => expect(queue.getStatus().stuck).toBe(true))
      await queue.retry()
      await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
      const lane = saveLane(render({ queue }))
      expect(lane).toContain('<dt>Save queue</dt><dd>idle (everything is saved)</dd>')
      expect(lane).toContain('<dt>Last save error</dt><dd>no answer after 20000 ms</dd>')
      expect(lane).toContain('<dt>Failed request</dt><dd>user_settings</dd>')
      expect(lane).toContain('<dt>HTTP status</dt><dd>none (no answer, no connection or no session)</dd>') // a timeout has no status or code
      expect(lane).toContain('<dt>Error code</dt><dd>none</dd>')
      expect(lane).toContain('<dt>Failed at</dt><dd>2026-10-25T20:00:00.000Z</dd>')
    })

    it('the metrics lane keeps its own "Last error", and a metrics failure is not a save error', async () => {
      const queue = createWriteQueue(
        { sendProgress: async () => {}, sendSettings: async () => {}, sendMetrics: async () => { throw new Error('user_daily_metrics: boom') } },
        { retryDelaysMs: [], metricsRetryDelaysMs: [], sleep: () => Promise.resolve() },
      )
      queue.enqueueMetrics(emptyRow('2026-10-04'))
      await vi.waitFor(() => expect(queue.getStatus().metricsGaveUp).toBe(true))
      const html = render({ queue })
      expect(html).toContain('<dt>Last error</dt><dd>user_daily_metrics: boom</dd>')
      expect(saveLane(html)).toContain('<dt>Last save error</dt><dd>none</dd>')
    })
  })
})
