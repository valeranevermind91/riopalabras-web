// Forms whose Russian transcription is written by hand: the rules cannot read them (loan words) or they read them wrongly. A letter of the alphabet or an abbreviation is not here: it has no transcription at all (transcription.ts). Keyed by the form in lower case; the
// value is the transcription with the stress as the combining acute (U+0301) straight after the vowel, none for a word of one syllable. The review sheet the owner fills
// (transcription-review.xlsx) is applied here.
export const OVERRIDES: Readonly<Record<string, string>> = {
  "whisky": "уи́ски",
  "sándwich": "са́ндуич",
  "jean": "шин",
  "placard": "плака́р",
}
