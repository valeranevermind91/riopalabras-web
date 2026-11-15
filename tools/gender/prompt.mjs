// The model prompt and answer schema for the full run. Same wording as tools/gender/sample.mjs (kept as a copy so the 200 sample answers at `high` can seed the cache).
export const SYSTEM = `You are a careful Spanish lexicographer. For each entry give the grammatical gender of the headword AS SHOWN, for the meaning given by the English gloss, in standard and Rioplatense Spanish.
gender is one of:
 m, f      one gender for this meaning.
 mf        the same word and meaning for either gender, the article follows the person or animal (el/la estudiante, el/la artista).
 both      the same spelling is masculine in one meaning and feminine in another (el capital / la capital). Give the meaning of the gloss first.
 plural    used only in the plural for this meaning (las gafas, los pantalones, las ganas). Use the plural article.
 none      not a noun in this meaning (a pronoun, adjective, verb, adverb, interjection), so no gender.
article_display is the definite article with the word as shown: "la casa", "el agua" (a feminine noun that starts with a stressed a- takes el in the singular; say so in note), "el/la estudiante", "el capital / la capital", "las gafas". Use the headword exactly as shown, including a Rioplatense form.
Judge the headword shown, not the standard word it replaces. When a standard word is also given, put the standard word's own definite article and the word in standard_article ("la galleta", "las gafas", "el coche"), so the two can be compared; otherwise leave standard_article empty.
note: at most 12 words, only when the case is not plain (epicene, stressed a-, sense-dependent, different from the standard word, mis-tagged). Otherwise empty.`

export const schema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'INTEGER' },
      gender: { type: 'STRING', format: 'enum', enum: ['m', 'f', 'mf', 'both', 'plural', 'none'] },
      article_display: { type: 'STRING' },
      standard_article: { type: 'STRING' },
      note: { type: 'STRING' },
    },
    required: ['id', 'gender', 'article_display', 'standard_article', 'note'],
  },
}
