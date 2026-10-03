# Stage 1 blind audit: A vs B vs Claude vs legacy

Compared: A = `stage1.merged.json` (gemini-3.1-pro-preview, context sense; the one entry held back there, apartamento, is taken from run A and marked [invalid]); B = run `s1-B` (gemini-2.5-flash, context minimal); Claude = `claude-blind.json` (a fresh subagent that saw only es_word, pos and the English translation, plus the type definitions from `schema.mjs`). The legacy column is the dictionary's `es_rioplatense`, shown for reference and not used in any class. Disagreements are listed, not resolved.

**Agreement** compares rio_type, rio_form (case-insensitive), region and alt_form; alt_region, register, confidence, notes, translations and examples are ignored. Two entries that express the same split differently (for example `ómnibus @uy + colectivo` versus `colectivo`) count as different. Cells read `type: form @region + alt @alt_region (confidence H/M/L, register if not neutral)`.

**Needs local check = yes** when the class is "A+B agree, Claude differs" or "all differ", or A, B or Claude says vulgar or offensive, or A, B or Claude has low confidence. The reason is in the last column.

## Counts

| class | rows |
|---|---|
| 3-way agree | 61 |
| A+B agree, Claude differs | 22 |
| Claude matches one of A/B | 40 |
| all differ | 11 |
| **total** | 134 |

Needs local check: yes 50, no 84.

## Table (dictionary rank ascending; rank 1 is the most frequent word)

| word | rank | legacy | A | B | Claude | agreement | needs local check |
|---|---|---|---|---|---|---|---|
| aquí | 43 | acá | replacement: acá (H) | none (H) | replacement: acá (M) | Claude matches one of A/B | no |
| tú | 45 | vos | form: vos (H) | form: vos (H) | form: vos (H) | 3-way agree | no |
| chico | 109 | pibe | none (H) | none (H) | replacement: gurí @uy + pibe @ar (H, informal) | A+B agree, Claude differs | yes: Claude differs from A+B |
| niño | 147 | pibe | replacement: nene (H) | replacement: chico (H) | none (M) | all differ | yes: all differ |
| pequeño | 192 | chico | replacement: chico (H) | none (H) | none (H) | Claude matches one of A/B | no |
| contigo | 244 | con vos | form: con vos (H) | form: con vos (H) | form: con vos (M) | 3-way agree | no |
| esposo | 269 | marido | none (H) | none (H) | none (H) | 3-way agree | no |
| quizá | 296 | capaz | replacement: capaz (H, informal) | none (H) | replacement: capaz (M, informal) | Claude matches one of A/B | no |
| ello | 334 | eso | none (H) | none (H) | none (H) | 3-way agree | no |
| quizás | 344 | capaz | replacement: capaz (H, informal) | none (H) | replacement: capaz (M, informal) | Claude matches one of A/B | no |
| coche | 367 | auto | replacement: auto (H) | replacement: auto (H) | replacement: auto (H) | 3-way agree | no |
| coger | 396 | agarrar | replacement: agarrar (H) | replacement: agarrar (H) | replacement: agarrar (H) | 3-way agree | no |
| muchacho | 405 | pibe | none (H) | replacement: pibe @ar (H, informal) | none (M) | Claude matches one of A/B | no |
| hermoso | 497 | lindo | none (H) | replacement: lindo (H) | none (H) | Claude matches one of A/B | no |
| bonito | 501 | lindo | replacement: lindo (H) | replacement: lindo (H) | replacement: lindo (M, informal) | 3-way agree | no |
| obtener | 503 | conseguir | none (H) | none (H) | none (H) | 3-way agree | no |
| utilizar | 508 | usar | none (H) | none (H) | none (H) | 3-way agree | no |
| vuestro | 626 | su/sus | replacement: su (H) | replacement: su (H) | form: de ustedes (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| recoger | 644 | levantar | none (H) | replacement: levantar (H) | none (L) | Claude matches one of A/B | yes: low confidence: Claude |
| vosotros | 790 | ustedes | replacement: ustedes (H) | replacement: ustedes (H) | form: ustedes (H) | A+B agree, Claude differs | yes: Claude differs from A+B |
| metro | 792 | subte | replacement: subte (H) | replacement: subte (H) | replacement: subte @ar (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| periódico | 1059 | diario | replacement: diario (H) | replacement: diario (H) | replacement: diario (H) | 3-way agree | no |
| guapo | 1129 | fachero | meaning_shift: guapo (H, informal) | meaning_shift: guapo (H) | meaning_shift: guapo (L, informal) | 3-way agree | yes: low confidence: Claude |
| bello | 1130 | lindo | replacement: lindo (H) | none (H) | none (H) | Claude matches one of A/B | no |
| rostro | 1304 | cara | none (H) | replacement: cara (H) | none (M) | Claude matches one of A/B | no |
| alcalde | 1306 | intendente | replacement: intendente (H) | replacement: intendente (H) | replacement: intendente (M) | 3-way agree | no |
| tontería | 1320 | boludez | replacement: boludez (H, informal) | replacement: boludez (H, informal) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| apartamento | 1339 | departamento | replacement: apartamento @uy + departamento @ar (H) [invalid] | replacement: departamento (H) | replacement: departamento @ar (H) | all differ | yes: all differ |
| tony | 1342 | cheto | none (H, informal) | none (L) | none (L, informal) | 3-way agree | yes: low confidence: B,Claude |
| vos | 1357 | vos | regional_only: vos (H) | regional_only: vos (H) | regional_only: vos (H) | 3-way agree | no |
| carretera | 1377 | ruta | replacement: ruta (H) | replacement: ruta (H) | replacement: ruta (H) | 3-way agree | no |
| cerdo | 1391 | chancho | replacement: chancho (H) | replacement: chancho (H) | replacement: chancho (M, informal) | 3-way agree | no |
| escoger | 1396 | elegir | replacement: elegir (H) | replacement: elegir (H) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| solicitar | 1397 | pedir / postularse | none (H) | none (H) | none (H) | 3-way agree | no |
| empleo | 1399 | laburo | none (H) | replacement: trabajo (H) | none (M) | Claude matches one of A/B | no |
| vacación | 1432 | vacaciones | none (H) | form: vacaciones (H) | none (H) | Claude matches one of A/B | no |
| mando | 1472 | control remoto | replacement: control remoto (H) | replacement: control remoto (H) | replacement: control remoto (H) | 3-way agree | no |
| fresco | 1491 | fresco | none (H) | none (H) | none (M, informal) | 3-way agree | no |
| norteamericano | 1522 | estadounidense | none (H) | replacement: estadounidense (H) | none (M) | Claude matches one of A/B | no |
| cabello | 1527 | pelo | replacement: pelo (H) | replacement: pelo (H) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| autobús | 1567 | colectivo | replacement: ómnibus @uy + colectivo @ar (H) | replacement: ómnibus @uy + colectivo @ar (H) | replacement: ómnibus @uy + colectivo @ar (M) | 3-way agree | no |
| coño | 1709 | concha | replacement: concha (H, vulgar) | replacement: concha (H, vulgar) | none (M, vulgar) | A+B agree, Claude differs | yes: Claude differs from A+B; vulgar/offensive: A,B,Claude |
| puto | 1747 | Used as a strong intensifier or general expletive, often to express annoyance or emphasize something negative, beyond its literal derogatory meaning. | none (H, offensive) | meaning_shift: puto (H, vulgar) | none (M, offensive) | Claude matches one of A/B | yes: vulgar/offensive: A,B,Claude |
| pastel | 1768 | torta | replacement: torta (H) | replacement: torta (H) | replacement: torta (L) | 3-way agree | yes: low confidence: Claude |
| profundar | 1789 | profundizar | none (H) | none (H) | none (H) | 3-way agree | no |
| enfadado | 1838 | enojado | replacement: enojado (H) | replacement: enojado (H) | replacement: enojado (H) | 3-way agree | no |
| cigarrillo | 1866 | pucho | none (H) | replacement: pucho (H, informal) | none (M) | Claude matches one of A/B | no |
| carro | 1970 | auto | none (H) | replacement: auto (H) | replacement: auto (H) | Claude matches one of A/B | no |
| fila | 1973 | cola | none (H) | replacement: cola (H) | replacement: cola (M) | Claude matches one of A/B | no |
| mina | 1993 | mina (slang for girl/chick) | meaning_shift: mina (H, informal) | meaning_shift: mina (H, informal) | meaning_shift: mina (H, informal) | 3-way agree | no |
| maleta | 2026 | valija | replacement: valija (H) | replacement: valija (H) | replacement: valija (H) | 3-way agree | no |
| deprisa | 2191 | rápido | replacement: rápido (H) | replacement: rápido (H) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| recientemente | 2192 | recién | none (H) | none (H) | none (H) | 3-way agree | no |
| nuevamente | 2195 | de nuevo | none (H) | none (H) | none (H) | 3-way agree | no |
| ayuntamiento | 2200 | municipalidad | replacement: intendencia @uy + municipalidad @ar (H) | replacement: intendencia (H) | replacement: intendencia @uy + municipalidad @ar (M) | Claude matches one of A/B | no |
| ordenador | 2214 | computadora | replacement: computadora (H) | replacement: computadora (H) | replacement: computadora (H) | 3-way agree | no |
| filme | 2266 | película | none (H) | replacement: película (H) | none (M) | Claude matches one of A/B | no |
| saco | 2280 | saco | meaning_shift: saco (H) | meaning_shift: saco (H) | meaning_shift: saco (M) | 3-way agree | no |
| wow | 2336 | ¡Qué bárbaro! | none (H) | none (L) | none (H, informal) | 3-way agree | yes: low confidence: B |
| camarero | 2387 | mozo | replacement: mozo (H) | replacement: mozo (H) | replacement: mozo (H) | 3-way agree | no |
| armario | 2422 | ropero | replacement: placard (H) | replacement: ropero (H) | replacement: placard (M) | Claude matches one of A/B | no |
| trozo | 2423 | pedazo | replacement: pedazo (H) | replacement: pedazo (H) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| piscina | 2441 | pileta | replacement: pileta @ar (H) | replacement: pileta @ar (H) | replacement: pileta @ar (H) | 3-way agree | no |
| enfadar | 2499 | enojar | replacement: enojar (H) | replacement: enojar (H) | replacement: enojar (H) | 3-way agree | no |
| portar | 2577 | llevar | none (H) | none (H) | none (H) | 3-way agree | no |
| galleta | 2595 | galletita | replacement: galletita (H) | meaning_shift: galleta (H) | replacement: galletita @ar (H) | all differ | yes: all differ |
| dormitorio | 2628 | habitación | none (H) | replacement: habitación (H) | none (H) | Claude matches one of A/B | no |
| sofá | 2657 | sillón | replacement: sillón (H) | replacement: sillón (H) | none (H) | A+B agree, Claude differs | yes: Claude differs from A+B |
| salario | 2660 | sueldo | none (H) | replacement: sueldo (H) | none (M) | Claude matches one of A/B | no |
| aguardar | 2770 | esperar | none (H) | replacement: esperar (H) | none (H) | Claude matches one of A/B | no |
| pluma | 2805 | lapicera | replacement: lapicera (H) | replacement: lapicera (H) | replacement: lapicera (H) | 3-way agree | no |
| automóvil | 2837 | auto | replacement: auto (H) | replacement: auto (H) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| Hacienda | 2843 | estancia | replacement: estancia (M) | none (H) | meaning_shift: Hacienda (M) | all differ | yes: all differ |
| feria | 2846 | feriado | meaning_shift: feria (H) | meaning_shift: feria (H) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| gasolina | 2878 | nafta | replacement: nafta (H) | replacement: nafta (H) | replacement: nafta (H) | 3-way agree | no |
| patata | 2900 | papa | replacement: papa (H) | replacement: papa (H) | replacement: papa (H) | 3-way agree | no |
| follar | 2958 | coger | replacement: coger (H, vulgar) | none (H, vulgar) | none (L, vulgar) | Claude matches one of A/B | yes: vulgar/offensive: A,B,Claude; low confidence: Claude |
| jo | 3029 | che | none (H, informal) | none (H, informal) | none (H, informal) | 3-way agree | no |
| boleto | 3098 | pasaje | none (H) | meaning_shift: boleto (H) | none (L) | Claude matches one of A/B | yes: low confidence: Claude |
| apresurar | 3185 | apurar | replacement: apurar (H) | replacement: apurar (H) | replacement: apurar (L) | 3-way agree | yes: low confidence: Claude |
| gafas | 3243 | anteojos | replacement: lentes @uy + anteojos @ar (H) | replacement: anteojos (H) | replacement: lentes @uy + anteojos @ar (M) | Claude matches one of A/B | no |
| tarta | 3342 | torta | meaning_shift: tarta (H) | replacement: torta (H) | replacement: torta (M) | Claude matches one of A/B | no |
| colgado | 3383 | (informal, for a person) obsessed, addicted, spaced out | meaning_shift: colgado (H, informal) | meaning_shift: colgado (H, informal) | meaning_shift: colgado (M, informal) | 3-way agree | no |
| garaje | 3430 | cochera | none (H) | none (H) | none (H) | 3-way agree | no |
| vaquero | 3441 | jean | replacement: jean (H) | meaning_shift: vaquero (H) | replacement: jean (M) | Claude matches one of A/B | no |
| mantequilla | 3445 | manteca | replacement: manteca (H) | replacement: manteca (H) | replacement: manteca (H) | 3-way agree | no |
| coste | 3449 | costo | replacement: costo (H) | replacement: costo (H) | replacement: costo (M) | 3-way agree | no |
| cojón | 3454 | huevo | replacement: huevo (H, vulgar) | none (H, vulgar) | none (L, vulgar) | Claude matches one of A/B | yes: vulgar/offensive: A,B,Claude; low confidence: Claude |
| acoger | 3510 | recibir | replacement: recibir (H) | none (H) | none (H) | Claude matches one of A/B | no |
| balón | 3553 | pelota | replacement: pelota (H) | replacement: pelota (H) | replacement: pelota (H) | 3-way agree | no |
| chaval | 3563 | pibe | replacement: pibe (H, informal) | replacement: pibe (H, informal) | replacement: gurí @uy + pibe @ar (H, informal) | A+B agree, Claude differs | yes: Claude differs from A+B |
| maya | 3580 | malla | none (H) | none (H) | replacement: malla (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| gilipollas | 3583 | boludo | replacement: boludo (H, vulgar) | replacement: boludo (H, informal) | replacement: boludo (M, vulgar) | 3-way agree | yes: vulgar/offensive: A,Claude |
| falda | 3616 | pollera | replacement: pollera (H) | replacement: pollera (H) | replacement: pollera (H) | 3-way agree | no |
| pa | 3628 | para | none (H, informal) | none (H) | none (H, informal) | 3-way agree | no |
| enhorabuena | 3725 | felicitaciones | replacement: felicitaciones (H) | replacement: felicitaciones (H) | none (L) | A+B agree, Claude differs | yes: Claude differs from A+B; low confidence: Claude |
| fibra | 3751 | fibra | meaning_shift: fibra @ar (H) | none (H) | meaning_shift: fibra (M) | all differ | yes: all differ |
| Gil | 3799 | gil | regional_only: gil (H, informal) | none (L) | none (M) | Claude matches one of A/B | yes: low confidence: B |
| píldora | 3860 | pastilla | replacement: pastilla (H) | replacement: pastilla (H) | none (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| guay | 3911 | copado | replacement: de más @uy + copado @ar (H, informal) | replacement: copado (H, informal) | replacement: bárbaro (M, informal) | all differ | yes: all differ |
| portero | 3916 | arquero (goalkeeper), encargado (doorman) | replacement: arquero (H) | none (H) | replacement: golero @uy + arquero @ar (M, informal) | all differ | yes: all differ |
| competición | 3949 | competencia | replacement: competencia (H) | replacement: competencia (H) | replacement: competencia (H) | 3-way agree | no |
| cigarro | 3952 | pucho | none (M) | replacement: cigarrillo (H) | replacement: cigarrillo (L) | Claude matches one of A/B | yes: low confidence: Claude |
| orinar | 3978 | hacer pis | none (H) | none (H) | none (H) | 3-way agree | no |
| boy | 4006 | pibe | none (H) | none (H) | none (H, informal) | 3-way agree | no |
| furgoneta | 4068 | camioneta | replacement: camioneta (H) | replacement: camioneta (H) | replacement: camioneta (M) | 3-way agree | no |
| cubo | 4076 | balde | replacement: balde (H) | replacement: balde (H) | replacement: balde (H) | 3-way agree | no |
| goma | 4079 | cubierta | none (M) | meaning_shift: goma (H) | meaning_shift: goma (M, informal) | Claude matches one of A/B | no |
| suprema | 4212 | suprema (de pollo) | meaning_shift: suprema (H) | meaning_shift: suprema (H) | meaning_shift: suprema (H) | 3-way agree | no |
| emisora | 4266 | radio | none (H) | replacement: radio (H) | none (H) | Claude matches one of A/B | no |
| polla | 4277 | pollita (for pullet) | meaning_shift: polla (H) | replacement: gallina (H) | none (L, vulgar) | all differ | yes: all differ; vulgar/offensive: Claude; low confidence: Claude |
| chance | 4281 | oportunidad | none (H) | regional_only: chance (H) | none (L, informal) | Claude matches one of A/B | yes: low confidence: Claude |
| mona | 4325 | borracha | none (H) | meaning_shift: mona (H, informal) | none (L, informal) | Claude matches one of A/B | yes: low confidence: Claude |
| calcetín | 4329 | media | replacement: media (H) | replacement: media (H) | replacement: media (H) | 3-way agree | no |
| asilo | 4332 | geriátrico | replacement: casa de salud @uy + geriátrico @ar (H) | none (H) | none (L) | Claude matches one of A/B | yes: low confidence: Claude |
| bus | 4352 | colectivo | replacement: ómnibus @uy + colectivo @ar (H) | replacement: ómnibus @uy + colectivo @ar (H) | replacement: colectivo @ar (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| vagabundo | 4357 | linyera | replacement: linyera (H, informal) | replacement: linyera (H, informal) | none (L) | A+B agree, Claude differs | yes: Claude differs from A+B; low confidence: Claude |
| baby | 4420 | bebé | none (H) | none (H) | none (H, informal) | 3-way agree | no |
| baloncesto | 4455 | básquet | replacement: básquetbol (H) | replacement: básquet (H) | replacement: básquet (H) | Claude matches one of A/B | no |
| tejado | 4503 | techo | replacement: techo (H) | replacement: techo (H) | replacement: techo (H) | 3-way agree | no |
| aparcar | 4556 | estacionar | replacement: estacionar (H) | replacement: estacionar (H) | replacement: estacionar (H) | 3-way agree | no |
| torta | 4592 | torta | meaning_shift: torta (H) | meaning_shift: torta (H) | meaning_shift: torta (M) | 3-way agree | no |
| marcador | 4650 | fibrón | none (M) | meaning_shift: marcador (H) | none (L) | Claude matches one of A/B | yes: low confidence: Claude |
| lentes | 4678 | anteojos | meaning_shift: lentes (H) | replacement: lentes @uy + anteojos @ar (H) | meaning_shift: lentes (M) | Claude matches one of A/B | no |
| foco | 4680 | lamparita | none (M) | meaning_shift: foco (H) | replacement: lamparita (H) | all differ | yes: all differ |
| crío | 4685 | pibe | replacement: nene (H) | meaning_shift: crío (H, informal) | replacement: gurí @uy + pibe @ar (M, informal) | all differ | yes: all differ |
| neumático | 4708 | cubierta | replacement: cubierta (H) | replacement: neumático @uy + cubierta @ar (H) | none (L) | all differ | yes: all differ; low confidence: Claude |
| picado | 4719 | picado (used with additional meanings like 'annoyed' or 'competitive' in Rioplatense) | meaning_shift: picado (H, informal) | meaning_shift: picado (H, informal) | none (L, informal) | A+B agree, Claude differs | yes: Claude differs from A+B; low confidence: Claude |
| propaganda | 4736 | publicidad | meaning_shift: propaganda (H) | meaning_shift: propaganda (H) | meaning_shift: propaganda (M) | 3-way agree | no |
| halar | 4765 | tirar | replacement: tirar (H) | replacement: tirar (H) | none (L) | A+B agree, Claude differs | yes: Claude differs from A+B; low confidence: Claude |
| condón | 4788 | forro | replacement: preservativo (H) | replacement: preservativo (H) | replacement: preservativo (M) | 3-way agree | no |
| sanidad | 4790 | salud | none (H) | none (H) | replacement: salud pública (M) | A+B agree, Claude differs | yes: Claude differs from A+B |
| refresco | 4871 | gaseosa | replacement: gaseosa @ar (H) | replacement: gaseosa (H) | replacement: gaseosa @ar (M) | Claude matches one of A/B | no |
| DANA | 4971 | fenómeno meteorológico / depresión atmosférica | none (H) | none (H) | none (H) | 3-way agree | no |

## Claude's one-line reasons for the 25 most frequent rows that need a local check

- **chico** (rank 109): Boy/kid: pibe in Argentina, gurí in Uruguay.
- **niño** (rank 147): Niño is used normally in AR and UY; pibe/gurí are informal extras, not replacements.
- **vuestro** (rank 626): No vosotros in AR/UY; the possessive for plural you is su or de ustedes.
- **recoger** (rank 644): Used normally; no clear documented Rioplatense difference.
- **vosotros** (rank 790): Vosotros is not used in AR/UY; ustedes is the plural you.
- **metro** (rank 792): Buenos Aires subway is the subte; Uruguay has no subway; meter sense is unchanged.
- **guapo** (rank 1129): In AR/UY guapo leans to brave, tough or skilled; handsome is lindo or buen mozo.
- **tontería** (rank 1320): Used normally; pavada exists but tontería is not marked.
- **apartamento** (rank 1339): Argentina says departamento; Uruguay uses apartamento like the standard.
- **tony** (rank 1342): Not a standard Spanish word (name/slang); no safe claim.
- **escoger** (rank 1396): Elegir is common everywhere; no regional claim.
- **cabello** (rank 1527): Formal everywhere; pelo preference is not Rioplatense-specific.
- **coño** (rank 1709): Peninsular vulgar word, not used by Rioplatense speakers; no clean everyday replacement.
- **puto** (rank 1747): Same vulgar/offensive use as standard; no distinct Rioplatense form.
- **pastel** (rank 1768): Cake is torta in AR/UY; pastel there is mostly a savory or small pastry.
- **deprisa** (rank 2191): Spelling variant of de prisa; no Rioplatense angle.
- **wow** (rank 2336): English interjection, not a Spanish word.
- **trozo** (rank 2423): Used normally; pedazo preference is not Rioplatense-specific.
- **galleta** (rank 2595): Argentina says galletita; Uruguay uses galleta.
- **sofá** (rank 2657): Same word everywhere.
- **automóvil** (rank 2837): Formal everywhere; auto preference is general, not Rioplatense-specific.
- **Hacienda** (rank 2843): In AR/UY hacienda commonly means livestock (cattle); the Treasury sense is Peninsular.
- **feria** (rank 2846): Fair or market sense is standard; no distinct shift.
- **follar** (rank 2958): Peninsular vulgar verb; the Rioplatense word is itself vulgar, no clean everyday form.
- **boleto** (rank 3098): Boleto for transport ticket is pan-Latin American, not specifically Rioplatense.
