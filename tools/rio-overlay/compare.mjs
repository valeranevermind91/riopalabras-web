// Compares the new overlay with the legacy free-text es_rioplatense field. The legacy field is never
// shown to the model; this report is the future review queue of words where the two disagree.

/** The comparable forms inside a legacy value: parenthetical glosses dropped, alternatives split. */
export function legacyForms(value) {
  if (!value) return []
  return value
    .replace(/\([^)]*\)/g, ' ')
    .split(/[/,;]| o /)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * @param rows [{ input: dictionary entry, entry: overlay entry, valid: boolean }]
 * @returns disagreements only: legacy_only (legacy flagged it, overlay says none), overlay_only (the reverse),
 *          different (both flag it, but with different forms)
 */
export function compareLegacy(rows) {
  const out = []
  for (const { input, entry, valid } of rows) {
    const legacy = input.es_rioplatense ?? null
    const hasOverlay = entry.rio_type !== 'none'
    let kind = null

    if (legacy && !hasOverlay) kind = 'legacy_only'
    else if (!legacy && hasOverlay) kind = 'overlay_only'
    else if (legacy && hasOverlay) {
      const overlayForms = [entry.rio_form, entry.alt_form].filter(Boolean).map((f) => f.toLowerCase())
      const agrees = legacyForms(legacy).some((f) => overlayForms.includes(f))
      if (!agrees) kind = 'different'
    }

    if (kind) {
      out.push({
        es_word: input.es_word,
        kind,
        legacy,
        overlay: { rio_type: entry.rio_type, rio_form: entry.rio_form, region: entry.region, alt_form: entry.alt_form, alt_region: entry.alt_region },
        confidence: entry.confidence,
        reasoning: entry.reasoning,
        valid,
      })
    }
  }
  return out
}
