// One Gemini call with a structured JSON answer, for the gender study. The key comes from GEMINI_API_KEY or .env.local and is never printed or logged.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib.mjs'

export const MODEL = 'gemini-3.5-flash-lite'
// $ per million tokens (the proxy's scripts/check-enrich-quality.js: gemini-3.5-flash-lite is priced like gemini-2.5-flash; thinking bills as output)
export const PRICE = { in: 0.3, out: 2.5 }

export function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  const file = path.join(ROOT, '.env.local')
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*GEMINI_API_KEY\s*=\s*(.*?)\s*$/.exec(line)
      if (m && m[1]) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  throw new Error('GEMINI_API_KEY is not set (environment or .env.local)')
}

export const usage = { calls: 0, input: 0, output: 0, thoughts: 0, retries: 0 }
export const cost = () => (usage.input * PRICE.in + (usage.output + usage.thoughts) * PRICE.out) / 1e6
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({ category, threshold: 'BLOCK_NONE' }))

/** Ask for JSON matching `schema`; returns the parsed value. Retries transport errors and unparsable answers a few times. */
export async function askJson({ system, user, schema, key, level = 'low', maxOutputTokens = 16384 }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingLevel: level } }, // a Gemini 3 model: a level, no temperature
    safetySettings: SAFETY,
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) })
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 300)
        if ((res.status === 429 || res.status >= 500) && attempt < 5) { usage.retries++; await sleep(Math.min(30000, 1500 * 2 ** attempt)); continue }
        throw new Error(`HTTP ${res.status}: ${text.replace(key, '***')}`)
      }
      const data = await res.json()
      const u = data.usageMetadata ?? {}
      usage.calls++; usage.input += u.promptTokenCount ?? 0; usage.output += u.candidatesTokenCount ?? 0; usage.thoughts += u.thoughtsTokenCount ?? 0
      const cand = data.candidates?.[0]
      const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
      try { return JSON.parse(text) } catch { if (attempt < 3) { usage.retries++; continue } throw new Error(`unparsable answer (finish ${cand?.finishReason})`) }
    } catch (err) {
      if (/^HTTP|unparsable/.test(err.message) || attempt >= 5) throw err
      usage.retries++; await sleep(2000 * (attempt + 1))
    }
  }
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i) } }))
  return out
}
