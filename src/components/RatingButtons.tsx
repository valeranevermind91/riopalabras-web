import type { Word } from '../data/types'
import { formatInterval, previewInterval } from '../sm2/sm2'
import { strings } from '../strings'

const RATINGS = [
  { quality: 1, label: strings.review.again, tone: 'again' },
  { quality: 2, label: strings.review.hard, tone: 'hard' },
  { quality: 3, label: strings.review.good, tone: 'good' },
  { quality: 4, label: strings.review.easy, tone: 'easy' },
] as const

/** The four SM-2 ratings, each previewing the interval it would schedule. The label carries the meaning; colour only reinforces it. */
export function RatingButtons({ word, onRate }: { word: Word; onRate: (quality: number) => void }) {
  return (
    <div className="rating">
      <p className="rating-prompt">{strings.review.howWell}</p>
      <div className="rate-row">
        {RATINGS.map(({ quality, label, tone }) => (
          <button key={quality} type="button" className={`rate-btn rate-${tone}`} onClick={() => onRate(quality)}>
            <span className="rate-label">{label}</span>
            <small className="rate-interval">{formatInterval(previewInterval(word, quality))}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
