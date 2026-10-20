import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ExternalLink } from '../components/ExternalLink'
import { ACCOUNT_EMAIL_EXAMPLE, AUTHOR_HANDLE, AUTHOR_URL, CC_BY_SA_URL, COFFEE_URL, DOOZAN_URL, HERMITDAVE_URL, LINK_LABELS, PRIVACY_PATH, openInTelegram, privacyUrl } from './links'

describe('the addresses the About screen and the privacy page point to', () => {
  it('are exactly these', () => {
    expect(AUTHOR_URL).toBe('https://t.me/valeranevermind')
    expect(AUTHOR_HANDLE).toBe('@valeranevermind')
    expect(AUTHOR_URL.endsWith(AUTHOR_HANDLE.slice(1))).toBe(true) // the handle shown is the account the link opens
    expect(COFFEE_URL).toBe('https://buymeacoffee.com/valeranevermind')
    expect(DOOZAN_URL).toBe('https://github.com/doozan/spanish_data')
    expect(HERMITDAVE_URL).toBe('https://github.com/hermitdave/FrequencyWords')
    expect(CC_BY_SA_URL).toBe('https://creativecommons.org/licenses/by-sa/4.0/')
    expect(LINK_LABELS).toEqual({ doozan: 'doozan/spanish_data', hermitdave: 'hermitdave/FrequencyWords', licence: 'CC BY-SA 4.0' })
    for (const [name, label] of [['doozan', DOOZAN_URL], ['hermitdave', HERMITDAVE_URL]] as const) expect(label.endsWith(LINK_LABELS[name]), name).toBe(true) // a link says where it goes
  })

  it('the example account address has the shape the proxy makes (tg_<id>@ and the internal domain) with an id that belongs to nobody', () => {
    expect(ACCOUNT_EMAIL_EXAMPLE).toMatch(/^tg_[0-9]{1,18}@telegram\.riopalabras\.internal$/)
    expect(ACCOUNT_EMAIL_EXAMPLE.startsWith('tg_123456789@')).toBe(true)
  })
})

describe('the privacy page address', () => {
  it('is the origin the app is served from, /privacy, and the language the app is in', () => {
    expect(PRIVACY_PATH).toBe('/privacy')
    expect(privacyUrl('en', 'https://riopalabras-web.vercel.app')).toBe('https://riopalabras-web.vercel.app/privacy?lang=en')
    expect(privacyUrl('ru', 'https://riopalabras-web.vercel.app')).toBe('https://riopalabras-web.vercel.app/privacy?lang=ru')
    expect(privacyUrl('ru', 'http://localhost:5173')).toBe('http://localhost:5173/privacy?lang=ru') // a preview deployment or a dev server links to itself
  })
})

describe('opening a link from inside Telegram', () => {
  const opener = () => {
    const calls: string[] = []
    const webApp = {
      openLink(this: unknown, url: string) {
        calls.push(`openLink:${url}`)
        expect(this).toBe(webApp) // Telegram's functions are methods of the WebApp object
      },
      openTelegramLink(this: unknown, url: string) {
        calls.push(`openTelegramLink:${url}`)
        expect(this).toBe(webApp)
      },
    }
    return { webApp, calls }
  }

  it('a t.me link goes to openTelegramLink, and nothing else does', () => {
    const { webApp, calls } = opener()
    expect(openInTelegram(AUTHOR_URL, webApp)).toBe(true)
    expect(calls).toEqual(['openTelegramLink:https://t.me/valeranevermind'])
  })

  it('every other address goes to openLink: the coffee page, the repositories, the licence, the privacy page', () => {
    const { webApp, calls } = opener()
    for (const url of [COFFEE_URL, DOOZAN_URL, HERMITDAVE_URL, CC_BY_SA_URL, privacyUrl('en', 'https://riopalabras-web.vercel.app')]) expect(openInTelegram(url, webApp), url).toBe(true)
    expect(calls.every((c) => c.startsWith('openLink:'))).toBe(true)
    expect(calls).toHaveLength(5)
  })

  it('a look-alike host is not t.me', () => {
    const { webApp, calls } = opener()
    openInTelegram('https://t.me.evil.test/x', webApp)
    openInTelegram('https://evil.test/t.me', webApp)
    expect(calls.every((c) => c.startsWith('openLink:'))).toBe(true)
  })

  it('says no, and opens nothing, where Telegram has no opener (outside Telegram, an old client): the anchor then does its ordinary job', () => {
    expect(openInTelegram(COFFEE_URL, {})).toBe(false)
    expect(openInTelegram(AUTHOR_URL, { openLink: () => {} })).toBe(false) // a t.me link needs openTelegramLink, not openLink
  })

  it('says no, and does not throw, when the opener throws or the address is not one', () => {
    expect(openInTelegram(COFFEE_URL, { openLink: () => { throw new Error('boom') } })).toBe(false)
    const open = vi.fn()
    expect(openInTelegram('not an address', { openLink: open, openTelegramLink: open })).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('an external link as drawn', () => {
  it('is an anchor to the address that opens a new tab with no opener and no referrer, so that outside Telegram it is an ordinary link', () => {
    const html = renderToStaticMarkup(ExternalLink({ url: COFFEE_URL, className: 'x', children: 'buy me a coffee' })) // a plain function component: called as one
    expect(html).toBe('<a class="x" href="https://buymeacoffee.com/valeranevermind" target="_blank" rel="noopener noreferrer">buy me a coffee</a>')
  })
})
