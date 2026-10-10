// The rule for country labels in the overlay (`region`, and `alt_region` with its `alt_form`).
//
//   A country label is set only when at least two independent sources say the OTHER country does not use the form.
//   Everything else is null, which reads as "Rioplatense, without a country".
//
// Why: a label is a claim about both countries. "Uruguayans say it" is evidence about Uruguay only, so the questionnaire,
// which asked nothing but Uruguayans ("¿En Uruguay …?"), can never set a label by itself. It is not a source here at all.
// For a pair (a form with an alt_form) each side is a claim of its own: the pair stands only if BOTH labels do, because the
// card says "X (uy), also Y (ar)", and a Y that Uruguayans use too is a false "also".
//
// The sources, and what each says about a form F and a country C:
//   A, B     stage-1 runs: their `reasoning` line "AR: x/y; UY: z; std: w -> type" lists what each country says.
//            F counts for C when it is in C's list and not in the other country's.
//   Claude   the blind Claude pass: its entry gives rio_form with `region`, and alt_form with `alt_region`.
//   DAMER    the dictionary of Americanisms: F counts for C when F has a label for C and none for the other country.
// Independence: A and B are both Gemini models, so they count as one family; Claude and DAMER are one each. Two sources
// must come from two different families.
//
// One exception is allowed, and only by name, with its reason written down (see EXTRALINGUISTIC_LABELS in the build): a label that
// rests on a fact about the world rather than on what sources say (there is no subway in Uruguay). It is reported as an exception
// and never counts as a two-source finding.

export const MIN_INDEPENDENT_SOURCES = 2
export const FAMILY = { A: 'Gemini', B: 'Gemini', Claude: 'Claude', DAMER: 'DAMER' }

const OTHER = { ar: 'uy', uy: 'ar' }
const norm = (s) => String(s).normalize('NFC').toLowerCase().trim()

/** "AR: a/b; UY: c, d; std: e -> type" → { ar: Set, uy: Set }, or null when the line is not in that shape. */
export function parseCountryLists(reasoning) {
  if (typeof reasoning !== 'string') return null
  const part = (tag) => {
    const m = new RegExp(`(?:^|;)\\s*${tag}:\\s*([^;]*)`).exec(reasoning)
    if (!m) return null
    return new Set(m[1].replace(/\([^)]*\)/g, '').split(/[/,]/).map(norm).filter((x) => x && x !== '?'))
  }
  const ar = part('AR')
  const uy = part('UY')
  return ar && uy ? { ar, uy } : null
}

/** The names of the sources ('A', 'B', 'Claude', 'DAMER') that say form is used in `country` and not in the other one. */
export function sourcesSayingOnlyIn(country, form, sources) {
  const f = norm(form)
  const names = []
  for (const name of ['A', 'B']) {
    const lists = parseCountryLists(sources[name]?.reasoning)
    if (lists && lists[country].has(f) && !lists[OTHER[country]].has(f)) names.push(name)
  }
  const c = sources.Claude
  if (c) {
    if (c.rio_form && norm(c.rio_form) === f && c.region === country) names.push('Claude')
    else if (c.alt_form && norm(c.alt_form) === f && c.alt_region === country) names.push('Claude')
  }
  const d = sources.DAMER?.[f]
  if (d?.found && d.ar !== d.ur && (country === 'ar' ? d.ar : d.ur)) names.push('DAMER')
  return names
}

/**
 * The sources that point the other way for a form: they say the OTHER country uses it too (it is in both lists, or the entry gives it no country),
 * or DAMER labels it for both countries. Not part of the rule (the rule counts only the sources that agree); recorded so a label that is kept
 * over a dissent says so.
 */
export function sourcesSayingBoth(form, sources) {
  const f = norm(form)
  const names = []
  for (const name of ['A', 'B']) {
    const lists = parseCountryLists(sources[name]?.reasoning)
    if (lists && lists.ar.has(f) && lists.uy.has(f)) names.push(name)
  }
  const c = sources.Claude
  if (c && c.rio_type !== 'none' && c.region === null && c.rio_form && norm(c.rio_form) === f) names.push('Claude')
  const d = sources.DAMER?.[f]
  if (d?.found && d.ar && d.ur) names.push('DAMER')
  return names
}

/** How many different families the sources come from. */
export const familiesOf = (names) => new Set(names.map((n) => FAMILY[n])).size
export const isSupported = (names) => familiesOf(names) >= MIN_INDEPENDENT_SOURCES

const say = (names) => (names.length === 0 ? 'no source says it' : `${names.join(' + ')} say${names.length === 1 ? 's' : ''} it`)

/**
 * Applies the rule to one entry ({ es_word, rio_form, region, alt_form, alt_region }) and returns the labels that survive, with one
 * log line per label for the entry's evidence. `exceptions` maps es_word → { region, reason } for the named extralinguistic labels.
 * A pair stands only if both of its labels do; a region that falls takes its alt_form with it (the pair is the claim).
 */
export function applyRegionRule(entry, sources, exceptions = {}) {
  const log = []
  let region = entry.region ?? null
  let altForm = entry.alt_form ?? null
  let altRegion = entry.alt_region ?? null
  let usedException = false

  if (region !== null) {
    const names = sourcesSayingOnlyIn(region, entry.rio_form, sources)
    const exception = exceptions[entry.es_word]?.region === region ? exceptions[entry.es_word].reason : null
    const against = sourcesSayingBoth(entry.rio_form, sources)
    const models = against.filter((n) => n !== 'DAMER')
    const dissentParts = [
      ...(models.length ? [`${models.join(' + ')} ${models.length === 1 ? 'has' : 'have'} it in both countries`] : []),
      ...(against.includes('DAMER') ? ['DAMER labels it for both countries (any sense)'] : []),
    ]
    const dissent = dissentParts.length ? `; against: ${dissentParts.join('; ')}` : ''
    if (isSupported(names)) log.push(`country label ${region} kept for «${entry.rio_form}»: ${names.join(' + ')} (${familiesOf(names)} independent families) say the other country does not use it${dissent}`)
    else if (exception) {
      usedException = true
      log.push(`country label ${region} kept for «${entry.rio_form}» by an extralinguistic reason, NOT by the two-source rule (${say(names)}${dissent}): ${exception}`)
    } else {
      region = null
      log.push(`country label ${entry.region} dropped for «${entry.rio_form}»: ${say(names)}, and the rule needs ${MIN_INDEPENDENT_SOURCES} independent families (the questionnaire only asked Uruguayans, so it cannot set one)`)
    }
  }

  if (altForm !== null) {
    const names = sourcesSayingOnlyIn(altRegion, altForm, sources)
    if (region !== null && isSupported(names)) log.push(`alt_form «${altForm}» (${altRegion}) kept: ${names.join(' + ')} say the other country does not use it`)
    else {
      log.push(`alt_form «${altForm}» (${altRegion}) dropped: ${region === null ? 'the pair needs its other label, and that one fell' : say(names)} (a pair stands only if both labels do)`)
      altForm = null
      altRegion = null
    }
  }
  return { region, alt_form: altForm, alt_region: altRegion, log, usedException }
}
