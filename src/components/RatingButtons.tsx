import type { Word } from '../data/types'
import { formatInterval, previewInterval } from '../sm2/sm2'
import { strings } from '../strings'

/** The four ratings. The labels are read when the buttons are drawn (not once at load), so they follow the interface language. */
const ratings = () =>
  [
    { quality: 1, label: strings.review.again, tone: 'again' },
    { quality: 2, label: strings.review.hard, tone: 'hard' },
    { quality: 3, label: strings.review.good, tone: 'good' },
    { quality: 4, label: strings.review.easy, tone: 'easy' },
  ] as const

/** The four SM-2 ratings (`hidden` keeps their place on screen, so the card above does not move when they appear), each previewing the interval it would schedule. The label carries the meaning; colour only reinforces it. */
export function RatingButtons({ word, onRate, hidden = false }: { word: Word; onRate: (quality: number) => void; hidden?: boolean }) {
  return (
    <div className={hidden ? 'rating is-hidden' : 'rating'} aria-hidden={hidden || undefined} inert={hidden || undefined}>
      <p className="rating-prompt">{strings.review.howWell}</p>
      <div className="rate-row">
        {ratings().map(({ quality, label, tone }) => (
          <button key={quality} type="button" className={`rate-btn rate-${tone}`} onClick={() => onRate(quality)}>
            <span className="rate-label">{label}</span>
            <small className="rate-interval">{formatInterval(previewInterval(word, quality))}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
