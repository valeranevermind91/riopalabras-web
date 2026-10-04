# Overlay v1 report

134 entries (the stage-1 words). Client export: 76 entries (status accepted and rio_type not none).

## Counts

| status | entries | by rio_type |
|---|---|---|
| accepted | 95 | replacement 61, form 2, none 19, meaning_shift 11, regional_only 2 |
| pending | 29 | replacement 17, none 8, meaning_shift 3, regional_only 1 |
| rejected | 10 | none 10 |

By rio_type overall: replacement 78, form 2, none 37, meaning_shift 14, regional_only 3.

## Base used per entry

Base = run A (`stage1.merged.json`; the one entry A failed validation on, apartamento, from `out/s1-A.json`) for every entry: A is the stage-1 base run and the only source with the full schema. Entries that deviate from A:

- aquí: A, manual accept
- chico: Claude (A said none), region uy, confidence medium
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

## Validator

- foco: alt_pair_mismatch: alt_form and alt_region must be set together (status now accepted, flags: validator_exception: alt_form without alt_region (country of lámpara unknown))

## Flags

- tony: needs_re_enrichment
- foco: validator_exception: alt_form without alt_region (country of lámpara unknown)
- condón: register_unverified: informal chosen for slang forro, no source gives it
