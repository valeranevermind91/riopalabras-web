import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { strings } from '../strings'
import { Notice } from './Notice'

describe('Notice', () => {
  it('renders the shared notice style with one action: the same markup for every Home notice', () => {
    const html = renderToStaticMarkup(createElement(Notice, { actionLabel: strings.home.retryNow, onAction: () => {} }, strings.home.unsavedProgress))
    expect(html).toBe(
      `<p class="notice" role="status">Some progress hasn&#x27;t been saved yet. Retrying… <button type="button" class="btn-small wp-off">Retry now</button></p>`,
    )
    const degraded = renderToStaticMarkup(createElement(Notice, { actionLabel: strings.home.retryNow, onAction: () => {} }, strings.home.degraded(['favorites'])))
    expect(degraded.startsWith('<p class="notice" role="status">')).toBe(true)
    expect(degraded).toContain('class="btn-small wp-off"')
  })
})
