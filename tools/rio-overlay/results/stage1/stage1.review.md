# Stage 1 review: 134 words with a legacy es_rioplatense

Base (A): `s1-A` — gemini-3.1-pro-preview, context sense. Review only (B): `s1-B` — gemini-2.5-flash, context minimal. No hint was sent in either run.

| bucket | size |
|---|---|
| (a) A and B disagree on rio_type, rio_form, region or alt_form | 51 |
| (b) A or B disagrees with the legacy es_rioplatense | 73 |
| (c) Validation errors (A or B) | 10 |
| (d) Confidence low or medium (A or B) | 8 |
| (e) Register vulgar or offensive (A or B) | 5 |
| (f) Pass-2 queue: A is not none and the current dictionary example lacks the form | 8 |
| (g) Legacy marked it, but both A and B answer none | 22 |

Line format: `word | legacy | A | B`, then the two reasoning strings. Types are rio_type: rio_form (region, alt_form/alt_region), then (confidence, register). Every entry in a bucket has its full fields in the Details section at the end.

## (a) A and B disagree on rio_type, rio_form, region or alt_form — 51

- **aquí** | legacy "acá" | A replacement: acá (high, neutral) | B none (high, neutral)
  - A reasoning: AR: acá; UY: acá; std: aquí -> replacement
  - B reasoning: AR: aquí; UY: aquí; std: aquí -> none. "Aquí" is used universally in Rioplatense Spanish, no specific regional form or meaning.

- **niño** | legacy "pibe" | A replacement: nene (high, neutral) | B replacement: chico (high, neutral)
  - A reasoning: AR: nene; UY: nene; std: niño -> replacement
  - B reasoning: AR: chico/pibe; UY: chico/gurí; std: niño -> replacement. "Chico" is more common for "child/boy" in everyday Rioplatense speech.

- **pequeño** | legacy "chico" | A replacement: chico (high, neutral) | B none (high, neutral)
  - A reasoning: AR: chico; UY: chico; std: pequeño -> replacement
  - B reasoning: AR: pequeño/chico; UY: pequeño/chico; std: pequeño -> none. "Pequeño" is widely used and understood, no specific Rioplatense angle.

- **quizá** | legacy "capaz" | A replacement: capaz (high, informal) | B none (high, neutral)
  - A reasoning: AR: capaz; UY: capaz; std: quizá -> replacement
  - B reasoning: AR: quizá/quizás; UY: quizá/quizás; std: quizá -> none. Both forms are standard and used interchangeably in Rioplatense.

- **quizás** | legacy "capaz" | A replacement: capaz (high, informal) | B none (high, neutral)
  - A reasoning: AR: capaz; UY: capaz; std: quizás -> replacement
  - B reasoning: AR: quizá/quizás; UY: quizá/quizás; std: quizás -> none. Both forms are standard and used interchangeably in Rioplatense.

- **muchacho** | legacy "pibe" | A none (high, neutral) | B replacement: pibe region=ar (high, informal)
  - A reasoning: AR: muchacho; UY: muchacho; std: muchacho -> none
  - B reasoning: AR: pibe; UY: muchacho (standard); std: muchacho (boy) -> replacement (in AR)

- **hermoso** | legacy "lindo" | A none (high, neutral) | B replacement: lindo (high, neutral)
  - A reasoning: AR: hermoso; UY: hermoso; std: hermoso -> none
  - B reasoning: AR: lindo; UY: lindo; std: hermoso (beautiful) -> replacement

- **recoger** | legacy "levantar" | A none (high, neutral) | B replacement: levantar (high, neutral)
  - A reasoning: AR: recoger; UY: recoger; std: recoger -> none
  - B reasoning: AR: levantar; UY: levantar; std: recoger (to pick up) -> replacement

- **bello** | legacy "lindo" | A replacement: lindo (high, neutral) | B none (high, neutral)
  - A reasoning: AR: lindo; UY: lindo; std: bello -> replacement
  - B reasoning: AR: hermoso/lindo; UY: hermoso/lindo; std: bello -> none

- **rostro** | legacy "cara" | A none (high, neutral) | B replacement: cara (high, neutral)
  - A reasoning: AR: cara; UY: cara; std: rostro -> none
  - B reasoning: AR: cara; UY: cara; std: rostro -> replacement

- **apartamento** | legacy "departamento" | A replacement: apartamento region=uy alt=departamento/ar (high, neutral) | B replacement: departamento (high, neutral)
  - A reasoning: AR: departamento; UY: apartamento; std: apartamento -> replacement
  - B reasoning: AR: departamento; UY: apartamento/departamento; std: apartamento -> replacement

- **empleo** | legacy "laburo" | A none (high, neutral) | B replacement: trabajo (high, neutral)
  - A reasoning: AR: empleo; UY: empleo; std: empleo -> none
  - B reasoning: AR: trabajo; UY: trabajo; std: empleo -> replacement. "Trabajo" is the much more common word for "job" or "employment" in Rioplatense Spanish.

- **vacación** | legacy "vacaciones" | A none (high, neutral) | B form: vacaciones (high, neutral)
  - A reasoning: AR: vacaciones; UY: vacaciones; std: vacación -> none
  - B reasoning: AR: vacaciones; UY: vacaciones; std: vacación (singular) -> form. In Rioplatense, "vacaciones" (plural) is almost exclusively used.

- **norteamericano** | legacy "estadounidense" | A none (high, neutral) | B replacement: estadounidense (high, neutral)
  - A reasoning: AR: norteamericano; UY: norteamericano; std: norteamericano -> none
  - B reasoning: AR: estadounidense; UY: estadounidense; std: norteamericano -> replacement. "Estadounidense" is preferred for "from the USA".

- **puto** | legacy "Used as a strong intensifier or general expletive, often to express annoyance or emphasize something negative, beyond its literal derogatory meaning." | A none (high, offensive) | B meaning_shift: puto (high, vulgar)
  - A reasoning: AR: puto; UY: puto; std: puto -> none
  - B reasoning: AR: puto (intensifier/insult); UY: puto (intensifier/insult); std: male prostitute, faggot -> meaning_shift

- **cigarrillo** | legacy "pucho" | A none (high, neutral) | B replacement: pucho (high, informal)
  - A reasoning: AR: cigarrillo; UY: cigarrillo; std: cigarrillo -> none
  - B reasoning: AR: pucho; UY: pucho; std: cigarrillo -> replacement

- **carro** | legacy "auto" | A none (high, neutral) | B replacement: auto (high, neutral)
  - A reasoning: AR: carro; UY: carro; std: carro -> none
  - B reasoning: AR: auto; UY: auto; std: carro (cart, wagon, sometimes car) -> replacement

- **fila** | legacy "cola" | A none (high, neutral) | B replacement: cola (high, neutral)
  - A reasoning: AR: fila; UY: fila; std: fila -> none
  - B reasoning: AR: cola; UY: cola; std: fila -> replacement

- **ayuntamiento** | legacy "municipalidad" | A replacement: intendencia region=uy alt=municipalidad/ar (high, neutral) | B replacement: intendencia (high, neutral)
  - A reasoning: AR: municipalidad; UY: intendencia; std: ayuntamiento -> replacement
  - B reasoning: AR: intendencia; UY: intendencia; std: ayuntamiento -> replacement

- **filme** | legacy "película" | A none (high, neutral) | B replacement: película (high, neutral)
  - A reasoning: AR: película; UY: película; std: película -> none
  - B reasoning: AR: película; UY: película; std: filme -> replacement

- **armario** | legacy "ropero" | A replacement: placard (high, neutral) | B replacement: ropero (high, neutral)
  - A reasoning: AR: placard; UY: placard; std: armario -> replacement
  - B reasoning: AR: ropero; UY: ropero; std: armario -> replacement

- **galleta** | legacy "galletita" | A replacement: galletita (high, neutral) | B meaning_shift: galleta (high, neutral)
  - A reasoning: AR: galletita; UY: galletita; std: galleta -> replacement
  - B reasoning: AR: galleta (cracker); UY: galleta (cracker); std: galleta (biscuit/cookie) -> meaning_shift

- **dormitorio** | legacy "habitación" | A none (high, neutral) | B replacement: habitación (high, neutral)
  - A reasoning: AR: dormitorio; UY: dormitorio; std: dormitorio -> none
  - B reasoning: AR: habitación/cuarto; UY: habitación/cuarto; std: dormitorio -> replacement

- **salario** | legacy "sueldo" | A none (high, neutral) | B replacement: sueldo (high, neutral)
  - A reasoning: AR: sueldo; UY: sueldo; std: salario -> none
  - B reasoning: AR: sueldo; UY: sueldo; std: salario -> replacement

- **aguardar** | legacy "esperar" | A none (high, neutral) | B replacement: esperar (high, neutral)
  - A reasoning: AR: esperar; UY: esperar; std: aguardar -> none
  - B reasoning: AR: esperar; UY: esperar; std: aguardar -> replacement

- **Hacienda** | legacy "estancia" | A replacement: estancia (medium, neutral) | B none (high, neutral)
  - A reasoning: AR: estancia; UY: estancia; std: hacienda -> replacement
  - B reasoning: AR: ?; UY: ?; std: Treasury, estate -> none

- **follar** | legacy "coger" | A replacement: coger (high, vulgar) | B none (high, vulgar)
  - A reasoning: AR: coger; UY: coger; std: follar -> replacement
  - B reasoning: AR: follar (vulgar); UY: follar (vulgar); std: to fuck (vulgar) -> none

- **boleto** | legacy "pasaje" | A none (high, neutral) | B meaning_shift: boleto (high, neutral)
  - A reasoning: AR: boleto; UY: boleto; std: billete -> none
  - B reasoning: AR: boleto; UY: boleto; std: ticket (general) -> meaning_shift

- **gafas** | legacy "anteojos" | A replacement: lentes region=uy alt=anteojos/ar (high, neutral) | B replacement: anteojos (high, neutral)
  - A reasoning: AR: anteojos; UY: lentes; std: gafas -> replacement
  - B reasoning: AR: anteojos; UY: lentes/anteojos; std: gafas -> replacement

- **tarta** | legacy "torta" | A meaning_shift: tarta (high, neutral) | B replacement: torta (high, neutral)
  - A reasoning: AR: tarta (savory); UY: tarta (savory); std: tarta (sweet) -> meaning_shift
  - B reasoning: AR: torta; UY: torta; std: tarta -> replacement

- **vaquero** | legacy "jean" | A replacement: jean (high, neutral) | B meaning_shift: vaquero (high, neutral)
  - A reasoning: AR: jean; UY: jean; std: vaquero -> replacement
  - B reasoning: AR: jean/vaquero; UY: jean/vaquero; std: vaquero (cowboy/denim) -> meaning_shift

- **cojón** | legacy "huevo" | A replacement: huevo (high, vulgar) | B none (high, vulgar)
  - A reasoning: AR: huevo; UY: huevo; std: cojón -> replacement
  - B reasoning: AR: testículo/pelota (vulgar); UY: testículo/pelota (vulgar); std: cojón (testicle, vulgar) -> none

- **acoger** | legacy "recibir" | A replacement: recibir (high, neutral) | B none (high, neutral)
  - A reasoning: AR: recibir; UY: recibir; std: acoger -> replacement
  - B reasoning: AR: recibir/dar la bienvenida; UY: recibir/dar la bienvenida; std: acoger (to welcome/receive) -> none

- **fibra** | legacy "fibra" | A meaning_shift: fibra region=ar (high, neutral) | B none (high, neutral)
  - A reasoning: AR: fibra; UY: marcador; std: rotulador -> meaning_shift
  - B reasoning: AR: fibra; UY: fibra; std: fibra -> none

- **Gil** | legacy "gil" | A regional_only: gil (high, informal) | B none (low, neutral)
  - A reasoning: AR: gil; UY: gil; std: tonto -> regional_only
  - B reasoning: AR: Gil (surname); UY: Gil (surname); std: Gil (surname) -> none

- **guay** | legacy "copado" | A replacement: de más region=uy alt=copado/ar (high, informal) | B replacement: copado (high, informal)
  - A reasoning: AR: copado; UY: de más; std: guay -> replacement
  - B reasoning: AR: copado/piola; UY: copado/piola; std: guay -> replacement

- **portero** | legacy "arquero (goalkeeper), encargado (doorman)" | A replacement: arquero (high, neutral) | B none (high, neutral)
  - A reasoning: AR: arquero; UY: arquero; std: portero -> replacement
  - B reasoning: AR: portero; UY: portero; std: portero -> none

- **cigarro** | legacy "pucho" | A none (medium, neutral) | B replacement: cigarrillo (high, neutral)
  - A reasoning: AR: cigarrillo; UY: cigarro; std: cigarro -> none
  - B reasoning: AR: cigarrillo; UY: cigarrillo; std: cigarro (cigar) -> replacement

- **goma** | legacy "cubierta" | A none (medium, neutral) | B meaning_shift: goma (high, neutral)
  - A reasoning: AR: goma; UY: goma; std: neumático -> none
  - B reasoning: AR: goma (eraser, tire); UY: goma (eraser, tire); std: goma (rubber, eraser, tire) -> meaning_shift

- **emisora** | legacy "radio" | A none (high, neutral) | B replacement: radio (high, neutral)
  - A reasoning: AR: radio; UY: radio; std: emisora -> none
  - B reasoning: AR: radio; UY: radio; std: emisora (broadcasting station) -> replacement

- **polla** | legacy "pollita (for pullet)" | A meaning_shift: polla (high, neutral) | B replacement: gallina (high, neutral)
  - A reasoning: AR: polla; UY: polla; std: young hen -> meaning_shift
  - B reasoning: AR: gallina (for hen); UY: gallina (for hen); std: hen, pool/bet -> replacement (due to vulgarity)

- **chance** | legacy "oportunidad" | A none (high, neutral) | B regional_only: chance (high, neutral)
  - A reasoning: AR: chance; UY: chance; std: oportunidad -> none
  - B reasoning: AR: chance; UY: chance; std: oportunidad, suerte -> regional_only (common loanword)

- **mona** | legacy "borracha" | A none (high, neutral) | B meaning_shift: mona (high, informal)
  - A reasoning: AR: mona; UY: mona; std: mona -> none
  - B reasoning: AR: resaca, mona; UY: resaca, mona; std: female monkey, cute -> meaning_shift

- **asilo** | legacy "geriátrico" | A replacement: casa de salud region=uy alt=geriátrico/ar (high, neutral) | B none (high, neutral)
  - A reasoning: AR: geriátrico; UY: casa de salud; std: asilo -> replacement
  - B reasoning: AR: asilo, hogar de ancianos; UY: asilo, hogar de ancianos; std: asylum, old people's home -> none

- **baloncesto** | legacy "básquet" | A replacement: básquetbol (high, neutral) | B replacement: básquet (high, neutral)
  - A reasoning: AR: básquetbol; UY: básquetbol; std: baloncesto -> replacement
  - B reasoning: AR: básquet; UY: básquet; std: baloncesto -> replacement

- **marcador** | legacy "fibrón" | A none (medium, neutral) | B meaning_shift: marcador (high, neutral)
  - A reasoning: AR: marcador; UY: marcador; std: marcador -> none
  - B reasoning: AR: marcador; UY: marcador; std: marker (pen), scoreboard -> meaning_shift

- **lentes** | legacy "anteojos" | A meaning_shift: lentes (high, neutral) | B replacement: lentes region=uy alt=anteojos/ar (high, neutral)
  - A reasoning: AR: lentes, anteojos; UY: lentes; std: lenses -> meaning_shift
  - B reasoning: AR: anteojos; UY: lentes; std: lenses, glasses -> replacement

- **foco** | legacy "lamparita" | A none (medium, neutral) | B meaning_shift: foco (high, neutral)
  - A reasoning: AR: lamparita, foco; UY: lamparita, foco; std: foco -> none
  - B reasoning: AR: foco; UY: foco; std: focus, spotlight -> meaning_shift

- **crío** | legacy "pibe" | A replacement: nene (high, neutral) | B meaning_shift: crío (high, informal)
  - A reasoning: AR: nene, pibe; UY: nene, chiquilín, gurí; std: crío -> replacement
  - B reasoning: AR: crío; UY: crío; std: baby animal, offspring -> meaning_shift

- **neumático** | legacy "cubierta" | A replacement: cubierta (high, neutral) | B replacement: neumático region=uy alt=cubierta/ar (high, neutral)
  - A reasoning: AR: cubierta, goma; UY: cubierta; std: neumático -> replacement
  - B reasoning: AR: cubierta; UY: neumático; std: pneumatic, tire -> replacement

- **refresco** | legacy "gaseosa" | A replacement: gaseosa region=ar (high, neutral) | B replacement: gaseosa (high, neutral)
  - A reasoning: AR: gaseosa; UY: refresco; std: refresco -> replacement
  - B reasoning: AR: gaseosa; UY: gaseosa; std: refresco (soft drink) -> replacement

## (b) A or B disagrees with the legacy es_rioplatense — 73

- **aquí** | legacy "acá" | A replacement: acá (high, neutral) | B none (high, neutral)
  - A reasoning: AR: acá; UY: acá; std: aquí -> replacement
  - B reasoning: AR: aquí; UY: aquí; std: aquí -> none. "Aquí" is used universally in Rioplatense Spanish, no specific regional form or meaning.
  - B vs legacy: legacy_only

- **chico** | legacy "pibe" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: chico; UY: chico; std: chico -> none
  - B reasoning: AR: chico/pibe; UY: chico/gurí; std: chico -> none. "Chico" is used as "boy" or "small" in Rioplatense, no meaning shift or replacement.
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **niño** | legacy "pibe" | A replacement: nene (high, neutral) | B replacement: chico (high, neutral)
  - A reasoning: AR: nene; UY: nene; std: niño -> replacement
  - B reasoning: AR: chico/pibe; UY: chico/gurí; std: niño -> replacement. "Chico" is more common for "child/boy" in everyday Rioplatense speech.
  - A vs legacy: different
  - B vs legacy: different

- **pequeño** | legacy "chico" | A replacement: chico (high, neutral) | B none (high, neutral)
  - A reasoning: AR: chico; UY: chico; std: pequeño -> replacement
  - B reasoning: AR: pequeño/chico; UY: pequeño/chico; std: pequeño -> none. "Pequeño" is widely used and understood, no specific Rioplatense angle.
  - B vs legacy: legacy_only

- **esposo** | legacy "marido" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: marido; UY: marido; std: esposo -> none
  - B reasoning: AR: esposo/marido; UY: esposo/marido; std: esposo -> none. "Esposo" is used and understood, no specific Rioplatense angle.
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **quizá** | legacy "capaz" | A replacement: capaz (high, informal) | B none (high, neutral)
  - A reasoning: AR: capaz; UY: capaz; std: quizá -> replacement
  - B reasoning: AR: quizá/quizás; UY: quizá/quizás; std: quizá -> none. Both forms are standard and used interchangeably in Rioplatense.
  - B vs legacy: legacy_only

- **ello** | legacy "eso" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: eso; UY: eso; std: ello -> none
  - B reasoning: AR: ello; UY: ello; std: ello -> none. "Ello" is a formal, neuter pronoun, rarely used in everyday Rioplatense speech.
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **quizás** | legacy "capaz" | A replacement: capaz (high, informal) | B none (high, neutral)
  - A reasoning: AR: capaz; UY: capaz; std: quizás -> replacement
  - B reasoning: AR: quizá/quizás; UY: quizá/quizás; std: quizás -> none. Both forms are standard and used interchangeably in Rioplatense.
  - B vs legacy: legacy_only

- **muchacho** | legacy "pibe" | A none (high, neutral) | B replacement: pibe region=ar (high, informal)
  - A reasoning: AR: muchacho; UY: muchacho; std: muchacho -> none
  - B reasoning: AR: pibe; UY: muchacho (standard); std: muchacho (boy) -> replacement (in AR)
  - A vs legacy: legacy_only

- **hermoso** | legacy "lindo" | A none (high, neutral) | B replacement: lindo (high, neutral)
  - A reasoning: AR: hermoso; UY: hermoso; std: hermoso -> none
  - B reasoning: AR: lindo; UY: lindo; std: hermoso (beautiful) -> replacement
  - A vs legacy: legacy_only

- **obtener** | legacy "conseguir" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: obtener; UY: obtener; std: obtener -> none
  - B reasoning: AR: obtener; UY: obtener; std: obtener -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **utilizar** | legacy "usar" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: utilizar; UY: utilizar; std: utilizar -> none
  - B reasoning: AR: usar; UY: usar; std: utilizar -> none (preference of frequency/formality, not a regional difference)
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **recoger** | legacy "levantar" | A none (high, neutral) | B replacement: levantar (high, neutral)
  - A reasoning: AR: recoger; UY: recoger; std: recoger -> none
  - B reasoning: AR: levantar; UY: levantar; std: recoger (to pick up) -> replacement
  - A vs legacy: legacy_only

- **guapo** | legacy "fachero" | A meaning_shift: guapo (high, informal) | B meaning_shift: guapo (high, neutral)
  - A reasoning: AR: brave, tough; UY: brave, tough; std: handsome -> meaning_shift
  - B reasoning: AR: valiente/bravo; UY: valiente/bravo; std: handsome, brave -> meaning_shift
  - A vs legacy: different
  - B vs legacy: different

- **bello** | legacy "lindo" | A replacement: lindo (high, neutral) | B none (high, neutral)
  - A reasoning: AR: lindo; UY: lindo; std: bello -> replacement
  - B reasoning: AR: hermoso/lindo; UY: hermoso/lindo; std: bello -> none
  - B vs legacy: legacy_only

- **rostro** | legacy "cara" | A none (high, neutral) | B replacement: cara (high, neutral)
  - A reasoning: AR: cara; UY: cara; std: rostro -> none
  - B reasoning: AR: cara; UY: cara; std: rostro -> replacement
  - A vs legacy: legacy_only

- **tony** | legacy "cheto" | A none (high, informal) | B none (low, neutral)
  - A reasoning: AR: cheto; UY: cheto; std: ? -> none
  - B reasoning: AR: ?; UY: ?; std: ? -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **solicitar** | legacy "pedir / postularse" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: solicitar; UY: solicitar; std: solicitar -> none
  - B reasoning: AR: pedir; UY: pedir; std: solicitar -> none. "Solicitar" is standard, formality difference exists everywhere, not Rioplatense specific.
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **empleo** | legacy "laburo" | A none (high, neutral) | B replacement: trabajo (high, neutral)
  - A reasoning: AR: empleo; UY: empleo; std: empleo -> none
  - B reasoning: AR: trabajo; UY: trabajo; std: empleo -> replacement. "Trabajo" is the much more common word for "job" or "employment" in Rioplatense Spanish.
  - A vs legacy: legacy_only
  - B vs legacy: different

- **vacación** | legacy "vacaciones" | A none (high, neutral) | B form: vacaciones (high, neutral)
  - A reasoning: AR: vacaciones; UY: vacaciones; std: vacación -> none
  - B reasoning: AR: vacaciones; UY: vacaciones; std: vacación (singular) -> form. In Rioplatense, "vacaciones" (plural) is almost exclusively used.
  - A vs legacy: legacy_only

- **fresco** | legacy "fresco" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: fresco; UY: fresco; std: fresco -> none
  - B reasoning: AR: fresco; UY: fresco; std: fresco -> none. "Fresco" means "cool" or "fresh" in Rioplatense Spanish, just like in standard Spanish.
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **norteamericano** | legacy "estadounidense" | A none (high, neutral) | B replacement: estadounidense (high, neutral)
  - A reasoning: AR: norteamericano; UY: norteamericano; std: norteamericano -> none
  - B reasoning: AR: estadounidense; UY: estadounidense; std: norteamericano -> replacement. "Estadounidense" is preferred for "from the USA".
  - A vs legacy: legacy_only

- **puto** | legacy "Used as a strong intensifier or general expletive, often to express annoyance or emphasize something negative, beyond its literal derogatory meaning." | A none (high, offensive) | B meaning_shift: puto (high, vulgar)
  - A reasoning: AR: puto; UY: puto; std: puto -> none
  - B reasoning: AR: puto (intensifier/insult); UY: puto (intensifier/insult); std: male prostitute, faggot -> meaning_shift
  - A vs legacy: legacy_only
  - B vs legacy: different

- **profundar** | legacy "profundizar" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: profundizar; UY: profundizar; std: profundar -> none
  - B reasoning: AR: profundizar; UY: profundizar; std: profundizar -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **cigarrillo** | legacy "pucho" | A none (high, neutral) | B replacement: pucho (high, informal)
  - A reasoning: AR: cigarrillo; UY: cigarrillo; std: cigarrillo -> none
  - B reasoning: AR: pucho; UY: pucho; std: cigarrillo -> replacement
  - A vs legacy: legacy_only

- **carro** | legacy "auto" | A none (high, neutral) | B replacement: auto (high, neutral)
  - A reasoning: AR: carro; UY: carro; std: carro -> none
  - B reasoning: AR: auto; UY: auto; std: carro (cart, wagon, sometimes car) -> replacement
  - A vs legacy: legacy_only

- **fila** | legacy "cola" | A none (high, neutral) | B replacement: cola (high, neutral)
  - A reasoning: AR: fila; UY: fila; std: fila -> none
  - B reasoning: AR: cola; UY: cola; std: fila -> replacement
  - A vs legacy: legacy_only

- **recientemente** | legacy "recién" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: recientemente; UY: recientemente; std: recientemente -> none
  - B reasoning: AR: recientemente; UY: recientemente; std: recientemente -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **nuevamente** | legacy "de nuevo" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: nuevamente; UY: nuevamente; std: nuevamente -> none
  - B reasoning: AR: nuevamente; UY: nuevamente; std: nuevamente -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **ayuntamiento** | legacy "municipalidad" | A replacement: intendencia region=uy alt=municipalidad/ar (high, neutral) | B replacement: intendencia (high, neutral)
  - A reasoning: AR: municipalidad; UY: intendencia; std: ayuntamiento -> replacement
  - B reasoning: AR: intendencia; UY: intendencia; std: ayuntamiento -> replacement
  - B vs legacy: different

- **filme** | legacy "película" | A none (high, neutral) | B replacement: película (high, neutral)
  - A reasoning: AR: película; UY: película; std: película -> none
  - B reasoning: AR: película; UY: película; std: filme -> replacement
  - A vs legacy: legacy_only

- **wow** | legacy "¡Qué bárbaro!" | A none (high, neutral) | B none (low, neutral)
  - A reasoning: AR: guau; UY: guau; std: guau -> none
  - B reasoning: AR: wow; UY: wow; std: wow -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **armario** | legacy "ropero" | A replacement: placard (high, neutral) | B replacement: ropero (high, neutral)
  - A reasoning: AR: placard; UY: placard; std: armario -> replacement
  - B reasoning: AR: ropero; UY: ropero; std: armario -> replacement
  - A vs legacy: different

- **portar** | legacy "llevar" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: llevar; UY: llevar; std: portar -> none
  - B reasoning: AR: llevar/comportarse; UY: llevar/comportarse; std: portar -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **galleta** | legacy "galletita" | A replacement: galletita (high, neutral) | B meaning_shift: galleta (high, neutral)
  - A reasoning: AR: galletita; UY: galletita; std: galleta -> replacement
  - B reasoning: AR: galleta (cracker); UY: galleta (cracker); std: galleta (biscuit/cookie) -> meaning_shift
  - B vs legacy: different

- **dormitorio** | legacy "habitación" | A none (high, neutral) | B replacement: habitación (high, neutral)
  - A reasoning: AR: dormitorio; UY: dormitorio; std: dormitorio -> none
  - B reasoning: AR: habitación/cuarto; UY: habitación/cuarto; std: dormitorio -> replacement
  - A vs legacy: legacy_only

- **salario** | legacy "sueldo" | A none (high, neutral) | B replacement: sueldo (high, neutral)
  - A reasoning: AR: sueldo; UY: sueldo; std: salario -> none
  - B reasoning: AR: sueldo; UY: sueldo; std: salario -> replacement
  - A vs legacy: legacy_only

- **aguardar** | legacy "esperar" | A none (high, neutral) | B replacement: esperar (high, neutral)
  - A reasoning: AR: esperar; UY: esperar; std: aguardar -> none
  - B reasoning: AR: esperar; UY: esperar; std: aguardar -> replacement
  - A vs legacy: legacy_only

- **Hacienda** | legacy "estancia" | A replacement: estancia (medium, neutral) | B none (high, neutral)
  - A reasoning: AR: estancia; UY: estancia; std: hacienda -> replacement
  - B reasoning: AR: ?; UY: ?; std: Treasury, estate -> none
  - B vs legacy: legacy_only

- **feria** | legacy "feriado" | A meaning_shift: feria (high, neutral) | B meaning_shift: feria (high, neutral)
  - A reasoning: AR: feria; UY: feria; std: fair, festival -> meaning_shift
  - B reasoning: AR: feria; UY: feria; std: fair, market (general) -> meaning_shift
  - A vs legacy: different
  - B vs legacy: different

- **follar** | legacy "coger" | A replacement: coger (high, vulgar) | B none (high, vulgar)
  - A reasoning: AR: coger; UY: coger; std: follar -> replacement
  - B reasoning: AR: follar (vulgar); UY: follar (vulgar); std: to fuck (vulgar) -> none
  - B vs legacy: legacy_only

- **jo** | legacy "che" | A none (high, informal) | B none (high, informal)
  - A reasoning: AR: ?; UY: ?; std: jo -> none
  - B reasoning: AR: ?; UY: ?; std: interjection of surprise/annoyance -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **boleto** | legacy "pasaje" | A none (high, neutral) | B meaning_shift: boleto (high, neutral)
  - A reasoning: AR: boleto; UY: boleto; std: billete -> none
  - B reasoning: AR: boleto; UY: boleto; std: ticket (general) -> meaning_shift
  - A vs legacy: legacy_only
  - B vs legacy: different

- **tarta** | legacy "torta" | A meaning_shift: tarta (high, neutral) | B replacement: torta (high, neutral)
  - A reasoning: AR: tarta (savory); UY: tarta (savory); std: tarta (sweet) -> meaning_shift
  - B reasoning: AR: torta; UY: torta; std: tarta -> replacement
  - A vs legacy: different

- **colgado** | legacy "(informal, for a person) obsessed, addicted, spaced out" | A meaning_shift: colgado (high, informal) | B meaning_shift: colgado (high, informal)
  - A reasoning: AR: colgado (distracted); UY: colgado; std: colgado (hung) -> meaning_shift
  - B reasoning: AR: colgado (distracted/obsessed); UY: colgado (distracted/obsessed); std: colgado (hanging) -> meaning_shift
  - A vs legacy: different
  - B vs legacy: different

- **garaje** | legacy "cochera" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: garaje; UY: garaje; std: garaje -> none
  - B reasoning: AR: garaje/cochera; UY: garaje/cochera; std: garaje -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **vaquero** | legacy "jean" | A replacement: jean (high, neutral) | B meaning_shift: vaquero (high, neutral)
  - A reasoning: AR: jean; UY: jean; std: vaquero -> replacement
  - B reasoning: AR: jean/vaquero; UY: jean/vaquero; std: vaquero (cowboy/denim) -> meaning_shift
  - B vs legacy: different

- **cojón** | legacy "huevo" | A replacement: huevo (high, vulgar) | B none (high, vulgar)
  - A reasoning: AR: huevo; UY: huevo; std: cojón -> replacement
  - B reasoning: AR: testículo/pelota (vulgar); UY: testículo/pelota (vulgar); std: cojón (testicle, vulgar) -> none
  - B vs legacy: legacy_only

- **acoger** | legacy "recibir" | A replacement: recibir (high, neutral) | B none (high, neutral)
  - A reasoning: AR: recibir; UY: recibir; std: acoger -> replacement
  - B reasoning: AR: recibir/dar la bienvenida; UY: recibir/dar la bienvenida; std: acoger (to welcome/receive) -> none
  - B vs legacy: legacy_only

- **maya** | legacy "malla" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: maya; UY: maya; std: maya -> none
  - B reasoning: AR: ?; UY: ?; std: maya (ethnic group) -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **pa** | legacy "para" | A none (high, informal) | B none (high, neutral)
  - A reasoning: AR: pa; UY: pa; std: para -> none
  - B reasoning: AR: pa (short for para); UY: pa (short for para); std: pa (short for para) -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **fibra** | legacy "fibra" | A meaning_shift: fibra region=ar (high, neutral) | B none (high, neutral)
  - A reasoning: AR: fibra; UY: marcador; std: rotulador -> meaning_shift
  - B reasoning: AR: fibra; UY: fibra; std: fibra -> none
  - B vs legacy: legacy_only

- **Gil** | legacy "gil" | A regional_only: gil (high, informal) | B none (low, neutral)
  - A reasoning: AR: gil; UY: gil; std: tonto -> regional_only
  - B reasoning: AR: Gil (surname); UY: Gil (surname); std: Gil (surname) -> none
  - B vs legacy: legacy_only

- **portero** | legacy "arquero (goalkeeper), encargado (doorman)" | A replacement: arquero (high, neutral) | B none (high, neutral)
  - A reasoning: AR: arquero; UY: arquero; std: portero -> replacement
  - B reasoning: AR: portero; UY: portero; std: portero -> none
  - B vs legacy: legacy_only

- **cigarro** | legacy "pucho" | A none (medium, neutral) | B replacement: cigarrillo (high, neutral)
  - A reasoning: AR: cigarrillo; UY: cigarro; std: cigarro -> none
  - B reasoning: AR: cigarrillo; UY: cigarrillo; std: cigarro (cigar) -> replacement
  - A vs legacy: legacy_only
  - B vs legacy: different

- **orinar** | legacy "hacer pis" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: orinar; UY: orinar; std: orinar -> none
  - B reasoning: AR: orinar/hacer pis; UY: orinar/hacer pis; std: orinar -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **boy** | legacy "pibe" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: chico; UY: chiquilín; std: chico -> none
  - B reasoning: AR: ?; UY: ?; std: boy (English loanword) -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **goma** | legacy "cubierta" | A none (medium, neutral) | B meaning_shift: goma (high, neutral)
  - A reasoning: AR: goma; UY: goma; std: neumático -> none
  - B reasoning: AR: goma (eraser, tire); UY: goma (eraser, tire); std: goma (rubber, eraser, tire) -> meaning_shift
  - A vs legacy: legacy_only
  - B vs legacy: different

- **emisora** | legacy "radio" | A none (high, neutral) | B replacement: radio (high, neutral)
  - A reasoning: AR: radio; UY: radio; std: emisora -> none
  - B reasoning: AR: radio; UY: radio; std: emisora (broadcasting station) -> replacement
  - A vs legacy: legacy_only

- **polla** | legacy "pollita (for pullet)" | A meaning_shift: polla (high, neutral) | B replacement: gallina (high, neutral)
  - A reasoning: AR: polla; UY: polla; std: young hen -> meaning_shift
  - B reasoning: AR: gallina (for hen); UY: gallina (for hen); std: hen, pool/bet -> replacement (due to vulgarity)
  - A vs legacy: different
  - B vs legacy: different

- **chance** | legacy "oportunidad" | A none (high, neutral) | B regional_only: chance (high, neutral)
  - A reasoning: AR: chance; UY: chance; std: oportunidad -> none
  - B reasoning: AR: chance; UY: chance; std: oportunidad, suerte -> regional_only (common loanword)
  - A vs legacy: legacy_only
  - B vs legacy: different

- **mona** | legacy "borracha" | A none (high, neutral) | B meaning_shift: mona (high, informal)
  - A reasoning: AR: mona; UY: mona; std: mona -> none
  - B reasoning: AR: resaca, mona; UY: resaca, mona; std: female monkey, cute -> meaning_shift
  - A vs legacy: legacy_only
  - B vs legacy: different

- **asilo** | legacy "geriátrico" | A replacement: casa de salud region=uy alt=geriátrico/ar (high, neutral) | B none (high, neutral)
  - A reasoning: AR: geriátrico; UY: casa de salud; std: asilo -> replacement
  - B reasoning: AR: asilo, hogar de ancianos; UY: asilo, hogar de ancianos; std: asylum, old people's home -> none
  - B vs legacy: legacy_only

- **baby** | legacy "bebé" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: bebé; UY: bebé; std: bebé -> none
  - B reasoning: AR: bebé, baby; UY: bebé, baby; std: bebé -> none (common loanword, not uniquely Rioplatense)
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **baloncesto** | legacy "básquet" | A replacement: básquetbol (high, neutral) | B replacement: básquet (high, neutral)
  - A reasoning: AR: básquetbol; UY: básquetbol; std: baloncesto -> replacement
  - B reasoning: AR: básquet; UY: básquet; std: baloncesto -> replacement
  - A vs legacy: different

- **marcador** | legacy "fibrón" | A none (medium, neutral) | B meaning_shift: marcador (high, neutral)
  - A reasoning: AR: marcador; UY: marcador; std: marcador -> none
  - B reasoning: AR: marcador; UY: marcador; std: marker (pen), scoreboard -> meaning_shift
  - A vs legacy: legacy_only
  - B vs legacy: different

- **lentes** | legacy "anteojos" | A meaning_shift: lentes (high, neutral) | B replacement: lentes region=uy alt=anteojos/ar (high, neutral)
  - A reasoning: AR: lentes, anteojos; UY: lentes; std: lenses -> meaning_shift
  - B reasoning: AR: anteojos; UY: lentes; std: lenses, glasses -> replacement
  - A vs legacy: different

- **foco** | legacy "lamparita" | A none (medium, neutral) | B meaning_shift: foco (high, neutral)
  - A reasoning: AR: lamparita, foco; UY: lamparita, foco; std: foco -> none
  - B reasoning: AR: foco; UY: foco; std: focus, spotlight -> meaning_shift
  - A vs legacy: legacy_only
  - B vs legacy: different

- **crío** | legacy "pibe" | A replacement: nene (high, neutral) | B meaning_shift: crío (high, informal)
  - A reasoning: AR: nene, pibe; UY: nene, chiquilín, gurí; std: crío -> replacement
  - B reasoning: AR: crío; UY: crío; std: baby animal, offspring -> meaning_shift
  - A vs legacy: different
  - B vs legacy: different

- **propaganda** | legacy "publicidad" | A meaning_shift: propaganda (high, neutral) | B meaning_shift: propaganda (high, neutral)
  - A reasoning: AR: propaganda; UY: propaganda; std: political propaganda -> meaning_shift
  - B reasoning: AR: publicidad; UY: publicidad; std: propaganda -> meaning_shift
  - A vs legacy: different
  - B vs legacy: different

- **condón** | legacy "forro" | A replacement: preservativo (high, neutral) | B replacement: preservativo (high, neutral)
  - A reasoning: AR: preservativo; UY: preservativo; std: condón -> replacement
  - B reasoning: AR: preservativo; UY: preservativo; std: condón -> replacement
  - A vs legacy: different
  - B vs legacy: different

- **sanidad** | legacy "salud" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: salud; UY: salud; std: sanidad -> none
  - B reasoning: AR: salud pública; UY: salud pública; std: sanidad (public health) -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

- **DANA** | legacy "fenómeno meteorológico / depresión atmosférica" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: temporal; UY: temporal; std: DANA -> none
  - B reasoning: AR: ?; UY: ?; std: DANA (acronym for a specific weather phenomenon in Spain) -> none
  - A vs legacy: legacy_only
  - B vs legacy: legacy_only

## (c) Validation errors (A or B) — 10

- **tú** | legacy "vos" | A form: vos (high, neutral) | B form: vos (high, neutral)
  - A reasoning: AR: vos; UY: vos; std: tú -> form
  - B reasoning: AR: vos; UY: vos/tú; std: tú -> form. "Vos" is the dominant informal pronoun in Rioplatense Spanish.
  - B errors: example_group_partial: set: example_translation_en,example_translation_ru

- **niño** | legacy "pibe" | A replacement: nene (high, neutral) | B replacement: chico (high, neutral)
  - A reasoning: AR: nene; UY: nene; std: niño -> replacement
  - B reasoning: AR: chico/pibe; UY: chico/gurí; std: niño -> replacement. "Chico" is more common for "child/boy" in everyday Rioplatense speech.
  - B errors: example_group_partial: set: example_translation_en,example_translation_ru

- **contigo** | legacy "con vos" | A form: con vos (high, neutral) | B form: con vos (high, neutral)
  - A reasoning: AR: con vos; UY: con vos; std: contigo -> form
  - B reasoning: AR: con vos; UY: con vos/contigo; std: contigo -> form. "Con vos" is the common Rioplatense form for informal "with you".
  - B errors: example_group_partial: set: example_translation_en,example_translation_ru

- **apartamento** | legacy "departamento" | A replacement: apartamento region=uy alt=departamento/ar (high, neutral) | B replacement: departamento (high, neutral)
  - A reasoning: AR: departamento; UY: apartamento; std: apartamento -> replacement
  - B reasoning: AR: departamento; UY: apartamento/departamento; std: apartamento -> replacement
  - A errors: rio_form_equals_es_word: replacement needs a different form

- **vos** | legacy "vos" | A regional_only: vos (high, neutral) | B regional_only: vos (high, neutral)
  - A reasoning: AR: vos; UY: vos; std: tú -> regional_only
  - B reasoning: AR: vos; UY: vos; std: tú -> regional_only
  - B errors: note_too_long: note_en 101 > 100 | note_too_long: note_ru 109 > 100

- **puto** | legacy "Used as a strong intensifier or general expletive, often to express annoyance or emphasize something negative, beyond its literal derogatory meaning." | A none (high, offensive) | B meaning_shift: puto (high, vulgar)
  - A reasoning: AR: puto; UY: puto; std: puto -> none
  - B reasoning: AR: puto (intensifier/insult); UY: puto (intensifier/insult); std: male prostitute, faggot -> meaning_shift
  - B errors: note_too_long: note_en 105 > 100

- **boleto** | legacy "pasaje" | A none (high, neutral) | B meaning_shift: boleto (high, neutral)
  - A reasoning: AR: boleto; UY: boleto; std: billete -> none
  - B reasoning: AR: boleto; UY: boleto; std: ticket (general) -> meaning_shift
  - B errors: note_too_long: note_ru 114 > 100

- **cigarro** | legacy "pucho" | A none (medium, neutral) | B replacement: cigarrillo (high, neutral)
  - A reasoning: AR: cigarrillo; UY: cigarro; std: cigarro -> none
  - B reasoning: AR: cigarrillo; UY: cigarrillo; std: cigarro (cigar) -> replacement
  - B errors: std_meaning_not_allowed: replacement must not set std_meaning_*

- **lentes** | legacy "anteojos" | A meaning_shift: lentes (high, neutral) | B replacement: lentes region=uy alt=anteojos/ar (high, neutral)
  - A reasoning: AR: lentes, anteojos; UY: lentes; std: lenses -> meaning_shift
  - B reasoning: AR: anteojos; UY: lentes; std: lenses, glasses -> replacement
  - B errors: rio_form_equals_es_word: replacement needs a different form

- **neumático** | legacy "cubierta" | A replacement: cubierta (high, neutral) | B replacement: neumático region=uy alt=cubierta/ar (high, neutral)
  - A reasoning: AR: cubierta, goma; UY: cubierta; std: neumático -> replacement
  - B reasoning: AR: cubierta; UY: neumático; std: pneumatic, tire -> replacement
  - B errors: rio_form_equals_es_word: replacement needs a different form

## (d) Confidence low or medium (A or B) — 8

- **tony** | legacy "cheto" | A none (high, informal) | B none (low, neutral)
  - A reasoning: AR: cheto; UY: cheto; std: ? -> none
  - B reasoning: AR: ?; UY: ?; std: ? -> none

- **wow** | legacy "¡Qué bárbaro!" | A none (high, neutral) | B none (low, neutral)
  - A reasoning: AR: guau; UY: guau; std: guau -> none
  - B reasoning: AR: wow; UY: wow; std: wow -> none

- **Hacienda** | legacy "estancia" | A replacement: estancia (medium, neutral) | B none (high, neutral)
  - A reasoning: AR: estancia; UY: estancia; std: hacienda -> replacement
  - B reasoning: AR: ?; UY: ?; std: Treasury, estate -> none

- **Gil** | legacy "gil" | A regional_only: gil (high, informal) | B none (low, neutral)
  - A reasoning: AR: gil; UY: gil; std: tonto -> regional_only
  - B reasoning: AR: Gil (surname); UY: Gil (surname); std: Gil (surname) -> none

- **cigarro** | legacy "pucho" | A none (medium, neutral) | B replacement: cigarrillo (high, neutral)
  - A reasoning: AR: cigarrillo; UY: cigarro; std: cigarro -> none
  - B reasoning: AR: cigarrillo; UY: cigarrillo; std: cigarro (cigar) -> replacement

- **goma** | legacy "cubierta" | A none (medium, neutral) | B meaning_shift: goma (high, neutral)
  - A reasoning: AR: goma; UY: goma; std: neumático -> none
  - B reasoning: AR: goma (eraser, tire); UY: goma (eraser, tire); std: goma (rubber, eraser, tire) -> meaning_shift

- **marcador** | legacy "fibrón" | A none (medium, neutral) | B meaning_shift: marcador (high, neutral)
  - A reasoning: AR: marcador; UY: marcador; std: marcador -> none
  - B reasoning: AR: marcador; UY: marcador; std: marker (pen), scoreboard -> meaning_shift

- **foco** | legacy "lamparita" | A none (medium, neutral) | B meaning_shift: foco (high, neutral)
  - A reasoning: AR: lamparita, foco; UY: lamparita, foco; std: foco -> none
  - B reasoning: AR: foco; UY: foco; std: focus, spotlight -> meaning_shift

## (e) Register vulgar or offensive (A or B) — 5

- **coño** | legacy "concha" | A replacement: concha (high, vulgar) | B replacement: concha (high, vulgar)
  - A reasoning: AR: concha; UY: concha; std: coño -> replacement
  - B reasoning: AR: concha (vulgar); UY: concha (vulgar); std: coño (vulgar) -> replacement

- **puto** | legacy "Used as a strong intensifier or general expletive, often to express annoyance or emphasize something negative, beyond its literal derogatory meaning." | A none (high, offensive) | B meaning_shift: puto (high, vulgar)
  - A reasoning: AR: puto; UY: puto; std: puto -> none
  - B reasoning: AR: puto (intensifier/insult); UY: puto (intensifier/insult); std: male prostitute, faggot -> meaning_shift

- **follar** | legacy "coger" | A replacement: coger (high, vulgar) | B none (high, vulgar)
  - A reasoning: AR: coger; UY: coger; std: follar -> replacement
  - B reasoning: AR: follar (vulgar); UY: follar (vulgar); std: to fuck (vulgar) -> none

- **cojón** | legacy "huevo" | A replacement: huevo (high, vulgar) | B none (high, vulgar)
  - A reasoning: AR: huevo; UY: huevo; std: cojón -> replacement
  - B reasoning: AR: testículo/pelota (vulgar); UY: testículo/pelota (vulgar); std: cojón (testicle, vulgar) -> none

- **gilipollas** | legacy "boludo" | A replacement: boludo (high, vulgar) | B replacement: boludo (high, informal)
  - A reasoning: AR: boludo; UY: boludo; std: gilipollas -> replacement
  - B reasoning: AR: boludo; UY: boludo; std: gilipollas -> replacement

## (f) Pass-2 queue: A is not none and the current dictionary example lacks the form — 8

- **niño** | legacy "pibe" | A replacement: nene (high, neutral) | B replacement: chico (high, neutral)
  - A reasoning: AR: nene; UY: nene; std: niño -> replacement
  - B reasoning: AR: chico/pibe; UY: chico/gurí; std: niño -> replacement. "Chico" is more common for "child/boy" in everyday Rioplatense speech.

- **guapo** | legacy "fachero" | A meaning_shift: guapo (high, informal) | B meaning_shift: guapo (high, neutral)
  - A reasoning: AR: brave, tough; UY: brave, tough; std: handsome -> meaning_shift
  - B reasoning: AR: valiente/bravo; UY: valiente/bravo; std: handsome, brave -> meaning_shift
  - B also needs an example

- **armario** | legacy "ropero" | A replacement: placard (high, neutral) | B replacement: ropero (high, neutral)
  - A reasoning: AR: placard; UY: placard; std: armario -> replacement
  - B reasoning: AR: ropero; UY: ropero; std: armario -> replacement

- **tarta** | legacy "torta" | A meaning_shift: tarta (high, neutral) | B replacement: torta (high, neutral)
  - A reasoning: AR: tarta (savory); UY: tarta (savory); std: tarta (sweet) -> meaning_shift
  - B reasoning: AR: torta; UY: torta; std: tarta -> replacement

- **lentes** | legacy "anteojos" | A meaning_shift: lentes (high, neutral) | B replacement: lentes region=uy alt=anteojos/ar (high, neutral)
  - A reasoning: AR: lentes, anteojos; UY: lentes; std: lenses -> meaning_shift
  - B reasoning: AR: anteojos; UY: lentes; std: lenses, glasses -> replacement

- **crío** | legacy "pibe" | A replacement: nene (high, neutral) | B meaning_shift: crío (high, informal)
  - A reasoning: AR: nene, pibe; UY: nene, chiquilín, gurí; std: crío -> replacement
  - B reasoning: AR: crío; UY: crío; std: baby animal, offspring -> meaning_shift
  - B also needs an example

- **propaganda** | legacy "publicidad" | A meaning_shift: propaganda (high, neutral) | B meaning_shift: propaganda (high, neutral)
  - A reasoning: AR: propaganda; UY: propaganda; std: political propaganda -> meaning_shift
  - B reasoning: AR: publicidad; UY: publicidad; std: propaganda -> meaning_shift
  - B also needs an example

- **condón** | legacy "forro" | A replacement: preservativo (high, neutral) | B replacement: preservativo (high, neutral)
  - A reasoning: AR: preservativo; UY: preservativo; std: condón -> replacement
  - B reasoning: AR: preservativo; UY: preservativo; std: condón -> replacement
  - B also needs an example

## (g) Legacy marked it, but both A and B answer none — 22

- **chico** | legacy "pibe" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: chico; UY: chico; std: chico -> none
  - B reasoning: AR: chico/pibe; UY: chico/gurí; std: chico -> none. "Chico" is used as "boy" or "small" in Rioplatense, no meaning shift or replacement.

- **esposo** | legacy "marido" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: marido; UY: marido; std: esposo -> none
  - B reasoning: AR: esposo/marido; UY: esposo/marido; std: esposo -> none. "Esposo" is used and understood, no specific Rioplatense angle.

- **ello** | legacy "eso" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: eso; UY: eso; std: ello -> none
  - B reasoning: AR: ello; UY: ello; std: ello -> none. "Ello" is a formal, neuter pronoun, rarely used in everyday Rioplatense speech.

- **obtener** | legacy "conseguir" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: obtener; UY: obtener; std: obtener -> none
  - B reasoning: AR: obtener; UY: obtener; std: obtener -> none

- **utilizar** | legacy "usar" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: utilizar; UY: utilizar; std: utilizar -> none
  - B reasoning: AR: usar; UY: usar; std: utilizar -> none (preference of frequency/formality, not a regional difference)

- **tony** | legacy "cheto" | A none (high, informal) | B none (low, neutral)
  - A reasoning: AR: cheto; UY: cheto; std: ? -> none
  - B reasoning: AR: ?; UY: ?; std: ? -> none

- **solicitar** | legacy "pedir / postularse" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: solicitar; UY: solicitar; std: solicitar -> none
  - B reasoning: AR: pedir; UY: pedir; std: solicitar -> none. "Solicitar" is standard, formality difference exists everywhere, not Rioplatense specific.

- **fresco** | legacy "fresco" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: fresco; UY: fresco; std: fresco -> none
  - B reasoning: AR: fresco; UY: fresco; std: fresco -> none. "Fresco" means "cool" or "fresh" in Rioplatense Spanish, just like in standard Spanish.

- **profundar** | legacy "profundizar" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: profundizar; UY: profundizar; std: profundar -> none
  - B reasoning: AR: profundizar; UY: profundizar; std: profundizar -> none

- **recientemente** | legacy "recién" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: recientemente; UY: recientemente; std: recientemente -> none
  - B reasoning: AR: recientemente; UY: recientemente; std: recientemente -> none

- **nuevamente** | legacy "de nuevo" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: nuevamente; UY: nuevamente; std: nuevamente -> none
  - B reasoning: AR: nuevamente; UY: nuevamente; std: nuevamente -> none

- **wow** | legacy "¡Qué bárbaro!" | A none (high, neutral) | B none (low, neutral)
  - A reasoning: AR: guau; UY: guau; std: guau -> none
  - B reasoning: AR: wow; UY: wow; std: wow -> none

- **portar** | legacy "llevar" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: llevar; UY: llevar; std: portar -> none
  - B reasoning: AR: llevar/comportarse; UY: llevar/comportarse; std: portar -> none

- **jo** | legacy "che" | A none (high, informal) | B none (high, informal)
  - A reasoning: AR: ?; UY: ?; std: jo -> none
  - B reasoning: AR: ?; UY: ?; std: interjection of surprise/annoyance -> none

- **garaje** | legacy "cochera" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: garaje; UY: garaje; std: garaje -> none
  - B reasoning: AR: garaje/cochera; UY: garaje/cochera; std: garaje -> none

- **maya** | legacy "malla" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: maya; UY: maya; std: maya -> none
  - B reasoning: AR: ?; UY: ?; std: maya (ethnic group) -> none

- **pa** | legacy "para" | A none (high, informal) | B none (high, neutral)
  - A reasoning: AR: pa; UY: pa; std: para -> none
  - B reasoning: AR: pa (short for para); UY: pa (short for para); std: pa (short for para) -> none

- **orinar** | legacy "hacer pis" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: orinar; UY: orinar; std: orinar -> none
  - B reasoning: AR: orinar/hacer pis; UY: orinar/hacer pis; std: orinar -> none

- **boy** | legacy "pibe" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: chico; UY: chiquilín; std: chico -> none
  - B reasoning: AR: ?; UY: ?; std: boy (English loanword) -> none

- **baby** | legacy "bebé" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: bebé; UY: bebé; std: bebé -> none
  - B reasoning: AR: bebé, baby; UY: bebé, baby; std: bebé -> none (common loanword, not uniquely Rioplatense)

- **sanidad** | legacy "salud" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: salud; UY: salud; std: sanidad -> none
  - B reasoning: AR: salud pública; UY: salud pública; std: sanidad (public health) -> none

- **DANA** | legacy "fenómeno meteorológico / depresión atmosférica" | A none (high, neutral) | B none (high, neutral)
  - A reasoning: AR: temporal; UY: temporal; std: DANA -> none
  - B reasoning: AR: ?; UY: ?; std: DANA (acronym for a specific weather phenomenon in Spain) -> none

## Details: every field of the 83 entries that appear in a bucket (null fields omitted)

#### aquí  (legacy: "acá")
- A: reasoning="AR: acá; UY: acá; std: aquí -> replacement"; rio_type="replacement"; rio_form="acá"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: aquí; UY: aquí; std: aquí -> none. \"Aquí\" is used universally in Rioplatense Spanish, no specific regional form or meaning."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### tú  (legacy: "vos")
- A: reasoning="AR: vos; UY: vos; std: tú -> form"; rio_type="form"; rio_form="vos"; register="neutral"; confidence="high"
  - warnings: form_type_notable_only: form is for pronouns and irregular voseo only; regular voseo is a general rule
  - needs_example_check; current example shows form: true
- B: reasoning="AR: vos; UY: vos/tú; std: tú -> form. \"Vos\" is the dominant informal pronoun in Rioplatense Spanish."; rio_type="form"; rio_form="vos"; register="neutral"; note_en="In Rioplatense Spanish, \"vos\" is used for informal address instead of \"tú\"."; note_ru="В риоплатском испанском \"vos\" используется для неформального обращения вместо \"tú\"."; example_translation_en="you (informal singular)"; example_translation_ru="ты"; en_translation="you (informal singular)"; ru_translation="ты"; confidence="high"
  - ERRORS: example_group_partial: set: example_translation_en,example_translation_ru
  - warnings: form_type_notable_only: form is for pronouns and irregular voseo only; regular voseo is a general rule

#### chico  (legacy: "pibe")
- A: reasoning="AR: chico; UY: chico; std: chico -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: chico/pibe; UY: chico/gurí; std: chico -> none. \"Chico\" is used as \"boy\" or \"small\" in Rioplatense, no meaning shift or replacement."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### niño  (legacy: "pibe")
- A: reasoning="AR: nene; UY: nene; std: niño -> replacement"; rio_type="replacement"; rio_form="nene"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: chico/pibe; UY: chico/gurí; std: niño -> replacement. \"Chico\" is more common for \"child/boy\" in everyday Rioplatense speech."; rio_type="replacement"; rio_form="chico"; register="neutral"; note_en="\"Niño\" is understood but \"chico\" is more common for \"child\" in Rioplatense Spanish."; note_ru="\"Niño\" понятно, но \"chico\" чаще используется для \"ребенок\" в риоплатском испанском."; example_translation_en="child, boy"; example_translation_ru="ребенок, мальчик"; en_translation="child, boy"; ru_translation="ребенок, мальчик"; confidence="high"
  - ERRORS: example_group_partial: set: example_translation_en,example_translation_ru
  - warnings: translation_unchanged: override equals the current translation

#### pequeño  (legacy: "chico")
- A: reasoning="AR: chico; UY: chico; std: pequeño -> replacement"; rio_type="replacement"; rio_form="chico"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: pequeño/chico; UY: pequeño/chico; std: pequeño -> none. \"Pequeño\" is widely used and understood, no specific Rioplatense angle."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### contigo  (legacy: "con vos")
- A: reasoning="AR: con vos; UY: con vos; std: contigo -> form"; rio_type="form"; rio_form="con vos"; register="neutral"; confidence="high"
  - warnings: form_type_notable_only: form is for pronouns and irregular voseo only; regular voseo is a general rule
  - needs_example_check; current example shows form: true
- B: reasoning="AR: con vos; UY: con vos/contigo; std: contigo -> form. \"Con vos\" is the common Rioplatense form for informal \"with you\"."; rio_type="form"; rio_form="con vos"; register="neutral"; note_en="In Rioplatense Spanish, \"con vos\" is used for informal \"with you\" instead of \"contigo\"."; note_ru="В риоплатском испанском \"con vos\" используется для неформального \"с тобой\" вместо \"contigo\"."; example_translation_en="with you (informal singular)"; example_translation_ru="с тобой"; en_translation="with you (informal singular)"; ru_translation="с тобой"; confidence="high"
  - ERRORS: example_group_partial: set: example_translation_en,example_translation_ru
  - warnings: form_type_notable_only: form is for pronouns and irregular voseo only; regular voseo is a general rule | translation_unchanged: override equals the current translation

#### esposo  (legacy: "marido")
- A: reasoning="AR: marido; UY: marido; std: esposo -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: esposo/marido; UY: esposo/marido; std: esposo -> none. \"Esposo\" is used and understood, no specific Rioplatense angle."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### quizá  (legacy: "capaz")
- A: reasoning="AR: capaz; UY: capaz; std: quizá -> replacement"; rio_type="replacement"; rio_form="capaz"; register="informal"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: quizá/quizás; UY: quizá/quizás; std: quizá -> none. Both forms are standard and used interchangeably in Rioplatense."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### ello  (legacy: "eso")
- A: reasoning="AR: eso; UY: eso; std: ello -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: ello; UY: ello; std: ello -> none. \"Ello\" is a formal, neuter pronoun, rarely used in everyday Rioplatense speech."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### quizás  (legacy: "capaz")
- A: reasoning="AR: capaz; UY: capaz; std: quizás -> replacement"; rio_type="replacement"; rio_form="capaz"; register="informal"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: quizá/quizás; UY: quizá/quizás; std: quizás -> none. Both forms are standard and used interchangeably in Rioplatense."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### muchacho  (legacy: "pibe")
- A: reasoning="AR: muchacho; UY: muchacho; std: muchacho -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: pibe; UY: muchacho (standard); std: muchacho (boy) -> replacement (in AR)"; rio_type="replacement"; rio_form="pibe"; region="ar"; register="informal"; en_translation="boy, kid"; ru_translation="мальчик, парень, ребёнок"; confidence="high"
  - needs_example_check; current example shows form: true

#### hermoso  (legacy: "lindo")
- A: reasoning="AR: hermoso; UY: hermoso; std: hermoso -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: lindo; UY: lindo; std: hermoso (beautiful) -> replacement"; rio_type="replacement"; rio_form="lindo"; register="neutral"; en_translation="beautiful, lovely, nice"; ru_translation="красивый, прекрасный, милый"; confidence="high"
  - needs_example_check; current example shows form: true

#### obtener  (legacy: "conseguir")
- A: reasoning="AR: obtener; UY: obtener; std: obtener -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: obtener; UY: obtener; std: obtener -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### utilizar  (legacy: "usar")
- A: reasoning="AR: utilizar; UY: utilizar; std: utilizar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: usar; UY: usar; std: utilizar -> none (preference of frequency/formality, not a regional difference)"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### recoger  (legacy: "levantar")
- A: reasoning="AR: recoger; UY: recoger; std: recoger -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: levantar; UY: levantar; std: recoger (to pick up) -> replacement"; rio_type="replacement"; rio_form="levantar"; register="neutral"; en_translation="to pick up, to lift"; ru_translation="поднимать, подбирать"; confidence="high"
  - needs_example_check; current example shows form: true

#### guapo  (legacy: "fachero")
- A: reasoning="AR: brave, tough; UY: brave, tough; std: handsome -> meaning_shift"; rio_type="meaning_shift"; rio_form="guapo"; std_meaning_en="handsome, good-looking"; std_meaning_ru="красивый, привлекательный"; register="informal"; en_translation="brave, tough"; ru_translation="смелый, крутой"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: valiente/bravo; UY: valiente/bravo; std: handsome, brave -> meaning_shift"; rio_type="meaning_shift"; rio_form="guapo"; std_meaning_en="handsome, good-looking"; std_meaning_ru="красивый, симпатичный"; register="neutral"; note_en="In Rioplatense, \"guapo\" means \"brave\" or \"tough\", not \"handsome\"."; note_ru="В риоплатенсе \"guapo\" означает \"храбрый\" или \"крутой\", а не \"красивый\"."; en_translation="brave, tough"; ru_translation="храбрый, смелый, крутой"; confidence="high"
  - needs_example_check; current example shows form: false

#### bello  (legacy: "lindo")
- A: reasoning="AR: lindo; UY: lindo; std: bello -> replacement"; rio_type="replacement"; rio_form="lindo"; register="neutral"; en_translation="beautiful, pretty"; ru_translation="красивый, милый"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: hermoso/lindo; UY: hermoso/lindo; std: bello -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### rostro  (legacy: "cara")
- A: reasoning="AR: cara; UY: cara; std: rostro -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: cara; UY: cara; std: rostro -> replacement"; rio_type="replacement"; rio_form="cara"; register="neutral"; en_translation="face"; ru_translation="лицо"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true

#### apartamento  (legacy: "departamento")
- A: reasoning="AR: departamento; UY: apartamento; std: apartamento -> replacement"; rio_type="replacement"; rio_form="apartamento"; region="uy"; alt_form="departamento"; alt_region="ar"; register="neutral"; en_translation="apartment"; ru_translation="квартира"; confidence="high"
  - ERRORS: rio_form_equals_es_word: replacement needs a different form
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true
- B: reasoning="AR: departamento; UY: apartamento/departamento; std: apartamento -> replacement"; rio_type="replacement"; rio_form="departamento"; register="neutral"; note_en="In Uruguay, \"apartamento\" is also commonly used."; note_ru="В Уругвае также часто используется \"apartamento\"."; en_translation="apartment"; ru_translation="квартира"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true

#### tony  (legacy: "cheto")
- A: reasoning="AR: cheto; UY: cheto; std: ? -> none"; rio_type="none"; register="informal"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: ?; UY: ?; std: ? -> none"; rio_type="none"; register="neutral"; confidence="low"

#### vos  (legacy: "vos")
- A: reasoning="AR: vos; UY: vos; std: tú -> regional_only"; rio_type="regional_only"; rio_form="vos"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: vos; UY: vos; std: tú -> regional_only"; rio_type="regional_only"; rio_form="vos"; register="neutral"; note_en="\"Vos\" is the standard informal second-person singular pronoun in Rioplatense Spanish, replacing \"tú\"."; note_ru="\"Vos\" — стандартное неформальное местоимение второго лица единственного числа в риоплатенсе, заменяющее \"tú\"."; en_translation="you (informal singular)"; ru_translation="ты (неформальное единственное число)"; confidence="high"
  - ERRORS: note_too_long: note_en 101 > 100 | note_too_long: note_ru 109 > 100
  - needs_example_check; current example shows form: true

#### solicitar  (legacy: "pedir / postularse")
- A: reasoning="AR: solicitar; UY: solicitar; std: solicitar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: pedir; UY: pedir; std: solicitar -> none. \"Solicitar\" is standard, formality difference exists everywhere, not Rioplatense specific."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### empleo  (legacy: "laburo")
- A: reasoning="AR: empleo; UY: empleo; std: empleo -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: trabajo; UY: trabajo; std: empleo -> replacement. \"Trabajo\" is the much more common word for \"job\" or \"employment\" in Rioplatense Spanish."; rio_type="replacement"; rio_form="trabajo"; register="neutral"; en_translation="job, employment"; ru_translation="работа, занятость"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: false

#### vacación  (legacy: "vacaciones")
- A: reasoning="AR: vacaciones; UY: vacaciones; std: vacación -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: vacaciones; UY: vacaciones; std: vacación (singular) -> form. In Rioplatense, \"vacaciones\" (plural) is almost exclusively used."; rio_type="form"; rio_form="vacaciones"; register="neutral"; en_translation="vacation, holiday"; ru_translation="отпуск, каникулы"; confidence="high"
  - warnings: form_type_notable_only: form is for pronouns and irregular voseo only; regular voseo is a general rule
  - needs_example_check; current example shows form: true

#### fresco  (legacy: "fresco")
- A: reasoning="AR: fresco; UY: fresco; std: fresco -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: fresco; UY: fresco; std: fresco -> none. \"Fresco\" means \"cool\" or \"fresh\" in Rioplatense Spanish, just like in standard Spanish."; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### norteamericano  (legacy: "estadounidense")
- A: reasoning="AR: norteamericano; UY: norteamericano; std: norteamericano -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: estadounidense; UY: estadounidense; std: norteamericano -> replacement. \"Estadounidense\" is preferred for \"from the USA\"."; rio_type="replacement"; rio_form="estadounidense"; register="neutral"; en_translation="American (from the USA)"; ru_translation="американский (из США)"; confidence="high"
  - needs_example_check; current example shows form: true

#### coño  (legacy: "concha")
- A: reasoning="AR: concha; UY: concha; std: coño -> replacement"; rio_type="replacement"; rio_form="concha"; register="vulgar"; confidence="high"
  - warnings: sensitive_register: vulgar
  - needs_example_check; current example shows form: true
- B: reasoning="AR: concha (vulgar); UY: concha (vulgar); std: coño (vulgar) -> replacement"; rio_type="replacement"; rio_form="concha"; register="vulgar"; note_en="In Rioplatense, \"coño\" is not used; \"concha\" is the common vulgar term for vagina."; note_ru="В Рио-де-ла-Плата \"coño\" не используется; \"concha\" - обычное вульгарное слово для влагалища."; en_translation="cunt, pussy"; ru_translation="пизда, вагина"; confidence="high"
  - warnings: sensitive_register: vulgar
  - needs_example_check; current example shows form: true

#### puto  (legacy: "Used as a strong intensifier or general expletive, often to express annoyance or emphasize something negative, beyond its literal derogatory meaning.")
- A: reasoning="AR: puto; UY: puto; std: puto -> none"; rio_type="none"; register="offensive"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: puto (intensifier/insult); UY: puto (intensifier/insult); std: male prostitute, faggot -> meaning_shift"; rio_type="meaning_shift"; rio_form="puto"; std_meaning_en="male prostitute, faggot (derogatory)"; std_meaning_ru="мужская проститутка, педик (уничижительно)"; register="vulgar"; note_en="In Rioplatense, \"puto\" is often used as an intensifier or general insult, similar to \"fucking\" or \"damn\"."; note_ru="В Рио-де-ла-Плата \"puto\" часто используется как усилитель или общее оскорбление."; en_translation="faggot (derogatory), damn, fucking (as intensifier)"; ru_translation="педик (уничижительно), чертов, блядский (как усилитель)"; confidence="high"
  - ERRORS: note_too_long: note_en 105 > 100
  - warnings: sensitive_register: vulgar
  - needs_example_check; current example shows form: true

#### profundar  (legacy: "profundizar")
- A: reasoning="AR: profundizar; UY: profundizar; std: profundar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: profundizar; UY: profundizar; std: profundizar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### cigarrillo  (legacy: "pucho")
- A: reasoning="AR: cigarrillo; UY: cigarrillo; std: cigarrillo -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: pucho; UY: pucho; std: cigarrillo -> replacement"; rio_type="replacement"; rio_form="pucho"; register="informal"; note_en="\"Pucho\" is a common informal term for \"cigarette\" in Rioplatense Spanish."; note_ru="\"Pucho\" - распространенное неформальное слово для \"сигареты\" в Рио-де-ла-Плата."; en_translation="cigarette"; ru_translation="сигарета"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: false

#### carro  (legacy: "auto")
- A: reasoning="AR: carro; UY: carro; std: carro -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: auto; UY: auto; std: carro (cart, wagon, sometimes car) -> replacement"; rio_type="replacement"; rio_form="auto"; register="neutral"; note_en="In Rioplatense, \"carro\" typically refers to a cart or wagon, not a car. Use \"auto\"."; note_ru="В Рио-де-ла-Плата \"carro\" обычно означает телегу, а не автомобиль. Используйте \"auto\"."; en_translation="car"; ru_translation="автомобиль, машина"; confidence="high"
  - needs_example_check; current example shows form: true

#### fila  (legacy: "cola")
- A: reasoning="AR: fila; UY: fila; std: fila -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: cola; UY: cola; std: fila -> replacement"; rio_type="replacement"; rio_form="cola"; register="neutral"; en_translation="queue, line"; ru_translation="очередь"; confidence="high"
  - needs_example_check; current example shows form: true

#### recientemente  (legacy: "recién")
- A: reasoning="AR: recientemente; UY: recientemente; std: recientemente -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: recientemente; UY: recientemente; std: recientemente -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### nuevamente  (legacy: "de nuevo")
- A: reasoning="AR: nuevamente; UY: nuevamente; std: nuevamente -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: nuevamente; UY: nuevamente; std: nuevamente -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### ayuntamiento  (legacy: "municipalidad")
- A: reasoning="AR: municipalidad; UY: intendencia; std: ayuntamiento -> replacement"; rio_type="replacement"; rio_form="intendencia"; region="uy"; alt_form="municipalidad"; alt_region="ar"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: intendencia; UY: intendencia; std: ayuntamiento -> replacement"; rio_type="replacement"; rio_form="intendencia"; register="neutral"; en_translation="city hall, municipal government"; ru_translation="мэрия, муниципалитет"; confidence="high"
  - needs_example_check; current example shows form: false

#### filme  (legacy: "película")
- A: reasoning="AR: película; UY: película; std: película -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: película; UY: película; std: filme -> replacement"; rio_type="replacement"; rio_form="película"; register="neutral"; en_translation="film, movie"; ru_translation="фильм, кино"; confidence="high"
  - needs_example_check; current example shows form: true

#### wow  (legacy: "¡Qué bárbaro!")
- A: reasoning="AR: guau; UY: guau; std: guau -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: wow; UY: wow; std: wow -> none"; rio_type="none"; register="neutral"; confidence="low"

#### armario  (legacy: "ropero")
- A: reasoning="AR: placard; UY: placard; std: armario -> replacement"; rio_type="replacement"; rio_form="placard"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: ropero; UY: ropero; std: armario -> replacement"; rio_type="replacement"; rio_form="ropero"; register="neutral"; en_translation="wardrobe, closet"; ru_translation="шкаф для одежды, гардероб"; confidence="high"
  - needs_example_check; current example shows form: true

#### portar  (legacy: "llevar")
- A: reasoning="AR: llevar; UY: llevar; std: portar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: llevar/comportarse; UY: llevar/comportarse; std: portar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### galleta  (legacy: "galletita")
- A: reasoning="AR: galletita; UY: galletita; std: galleta -> replacement"; rio_type="replacement"; rio_form="galletita"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: galleta (cracker); UY: galleta (cracker); std: galleta (biscuit/cookie) -> meaning_shift"; rio_type="meaning_shift"; rio_form="galleta"; std_meaning_en="biscuit, cookie (general term)"; std_meaning_ru="печенье, бисквит (общий термин)"; register="neutral"; en_translation="cracker, hardtack biscuit"; ru_translation="крекер, галета, сухое печенье"; confidence="high"
  - needs_example_check; current example shows form: true

#### dormitorio  (legacy: "habitación")
- A: reasoning="AR: dormitorio; UY: dormitorio; std: dormitorio -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: habitación/cuarto; UY: habitación/cuarto; std: dormitorio -> replacement"; rio_type="replacement"; rio_form="habitación"; register="neutral"; en_translation="bedroom"; ru_translation="спальня, комната"; confidence="high"
  - needs_example_check; current example shows form: true

#### salario  (legacy: "sueldo")
- A: reasoning="AR: sueldo; UY: sueldo; std: salario -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: sueldo; UY: sueldo; std: salario -> replacement"; rio_type="replacement"; rio_form="sueldo"; register="neutral"; en_translation="salary, wage"; ru_translation="зарплата, оклад"; confidence="high"
  - needs_example_check; current example shows form: true

#### aguardar  (legacy: "esperar")
- A: reasoning="AR: esperar; UY: esperar; std: aguardar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: esperar; UY: esperar; std: aguardar -> replacement"; rio_type="replacement"; rio_form="esperar"; register="neutral"; en_translation="to wait"; ru_translation="ждать"; confidence="high"
  - needs_example_check; current example shows form: true

#### Hacienda  (legacy: "estancia")
- A: reasoning="AR: estancia; UY: estancia; std: hacienda -> replacement"; rio_type="replacement"; rio_form="estancia"; register="neutral"; en_translation="estate, ranch"; ru_translation="поместье, ранчо"; confidence="medium"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: ?; UY: ?; std: Treasury, estate -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### feria  (legacy: "feriado")
- A: reasoning="AR: feria; UY: feria; std: fair, festival -> meaning_shift"; rio_type="meaning_shift"; rio_form="feria"; std_meaning_en="fair, festival, holiday"; std_meaning_ru="ярмарка, праздник, фестиваль"; register="neutral"; en_translation="street market, farmers' market"; ru_translation="уличный рынок, продуктовый рынок"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: feria; UY: feria; std: fair, market (general) -> meaning_shift"; rio_type="meaning_shift"; rio_form="feria"; std_meaning_en="fair, market (general)"; std_meaning_ru="ярмарка, базар (общий)"; register="neutral"; en_translation="street market, fair"; ru_translation="уличный рынок, ярмарка"; confidence="high"
  - needs_example_check; current example shows form: true

#### follar  (legacy: "coger")
- A: reasoning="AR: coger; UY: coger; std: follar -> replacement"; rio_type="replacement"; rio_form="coger"; register="vulgar"; note_en="\"Coger\" is the local vulgar equivalent. Never use it to mean \"to take\" here!"; note_ru="Местный мат. Никогда не используйте \"coger\" в значении \"брать\" в этих странах!"; en_translation="to fuck"; ru_translation="трахаться"; confidence="high"
  - warnings: sensitive_register: vulgar
  - needs_example_check; current example shows form: true
- B: reasoning="AR: follar (vulgar); UY: follar (vulgar); std: to fuck (vulgar) -> none"; rio_type="none"; register="vulgar"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### jo  (legacy: "che")
- A: reasoning="AR: ?; UY: ?; std: jo -> none"; rio_type="none"; register="informal"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: ?; UY: ?; std: interjection of surprise/annoyance -> none"; rio_type="none"; register="informal"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### boleto  (legacy: "pasaje")
- A: reasoning="AR: boleto; UY: boleto; std: billete -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: boleto; UY: boleto; std: ticket (general) -> meaning_shift"; rio_type="meaning_shift"; rio_form="boleto"; std_meaning_en="ticket (general)"; std_meaning_ru="билет (общий)"; register="neutral"; note_en="In Rioplatense, usually refers to a bus ticket or lottery ticket. Use \"entrada\" for other tickets."; note_ru="В Рио-де-ла-Плата обычно означает билет на автобус или лотерейный билет. Для других билетов используйте \"entrada\"."; en_translation="bus ticket, lottery ticket"; ru_translation="билет на автобус, лотерейный билет"; confidence="high"
  - ERRORS: note_too_long: note_ru 114 > 100
  - needs_example_check; current example shows form: false

#### gafas  (legacy: "anteojos")
- A: reasoning="AR: anteojos; UY: lentes; std: gafas -> replacement"; rio_type="replacement"; rio_form="lentes"; region="uy"; alt_form="anteojos"; alt_region="ar"; register="neutral"; en_translation="glasses"; ru_translation="очки"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: anteojos; UY: lentes/anteojos; std: gafas -> replacement"; rio_type="replacement"; rio_form="anteojos"; register="neutral"; en_translation="glasses, spectacles"; ru_translation="очки"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true

#### tarta  (legacy: "torta")
- A: reasoning="AR: tarta (savory); UY: tarta (savory); std: tarta (sweet) -> meaning_shift"; rio_type="meaning_shift"; rio_form="tarta"; std_meaning_en="sweet cake"; std_meaning_ru="сладкий торт"; register="neutral"; note_en="In Rioplatense, tarta is a savory pie. For a sweet cake, use torta."; note_ru="В Рио-де-ла-Плата tarta — это несладкий пирог. Торт — это torta."; en_translation="savory pie, quiche"; ru_translation="несладкий пирог, киш"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: torta; UY: torta; std: tarta -> replacement"; rio_type="replacement"; rio_form="torta"; register="neutral"; en_translation="cake, pie"; ru_translation="торт, пирог"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true

#### colgado  (legacy: "(informal, for a person) obsessed, addicted, spaced out")
- A: reasoning="AR: colgado (distracted); UY: colgado; std: colgado (hung) -> meaning_shift"; rio_type="meaning_shift"; rio_form="colgado"; std_meaning_en="hung, hanging"; std_meaning_ru="висящий, повешенный"; register="informal"; en_translation="spaced out, distracted"; ru_translation="рассеянный, витающий в облаках"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: colgado (distracted/obsessed); UY: colgado (distracted/obsessed); std: colgado (hanging) -> meaning_shift"; rio_type="meaning_shift"; rio_form="colgado"; std_meaning_en="hung, hanging"; std_meaning_ru="повешенный, висящий"; register="informal"; en_translation="distracted, absent-minded, obsessed"; ru_translation="рассеянный, задумчивый, помешанный"; confidence="high"
  - needs_example_check; current example shows form: true

#### garaje  (legacy: "cochera")
- A: reasoning="AR: garaje; UY: garaje; std: garaje -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: garaje/cochera; UY: garaje/cochera; std: garaje -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### vaquero  (legacy: "jean")
- A: reasoning="AR: jean; UY: jean; std: vaquero -> replacement"; rio_type="replacement"; rio_form="jean"; register="neutral"; en_translation="jeans"; ru_translation="джинсы"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: jean/vaquero; UY: jean/vaquero; std: vaquero (cowboy/denim) -> meaning_shift"; rio_type="meaning_shift"; rio_form="vaquero"; std_meaning_en="cowboy, denim (fabric)"; std_meaning_ru="ковбой, джинсовая ткань"; register="neutral"; en_translation="jeans"; ru_translation="джинсы"; confidence="high"
  - needs_example_check; current example shows form: false

#### cojón  (legacy: "huevo")
- A: reasoning="AR: huevo; UY: huevo; std: cojón -> replacement"; rio_type="replacement"; rio_form="huevo"; register="vulgar"; en_translation="testicle, ball"; ru_translation="яичко, яйцо"; confidence="high"
  - warnings: sensitive_register: vulgar
  - needs_example_check; current example shows form: true
- B: reasoning="AR: testículo/pelota (vulgar); UY: testículo/pelota (vulgar); std: cojón (testicle, vulgar) -> none"; rio_type="none"; register="vulgar"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### acoger  (legacy: "recibir")
- A: reasoning="AR: recibir; UY: recibir; std: acoger -> replacement"; rio_type="replacement"; rio_form="recibir"; register="neutral"; en_translation="to welcome, to receive"; ru_translation="принимать, встречать"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: recibir/dar la bienvenida; UY: recibir/dar la bienvenida; std: acoger (to welcome/receive) -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### maya  (legacy: "malla")
- A: reasoning="AR: maya; UY: maya; std: maya -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: ?; UY: ?; std: maya (ethnic group) -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### gilipollas  (legacy: "boludo")
- A: reasoning="AR: boludo; UY: boludo; std: gilipollas -> replacement"; rio_type="replacement"; rio_form="boludo"; register="vulgar"; en_translation="idiot, jerk"; ru_translation="придурок, идиот"; confidence="high"
  - warnings: sensitive_register: vulgar
  - needs_example_check; current example shows form: true
- B: reasoning="AR: boludo; UY: boludo; std: gilipollas -> replacement"; rio_type="replacement"; rio_form="boludo"; register="informal"; note_en="\"Gilipollas\" is not used in Rioplatense Spanish. Use \"boludo\" instead."; note_ru="\"Gilipollas\" не используется в риоплатском испанском. Используйте \"boludo\"."; en_translation="idiot, jerk"; ru_translation="идиот, придурок"; confidence="high"
  - needs_example_check; current example shows form: true

#### pa  (legacy: "para")
- A: reasoning="AR: pa; UY: pa; std: para -> none"; rio_type="none"; register="informal"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: pa (short for para); UY: pa (short for para); std: pa (short for para) -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### fibra  (legacy: "fibra")
- A: reasoning="AR: fibra; UY: marcador; std: rotulador -> meaning_shift"; rio_type="meaning_shift"; rio_form="fibra"; region="ar"; std_meaning_en="fiber"; std_meaning_ru="волокно, клетчатка"; register="neutral"; en_translation="marker pen, felt-tip pen"; ru_translation="фломастер, маркер"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: fibra; UY: fibra; std: fibra -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### Gil  (legacy: "gil")
- A: reasoning="AR: gil; UY: gil; std: tonto -> regional_only"; rio_type="regional_only"; rio_form="gil"; register="informal"; en_translation="fool, sucker, naive person"; ru_translation="дурак, простофиля, лох"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: Gil (surname); UY: Gil (surname); std: Gil (surname) -> none"; rio_type="none"; register="neutral"; confidence="low"

#### guay  (legacy: "copado")
- A: reasoning="AR: copado; UY: de más; std: guay -> replacement"; rio_type="replacement"; rio_form="de más"; region="uy"; alt_form="copado"; alt_region="ar"; register="informal"; en_translation="cool, great"; ru_translation="круто, классный"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: copado/piola; UY: copado/piola; std: guay -> replacement"; rio_type="replacement"; rio_form="copado"; register="informal"; note_en="\"Guay\" is not used in Rioplatense Spanish. Use \"copado\" or \"piola\" instead."; note_ru="\"Guay\" не используется в риоплатском испанском. Используйте \"copado\" или \"piola\"."; en_translation="cool, great"; ru_translation="классный, крутой"; confidence="high"
  - needs_example_check; current example shows form: true

#### portero  (legacy: "arquero (goalkeeper), encargado (doorman)")
- A: reasoning="AR: arquero; UY: arquero; std: portero -> replacement"; rio_type="replacement"; rio_form="arquero"; register="neutral"; en_translation="goalkeeper"; ru_translation="вратарь"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: portero; UY: portero; std: portero -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### cigarro  (legacy: "pucho")
- A: reasoning="AR: cigarrillo; UY: cigarro; std: cigarro -> none"; rio_type="none"; register="neutral"; confidence="medium"
- B: reasoning="AR: cigarrillo; UY: cigarrillo; std: cigarro (cigar) -> replacement"; rio_type="replacement"; rio_form="cigarrillo"; std_meaning_en="cigar (often also cigarette in Spain)"; std_meaning_ru="сигара (часто также сигарета в Испании)"; register="neutral"; note_en="In Rioplatense, \"cigarro\" means 'cigar'. Use \"cigarrillo\" for 'cigarette'."; note_ru="В Рио-де-ла-Плате \"cigarro\" означает 'сигара'. Используйте \"cigarrillo\" для 'сигареты'."; en_translation="cigarette"; ru_translation="сигарета"; confidence="high"
  - ERRORS: std_meaning_not_allowed: replacement must not set std_meaning_*
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: false

#### orinar  (legacy: "hacer pis")
- A: reasoning="AR: orinar; UY: orinar; std: orinar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: orinar/hacer pis; UY: orinar/hacer pis; std: orinar -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### boy  (legacy: "pibe")
- A: reasoning="AR: chico; UY: chiquilín; std: chico -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: ?; UY: ?; std: boy (English loanword) -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### goma  (legacy: "cubierta")
- A: reasoning="AR: goma; UY: goma; std: neumático -> none"; rio_type="none"; register="neutral"; confidence="medium"
- B: reasoning="AR: goma (eraser, tire); UY: goma (eraser, tire); std: goma (rubber, eraser, tire) -> meaning_shift"; rio_type="meaning_shift"; rio_form="goma"; std_meaning_en="rubber, gum"; std_meaning_ru="резина, жвачка"; register="neutral"; en_translation="eraser, tire"; ru_translation="ластик, шина"; confidence="high"
  - needs_example_check; current example shows form: false

#### emisora  (legacy: "radio")
- A: reasoning="AR: radio; UY: radio; std: emisora -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: radio; UY: radio; std: emisora (broadcasting station) -> replacement"; rio_type="replacement"; rio_form="radio"; register="neutral"; en_translation="radio station"; ru_translation="радиостанция"; confidence="high"
  - needs_example_check; current example shows form: true

#### polla  (legacy: "pollita (for pullet)")
- A: reasoning="AR: polla; UY: polla; std: young hen -> meaning_shift"; rio_type="meaning_shift"; rio_form="polla"; std_meaning_en="young hen"; std_meaning_ru="молодая курица"; register="neutral"; note_en="In Spain this is highly vulgar (penis), but in Rioplatense it is a normal word for a betting pool."; note_ru="В Испании это вульгарное слово (член), но в Рио-де-ла-Плате — обычное слово для тотализатора."; en_translation="betting pool, sweepstake"; ru_translation="тотализатор, ставки"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: gallina (for hen); UY: gallina (for hen); std: hen, pool/bet -> replacement (due to vulgarity)"; rio_type="replacement"; rio_form="gallina"; register="neutral"; note_en="In Rioplatense, \"polla\" is a vulgar term for \"penis\". Use \"gallina\" for \"hen\"."; note_ru="В Рио-де-ла-Плата \"polla\" - вульгарное слово для \"пениса\". Используйте \"gallina\" для \"курица\"."; en_translation="hen"; ru_translation="курица"; confidence="high"
  - needs_example_check; current example shows form: false

#### chance  (legacy: "oportunidad")
- A: reasoning="AR: chance; UY: chance; std: oportunidad -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: chance; UY: chance; std: oportunidad, suerte -> regional_only (common loanword)"; rio_type="regional_only"; rio_form="chance"; register="neutral"; en_translation="chance, opportunity"; ru_translation="шанс, возможность"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true

#### mona  (legacy: "borracha")
- A: reasoning="AR: mona; UY: mona; std: mona -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: resaca, mona; UY: resaca, mona; std: female monkey, cute -> meaning_shift"; rio_type="meaning_shift"; rio_form="mona"; std_meaning_en="female monkey, cute"; std_meaning_ru="самка обезьяны, милая"; register="informal"; en_translation="hangover"; ru_translation="похмелье"; confidence="high"
  - needs_example_check; current example shows form: false

#### asilo  (legacy: "geriátrico")
- A: reasoning="AR: geriátrico; UY: casa de salud; std: asilo -> replacement"; rio_type="replacement"; rio_form="casa de salud"; region="uy"; alt_form="geriátrico"; alt_region="ar"; register="neutral"; en_translation="nursing home, retirement home"; ru_translation="дом престарелых"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: asilo, hogar de ancianos; UY: asilo, hogar de ancianos; std: asylum, old people's home -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### baby  (legacy: "bebé")
- A: reasoning="AR: bebé; UY: bebé; std: bebé -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: bebé, baby; UY: bebé, baby; std: bebé -> none (common loanword, not uniquely Rioplatense)"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### baloncesto  (legacy: "básquet")
- A: reasoning="AR: básquetbol; UY: básquetbol; std: baloncesto -> replacement"; rio_type="replacement"; rio_form="básquetbol"; register="neutral"; en_translation="basketball"; ru_translation="баскетбол"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true
- B: reasoning="AR: básquet; UY: básquet; std: baloncesto -> replacement"; rio_type="replacement"; rio_form="básquet"; register="neutral"; en_translation="basketball"; ru_translation="баскетбол"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: true

#### marcador  (legacy: "fibrón")
- A: reasoning="AR: marcador; UY: marcador; std: marcador -> none"; rio_type="none"; register="neutral"; confidence="medium"
- B: reasoning="AR: marcador; UY: marcador; std: marker (pen), scoreboard -> meaning_shift"; rio_type="meaning_shift"; rio_form="marcador"; std_meaning_en="marker (pen), scoreboard"; std_meaning_ru="маркер (ручка), табло"; register="neutral"; en_translation="marker (pen)"; ru_translation="маркер (ручка)"; confidence="high"
  - needs_example_check; current example shows form: false

#### lentes  (legacy: "anteojos")
- A: reasoning="AR: lentes, anteojos; UY: lentes; std: lenses -> meaning_shift"; rio_type="meaning_shift"; rio_form="lentes"; std_meaning_en="lenses"; std_meaning_ru="линзы"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: anteojos; UY: lentes; std: lenses, glasses -> replacement"; rio_type="replacement"; rio_form="lentes"; region="uy"; alt_form="anteojos"; alt_region="ar"; register="neutral"; en_translation="glasses, spectacles"; ru_translation="очки"; confidence="high"
  - ERRORS: rio_form_equals_es_word: replacement needs a different form
  - needs_example_check; current example shows form: true

#### foco  (legacy: "lamparita")
- A: reasoning="AR: lamparita, foco; UY: lamparita, foco; std: foco -> none"; rio_type="none"; register="neutral"; confidence="medium"
- B: reasoning="AR: foco; UY: foco; std: focus, spotlight -> meaning_shift"; rio_type="meaning_shift"; rio_form="foco"; std_meaning_en="focus, spotlight"; std_meaning_ru="фокус, прожектор"; register="neutral"; en_translation="light bulb"; ru_translation="лампочка"; confidence="high"
  - needs_example_check; current example shows form: false

#### crío  (legacy: "pibe")
- A: reasoning="AR: nene, pibe; UY: nene, chiquilín, gurí; std: crío -> replacement"; rio_type="replacement"; rio_form="nene"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: crío; UY: crío; std: baby animal, offspring -> meaning_shift"; rio_type="meaning_shift"; rio_form="crío"; std_meaning_en="baby animal, offspring"; std_meaning_ru="детёныш, отпрыск"; register="informal"; en_translation="child, kid (informal)"; ru_translation="ребёнок, дитя (разг.)"; confidence="high"
  - needs_example_check; current example shows form: false

#### neumático  (legacy: "cubierta")
- A: reasoning="AR: cubierta, goma; UY: cubierta; std: neumático -> replacement"; rio_type="replacement"; rio_form="cubierta"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: cubierta; UY: neumático; std: pneumatic, tire -> replacement"; rio_type="replacement"; rio_form="neumático"; region="uy"; alt_form="cubierta"; alt_region="ar"; register="neutral"; en_translation="tire"; ru_translation="шина, покрышка"; confidence="high"
  - ERRORS: rio_form_equals_es_word: replacement needs a different form
  - needs_example_check; current example shows form: true

#### propaganda  (legacy: "publicidad")
- A: reasoning="AR: propaganda; UY: propaganda; std: political propaganda -> meaning_shift"; rio_type="meaning_shift"; rio_form="propaganda"; std_meaning_en="political propaganda"; std_meaning_ru="политическая пропаганда"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: publicidad; UY: publicidad; std: propaganda -> meaning_shift"; rio_type="meaning_shift"; rio_form="propaganda"; std_meaning_en="propaganda"; std_meaning_ru="пропаганда"; register="neutral"; note_en="In Rioplatense, 'propaganda' often means 'advertising' in general, not just political propaganda."; note_ru="В Рио-де-ла-Плата 'propaganda' часто означает 'реклама' в целом, а не только политическую."; en_translation="advertising, commercial"; ru_translation="реклама, рекламный ролик"; confidence="high"
  - needs_example_check; current example shows form: false

#### condón  (legacy: "forro")
- A: reasoning="AR: preservativo; UY: preservativo; std: condón -> replacement"; rio_type="replacement"; rio_form="preservativo"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: false
- B: reasoning="AR: preservativo; UY: preservativo; std: condón -> replacement"; rio_type="replacement"; rio_form="preservativo"; register="neutral"; en_translation="condom"; ru_translation="презерватив"; confidence="high"
  - warnings: translation_unchanged: override equals the current translation
  - needs_example_check; current example shows form: false

#### sanidad  (legacy: "salud")
- A: reasoning="AR: salud; UY: salud; std: sanidad -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: salud pública; UY: salud pública; std: sanidad (public health) -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

#### refresco  (legacy: "gaseosa")
- A: reasoning="AR: gaseosa; UY: refresco; std: refresco -> replacement"; rio_type="replacement"; rio_form="gaseosa"; region="ar"; register="neutral"; confidence="high"
  - needs_example_check; current example shows form: true
- B: reasoning="AR: gaseosa; UY: gaseosa; std: refresco (soft drink) -> replacement"; rio_type="replacement"; rio_form="gaseosa"; register="neutral"; en_translation="soft drink, soda"; ru_translation="газировка, безалкогольный напиток"; confidence="high"
  - needs_example_check; current example shows form: true

#### DANA  (legacy: "fenómeno meteorológico / depresión atmosférica")
- A: reasoning="AR: temporal; UY: temporal; std: DANA -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle
- B: reasoning="AR: ?; UY: ?; std: DANA (acronym for a specific weather phenomenon in Spain) -> none"; rio_type="none"; register="neutral"; confidence="high"
  - warnings: none_high_confidence: check that a high-confidence none is not a missed angle

