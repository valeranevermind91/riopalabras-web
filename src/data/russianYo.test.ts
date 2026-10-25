import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The convention: Russian text is written with «е» for «ё», and «ё» is kept only where leaving it out would give a different word
// (всё and все, чём and чем, мёд, осёл, чёрт, …). See "Conventions" in README.md. Practice matching ignores the difference (glossKey in practice.ts).

type Piece = { where: string; text: string }
const read = (path: string) => readFileSync(path, 'utf8')
const json = (path: string) => JSON.parse(read(path))

/** Every piece of Russian text the app ships: the dictionary, the overlay, the fallback examples and the interface strings. */
function russianText(): Piece[] {
  const pieces: Piece[] = []
  const add = (where: string, text: unknown) => {
    if (typeof text === 'string' && /[Ѐ-ӿ]/.test(text)) pieces.push({ where, text })
  }
  for (const d of json('public/words_enriched.json')) {
    add(`${d.es_word} · ru_translation`, d.ru_translation)
    add(`${d.es_word} · example_translation_ru`, d.example_translation_ru)
  }
  for (const e of json('public/rio_overlay.json')) {
    add(`overlay ${e.es_word} · notes.ru`, e.notes?.ru)
    add(`overlay ${e.es_word} · std_meaning.ru`, e.std_meaning?.ru)
    add(`overlay ${e.es_word} · translation.ru`, e.translation?.ru)
    add(`overlay ${e.es_word} · example.ru`, e.example?.ru)
  }
  for (const e of json('public/examples_fallback.json')) add(`fallback ${e.es_word} · ru`, e.ru)
  read('src/strings.ru.ts').split('\n').forEach((line, i) => add(`strings.ru.ts:${i + 1}`, line))
  return pieces
}

/** The forms that keep their «ё»: each one is a different word without it. To keep another pair, add its forms here. */
const KEPT = new Set([
  'всё', 'всём', // все (all) / всё (everything); всем (to all, with all) / всём (in everything)
  'чём', 'нём', // чем (than, with what) / чём (about what); нем (mute) / нём (in him, in it)
  'мёд', 'мёда', 'мёду', 'мёдом', 'мёде', // honey
  'осёл', // donkey (осел is a past-tense form, "settled")
  'чёрт', 'чёрта', 'чёрту', 'чёртом', 'чёрте', // the devil (черт, черта: of "trait")
  'узнаёт', 'слёз', 'слёзы', // узнает (will find out) / узнаёт (learns); слез (climbed down) / слёз (tears)
  'лёгкие', 'лёгких', // light, easy; легкие, легких are the lungs
  'берёт', 'нёбо', // берет (a beret) / берёт (takes); небо (sky) / нёбо (palate)
])

const tokensWithYo = (pieces: Piece[]) =>
  pieces.flatMap((p) => (p.text.match(/[Ѐ-ӿ]+/g) ?? []).filter((t) => /[ёЁ]/.test(t)).map((t) => ({ form: t.toLowerCase(), where: p.where })))

describe('«ё» in the Russian text the app ships', () => {
  const pieces = russianText()
  const yo = tokensWithYo(pieces)

  it('scans the dictionary, the overlay, the fallback examples and the interface strings', () => {
    expect(pieces.length).toBeGreaterThan(9000)
    expect(pieces.some((p) => p.where.startsWith('overlay '))).toBe(true)
    expect(pieces.some((p) => p.where.startsWith('fallback '))).toBe(true)
    expect(pieces.some((p) => p.where.startsWith('strings.ru.ts'))).toBe(true)
  })

  it('has «ё» only in the words that need it: every other «ё» is written «е» (ее, еще, пришел, нашел, …)', () => {
    const stray = yo.filter((t) => !KEPT.has(t.form)).map((t) => `${t.form} (${t.where})`)
    expect(stray).toEqual([])
  })

  it('keeps the «ё» of the pairs it was kept for: none of them has been written without it', () => {
    const count = (form: string) => yo.filter((t) => t.form === form).length
    // at least this many today: a «всё» that loses its «ё» turns into «все» and the count drops
    const atLeast: [string, number][] = [['всё', 68], ['всём', 9], ['чёрт', 8], ['чёрта', 2], ['чём', 3], ['мёд', 2], ['осёл', 2], ['узнаёт', 1], ['слёз', 1], ['нём', 1], ['лёгкие', 1]]
    for (const [form, n] of atLeast) expect(count(form), form).toBeGreaterThanOrEqual(n)
    const at = (where: string, text: string) => expect(pieces.find((p) => p.where === where)?.text, where).toContain(text)
    at('estar · example_translation_ru', 'Всё хорошо?')
    at('miel · ru_translation', 'мёд')
    at('miel · example_translation_ru', 'мёд в тосты')
    at('burro · ru_translation', 'осёл')
    at('burro · example_translation_ru', 'Осёл нес')
    at('diablo · example_translation_ru', 'чёрт возьми')
    at('carajo · ru_translation', 'чёрт возьми / какого чёрта')
    at('emocionar · example_translation_ru', 'до слёз')
    at('intelectual · example_translation_ru', 'узнаёт')
    at('padre · example_translation_ru', 'во всём')
    at('relacionado · example_translation_ru', 'о чём мы')
    at('fallback jo · ru', 'во всём районе')
  })

  it('does not use the «ё»-less spelling for the word that needs it: «во всем», «о чем», «черт возьми», «осел» (the animal), «все будет»', () => {
    const banned: [string, RegExp][] = [
      ['во всем (in everything: во всём)', /(?<![Ѐ-ӿ])во всем(?![Ѐ-ӿ])/i],
      ['о/в чем (about/in what: о чём, в чём)', /(?<![Ѐ-ӿ])[ов] чем(?![Ѐ-ӿ])/i],
      ['черт возьми / какого черта (the devil: чёрт)', /(?<![Ѐ-ӿ])(черт возьми|какого черта)/i],
      ['осел (the donkey: осёл)', /(?<![Ѐ-ӿ])осел(?![Ѐ-ӿ])/i],
      ['все равно / все еще / все больше (still, anyway, ever more: всё)', /(?<![Ѐ-ӿ])все (равно|еще|больше|хуже|более|менее)(?![Ѐ-ӿ])/i],
      ['все + a singular verb (everything: всё будет, всё было, всё прошло)', /(?<![Ѐ-ӿ])все (будет|было|прошло|получилось|наладится|разрешится)(?![Ѐ-ӿ])/i],
    ]
    const hits = pieces.flatMap((p) => banned.filter(([, re]) => re.test(p.text)).map(([name]) => `${name}: ${p.where}`))
    expect(hits).toEqual([])
  })
})
