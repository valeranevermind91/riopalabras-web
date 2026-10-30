// The forms of a Spanish verb, for Cloze: a typed answer that is any form of the card's verb counts (see checkClozeAnswer). We store the dictionary word and the one form
// the example shows, and nothing about person or tense, so the forms are generated here from the dictionary word, by rule where a verb follows the rules and from
// a table where it does not.
//
// THE RULE THIS FILE KEEPS: a form is accepted only if this file can vouch for it. A verb it cannot vouch for gets no forms at all (`verbForms` returns null) and Cloze
// takes only the sentence form and the dictionary word, as before; rejecting a correct but unusual answer is the cost we chose over accepting a word that is not the
// verb. So there are four kinds of verb, and every verb is exactly one:
//   - a verb that follows the rules (the default): the full set of regular -ar/-er/-ir forms, with the spelling changes the rules make (busqué, empiece, escojo, conozco,
//     venzo, sigo, construyó, leyó, averigüé);
//   - a stem-changer (pienso, duermo, pido, juego, adquiero): the regular forms with the vowel changing as its class says. Which verbs change is not in the spelling, so
//     each is named below under its class;
//   - an irregular participle (abierto, escrito, vuelto, muerto), on top of either of the above;
//   - a verb written out in IRREGULAR (ser, tener, ir ...), and a verb known to be irregular that has no table yet (UNTABLED): the second gets nothing.
// A verb in none of the lists is taken to follow the rules. That is a claim about the verb, so test/verbForms.test.ts checks every verb card in the data against it.
//
// The forms are the standard ones and the voseo ones together: «tienes» and «tenés», «tienes» and «tiene», «habláis» and «hablan». The person who was taught «tienes» and
// is asked for «tenés» is right about the word and has not yet learned the form the app teaches, and Cloze shows the sentence's form in place.
//
// Forms are compared without accents (a missing accent is already accepted by Cloze), so they are kept folded and the accents below are for the reader. ñ is a letter.

const DIACRITICS: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' }
/** The same folding as practice.ts's foldAccents (a test holds them together); it is not imported because practice.ts imports this file. */
const fold = (text: string): string => [...text.normalize('NFC').toLowerCase()].map((c) => DIACRITICS[c] ?? c).join('')

type Kind = 'ar' | 'er' | 'ir'
type Tense = 'pres' | 'pret' | 'impf' | 'subj' | 'impsubj' | 'futsubj' | 'imp' | 'ger' | 'part'

// Endings by tense, in the order of persons. pres/subj/impf/pret: yo, tú, vos, él, nosotros, vosotros, ellos (the preterite and the imperfect have no separate vos).
// imp: tú, vos, usted, nosotros, vosotros, ustedes.
const ENDINGS: Record<Kind, Record<Tense, readonly string[]>> = {
  ar: {
    pres: ['o', 'as', 'ás', 'a', 'amos', 'áis', 'an'],
    pret: ['é', 'aste', 'ó', 'amos', 'asteis', 'aron'],
    impf: ['aba', 'abas', 'aba', 'ábamos', 'abais', 'aban'],
    subj: ['e', 'es', 'és', 'e', 'emos', 'éis', 'en'],
    impsubj: ['ara', 'aras', 'ara', 'áramos', 'arais', 'aran', 'ase', 'ases', 'ase', 'ásemos', 'aseis', 'asen'],
    futsubj: ['are', 'ares', 'are', 'áremos', 'areis', 'aren'],
    imp: ['a', 'á', 'e', 'emos', 'ad', 'en'],
    ger: ['ando'],
    part: ['ado', 'ada', 'ados', 'adas'],
  },
  er: {
    pres: ['o', 'es', 'és', 'e', 'emos', 'éis', 'en'],
    pret: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'],
    impf: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    subj: ['a', 'as', 'ás', 'a', 'amos', 'áis', 'an'],
    impsubj: ['iera', 'ieras', 'iera', 'iéramos', 'ierais', 'ieran', 'iese', 'ieses', 'iese', 'iésemos', 'ieseis', 'iesen'],
    futsubj: ['iere', 'ieres', 'iere', 'iéremos', 'iereis', 'ieren'],
    imp: ['e', 'é', 'a', 'amos', 'ed', 'an'],
    ger: ['iendo'],
    part: ['ido', 'ida', 'idos', 'idas'],
  },
  ir: {
    pres: ['o', 'es', 'ís', 'e', 'imos', 'ís', 'en'],
    pret: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'],
    impf: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    subj: ['a', 'as', 'ás', 'a', 'amos', 'áis', 'an'],
    impsubj: ['iera', 'ieras', 'iera', 'iéramos', 'ierais', 'ieran', 'iese', 'ieses', 'iese', 'iésemos', 'ieseis', 'iesen'],
    futsubj: ['iere', 'ieres', 'iere', 'iéremos', 'iereis', 'ieren'],
    imp: ['e', 'í', 'a', 'amos', 'id', 'an'],
    ger: ['iendo'],
    part: ['ido', 'ida', 'idos', 'idas'],
  },
}
const FUTURE = ['é', 'ás', 'á', 'emos', 'éis', 'án']
const CONDITIONAL = ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían']

/** The vowel change of a stem-changing verb: the last e of the stem becomes ie, and so on. */
export type StemChange = 'e-ie' | 'o-ue' | 'e-i' | 'u-ue' | 'i-ie'

const words = (list: string): readonly string[] => list.split(/\s+/).filter(Boolean)

// The stem-changers, by class (a reflexive verb is named without its "se"). A class names a vowel change in the stressed stem (pienso, piensas, piensa, piensan: present,
// subjunctive and the imperative for tú, usted, ustedes) and, for an -ir verb, e>i / o>u where the stem is unstressed but the ending begins with i or with a stressed
// a or e (sintió, sintiendo, sintamos, durmiera).
const STEM_CHANGERS: Record<StemChange, readonly string[]> = {
  'e-ie': words(`
    sentir pensar perder entender empezar comenzar convertir sentar referir cerrar mentir despertar preferir negar defender divertir advertir sugerir atender encender
    requerir manifestar confesar atravesar tender extender encerrar recomendar enterrar apretar herir arrepentir gobernar calentar temblar ascender invertir descender
    transferir hervir interferir reventar aferrar tropezar asentar desplegar quebrar verter sembrar acertar tentar consentir concernir`),
  'o-ue': words(`
    encontrar volver morir recordar contar dormir mover mostrar sonar probar soler volar devolver demostrar resolver costar soltar apostar acordar doler comprobar acostar
    soñar colgar rogar aprobar morder llover rodar avergonzar almorzar forzar promover esforzar renovar envolver colar reforzar remover conmover consolar revolver`),
  'e-i': words('seguir conseguir pedir servir elegir despedir repetir impedir perseguir rendir vestir medir competir corregir concebir proseguir regir'),
  'u-ue': words('jugar'),
  'i-ie': words('adquirir'),
}

/** Verbs with an irregular participle, which takes the place of the regular one (abierto, and not abrido): what the other forms do is decided by the lists above and below. */
const PARTICIPLES: Record<string, string> = {
  abrir: 'abierto abierta abiertos abiertas',
  cubrir: 'cubierto cubierta cubiertos cubiertas',
  descubrir: 'descubierto descubierta descubiertos descubiertas',
  escribir: 'escrito escrita escritos escritas',
  describir: 'descrito descrita descritos descritas',
  inscribir: 'inscrito inscrita inscritos inscritas',
  romper: 'roto rota rotos rotas',
  morir: 'muerto muerta muertos muertas',
  volver: 'vuelto vuelta vueltos vueltas',
  devolver: 'devuelto devuelta devueltos devueltas',
  envolver: 'envuelto envuelta envueltos envueltas',
  revolver: 'revuelto revuelta revueltos revueltas',
  resolver: 'resuelto resuelta resueltos resueltas',
}

/**
 * Known to be irregular, and with no table here yet: the verbs gets no generated forms (a regular conjugation would accept forms that are not words: «teno», «oyí»). The
 * ones that belong to the family of a table verb (suponer, mantener, atraer ...) can take that table when it is wanted; the others need one of their own.
 */
export const UNTABLED: readonly string[] = words(`
  oír salir valer traer caer andar caber reír sonreír freír oler satisfacer yacer bendecir maldecir predecir deshacer
  mantener detener obtener sostener contener retener entretener suponer proponer disponer imponer componer exponer oponer interponer
  intervenir convenir provenir prevenir atraer extraer distraer contraer prever
  producir conducir reducir introducir traducir reproducir seducir deducir inducir`)

/**
 * A verb written out. Each field is the forms of one tense, in any order. `fut` is the stem of the future and the conditional (tendr-), and the imperfect and future
 * subjunctive are made from the third person plural of `pret` (tuvieron > tuviera, tuviese, tuviere), which they always are. Both ways of saying the second person are listed:
 * «tienes» and «tenés», «sé» and «sos».
 */
interface Irregular {
  pres: string
  pret: string
  impf: string
  fut: string
  subj: string
  imp: string
  ger: string
  part: string
}

const IRREGULAR: Record<string, Irregular> = {
  ser: {
    pres: 'soy eres sos es somos sois son',
    pret: 'fui fuiste fue fuimos fuisteis fueron',
    impf: 'era eras era éramos erais eran',
    fut: 'ser',
    subj: 'sea seas seás sea seamos seáis sean',
    imp: 'sé sea seamos sed sean',
    ger: 'siendo',
    part: 'sido',
  },
  estar: {
    pres: 'estoy estás está estamos estáis están',
    pret: 'estuve estuviste estuvo estuvimos estuvisteis estuvieron',
    impf: 'estaba estabas estaba estábamos estabais estaban',
    fut: 'estar',
    subj: 'esté estés estemos estéis estén',
    imp: 'está esté estemos estad estén',
    ger: 'estando',
    part: 'estado estada estados estadas',
  },
  haber: {
    pres: 'he has ha hay hemos habéis han',
    pret: 'hube hubiste hubo hubimos hubisteis hubieron',
    impf: 'había habías había habíamos habíais habían',
    fut: 'habr',
    subj: 'haya hayas hayás hayamos hayáis hayan',
    imp: '',
    ger: 'habiendo',
    part: 'habido',
  },
  tener: {
    pres: 'tengo tienes tenés tiene tenemos tenéis tienen',
    pret: 'tuve tuviste tuvo tuvimos tuvisteis tuvieron',
    impf: 'tenía tenías tenía teníamos teníais tenían',
    fut: 'tendr',
    subj: 'tenga tengas tengás tengamos tengáis tengan',
    imp: 'ten tené tenga tengamos tened tengan',
    ger: 'teniendo',
    part: 'tenido tenida tenidos tenidas',
  },
  ir: {
    pres: 'voy vas va vamos vais van',
    pret: 'fui fuiste fue fuimos fuisteis fueron',
    impf: 'iba ibas iba íbamos ibais iban',
    fut: 'ir',
    subj: 'vaya vayas vayás vayamos vayáis vayan',
    imp: 've vaya vamos vayamos id vayan',
    ger: 'yendo',
    part: 'ido ida idos idas',
  },
  hacer: {
    pres: 'hago haces hacés hace hacemos hacéis hacen',
    pret: 'hice hiciste hizo hicimos hicisteis hicieron',
    impf: 'hacía hacías hacía hacíamos hacíais hacían',
    fut: 'har',
    subj: 'haga hagas hagás hagamos hagáis hagan',
    imp: 'haz hacé haga hagamos haced hagan',
    ger: 'haciendo',
    part: 'hecho hecha hechos hechas',
  },
  poder: {
    pres: 'puedo puedes podés puede podemos podéis pueden',
    pret: 'pude pudiste pudo pudimos pudisteis pudieron',
    impf: 'podía podías podía podíamos podíais podían',
    fut: 'podr',
    subj: 'pueda puedas podás podamos podáis puedan',
    imp: 'puede podé pueda podamos poded puedan',
    ger: 'pudiendo',
    part: 'podido',
  },
  decir: {
    pres: 'digo dices decís dice decimos dicen',
    pret: 'dije dijiste dijo dijimos dijisteis dijeron',
    impf: 'decía decías decía decíamos decíais decían',
    fut: 'dir',
    subj: 'diga digas digás digamos digáis digan',
    imp: 'di decí diga digamos decid digan',
    ger: 'diciendo',
    part: 'dicho dicha dichos dichas',
  },
  querer: {
    pres: 'quiero quieres querés quiere queremos queréis quieren',
    pret: 'quise quisiste quiso quisimos quisisteis quisieron',
    impf: 'quería querías quería queríamos queríais querían',
    fut: 'querr',
    subj: 'quiera quieras querás queramos queráis quieran',
    imp: 'quiere queré quiera queramos quered quieran',
    ger: 'queriendo',
    part: 'querido querida queridos queridas',
  },
  ver: {
    pres: 'veo ves ve vemos veis ven',
    pret: 'vi viste vio vimos visteis vieron',
    impf: 'veía veías veía veíamos veíais veían',
    fut: 'ver',
    subj: 'vea veas veás veamos veáis vean',
    imp: 've vea veamos ved vean',
    ger: 'viendo',
    part: 'visto vista vistos vistas',
  },
  saber: {
    pres: 'sé sabes sabés sabe sabemos sabéis saben',
    pret: 'supe supiste supo supimos supisteis supieron',
    impf: 'sabía sabías sabía sabíamos sabíais sabían',
    fut: 'sabr',
    subj: 'sepa sepas sepás sepamos sepáis sepan',
    imp: 'sabe sabé sepa sepamos sabed sepan',
    ger: 'sabiendo',
    part: 'sabido sabida sabidos sabidas',
  },
  dar: {
    pres: 'doy das da damos dais dan',
    pret: 'di diste dio dimos disteis dieron',
    impf: 'daba dabas daba dábamos dabais daban',
    fut: 'dar',
    subj: 'dé des demos deis den',
    imp: 'da dá dé demos dad den',
    ger: 'dando',
    part: 'dado dada dados dadas',
  },
  venir: {
    pres: 'vengo vienes venís viene venimos vienen',
    pret: 'vine viniste vino vinimos vinisteis vinieron',
    impf: 'venía venías venía veníamos veníais venían',
    fut: 'vendr',
    subj: 'venga vengas vengás vengamos vengáis vengan',
    imp: 'ven vení venga vengamos venid vengan',
    ger: 'viniendo',
    part: 'venido venida venidos venidas',
  },
  poner: {
    pres: 'pongo pones ponés pone ponemos ponéis ponen',
    pret: 'puse pusiste puso pusimos pusisteis pusieron',
    impf: 'ponía ponías ponía poníamos poníais ponían',
    fut: 'pondr',
    subj: 'ponga pongas pongás pongamos pongáis pongan',
    imp: 'pon poné ponga pongamos poned pongan',
    ger: 'poniendo',
    part: 'puesto puesta puestos puestas',
  },
}

export const IRREGULAR_VERBS: readonly string[] = Object.keys(IRREGULAR)

// ---- generating --------------------------------------------------------------------------------------------------------------------

const VOWELS = 'aeiouáéíóú'

/** The stem as the ending that follows needs it to be spelled: busc + é = busqué, empez + e = empiece, escog + o = escojo, conoc + o = conozco, venc + o = venzo. */
function spelled(stem: string, kind: Kind, ending: string): string {
  const next = fold(ending[0])
  if (kind === 'ar') {
    if (next !== 'e') return stem
    if (stem.endsWith('c')) return `${stem.slice(0, -1)}qu`
    if (stem.endsWith('gu')) return `${stem.slice(0, -2)}gü`
    if (stem.endsWith('g')) return `${stem}u`
    if (stem.endsWith('z')) return `${stem.slice(0, -1)}c`
    return stem
  }
  if (next !== 'o' && next !== 'a') return stem
  if (stem.endsWith('gu')) return stem.slice(0, -1) // sigo
  if (stem.endsWith('g')) return `${stem.slice(0, -1)}j` // escojo
  if (stem.endsWith('c')) return `${stem.slice(0, -1)}${stem.length > 1 && !VOWELS.includes(stem[stem.length - 2]) ? 'z' : 'zc'}` // venzo, conozco
  return stem
}

const swapLast = (text: string, from: string, to: string): string => {
  const at = text.lastIndexOf(from)
  return at < 0 ? text : text.slice(0, at) + to + text.slice(at + from.length)
}

// Where the stem is stressed (so a stem-changer changes it): present and subjunctive o/es/e/en, imperative tú, usted, ustedes.
const STRESSED = new Set(['pres:0', 'pres:1', 'pres:3', 'pres:6', 'subj:0', 'subj:1', 'subj:3', 'subj:6', 'imp:0', 'imp:2', 'imp:5'])
// Where an -ir verb's stem is weakened (e>i, o>u): the third person of the preterite, the subjunctive for nosotros, vosotros and vos, the imperative for nosotros, and every form
// of the imperfect and future subjunctive and the gerund.
const WEAK_ALL: readonly Tense[] = ['impsubj', 'futsubj', 'ger']
const WEAK_ONE = new Set(['pret:2', 'pret:5', 'subj:2', 'subj:4', 'subj:5', 'imp:3'])

function changedStem(stem: string, kind: Kind, change: StemChange | null, tense: Tense, at: number): string {
  if (change === null) return stem
  if (STRESSED.has(`${tense}:${at}`)) {
    if (change === 'e-ie') return swapLast(stem, 'e', 'ie')
    if (change === 'o-ue') return swapLast(stem, 'o', 'ue')
    if (change === 'u-ue') return swapLast(stem, 'u', 'ue')
    if (change === 'i-ie') return swapLast(stem, 'i', 'ie')
    return swapLast(stem, 'e', 'i') // e-i
  }
  if (kind === 'ir' && (WEAK_ALL.includes(tense) || WEAK_ONE.has(`${tense}:${at}`))) {
    if (change === 'e-ie' || change === 'e-i') return swapLast(stem, 'e', 'i')
    if (change === 'o-ue') return swapLast(stem, 'o', 'u')
  }
  return stem
}

/** Every form of a verb that follows the rules (with the vowel change its class says, if any), folded. The dictionary form is not among them: Cloze takes that already. */
function ruleForms(base: string, change: StemChange | null): Set<string> {
  const kind = fold(base.slice(-2)) as Kind
  const stem = base.slice(0, -2)
  const out = new Set<string>()
  // -uir (construyo, construyó), and -aer/-eer/-oer (leyó, creyendo): between vowels the i becomes y; the stem's own vowel is not touched
  const yStem = kind === 'ir' && stem.endsWith('u') && !stem.endsWith('gu') && !stem.endsWith('qu')
  const vowelStem = kind === 'er' && 'aeo'.includes(stem[stem.length - 1] ?? '')
  for (const tense of Object.keys(ENDINGS[kind]) as Tense[]) {
    ENDINGS[kind][tense].forEach((ending, at) => {
      let e = ending
      if ((yStem || vowelStem) && e[0] === 'i' && e.length > 1 && 'aeoáéó'.includes(e[1])) e = `y${e.slice(1)}` // ió > yó, iendo > yendo, iera > yera
      else if (yStem && 'aeo'.includes(fold(e[0]))) e = `y${e}` // construyo, construyes, construya
      out.add(fold(spelled(changedStem(stem, kind, change, tense, at), kind, ending) + e))
    })
  }
  for (const e of [...FUTURE, ...CONDITIONAL]) out.add(fold(base + e))
  return out
}

function tableForms(v: Irregular): Set<string> {
  const out = new Set<string>()
  const add = (list: string) => words(list).forEach((form) => out.add(fold(form)))
  add(v.pres)
  add(v.pret)
  add(v.impf)
  add(v.subj)
  add(v.imp)
  add(v.ger)
  add(v.part)
  for (const e of [...FUTURE, ...CONDITIONAL]) out.add(fold(v.fut + e))
  const third = words(v.pret).slice(-1)[0] // tuvieron
  const stem = third.slice(0, -3) // tuvie
  for (const e of ['ra', 'ras', 'ramos', 'rais', 'ran', 'se', 'ses', 'semos', 'seis', 'sen', 're', 'res', 'remos', 'reis', 'ren']) out.add(fold(stem + e))
  return out
}

const CHANGE_OF = new Map<string, StemChange>(
  (Object.entries(STEM_CHANGERS) as [StemChange, readonly string[]][]).flatMap(([change, list]) => list.map((lemma): [string, StemChange] => [lemma, change])),
)
export const STEM_CHANGE_VERBS: ReadonlyMap<string, StemChange> = CHANGE_OF
export const PARTICIPLE_VERBS: readonly string[] = Object.keys(PARTICIPLES)

/** The dictionary word without its "se" (sentarse > sentar), or null when it is not a single -ar / -er / -ir / -ír verb. */
export function verbCore(lemma: string): string | null {
  const word = lemma.trim().toLowerCase().normalize('NFC')
  if (!/^[a-záéíóúüñ]+$/.test(word)) return null
  const base = word.endsWith('se') && word.length > 4 ? word.slice(0, -2) : word
  return /(ar|er|ir|ír)$/.test(base) ? base : null
}

const cache = new Map<string, ReadonlySet<string> | null>()

/**
 * The forms of a verb that Cloze accepts for it, folded and without the dictionary form; null when we cannot vouch for the verb (see the top of this file).
 * `lemma` is the dictionary word as the card shows it. A word the user added must not come here: nothing is known about it.
 */
export function verbForms(lemma: string): ReadonlySet<string> | null {
  const base = verbCore(lemma)
  if (base === null) return null
  const known = cache.get(base)
  if (known !== undefined) return known
  let forms: Set<string> | null = null
  if (UNTABLED.includes(base)) forms = null
  else if (IRREGULAR[base]) forms = tableForms(IRREGULAR[base])
  else {
    const generated = ruleForms(base, CHANGE_OF.get(base) ?? null)
    if (PARTICIPLES[base]) {
      for (const ending of ENDINGS[fold(base.slice(-2)) as Kind].part) generated.delete(fold(base.slice(0, -2) + ending))
      words(PARTICIPLES[base]).forEach((form) => generated.add(fold(form)))
    }
    forms = generated
  }
  cache.set(base, forms)
  return forms
}
