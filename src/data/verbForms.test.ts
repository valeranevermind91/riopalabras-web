import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { headword } from './headword'
import { clozeTarget, foldAccents } from './practice'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { IRREGULAR_VERBS, PARTICIPLE_VERBS, STEM_CHANGE_VERBS, UNTABLED, verbCore, verbForms } from './verbForms'

// What Cloze accepts for a verb. The rule it keeps: a form is accepted only if verbForms.ts can vouch for it, and a verb it cannot vouch for gets nothing.
// Forms are compared without accents, so the tests write them with accents, as a person would, and fold them.

const folded = (list: string) => new Set(list.split(/\s+/).filter(Boolean).map(foldAccents))
const forms = (lemma: string): ReadonlySet<string> => {
  const set = verbForms(lemma)
  if (!set) throw new Error(`no forms for ${lemma}`)
  return set
}
const accepts = (lemma: string, list: string) => {
  const set = forms(lemma)
  const missing = list.split(/\s+/).filter(Boolean).filter((f) => !set.has(foldAccents(f)))
  expect(missing, `${lemma}: not accepted`).toEqual([])
}
const rejects = (lemma: string, list: string) => {
  const set = forms(lemma)
  const found = list.split(/\s+/).filter(Boolean).filter((f) => set.has(foldAccents(f)))
  expect(found, `${lemma}: accepted, but not a form`).toEqual([])
}

describe('the forms are kept the way Cloze compares answers', () => {
  it('already folded (so a typed answer is folded and looked up), ñ kept', () => {
    for (const lemma of ['hablar', 'enseñar', 'averiguar', 'tener', 'jugar']) expect([...forms(lemma)].every((f) => f === foldAccents(f)), lemma).toBe(true)
    expect(forms('enseñar').has('enseño')).toBe(true)
    expect(forms('enseñar').has('ensenó')).toBe(false)
    expect(forms('averiguar').has(foldAccents('averigüé'))).toBe(true)
  })
})

describe('a verb that follows the rules: every form, no more and no fewer (written out for three)', () => {
  const reference: Record<string, string> = {
    hablar: `hablo hablas hablás habla hablamos habláis hablan  hablé hablaste habló hablamos hablasteis hablaron  hablaba hablabas hablábamos hablabais hablaban
      hablaré hablarás hablará hablaremos hablaréis hablarán  hablaría hablarías hablaríamos hablaríais hablarían  hable hables hablés hablemos habléis hablen
      hablara hablaras habláramos hablarais hablaran hablase hablases hablásemos hablaseis hablasen  hablare hablares habláremos hablareis hablaren
      hablá hablad  hablando hablado hablada hablados habladas`,
    comer: `como comes comés come comemos coméis comen  comí comiste comió comimos comisteis comieron  comía comías comíamos comíais comían
      comeré comerás comerá comeremos comeréis comerán  comería comerías comeríamos comeríais comerían  coma comas comás comamos comáis coman
      comiera comieras comiéramos comierais comieran comiese comieses comiésemos comieseis comiesen  comiere comieres comiéremos comiereis comieren
      comé comed  comiendo comido comida comidos comidas`,
    vivir: `vivo vives vivís vive vivimos viven  viví viviste vivió vivimos vivisteis vivieron  vivía vivías vivíamos vivíais vivían
      viviré vivirás vivirá viviremos viviréis vivirán  viviría vivirías viviríamos viviríais vivirían  viva vivas vivás vivamos viváis vivan
      viviera vivieras viviéramos vivierais vivieran viviese vivieses viviésemos vivieseis viviesen  viviere vivieres viviéremos viviereis vivieren
      viví vivid  viviendo vivido vivida vividos vividas`,
  }
  for (const [lemma, list] of Object.entries(reference)) {
    it(lemma, () => {
      expect(forms(lemma)).toEqual(folded(list))
    })
  }

  it('the dictionary form itself is not in the set (Cloze takes that already, as the headword)', () => {
    expect(forms('hablar').has('hablar')).toBe(false)
  })

  it('every plain -ar, -er and -ir verb makes as many forms as these (no spelling change, nothing dropped)', () => {
    for (const [lemma, like] of [['cantar', 'hablar'], ['mirar', 'hablar'], ['beber', 'comer'], ['correr', 'comer'], ['partir', 'vivir'], ['sufrir', 'vivir']] as const) expect(forms(lemma).size, lemma).toBe(forms(like).size)
  })
})

describe('the spelling changes the rules make', () => {
  it('-car, -gar, -zar, -guar before e', () => {
    accepts('buscar', 'busco buscas busqué busque busques busquemos busquen buscó buscaron')
    rejects('buscar', 'buscé busce busces')
    accepts('llegar', 'llego llegué llegue llegues lleguemos lleguen')
    rejects('llegar', 'llegé llege')
    accepts('almorzar', 'almorcé') // (also a stem-changer; the spelling is the same)
    accepts('rezar', 'rezo rezas recé rece reces recemos')
    rejects('rezar', 'rezé reze')
    accepts('averiguar', 'averigüé averigüe averigüemos averiguo averiguó')
  })

  it('-ger, -gir, -guir before o and a', () => {
    accepts('escoger', 'escojo escoges escoge escogemos escogen escogí escoja escojas escojamos escojan')
    rejects('escoger', 'escogo escoga')
    accepts('dirigir', 'dirijo diriges dirija dirijamos dirigió')
    accepts('distinguir', 'distingo distingues distingue distinguimos distinga distingamos distinguí')
    rejects('distinguir', 'distinguo distinguamos')
  })

  it('-cer and -cir: zc after a vowel, z after a consonant', () => {
    accepts('conocer', 'conozco conoces conozca conozcamos conocí conoció')
    rejects('conocer', 'conoco conozo conozcés')
    accepts('parecer', 'parezco parezca parecemos')
    accepts('vencer', 'venzo vences venza venzamos vencí')
    rejects('vencer', 'venzco vencó venca')
    accepts('lucir', 'luzco luces luzca lucimos')
    accepts('convencer', 'convenzo convenza')
  })

  it('-uir takes a y: construyo, construyó, construyendo; but not before an i that is stressed or a consonant', () => {
    accepts('construir', 'construyo construyes construís construye construimos construyen construí construiste construyó construimos construyeron construía construyendo construido construya construyamos construyáis construyera construyese construyere construye construid')
    rejects('construir', 'construio construió construieron construiendo construiya')
    accepts('huir', 'huyo huyes huís huye huimos huyen huí huyó huyeron huyendo huido huya')
    accepts('incluir', 'incluyo incluyó incluyendo')
  })

  it('-eer: leyó, creyendo; the i between vowels is a y', () => {
    accepts('leer', 'leo lees lee leemos leen leí leíste leyó leímos leísteis leyeron leía leyendo leído lea leamos leyera leyese leyere')
    rejects('leer', 'leió leieron leiendo leiera')
    accepts('creer', 'creo crees cree creímos creyó creyeron creyendo creído crea')
  })

  it('the stem keeps its ñ and its other letters', () => {
    accepts('enseñar', 'enseño enseñas enseñó enseñamos enseñé')
    rejects('enseñar', 'ensenó ensenamos')
  })
})

describe('a stem-changer changes its vowel where its class says, and not elsewhere', () => {
  it('e > ie: pensar, with the stem staying put for nosotros, vosotros, the preterite and vos', () => {
    accepts('pensar', 'pienso piensas pensás piensa pensamos pensáis piensan pensé pensaste pensó pensaron pensaba pensaré pensaría piense pienses pensés piense pensemos penséis piensen pensando pensado pensá pensad')
    rejects('pensar', 'piensamos piensáis piensaba piensando piensaré')
  })

  it('e > ie, and an -ir verb also weakens to i: sentir', () => {
    accepts('sentir', 'siento sientes sentís siente sentimos sienten sentí sentiste sintió sentimos sintieron sentía sentiré siente sienta sientas sintás sintamos sintáis sientan sintiera sintiese sintiere sintiendo sentido sentí sentid')
    rejects('sentir', 'sentió sentieron sentiendo sentamos sintimos sentiera sientimos')
  })

  it('o > ue: volver, contar, dormir (with u in the weak places), morir', () => {
    accepts('volver', 'vuelvo vuelves volvés vuelve volvemos volvéis vuelven volví volvió volvía volveré vuelva volvamos volviendo vuelve volvé volved')
    rejects('volver', 'vuelvemos volvo vuelvió vuelviendo volvido')
    accepts('contar', 'cuento cuentas contás cuenta contamos cuentan conté contó cuente contemos contando contá')
    accepts('dormir', 'duermo duermes dormís duerme dormimos duermen dormí durmió durmieron durmiendo dormido duerma duermas durmás durmamos durmáis durmiera durmiese duerme dormí dormid')
    rejects('dormir', 'dormió dormieron dormiendo durmimos dormamos')
    accepts('morir', 'muero mueres morís muere morimos mueren morí murió murieron muriendo muerto muerta muera muramos')
    rejects('morir', 'morió morieron moriendo morido')
  })

  it('e > i (an -ir verb): pedir, seguir, elegir, corregir', () => {
    accepts('pedir', 'pido pides pedís pide pedimos piden pedí pidió pidieron pidiendo pedido pida pidas pidamos pidan pidiera pide pedí pedid')
    rejects('pedir', 'pedió pedieron pediendo pidimos pedamos')
    accepts('seguir', 'sigo sigues seguís sigue seguimos siguen seguí siguió siguieron siguiendo seguido siga sigamos sigan siguiera')
    rejects('seguir', 'seguo seguió seguieron siguí')
    accepts('elegir', 'elijo eliges elegís elige elegimos eligen elegí eligió eligieron eligiendo elegido elija elijamos elijan')
    rejects('elegir', 'eligo elejo elegió elegieron')
    accepts('corregir', 'corrijo corriges corrige corregimos corrigen corregí corrigió corrija corrijamos corrigiendo')
  })

  it('u > ue and i > ie: jugar, adquirir', () => {
    accepts('jugar', 'juego juegas jugás juega jugamos juegan jugué jugó jugaba jugaré juegue juegues juguemos jueguen jugando jugado jugá jugad')
    rejects('jugar', 'juegamos juegaba juegando')
    accepts('adquirir', 'adquiero adquieres adquirís adquiere adquirimos adquieren adquirí adquirió adquiera adquiramos adquirido')
    rejects('adquirir', 'adquiro adquieramos adquierimos')
  })

  it('a stem-changer that also changes its spelling does both: empezar, comenzar, negar, colgar, almorzar, avergonzar', () => {
    accepts('empezar', 'empiezo empiezas empezás empieza empezamos empiezan empecé empezó empiece empieces empecemos empiecen empezando')
    rejects('empezar', 'empezé empiezé empiezamos')
    accepts('comenzar', 'comienzo comienza comencé comience comencemos')
    accepts('negar', 'niego niegas negás niega negamos niegan negué negó niegue neguemos nieguen')
    rejects('negar', 'negé niege')
    accepts('colgar', 'cuelgo cuelgas colgás cuelga colgamos cuelgan colgué cuelgue colguemos cuelguen')
    accepts('almorzar', 'almuerzo almuerzas almorzás almuerza almorzamos almuerzan almorcé almorzó almuerce almorcemos almuercen')
    accepts('avergonzar', 'avergüenzo avergüenzas avergonzamos avergonzó avergoncé avergüence avergoncemos')
  })

  it('a reflexive verb is its verb: sentarse is sentar, arrepentirse is arrepentir', () => {
    accepts('sentarse', 'siento sientas sentamos senté sienta sentado')
    accepts('arrepentirse', 'arrepiento arrepientes arrepentimos arrepintió arrepintieron arrepintiendo arrepentido')
  })

  it('the voseo form of the present never changes its vowel, and neither does the vos imperative', () => {
    for (const [lemma, vos, tu] of [['pensar', 'pensás', 'piensas'], ['volver', 'volvés', 'vuelves'], ['pedir', 'pedís', 'pides'], ['dormir', 'dormís', 'duermes'], ['jugar', 'jugás', 'juegas'], ['sentir', 'sentís', 'sientes']] as const) {
      accepts(lemma, `${vos} ${tu}`) // the person who was taught the second and the one who says the first are both right
    }
    accepts('pensar', 'pensá')
    accepts('volver', 'volvé')
    accepts('pedir', 'pedí')
  })
})

describe('an irregular participle takes the place of the regular one', () => {
  it('abierto, not abrido', () => {
    accepts('abrir', 'abierto abierta abiertos abiertas abrí abrió abrimos abriendo abra')
    rejects('abrir', 'abrido abrida abridos abridas')
    accepts('escribir', 'escrito escrita escritos escritas escribió escribiendo')
    rejects('escribir', 'escribido')
    accepts('romper', 'roto rota rompió rompiendo rompe rompé')
    rejects('romper', 'rompido')
    accepts('cubrir', 'cubierto cubierta')
    accepts('descubrir', 'descubierto descubrió')
    accepts('describir', 'descrito describió')
    accepts('inscribir', 'inscrito inscribió')
    accepts('resolver', 'resuelto resuelvo resolvió')
    accepts('devolver', 'devuelto devuelvo devolvió')
    accepts('envolver', 'envuelto envuelvo')
    accepts('revolver', 'revuelto revuelvo')
    rejects('volver', 'volvido')
  })
})

describe('a verb written out: the forms are the ones the verb has', () => {
  const cases: Record<string, { yes: string; no: string }> = {
    ser: {
      yes: 'soy eres sos es somos sois son fui fuiste fue fuimos fuisteis fueron era eras éramos erais eran seré serás será seremos seréis serán sería serías seríamos seríais serían sea seas seás seamos seáis sean fuera fueras fuéramos fuese fuere siendo sido sé sed',
      no: 'seo sees seía sió sieron seyendo soi seres',
    },
    estar: {
      yes: 'estoy estás está estamos estáis están estuve estuviste estuvo estuvimos estuvieron estaba estábamos estaré estaría esté estés estemos estén estuviera estuviese estando estado estad',
      no: 'estó estí estevo',
    },
    haber: {
      yes: 'he has ha hay hemos habéis han hube hubo hubieron había habré habría haya hayas hayamos hayan hubiera habiendo habido',
      no: 'hayo habo habió habieron',
    },
    tener: {
      yes: 'tengo tienes tenés tiene tenemos tenéis tienen tuve tuviste tuvo tuvimos tuvieron tenía teníamos tendré tendrás tendremos tendría tendrían tenga tengas tengás tengan tuviera tuviese tuviere ten tené tened teniendo tenido tenida',
      no: 'teno tenió tenieron tenerá tendo tiengo tenieres',
    },
    ir: {
      yes: 'voy vas va vamos vais van fui fue fueron iba ibas íbamos iré irás irá iremos irían vaya vayas vayamos fuera ve id yendo ido',
      no: 'io ies vo yió ieron',
    },
    hacer: {
      yes: 'hago haces hacés hace hacemos hacen hice hiciste hizo hicimos hicieron hacía haré harás hará haremos haría hagan haga hagas hagás haz hacé haced haciendo hecho hecha hicieran hiciese',
      no: 'haco hací hacieron hacerá hazo',
    },
    poder: {
      yes: 'puedo puedes podés puede podemos podéis pueden pude pudiste pudo pudimos pudieron podía podíamos podré podrás podrá podremos podría podrían pueda puedas podás puedan pudiera pudiese podido pudiendo',
      no: 'podo podió podieron poderé poduve',
    },
    decir: {
      yes: 'digo dices decís dice decimos dicen dije dijiste dijo dijimos dijeron decía diré dirás dirá diremos diría dirían diga digas digás digan dijera dijese di decí decid diciendo dicho dicha',
      no: 'dezo decio decieron decirá dició',
    },
    querer: {
      yes: 'quiero quieres querés quiere queremos queréis quieren quise quisiste quiso quisimos quisieron quería queríamos querré querrás querrá querríamos querría querrían quiera quieras querás quieran quisiera quisiese quiere queré quered queriendo querido',
      no: 'quero querió querieron quererá',
    },
    ver: {
      yes: 'veo ves ve vemos veis ven vi viste vio vimos vieron veía veíamos veré verás verá veremos vería verían vea veas veamos vean viera viese ved viendo visto vista',
      no: 'vo veí veió veieron veyendo',
    },
    saber: {
      yes: 'sé sabes sabés sabe sabemos sabéis saben supe supiste supo supimos supieron sabía sabíamos sabré sabrás sabrá sabremos sabría sabrían sepa sepas sepás sepan supiera supiese sabé sabed sabiendo sabido',
      no: 'sabo sabí sabió sabieron saberé',
    },
    dar: {
      yes: 'doy das da damos dais dan di diste dio dimos disteis dieron daba dabas dábamos daré darás dará daremos daría darían dé des demos deis den diera diese dad dando dado',
      no: 'dao daste daron dasteis',
    },
    venir: {
      yes: 'vengo vienes venís viene venimos vienen vine viniste vino vinimos vinieron venía veníamos vendré vendrás vendrá vendremos vendría vendrían venga vengas vengás vengan viniera viniese ven vení venid viniendo venido',
      no: 'veno venió venieron venirá vengé',
    },
    poner: {
      yes: 'pongo pones ponés pone ponemos ponen puse pusiste puso pusimos pusieron ponía poníamos pondré pondrás pondrá pondremos pondría pondrían ponga pongas pongás pongan pusiera pusiese pon poné poned poniendo puesto puesta',
      no: 'pono ponió ponieron ponerá',
    },
  }

  it('there is a table for each of these, and no other', () => {
    expect(Object.keys(cases).sort()).toEqual([...IRREGULAR_VERBS].sort())
    expect(IRREGULAR_VERBS).toHaveLength(14)
  })

  for (const [lemma, { yes, no }] of Object.entries(cases)) {
    it(lemma, () => {
      accepts(lemma, yes)
      rejects(lemma, no)
    })
  }

  it('the standard form and the voseo form are both there, for the person and the imperative', () => {
    const pairs: Record<string, string> = {
      tener: 'tienes tenés ten tené tengas tengás',
      poder: 'puedes podés puedas podás',
      querer: 'quieres querés quieras querás',
      hacer: 'haces hacés haz hacé hagas hagás',
      decir: 'dices decís di decí digas digás',
      venir: 'vienes venís ven vení vengas vengás',
      poner: 'pones ponés pon poné pongas pongás',
      saber: 'sabes sabés sabe sabé sepas sepás',
      ser: 'eres sos seas seás',
      ir: 'vas vayas vayás',
      estar: 'estás estés',
      haber: 'has hayas hayás',
      dar: 'das des',
      ver: 'ves veas veás',
    }
    for (const [lemma, list] of Object.entries(pairs)) accepts(lemma, list)
  })

  it('the standard and the voseo second person are both there for a regular verb too', () => {
    accepts('hablar', 'hablas hablás habla hablá hables hablés')
    accepts('comer', 'comes comés come comé comas comás')
    accepts('vivir', 'vives vivís vive viví vivas vivás')
  })
})

describe('a verb we cannot vouch for gets nothing', () => {
  it('an irregular verb with no table yet: forms are not guessed from the infinitive', () => {
    for (const lemma of ['oír', 'salir', 'traer', 'caer', 'oler', 'mantener', 'suponer', 'conducir', 'prever', 'reír', 'sonreír', 'satisfacer']) expect(verbForms(lemma), lemma).toBeNull()
    expect(UNTABLED).toHaveLength(50)
  })

  it('a word that is not a single -ar, -er or -ir verb: nothing', () => {
    for (const lemma of ['casa', 'azul', 'darse cuenta', 'ponerle', '', 'ir a', 'bien', 'canción']) expect(verbForms(lemma), lemma).toBeNull()
    expect(verbCore('Sentarse')).toBe('sentar')
    expect(verbCore('ir')).toBe('ir')
    expect(verbCore('oír')).toBe('oír')
    expect(verbCore('ponerle')).toBeNull()
  })

  it('no verb is in two lists', () => {
    const stem = [...STEM_CHANGE_VERBS.keys()]
    const lists = [stem, UNTABLED, IRREGULAR_VERBS]
    const all = lists.flat()
    expect(new Set(all).size).toBe(all.length)
    expect(stem).toHaveLength(114)
    expect(IRREGULAR_VERBS.length + UNTABLED.length).toBe(64)
    for (const lemma of PARTICIPLE_VERBS) expect(IRREGULAR_VERBS, lemma).not.toContain(lemma)
    expect(PARTICIPLE_VERBS).toHaveLength(13) // 7 that only the participle sets apart, and 6 stem-changers whose participle is irregular too
  })
})

describe('against the dictionary', () => {
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
  const dictionary = parseDictionary(read('public/words_enriched.json'), parseRioOverlay(read('public/rio_overlay.json')), parseFallbackExamples(read('public/examples_fallback.json')))
  const verbs = dictionary.filter((w) => w.pos === 'v' && !w.isCustom)
  const heads = new Set(verbs.map((w) => verbCore(headword(w).text) ?? headword(w).text))

  it('every verb the lists name is a verb card (a typo in a list would silently do nothing)', () => {
    const names = [...STEM_CHANGE_VERBS.keys(), ...UNTABLED, ...IRREGULAR_VERBS, ...PARTICIPLE_VERBS]
    const cores = new Set(verbs.flatMap((w) => [verbCore(w.esWord), verbCore(headword(w).text)]))
    expect(names.filter((n) => !cores.has(n))).toEqual([])
    expect(heads.size).toBeGreaterThan(900)
  })

  it('the sentence form of each verb card, where we vouch for the verb, is one of its forms (or the dictionary word, or the verb with a pronoun on it)', () => {
    const clitics = /^(?:me|te|se|le|lo|la|nos|les|los|las)+$/
    const failures: string[] = []
    let vouched = 0
    for (const word of verbs) {
      const head = headword(word).text
      const set = verbForms(head)
      if (!set) continue
      const item = clozeTarget(word)
      if (!item) continue
      vouched++
      const target = foldAccents(item.target.toLowerCase())
      const infinitive = foldAccents((verbCore(head) ?? head).toLowerCase())
      let ok = set.has(target) || target === infinitive
      for (let i = 3; !ok && i < target.length; i++) {
        const [stem, tail] = [target.slice(0, i), target.slice(i)]
        if (clitics.test(tail) && (set.has(stem) || stem === infinitive)) ok = true // dejame, acercate, temerle, hundirse
      }
      if (!ok) failures.push(`${word.esWord}: ${item.target}`)
    }
    expect(failures).toEqual([])
    expect(vouched).toBeGreaterThan(900)
  })

  it('the verbs that make the most trouble are never left to the rules: each is written out, has no forms yet, or changes its vowel (a short list of my own, apart from the ones above)', () => {
    const irregular = 'ser estar haber tener ir hacer poder decir querer ver saber dar venir poner oír salir valer traer caer andar caber reír oler satisfacer yacer conducir producir'.split(' ')
    const changers = 'pensar sentir volver encontrar pedir seguir empezar recordar contar dormir jugar perder entender cerrar morir mostrar servir'.split(' ')
    const cores = new Set(verbs.map((w) => verbCore(headword(w).text)))
    for (const lemma of irregular.filter((l) => cores.has(l))) expect(IRREGULAR_VERBS.includes(lemma) || UNTABLED.includes(lemma), lemma).toBe(true)
    for (const lemma of changers.filter((l) => cores.has(l))) expect(STEM_CHANGE_VERBS.has(lemma), lemma).toBe(true)
    expect(irregular.filter((l) => cores.has(l)).length).toBeGreaterThan(20) // the list is found in the data, so the loop above checks something
  })

  it('a verb card the lists do not name is taken to follow the rules, and gets forms', () => {
    for (const word of verbs) {
      const core = verbCore(headword(word).text)
      if (!core || STEM_CHANGE_VERBS.has(core) || UNTABLED.includes(core) || IRREGULAR_VERBS.includes(core)) continue
      expect(verbForms(core), core).not.toBeNull()
    }
  })

  it('every set is made of letters only, lower case, and at least two of them', () => {
    for (const word of verbs) {
      const set = verbForms(headword(word).text)
      if (!set) continue
      for (const f of set) expect(f, `${word.esWord}: ${f}`).toMatch(/^[a-zñ]{2,}$/)
    }
  })
})
