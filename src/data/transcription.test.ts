import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GOLDEN } from './transcription.golden'
import { OVERRIDES } from './transcriptionOverrides'
import { STRESS, transcribe, transcriptionFlags, transcriptionText } from './transcription'

// The Russian transcription of a Spanish headword: a rule-based reading of the spelling, as Rioplatense is spoken (ll and y are «ш»; c and z are «с»; no aspirated s), with the
// stressed vowel marked. The rules here are written down by hand; the golden list (transcription.golden.ts) pins the output for ~170 real words, and the owner's review sheet decides
// what is right where the rules are unsure (transcriptionOverrides.ts).
//
// In the expectations below a capital vowel is the stressed one: `st('кАса')` is «ка́са» with the stress as the combining acute that transcriptionText() returns.

const VOWELS = 'АЕЁИОУЫЭЮЯ'
const st = (text: string) => text.replace(new RegExp(`[${VOWELS}]`, 'g'), (v) => v.toLowerCase() + STRESS)
const tr = (spanish: string) => transcriptionText(spanish)

describe('stress comes from the spelling', () => {
  it('a written accent marks its vowel', () => {
    expect(tr('árbol')).toBe(st('Арболь'))
    expect(tr('canción')).toBe(st('кансьОн'))
    expect(tr('jóvenes')).toBe(st('хОбенес'))
    expect(tr('tenés')).toBe(st('тенЕс'))
    expect(tr('también')).toBe(st('тамбьЕн'))
    expect(tr('cuándo')).toBe(st('куАндо'))
  })

  it('without one: a word ending in a vowel, n or s is stressed on the next to last syllable, any other on the last', () => {
    expect(tr('casa')).toBe(st('кАса'))
    expect(tr('hablan')).toBe(st('Аблан'))
    expect(tr('virus')).toBe(st('бИрус'))
    expect(tr('papel')).toBe(st('папЕль'))
    expect(tr('hablar')).toBe(st('аблАр'))
    expect(tr('ciudad')).toBe(st('сьюдАд'))
    expect(tr('reloj')).toBe(st('релОх'))
  })

  it('a final y counts as a consonant for the rule: Uruguay is stressed on the last syllable', () => {
    expect(tr('Uruguay')).toBe(`Уругуа${STRESS}й`)
  })

  it('a word of one syllable has no mark, whatever its spelling (the accent on qué, él, sí tells words apart; it is not stress)', () => {
    for (const w of ['yo', 'de', 'que', 'qué', 'él', 'sí', 'vos', 'hay', 'muy', 'rey', 'ley', 'huir', 'fue']) expect(tr(w), w).not.toContain(STRESS)
  })

  it('two vowels that are both strong are two syllables; a weak one with the accent is its own too', () => {
    expect(tr('leer')).toBe(st('леЭр'))
    expect(tr('poeta')).toBe(st('поЭта'))
    expect(tr('país')).toBe(st('паИс'))
    expect(tr('baúl')).toBe(st('баУль'))
    expect(tr('día')).toBe(st('дИа'))
  })

  it('a strong and a weak vowel, or two weak ones, are one syllable, stressed on the strong (the second of two weak)', () => {
    expect(tr('aire')).toBe(st('Айре'))
    expect(tr('reina')).toBe(st('рЕйна'))
    expect(tr('ruido')).toBe(st('руИдо'))
    expect(tr('cuidar')).toBe(st('куидАр'))
    expect(tr('viuda')).toBe(st('бьЮда'))
    expect(tr('agua')).toBe(st('Агуа'))
  })

  it('an h between two vowels does not join them: ahora, alcohol and prohibir have the syllables they are said with', () => {
    expect(tr('ahora')).toBe(st('аОра'))
    expect(tr('prohibir')).toBe(st('проибИр'))
    expect(tr('cohete')).toBe(st('коЭте'))
  })
})

describe('the consonants, as Rioplatense says them', () => {
  it('sheísmo: ll and y before a vowel are «ш»', () => {
    expect(tr('llevar')).toBe(st('шебАр'))
    expect(tr('calle')).toBe(st('кАше'))
    expect(tr('yo')).toBe('шо')
    expect(tr('playa')).toBe(st('плАша'))
    expect(tr('ayer')).toBe(st('ашЕр'))
    expect(tr('yegua')).toBe(st('шЕгуа'))
  })

  it('a final y is a vowel sound («й»), and the word y is «и»', () => {
    expect(tr('hoy')).toBe('ой')
    expect(tr('muy')).toBe('муй')
    expect(tr('y')).toBe('и')
  })

  it('seseo: c before e or i, and z, are «с»; c elsewhere is «к»; cc before e or i is «кс»', () => {
    expect(tr('cerveza')).toBe(st('сербЕса'))
    expect(tr('zorro')).toBe(st('сОрро'))
    expect(tr('cosa')).toBe(st('кОса'))
    expect(tr('acción')).toBe(st('аксьОн'))
    expect(tr('escena')).toBe(st('эсЕна'))
  })

  it('b and v are «б»; h is silent; ch is «ч»', () => {
    expect(tr('vaca')).toBe(st('бАка'))
    expect(tr('hacer')).toBe(st('асЕр'))
    expect(tr('chico')).toBe(st('чИко'))
  })

  it('qu and gu before e or i keep no u; gü and gu before a or o keep it', () => {
    expect(tr('queso')).toBe(st('кЕсо'))
    expect(tr('guerra')).toBe(st('гЕрра'))
    expect(tr('guitarra')).toBe(st('гитАрра'))
    expect(tr('pingüino')).toBe(st('пингуИно'))
    expect(tr('vergüenza')).toBe(st('бергуЭнса'))
    expect(tr('agua')).toBe(st('Агуа'))
  })

  it('j, and g before e or i, are «х»; g elsewhere is «г»', () => {
    expect(tr('gente')).toBe(st('хЕнте'))
    expect(tr('jamón')).toBe(st('хамОн'))
    expect(tr('gato')).toBe(st('гАто'))
  })

  it('ñ is «нь», with the vowel after it written as after a soft consonant', () => {
    expect(tr('año')).toBe(st('Аньо'))
    expect(tr('mañana')).toBe(st('маньЯна'))
    expect(tr('niño')).toBe(st('нИньо'))
    expect(tr('cañón')).toBe(st('каньОн'))
    expect(tr('ñandú')).toBe(st('ньяндУ'))
    expect(tr('pañuelo')).toBe(st('паньуЭло'))
  })

  it('r is «р» and rr is «рр»', () => {
    expect(tr('pero')).toBe(st('пЕро'))
    expect(tr('perro')).toBe(st('пЕрро'))
  })

  it('x is «кс» everywhere (careful speech, as it is spelled): between vowels, before a consonant, at the end; at the start of a word it is «с» (xilófono); in México, Texas, Oaxaca it is «х»', () => {
    expect(tr('examen')).toBe(st('эксАмен'))
    expect(tr('taxi')).toBe(st('тАкси'))
    expect(tr('extranjero')).toBe(st('экстранхЕро'))
    expect(tr('explicar')).toBe(st('экспликАр'))
    expect(tr('texto')).toBe(st('тЕксто'))
    expect(tr('sexto')).toBe(st('сЕксто'))
    expect(tr('próximo')).toBe(st('прОксимо'))
    expect(tr('xilófono')).toBe(st('силОфоно'))
    expect(tr('mexicano')).toBe(st('мехикАно'))
    expect(tr('texas')).toBe(st('тЕхас'))
    expect(tr('oaxaca')).toBe(st('оахАка'))
  })

  it('xc before e/i is one «кс» (the c is not said twice): excelente is э-кс-е-ле́н-те, and the е after the «с» is «е» (э is only for the start of a word and after a vowel); before a, o, u or a consonant the c keeps its own sound', () => {
    expect(tr('excelente')).toBe(st('экселЕнте'))
    expect(tr('excepto')).toBe(st('эксЕпто'))
    expect(tr('exceso')).toBe(st('эксЕсо'))
    expect(tr('excepción')).toBe(st('эксепсьОн'))
    expect(tr('excitar')).toBe(st('экситАр'))
    expect(tr('excusa')).toBe(st('экскУса'))
    expect(tr('exclusivo')).toBe(st('эксклусИбо'))
    expect(tr('excursión')).toBe(st('экскурсьОн'))
    // no doubled «сс» or «ксс»: that would be said as a long consonant
    for (const w of ['excelente', 'exceso', 'excitar', 'excusa', 'exclusivo', 'extranjero', 'texto', 'sexo']) expect(tr(w), w).not.toMatch(/сс/)
  })

  it('the s is «с» everywhere: it is not aspirated', () => {
    expect(tr('vos')).toBe('бос')
    expect(tr('tenés')).toBe(st('тенЕс'))
    expect(tr('mismo')).toBe(st('мИсмо'))
  })

  it('ps at the start is said «с» (psicología); the des- prefix before h is «с», not a «ш» (deshacer)', () => {
    expect(tr('psicología')).toBe(st('сиколохИа'))
    expect(tr('deshacer')).toBe(st('десасЕр'))
    expect(tr('shock')).toBe('шок') // sh is «ш» in a loan, and ck is one sound
  })
})

describe('the vowels', () => {
  it('e is «е» after a consonant, «э» at the start of a word, after a vowel or after the glide у', () => {
    expect(tr('mesa')).toBe(st('мЕса'))
    expect(tr('esto')).toBe(st('Эсто'))
    expect(tr('leer')).toBe(st('леЭр'))
    expect(tr('poeta')).toBe(st('поЭта'))
    expect(tr('huevo')).toBe(st('уЭбо'))
    expect(tr('jueves')).toBe(st('хуЭбес'))
    expect(tr('Europa')).toBe(`Эуро${STRESS}па`)
  })

  it('a glide: after a consonant ia is «ья», ie «ье», io «ьо», iu «ью»; at the start or after a vowel it is «й»', () => {
    expect(tr('gracias')).toBe(st('грАсьяс'))
    expect(tr('familia')).toBe(st('фамИлья'))
    expect(tr('bien')).toBe('бьен')
    expect(tr('cielo')).toBe(st('сьЕло'))
    expect(tr('estudio')).toBe(st('эстУдьо'))
    expect(tr('ciudad')).toBe(st('сьюдАд'))
    expect(tr('hielo')).toBe(st('йЕло'))
    expect(transcriptionFlags('hielo')).toContain('hie')
    expect(tr('aire')).toBe(st('Айре'))
    expect(tr('auto')).toBe(st('Ауто'))
  })

  it('u before a vowel is the glide «у»: agua, cuando, huevo', () => {
    expect(tr('cuando')).toBe(st('куАндо'))
    expect(tr('huevo')).toBe(st('уЭбо'))
  })
})

describe('a form is transcribed as it is headlined, word by word', () => {
  it('a phrase: each word on its own, the spaces kept, a one-syllable word unmarked', () => {
    expect(tr('de veras')).toBe(`де ${st('бЕрас')}`)
    expect(tr('con vos')).toBe('кон бос')
    expect(tr('control remoto')).toBe(st('контрОль ремОто'))
    expect(tr('casa de salud')).toBe(st('кАса де салУд'))
    expect(tr('de repente')).toBe(`де ${st('репЕнте')}`)
  })

  it('a capital stays a capital (a place or a name)', () => {
    expect(tr('San')).toBe('Сан')
    expect(tr('Jesús')).toBe(`Хесу${STRESS}с`)
    expect(tr('Puerto')).toBe(`Пуэ${STRESS}рто`)
  })

  it('what is not Spanish spelling is not transcribed: digits, other punctuation, an empty string', () => {
    expect(tr('')).toBeNull()
    expect(tr('hello1')).toBeNull()
    expect(tr('3D')).toBeNull()
    expect(tr('a@b')).toBeNull()
  })

  it('a short run of capitals or a word with a full stop is an abbreviation: no transcription at all', () => {
    for (const form of ['XYZ', 'Dr.', 'OK', 'IA', 'Sr.', 'ADN', 'CD', 'DANA', 'EE. UU.', 'S.A.']) expect(tr(form), form).toBeNull()
    expect(transcribe('ADN')).toBeNull()
  })

  it('a letter of the alphabet (the dictionary lists sixteen as words) and a form with no vowel in it (pm) have none either; the one-letter words a, e, o, u, y still do', () => {
    for (const form of ['s', 'i', 'm', 'c', 'd', 'b', 't', 'n', 'p', 'g', 'l', 'r', 'j', 'v', 'x', 'h', 'f', 'pm', 'km']) expect(tr(form), form).toBeNull()
    expect(tr('a')).toBe('а')
    expect(tr('o')).toBe('о')
    expect(tr('y')).toBe('и')
    expect(tr('e')).toBe('э')
    expect(tr('u')).toBe('у')
  })

  it('the rules read these on their own, with no override: prohibir, psicología, deshacer', () => {
    expect(tr('prohibir')).toBe(st('проибИр'))
    expect(tr('psicología')).toBe(st('сиколохИа'))
    expect(tr('psiquiatra')).toBe(st('сикьЯтра'))
    expect(tr('deshacer')).toBe(st('десасЕр'))
    for (const form of ['prohibir', 'psicología', 'psiquiatra', 'deshacer']) expect(OVERRIDES[form], form).toBeUndefined()
  })
})

describe('the pieces the page draws', () => {
  it('the stressed vowel is a piece of its own; the pieces joined are the text without the mark', () => {
    const pieces = transcribe('llevar')!
    expect(pieces.map((p) => p.text).join('')).toBe('шебар')
    expect(pieces.filter((p) => p.stressed).map((p) => p.text)).toEqual(['а'])
    expect(pieces).toEqual([
      { text: 'шеб', stressed: false },
      { text: 'а', stressed: true },
      { text: 'р', stressed: false },
    ])
  })

  it('a word of one syllable has no stressed piece; a phrase has one for each longer word', () => {
    expect(transcribe('yo')).toEqual([{ text: 'шо', stressed: false }])
    expect(transcribe('de veras')!.filter((p) => p.stressed)).toHaveLength(1)
    expect(transcribe('casa de salud')!.filter((p) => p.stressed)).toHaveLength(2)
  })

  it('the text form is the pieces with the combining acute after each stressed vowel', () => {
    expect(transcriptionText('llevar')).toBe(`шеба${STRESS}р`)
  })
})

describe('what makes a form worth a second look (the review sheet lists these)', () => {
  it('names why: x, -mente, an h between vowels, ps at the start, a letter outside the Spanish alphabet, a phrase, an override', () => {
    expect(transcriptionFlags('examen')).toContain('x')
    expect(transcriptionFlags('realmente')).toContain('mente')
    expect(transcriptionFlags('ahora')).toContain('h')
    expect(transcriptionFlags('psicología')).toContain('ps')
    expect(transcriptionFlags('kilómetro')).toContain('loan')
    expect(transcriptionFlags('de veras')).toContain('phrase')
    expect(transcriptionFlags('whisky')).toContain('override')
    expect(transcriptionFlags('ADN')).toContain('abbreviation')
    expect(transcriptionFlags('ADN')).not.toContain('override')
    expect(transcriptionFlags('casa')).toEqual([])
  })
})

describe('the overrides', () => {
  const keys = Object.keys(OVERRIDES)

  it('are keyed by the form in lower case, one entry each', () => {
    for (const key of keys) expect(key, key).toBe(key.toLowerCase())
  })

  it('are Cyrillic, with the stress marked by the combining acute straight after a vowel (or no mark for one syllable)', () => {
    for (const [key, value] of Object.entries(OVERRIDES)) {
      expect(value, key).toMatch(/^(?:[а-я -]|\u0301)+$/i)
      for (const m of value.matchAll(/(.)́/g)) expect(m[1], `${key}: ${value}`).toMatch(/[аеиоуыэюя]/i)
    }
  })

  it('win over the rules, in the pieces the page draws as well as in the text', () => {
    expect(tr('whisky')).toBe(OVERRIDES['whisky'])
    expect(transcribe('whisky')!.map((p) => p.text).join('')).toBe(OVERRIDES['whisky'].replace(/́/g, ''))
  })

  it('hold loan words only: no letter of the alphabet and no abbreviation has one (they have no transcription)', () => {
    const dictionary: { es_word: string; pos: string }[] = JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))
    const letters = dictionary.filter((w) => w.pos === 'letter').map((w) => w.es_word.toLowerCase())
    expect(letters).toHaveLength(16)
    for (const letter of letters) expect(OVERRIDES[letter], letter).toBeUndefined()
    for (const abbreviation of ['ok', 'ia', 'sr.', 'adn', 'cd', 'dana']) expect(OVERRIDES[abbreviation], abbreviation).toBeUndefined()
    expect(Object.keys(OVERRIDES).sort()).toEqual(['jean', 'placard', 'sándwich', 'whisky'])
  })
})

describe('-mente: two stresses, the base word\'s and «ме́нте»', () => {
  it('the adverb keeps the stress of the adjective it is made from, and the ending is stressed too', () => {
    expect(tr('rápidamente')).toBe(st('рАпидамЕнте'))
    expect(tr('simplemente')).toBe(st('сИмплемЕнте'))
    expect(tr('lentamente')).toBe(st('лЕнтамЕнте'))
    expect(tr('felizmente')).toBe(st('фелИсмЕнте'))
    expect(tr('fácilmente')).toBe(st('фАсильмЕнте'))
    expect(tr('realmente')).toBe(st('реАльмЕнте'))
    expect(tr('actualmente')).toBe(st('актуАльмЕнте'))
    expect(tr('desafortunadamente')).toBe(st('десафортунАдамЕнте'))
  })

  it('the page gets two stressed pieces', () => {
    expect(transcribe('rápidamente')!.filter((p) => p.stressed).map((p) => p.text)).toEqual(['а', 'е'])
  })

  it('a word that only ends in the same letters is not an adverb: mente, demente, clemente keep one stress', () => {
    expect(tr('mente')).toBe(st('мЕнте'))
    expect(tr('demente')).toBe(st('демЕнте'))
    expect(tr('clemente')).toBe(st('клемЕнте'))
  })
})

describe('i and y as a glide after a consonant: «ья ье ьо ью»', () => {
  it('ia is «ья» (not «я»), ie «ье», io «ьо», iu «ью»', () => {
    expect(tr('existencia')).toBe(st('эксистЕнсья'))
    expect(tr('galaxia')).toBe(st('галАксья'))
    expect(tr('zanahoria')).toBe(st('санаОрья'))
    expect(tr('gracias')).toBe(st('грАсьяс'))
    expect(tr('experiencia')).toBe(st('эксперьЕнсья'))
    expect(tr('estudio')).toBe(st('эстУдьо'))
    expect(tr('ciudad')).toBe(st('сьюдАд'))
    expect(tr('tiempo')).toBe(st('тьЕмпо'))
  })

  it('after a vowel or at the start it stays «й»; after ñ it is as before («нья»)', () => {
    expect(tr('hay')).toBe('ай')
    expect(tr('hielo')).toBe(st('йЕло'))
    expect(tr('compañía')).toBe(st('компанИа'))
    expect(tr('ñandú')).toBe(st('ньяндУ'))
  })

  it('no «я» stands for ia after a consonant that is not a soft one (the glide is always written)', () => {
    for (const w of ['historia', 'gracias', 'existencia', 'familia', 'media', 'distancia']) expect(tr(w), w).toMatch(/ья/)
  })
})

describe('l at the end of a word or before a consonant is «ль»', () => {
  it('at the end', () => {
    expect(tr('árbol')).toBe(st('Арболь'))
    expect(tr('papel')).toBe(st('папЕль'))
    expect(tr('azul')).toBe(st('асУль'))
    expect(tr('excepcional')).toBe(st('эксепсьонАль'))
    expect(tr('control')).toBe(st('контрОль'))
    expect(tr('el')).toBe('эль')
  })

  it('before a consonant', () => {
    expect(tr('alto')).toBe(st('Альто'))
    expect(tr('alma')).toBe(st('Альма'))
    expect(tr('bolsa')).toBe(st('бОльса'))
    expect(tr('golf')).toBe('гольф')
  })

  it('before a vowel (also across a silent h) it stays «л», and ll is still «ш»', () => {
    expect(tr('luz')).toBe('лус')
    expect(tr('plato')).toBe(st('плАто'))
    expect(tr('salud')).toBe(st('салУд'))
    expect(tr('calle')).toBe(st('кАше'))
    expect(tr('alhaja')).toBe(st('алАха'))
  })
})

describe('the golden list: what the converter gives for about 170 real forms', () => {
  it('has the size it should and no form twice', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(150)
    expect(GOLDEN.length).toBeLessThanOrEqual(200)
    expect(new Set(GOLDEN.map(([w]) => w)).size).toBe(GOLDEN.length)
  })

  it('every form gives exactly the transcription written next to it', () => {
    for (const [word, expected] of GOLDEN) expect(transcriptionText(word), word).toBe(expected)
  })

  it('every form is one the app has: a dictionary word or an overlay form', () => {
    const dictionary: { es_word: string }[] = JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))
    const overlay: { rio_form: string | null; alt_form: string | null }[] = JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))
    const known = new Set([...dictionary.map((w) => w.es_word), ...overlay.flatMap((o) => [o.rio_form, o.alt_form])].filter(Boolean))
    for (const [word] of GOLDEN) expect(known.has(word), word).toBe(true)
  })

  it('has at least one form of every rule that can be unsure', () => {
    const seen = new Set(GOLDEN.flatMap(([w]) => transcriptionFlags(w)))
    for (const flag of ['x', 'mente', 'h', 'ps', 'loan', 'phrase', 'override']) expect(seen.has(flag as never), flag).toBe(true)
  })
})
