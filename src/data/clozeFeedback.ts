import { strings } from '../strings'
import type { Lang } from './rio'
import type { ClozeKind } from './practice'

export interface ClozeFeedback {
  text: string
  tone: 'ok' | 'bad' | 'neutral'
}

/**
 * The line shown after a question is answered. The wording is UI chrome (English); only the
 * "in this sentence" nudge is word content, so it follows the translation language (`lang`).
 */
export function clozeFeedback(kind: ClozeKind | 'gaveUp', target: string, lang: Lang): ClozeFeedback {
  const t = strings.practice.en
  switch (kind) {
    case 'exact':
      return { text: t.correct, tone: 'ok' }
    case 'accent':
      return { text: `${t.correct} ${t.accentNudge(target)}`, tone: 'ok' }
    case 'headword':
      return { text: `${t.correct} ${strings.wordContent[lang].inSentence(target)}`, tone: 'ok' }
    case 'gaveUp':
      return { text: t.gaveUp(target), tone: 'neutral' }
    default:
      return { text: t.wrong(target), tone: 'bad' }
  }
}
