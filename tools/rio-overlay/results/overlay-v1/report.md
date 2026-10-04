# Overlay v1 report

134 entries (the stage-1 words). Client export: 76 entries (status accepted and rio_type not none).

## Counts

| status | entries | by rio_type |
|---|---|---|
| accepted | 95 | replacement 63, none 19, meaning_shift 11, regional_only 2 |
| pending | 29 | replacement 17, none 8, meaning_shift 3, regional_only 1 |
| rejected | 10 | none 10 |

By rio_type overall: replacement 80, none 37, meaning_shift 14, regional_only 3.

## Base used per entry

Base = run A (`stage1.merged.json`; the one entry A failed validation on, apartamento, from `out/s1-A.json`) for every entry: A is the stage-1 base run and the only source with the full schema. Entries that deviate from A:

- aquí: A, manual accept
- tú: A (form set by decision), manual accept
- chico: Claude (A said none), region uy, confidence medium
- contigo: A (form set by decision), manual accept
- quizá: A, manual accept
- quizás: A, manual accept
- hermoso: A (type none; register kept from A)
- vuestro: A, manual accept
- recoger: B (A said none), region uy, confidence medium
- vosotros: A, manual accept
- metro: A, manual accept
- bello: A (type none; register kept from A)
- rostro: A (type none; register kept from A)
- apartamento: A (form and register from B), manual accept
- tony: A (type none)
- escoger: A, manual accept
- empleo: A (type none; register kept from A)
- vacación: A (type none; register kept from A)
- norteamericano: A (type none; register kept from A)
- cabello: A, manual accept
- puto: A (type none; register kept from A)
- cigarrillo: manual (form from B / legacy)
- carro: A (form and register from B), manual accept
- fila: A (form and register from B), manual accept
- boleto: B (A said none), region uy, confidence medium
- maya: Claude (A said none), region uy, confidence medium
- portero: A, rio_form/alt_form swapped by decision
- cigarro: legacy (A said none), region uy, confidence medium
- polla: A (type none; register kept from A)
- chance: B (A said none), region uy, confidence medium
- mona: A (type none; register kept from A)
- marcador: B (A said none), region uy, confidence medium
- foco: B (A said none), manual alt_form
- picado: A (type none; register kept from A)
- condón: manual (form from legacy)

## Rejected

- hermoso (rank 497): manual reject (Valera): not a dialect difference
- bello (rank 1130): manual reject (Valera): not a dialect difference
- rostro (rank 1304): manual reject (Valera): not a dialect difference
- empleo (rank 1399): manual reject (Valera): not a dialect difference
- vacación (rank 1432): manual reject (Valera): not a dialect difference
- norteamericano (rank 1522): manual reject (Valera): not a dialect difference
- puto (rank 1747): questionnaire n=8, yes=5 (REMOVE), rejected by decision
- polla (rank 4277): questionnaire n=8, yes=0 (REMOVE), rejected by decision
- mona (rank 4325): questionnaire n=8, yes=0 (REMOVE), rejected by decision
- picado (rank 4719): questionnaire n=8, yes=2 (REMOVE), rejected by decision

## Pending (the short list for further checks)

29 entries, by dictionary rank. Each shows the reason and the competing proposals.

- **niño** (rank 147): no questionnaire item; A, B and Claude do not agree (audit class: all differ)
  - A: replacement: nene (high)
  - B: replacement: chico (high)
  - Claude: none (medium)
  - legacy: pibe
  - manual triage (Valera): left pending
- **pequeño** (rank 192): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - DAMER: «chico» has Ur label (rio_form, any sense)
  - A: replacement: chico (high)
  - B: none (high)
  - Claude: none (high)
  - legacy: chico
  - manual triage (Valera): left pending
- **muchacho** (rank 405): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: none (high)
  - B: replacement: pibe @ar (high)
  - Claude: none (medium)
  - legacy: pibe
  - manual triage (Valera): left pending
- **deprisa** (rank 2191): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - A: replacement: rápido (high)
  - B: replacement: rápido (high)
  - Claude: none (medium)
  - legacy: rápido
- **ayuntamiento** (rank 2200): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - DAMER: «intendencia» has Ar and Ur labels (rio_form, any sense)
  - DAMER: «municipalidad» has Ar label (alt_form, any sense)
  - A: replacement: intendencia @uy + municipalidad @ar (high)
  - B: replacement: intendencia (high)
  - Claude: replacement: intendencia @uy + municipalidad @ar (medium)
  - legacy: municipalidad
- **filme** (rank 2266): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: none (high)
  - B: replacement: película (high)
  - Claude: none (medium)
  - legacy: película
- **armario** (rank 2422): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - DAMER: «placard» has Ar and Ur labels (rio_form, any sense)
  - A: replacement: placard (high)
  - B: replacement: ropero (high)
  - Claude: replacement: placard (medium)
  - legacy: ropero
- **trozo** (rank 2423): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - A: replacement: pedazo (high)
  - B: replacement: pedazo (high)
  - Claude: none (medium)
  - legacy: pedazo
- **dormitorio** (rank 2628): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: none (high)
  - B: replacement: habitación (high)
  - Claude: none (high)
  - legacy: habitación
- **sofá** (rank 2657): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - DAMER: «sillón» has Ur label (rio_form, any sense)
  - A: replacement: sillón (high)
  - B: replacement: sillón (high)
  - Claude: none (high)
  - legacy: sillón
- **salario** (rank 2660): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: none (high)
  - B: replacement: sueldo (high)
  - Claude: none (medium)
  - legacy: sueldo
- **aguardar** (rank 2770): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: none (high)
  - B: replacement: esperar (high)
  - Claude: none (high)
  - legacy: esperar
- **automóvil** (rank 2837): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - A: replacement: auto (high)
  - B: replacement: auto (high)
  - Claude: none (medium)
  - legacy: auto
- **gafas** (rank 3243): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - DAMER: «anteojos» has Ar and Ur labels (alt_form, any sense)
  - A: replacement: lentes @uy + anteojos @ar (high)
  - B: replacement: anteojos (high)
  - Claude: replacement: lentes @uy + anteojos @ar (medium)
  - legacy: anteojos
- **tarta** (rank 3342): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: meaning_shift: tarta (high)
  - B: replacement: torta (high)
  - Claude: replacement: torta (medium)
  - legacy: torta
- **vaquero** (rank 3441): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: replacement: jean (high)
  - B: meaning_shift: vaquero (high)
  - Claude: replacement: jean (medium)
  - legacy: jean
- **acoger** (rank 3510): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - DAMER: «recibir» has Ar and Ur labels (rio_form, any sense)
  - A: replacement: recibir (high)
  - B: none (high)
  - Claude: none (high)
  - legacy: recibir
- **enhorabuena** (rank 3725): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - A: replacement: felicitaciones (high)
  - B: replacement: felicitaciones (high)
  - Claude: none (low)
  - legacy: felicitaciones
- **fibra** (rank 3751): no questionnaire item; A, B and Claude do not agree (audit class: all differ)
  - DAMER: «fibra» has Ar and Ur labels (rio_form, any sense)
  - A: meaning_shift: fibra @ar (high)
  - B: none (high)
  - Claude: meaning_shift: fibra (medium)
  - legacy: fibra
- **Gil** (rank 3799): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: regional_only: gil (high)
  - B: none (low)
  - Claude: none (medium)
  - legacy: gil
- **píldora** (rank 3860): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - A: replacement: pastilla (high)
  - B: replacement: pastilla (high)
  - Claude: none (medium)
  - legacy: pastilla
- **goma** (rank 4079): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: none (medium)
  - B: meaning_shift: goma (high)
  - Claude: meaning_shift: goma (medium)
  - legacy: cubierta
- **emisora** (rank 4266): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: none (high)
  - B: replacement: radio (high)
  - Claude: none (high)
  - legacy: radio
- **bus** (rank 4352): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - DAMER: «colectivo» has Ar and Ur labels (alt_form, any sense)
  - A: replacement: ómnibus @uy + colectivo @ar (high)
  - B: replacement: ómnibus @uy + colectivo @ar (high)
  - Claude: replacement: colectivo @ar (medium)
  - legacy: colectivo
- **baloncesto** (rank 4455): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - DAMER: «básquetbol» has Ar and Ur labels (rio_form, any sense)
  - A: replacement: básquetbol (high)
  - B: replacement: básquet (high)
  - Claude: replacement: básquet (high)
  - legacy: básquet
- **lentes** (rank 4678): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - A: meaning_shift: lentes (high)
  - B: replacement: lentes @uy + anteojos @ar (high)
  - Claude: meaning_shift: lentes (medium)
  - legacy: anteojos
- **crío** (rank 4685): no questionnaire item; A, B and Claude do not agree (audit class: all differ)
  - A: replacement: nene (high)
  - B: meaning_shift: crío (high)
  - Claude: replacement: gurí @uy + pibe @ar (medium)
  - legacy: pibe
- **sanidad** (rank 4790): no questionnaire item; A, B and Claude do not agree (audit class: A+B agree, Claude differs)
  - A: none (high)
  - B: none (high)
  - Claude: replacement: salud pública (medium)
  - legacy: salud
- **refresco** (rank 4871): no questionnaire item; A, B and Claude do not agree (audit class: Claude matches one of A/B)
  - DAMER: «gaseosa» has Ar label (rio_form, any sense)
  - A: replacement: gaseosa @ar (high)
  - B: replacement: gaseosa (high)
  - Claude: replacement: gaseosa @ar (medium)
  - legacy: gaseosa

## Accepted on questionnaire evidence only (the weakest accepted entries)

Either the form came from a proposal where A said none (confidence medium, region uy by rule), or the only support is the questionnaire (no DAMER label, no 3-way agreement).

- chico → gurí @uy (medium): questionnaire n=8, yes=7; proposal from Claude (A said none); region set to uy by rule
- recoger → levantar @uy (medium): questionnaire n=8, yes=8; proposal from B (A said none); region set to uy by rule
- galleta → galletita (high): questionnaire n=8, yes=8
- feria → feria (high): questionnaire n=8, yes=8
- boleto → boleto @uy (medium): questionnaire n=8, yes=8; proposal from B (A said none); region set to uy by rule
- maya → malla @uy (medium): questionnaire n=8, yes=8; proposal from Claude (A said none); region set to uy by rule
- portero → golero @uy (high): questionnaire n=8, yes=8 (item 24: golero); questionnaire item 23: «arquero» n=8, yes=8
- cigarro → pucho @uy (medium): questionnaire n=8, yes=8; proposal from legacy (A said none); region set to uy by rule
- chance → chance @uy (medium): questionnaire n=8, yes=8; proposal from B (A said none); region set to uy by rule
- asilo → casa de salud @uy (high): questionnaire n=8, yes=8
- marcador → marcador @uy (medium): questionnaire n=8, yes=8; proposal from B (A said none); region set to uy by rule
- foco → foco @uy (medium): questionnaire n=8, yes=5 (5/8, below the usual threshold; kept by decision); proposal from B (A said none): meaning_shift foco = light bulb
- neumático → cubierta (high): questionnaire n=8, yes=8

## Manual overrides from questionnaire free text

Reason recorded for each: questionnaire free-text (Salto respondent).

- vagabundo → linyera: register informal → pejorative; note added (EN and RU)
- cigarrillo → pucho: register informal → informal; note added (EN and RU)
- cigarro → pucho: register informal → informal; note added (EN and RU)

## Pass 2 examples

Generated by `gemini-3.1-pro-preview` (run `p2-examples`): 21 of 21 in scope, 0 failed, cost about $0.1193.

Shipped to the client: 21 (6 replacements that passed the automatic checks, 15 confirmed by hand). Still held back (pending): 0.

| word | form | type | review | sentence | EN | RU |
|---|---|---|---|---|---|---|
| tú | vos | replacement | confirmed | Vos siempre llegás tarde a las reuniones del trabajo. | You always arrive late to work meetings. | Ты всегда опаздываешь на рабочие встречи. |
| chico | gurí | replacement | auto | El gurí estaba jugando a la pelota en la rambla. | The kid was playing ball on the promenade. | Мальчишка играл в мяч на набережной. |
| contigo | con vos | replacement | confirmed | Mañana voy a la feria con vos a comprar verduras. | Tomorrow I'm going to the street market with you to buy vegetables. | Завтра я пойду с тобой на рынок за овощами. |
| guapo | guapo | meaning_shift | confirmed | Hay que ser muy guapo para caminar solo por ese barrio. | You have to be very brave to walk alone in that neighborhood. | Нужно быть очень смелым, чтобы гулять одному по этому району. |
| vos | vos | regional_only | confirmed | Me parece que vos tenés que descansar un poco más. | I think you need to rest a little more. | Мне кажется, тебе нужно немного больше отдыхать. |
| autobús | ómnibus | replacement | auto | Tomé el ómnibus equivocado y terminé en el centro de Montevideo. | I took the wrong bus and ended up in downtown Montevideo. | Я сел не на тот автобус и оказался в центре Монтевидео. |
| cigarrillo | pucho | replacement | auto | Salgo un ratito al balcón a fumarme un pucho y vuelvo. | I'm going out to the balcony for a bit to smoke a cigarette and I'll be back. | Я выйду на минутку на балкон выкурить сигарету и вернусь. |
| mina | mina | meaning_shift | confirmed | Esa mina que trabaja en la panadería es re simpática. | That chick who works at the bakery is really nice. | Та девушка, что работает в пекарне, очень милая. |
| saco | saco | meaning_shift | confirmed | Para la entrevista de trabajo, ponete una camisa blanca y un saco azul. | For the job interview, put on a white shirt and a blue blazer. | На собеседование надень белую рубашку и синий пиджак. |
| feria | feria | meaning_shift | confirmed | Los domingos siempre compro la verdura y la fruta fresca en la feria. | On Sundays I always buy fresh vegetables and fruit at the street market. | По воскресеньям я всегда покупаю свежие овощи и фрукты на рынке. |
| boleto | boleto | meaning_shift | confirmed | Subió al ómnibus por 18 de Julio y se olvidó de pagar el boleto. | He got on the bus along 18 de Julio and forgot to pay for the ticket. | Он сел в автобус на 18 Июля и забыл купить билет. |
| colgado | colgado | meaning_shift | confirmed | Perdoná que no te escuché, estaba re colgado mirando por la ventana. | Sorry I didn't hear you, I was totally spaced out looking out the window. | Извини, что не расслышал, я совсем завис, глядя в окно. |
| guay | de más | replacement | auto | El concierto en la rambla estuvo de más, tocaban todas mis bandas favoritas. | The concert on the promenade was awesome, all my favorite bands played. | Концерт на набережной был просто супер, играли все мои любимые группы. |
| portero | golero | replacement | auto | El golero de Peñarol atajó un penal decisivo en el último minuto del partido. | Peñarol's goalkeeper saved a decisive penalty in the last minute of the match. | Вратарь Пеньяроля отбил решающий пенальти на последней минуте матча. |
| suprema | suprema | meaning_shift | confirmed | Me pedí una suprema con puré para almorzar en el bar de la esquina. | I ordered a breaded chicken breast with mashed potatoes for lunch at the corner bar. | Я заказал куриную отбивную с пюре на обед в баре на углу. |
| chance | chance | regional_only | confirmed | Si estudiás un poco más, tenés chance de salvar el examen de la facultad. | If you study a bit more, you have a chance of passing the university exam. | Если ты еще немного поучишься, у тебя есть шанс сдать экзамен в университете. |
| asilo | casa de salud | replacement | auto | Mi abuela vive en una casa de salud cerca de la rambla. | My grandmother lives in a nursing home near the promenade. | Моя бабушка живет в доме престарелых недалеко от набережной. |
| torta | torta | meaning_shift | confirmed | Para tu cumpleaños te voy a preparar una torta de chocolate riquísima. | For your birthday I am going to bake you a delicious chocolate cake. | На твой день рождения я испеку тебе очень вкусный шоколадный торт. |
| marcador | marcador | meaning_shift | confirmed | Prestame un marcador rojo para subrayar los títulos de estos apuntes. | Lend me a red marker to underline the titles of these notes. | Одолжи мне красный маркер, чтобы подчеркнуть заголовки в этих конспектах. |
| foco | foco | meaning_shift | confirmed | Comprá un foco nuevo en el súper porque se quemó el del pasillo. | Buy a new light bulb at the supermarket because the hallway one burned out. | Купи новую лампочку в супермаркете, потому что в коридоре перегорела. |
| propaganda | propaganda | meaning_shift | confirmed | Vi una propaganda en la tele sobre un champú muy bueno. | I saw an advertisement on TV about a really good shampoo. | Я видел по телевизору рекламу очень хорошего шампуня. |

## Standard-word usage (pass 4)

Question asked of `gemini-3.1-pro-preview` (run `p4-stdusage`), per entry whose form differs from es_word: is es_word itself used in everyday speech in that region? 63 answered, 0 failed, cost about $0.3433. Overrides applied: 30.

### not_used (8; card shows: hint "rarely used here")

- vuestro → su: the Peninsular possessive of vosotros; Rioplatense uses su / de ustedes, and vuestro has no other sense (kept by hand)
- vosotros → ustedes: Peninsular-only pronoun; Rioplatense says ustedes in every context, and it has no other sense (kept by hand)
- ordenador → computadora: Peninsular word for a computer (computadora here); the "one who orders" sense is rare and bookish (kept by hand)
- patata → papa: Peninsular word for potato (papa here); no other common sense (kept by hand)
- chaval → pibe: Peninsular slang for a kid (pibe / gurí here); no other sense (kept by hand)
- gilipollas → boludo: Peninsular vulgar insult (boludo / pelotudo here); no other sense (kept by hand)
- guay → de más @uy: Peninsular slang for "cool" (copado / bárbaro here); no other sense (kept by hand)
- aparcar → estacionar: Peninsular verb for parking (estacionar here); no other sense (kept by hand)

### less_common (51; card shows: no hint)

- aquí → acá: 'Acá' is the standard everyday word. 'Aquí' sounds more formal or literary, though it is still occasionally used in speech.
- tú → vos: 'Vos' is the standard in Argentina. 'Tú' is still widely used in Uruguay (often with voseo verbs), making it less common overall.
- contigo → con vos: 'Con vos' is dominant. 'Contigo' is common in Uruguay but sounds poetic, formal, or foreign in everyday Argentine speech.
- quizá → capaz: 'Capaz' is the everyday standard. 'Quizá' sounds quite formal or bookish and is rarely used in casual conversation.
- quizás → capaz: While 'capaz' is the most natural choice for 'maybe', 'quizás' is still used in everyday speech, just less often.
- coche → auto: 'Auto' is the standard everyday word for a car. 'Coche' is understood and used, but noticeably less frequently.
- coger → agarrar: coger does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- bonito → lindo: Lindo is the default adjective for beautiful or pretty. Bonito sounds a bit like a TV dub or foreign, but is occasionally used.
- recoger → levantar @uy: While not as strictly taboo in Uruguay as in Argentina, recoger is still mostly replaced by levantar or juntar in everyday speech.
- metro → subte @ar: metro has another everyday sense in the region (decided by hand)
- periódico → diario: Diario is the everyday word for newspaper. Periódico is understood but sounds formal, bookish, or like a translation.
- alcalde → intendente: Intendente is the traditional title. Alcalde sounds foreign in Argentina, though Uruguay recently introduced it for a lower municipal role.
- tontería → boludez: Boludez or pavada are the go-to everyday terms. Tontería is understood and sometimes used to avoid swearing, but it is much less frequent.
- apartamento → departamento @ar: apartamento does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- carretera → ruta: carretera has another everyday sense in the region (decided by hand)
- cerdo → chancho: Chancho is the everyday word for the animal, but cerdo is still used, especially when referring to pork meat or in slightly more formal contexts.
- escoger → elegir: escoger does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- mando → control remoto: mando has another everyday sense in the region (decided by hand)
- cabello → pelo: Pelo is the everyday word. Cabello is understood but sounds formal, mostly restricted to shampoo commercials or literature.
- autobús → ómnibus @uy: autobús: used in Uruguay in formal and official speech; not Peninsular-only; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- coño → concha: coño does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- pastel → torta: pastel does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- enfadado → enojado: enfadado: unsure: understood and sometimes used in the region, not clearly Peninsular-only; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- carro → auto: carro does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- maleta → valija: 'Valija' is the absolute standard. 'Maleta' is understood and appears in some phrases, but sounds a bit foreign or literary in daily speech.
- camarero → mozo: 'Mozo' is the everyday word. 'Camarero' is understood and seen in formal hospitality contexts, but is much rarer in normal conversation.
- piscina → pileta @ar: piscina: used in Uruguay (pileta is the Argentine preference), so not unambiguously Peninsular; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- enfadar → enojar: enfadar: unsure: understood and sometimes used in the region, not clearly Peninsular-only; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- galleta → galletita: Galletita is the generic term for cookies; galleta is used but usually restricted to specific hard breads, crackers, or a slap.
- pluma → lapicera: pluma has another everyday sense in the region (decided by hand)
- Hacienda → estancia: Estancia is the estate; hacienda is used in daily speech but typically refers to the livestock itself or the tax authority.
- gasolina → nafta: gasolina: standard in most of Latin America and used in the region too (nafta is just the preferred word); not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- follar → coger: follar does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- apresurar → apurar: apresurar: a formal verb, not Peninsular-only; it is used in the region; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- mantequilla → manteca: mantequilla has another everyday sense in the region (decided by hand)
- coste → costo: coste: unsure: a standard variant of costo that does appear in formal and written Spanish in the region; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- cojón → huevo: cojón does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)
- balón → pelota: balón has another everyday sense in the region (decided by hand)
- maya → malla @uy: maya has another everyday sense in the region (decided by hand)
- falda → pollera: falda has another everyday sense in the region (decided by hand)
- portero → golero @uy: portero has another everyday sense in the region (decided by hand)
- competición → competencia: "Competencia" is the standard everyday term, while "competición" is mostly restricted to sports journalism or formal contexts.
- furgoneta → camioneta: furgoneta: used in the region for the commercial vehicle; not clearly Peninsular-only; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- cubo → balde: cubo has another everyday sense in the region (decided by hand)
- calcetín → media: calcetín: standard across Latin America; not unambiguously Peninsular-only; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- asilo → casa de salud @uy: Casa de salud or residencial are the standard terms in Uruguay; asilo is understood but sounds older or more institutional, making it less common.
- vagabundo → linyera: Linyera is the traditional local term for a homeless person, while vagabundo is understood and used but sounds slightly more formal or literary.
- tejado → techo: tejado: a common word for a tiled roof in the region as well (techo is the general one); not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- neumático → cubierta: Cubierta or goma are the everyday words for car tires; neumático is used but tends to be reserved for more formal, commercial, or technical contexts.
- halar → tirar: halar: Latin American, not Peninsular, so the "Peninsular-only" test fails; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)
- condón → forro: condón has another everyday sense in the region (decided by hand)

### equally_used (4; card shows: hint "also common")

- chico → gurí @uy: Both 'chico' and 'gurí' are completely normal and frequently used in everyday Uruguayan speech to refer to children.
- cigarrillo → pucho: 'Cigarrillo' is the standard, completely normal word, while 'pucho' is a very common colloquial alternative. Both are widely used.
- fila → cola: Both 'fila' and 'cola' are completely normal and interchangeable in everyday speech when referring to a line of people.
- cigarro → pucho @uy: "Cigarro" is the standard everyday word for cigarette, while "pucho" is a very common informal slang term; both are widely used.

### Final not_used list (kept only where es_word is unambiguously Peninsular-only and has no other common sense)

- vuestro → su: the Peninsular possessive of vosotros; Rioplatense uses su / de ustedes, and vuestro has no other sense (kept by hand)
- vosotros → ustedes: Peninsular-only pronoun; Rioplatense says ustedes in every context, and it has no other sense (kept by hand)
- ordenador → computadora: Peninsular word for a computer (computadora here); the "one who orders" sense is rare and bookish (kept by hand)
- patata → papa: Peninsular word for potato (papa here); no other common sense (kept by hand)
- chaval → pibe: Peninsular slang for a kid (pibe / gurí here); no other sense (kept by hand)
- gilipollas → boludo: Peninsular vulgar insult (boludo / pelotudo here); no other sense (kept by hand)
- guay → de más: Peninsular slang for "cool" (copado / bárbaro here); no other sense (kept by hand)
- aparcar → estacionar: Peninsular verb for parking (estacionar here); no other sense (kept by hand)


## Validator

- foco: alt_pair_mismatch: alt_form and alt_region must be set together (status now accepted, flags: validator_exception: alt_form without alt_region (country of lámpara unknown))

## Flags

- tony: needs_re_enrichment
- foco: validator_exception: alt_form without alt_region (country of lámpara unknown)
- condón: register_unverified: informal chosen for slang forro, no source gives it
