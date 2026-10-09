import { getLanguage } from './language'

const rules = new Map<string, Intl.PluralRules>()

/**
 * The form of a word that goes with a count, in the current language: English has two forms (one, other), Russian three
 * (one: 1, 21 · few: 2–4, 22–24 · many: 0, 5–20, 25–30), so a string never writes "слов(о)". `forms` holds the forms the language uses;
 * a form that is missing falls back to `other`, then `many`, then `one`.
 */
export function plural(n: number, forms: Partial<Record<Intl.LDMLPluralRule, string>>): string {
  const language = getLanguage()
  let rule = rules.get(language)
  if (!rule) {
    rule = new Intl.PluralRules(language)
    rules.set(language, rule)
  }
  return forms[rule.select(n)] ?? forms.other ?? forms.many ?? forms.one ?? ''
}
