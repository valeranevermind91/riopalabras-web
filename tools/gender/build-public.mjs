// Writes public/noun_gender.json from tools/gender/out/noun_gender.json (the merged result). `node tools/gender/build-public.mjs`
// The compact form is lossless for what the app shows: { v: 1, e: { key: value } }. The value is just the article ("la") when the display is the article plus the key
// itself, and the whole display ("el subte") when the card's headword is another form (a Rioplatense replacement, a plural). The gender letter is not carried: the app
// only ever shows the article, which is the display.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = JSON.parse(fs.readFileSync(path.join(here, 'out', 'noun_gender.json'), 'utf8'))
const ARTICLE = /^(el\/la|el|la|los|las) (\S.*)$/
const e = {}
for (const [key, { d }] of Object.entries(src.entries)) {
  const m = ARTICLE.exec(d)
  if (!m) throw new Error(`not an article + word: ${key} -> ${d}`)
  e[key] = m[2].toLowerCase() === key ? m[1] : d
}
const out = path.join(here, '..', '..', 'public', 'noun_gender.json')
fs.writeFileSync(out, JSON.stringify({ v: 1, e }))
console.log(`${Object.keys(e).length} entries -> ${out} (${fs.statSync(out).size} bytes; was ${fs.statSync(path.join(here, 'out', 'noun_gender.json')).size})`)
