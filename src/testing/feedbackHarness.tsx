// A page for the real-browser test of the message form (src/lib/feedback.browser.test.ts): the real FeedbackScreen with a send function that records
// every report it is given (window.__reports) and answers as the test says (window.__mode: 'ok' | 'fail' | 'hang'). When the form closes, #result says how.
// ?kind=word|general picks the form, ?lang=ru the interface language.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import type { FeedbackReport, SendResult } from '../data/feedback'
import { setLanguage, useLanguage } from '../lib/language'
import { FeedbackScreen } from '../screens/Feedback'

const win = window as never as {
  Telegram: unknown
  __reports: FeedbackReport[]
  __mode: 'ok' | 'fail' | 'hang'
  __pressBack: () => string
}
// Telegram says which client this is, as it does in the app.
win.Telegram = { WebApp: { initData: 'harness', initDataUnsafe: {}, colorScheme: 'light', themeParams: {}, ready: () => {}, expand: () => {}, platform: 'android' } }
win.__reports = []
win.__mode = 'ok'

const params = new URLSearchParams(location.search)
if (params.get('lang') === 'ru') setLanguage('ru')

const send = async (report: FeedbackReport): Promise<SendResult> => {
  win.__reports.push(report)
  if (win.__mode === 'hang') return new Promise<SendResult>(() => {})
  if (win.__mode === 'fail') return { ok: false, reason: 'failed' }
  return { ok: true }
}

export function Harness() {
  useLanguage()
  const [result, setResult] = useState<string | null>(null)
  const backInterceptor = useRef<(() => boolean) | null>(null)
  const registerBack = useCallback((handler: (() => boolean) | null) => {
    backInterceptor.current = handler
  }, [])
  useEffect(() => {
    win.__pressBack = () => (backInterceptor.current?.() ? 'handled' : 'left')
  }, [])
  const kind = params.get('kind') === 'word' ? 'word' : 'general'
  if (result) return <p id="result">{result}</p>
  // ?named= and ?shown= make a report name one thing and show the person another (a card that leads with the Rioplatense form)
  const named = params.get('named') ?? 'chévere'
  const shown = params.get('shown')
  return <FeedbackScreen kind={kind} esWord={kind === 'word' ? named : null} shownWord={kind === 'word' ? shown : null} from={kind === 'word' ? 'word' : 'settings'} send={send} onSent={() => setResult('sent')} onClose={() => setResult('closed')} registerBack={registerBack} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
