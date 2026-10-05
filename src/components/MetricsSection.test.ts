import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyRow } from '../data/metrics'
import { createWriteQueue } from '../data/writeQueue'
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
})
