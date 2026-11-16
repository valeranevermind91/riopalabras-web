/** The tour's steps, in order: what each one points at (data-hint="<target>" on Home) and the strings it reads (strings.hints.tour.<id>). A step whose element is not on the screen is left out. */
export const TOUR_STEPS = [
  { id: 'learn', target: 'tile-learn' },
  { id: 'review', target: 'tile-review' },
  { id: 'practice', target: 'tile-practice' },
  { id: 'words', target: 'words' },
  { id: 'wotd', target: 'wotd' },
] as const

export type TourStepId = (typeof TOUR_STEPS)[number]['id']
