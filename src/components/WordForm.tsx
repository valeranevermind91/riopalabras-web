import { useEffect, useRef, useState } from 'react'
import { CUSTOM_REGIONS, CUSTOM_REGISTERS, customRegion, customRegister } from '../data/customMarks'
import { POS_CODES, checkSpanish, findDuplicate, type Duplicate, type PosCode, type WordValues } from '../data/customWords'
import { BottomSheet } from './WordsSheets'
import { enrichFailureMessage, noEnrichment, type EnrichResult } from '../data/enrich'
import type { Word } from '../data/types'
import { strings } from '../strings'

const f = strings.words.form

/** What a screen does with the form's values: saves them, or says why not. */
export type SubmitResult = { status: 'added' | 'saved' } | { status: 'invalid'; problem: string } | { status: 'duplicate'; duplicate: Duplicate }

interface WordFormProps {
  /** A new word (word and part of speech first, then a lookup, then the details), or an existing one (straight to the details). */
  existing: Word | null
  words: readonly Word[]
  initial: WordValues
  /** The lookup that fills in a new word's translations. Only adding uses it: editing is for fixing fields by hand. */
  enrich?: (input: { word: string; pos: string | null }) => Promise<EnrichResult>
  onSubmit: (values: WordValues) => SubmitResult
  onDone: (result: { status: 'added' | 'saved' }) => void
  /** Leave without saving (asked for only once something has been filled in). */
  onCancel: () => void
  onOpenExisting: (word: Word) => void
  /**
   * The form takes Back (Telegram's or the page's) while it is open: with something filled in it asks before leaving, with
   * nothing it just closes. The screen that shows the form does not register its own handler meanwhile.
   */
  registerBack?: (handler: (() => boolean) | null) => void
}

type Phase = 'word' | 'details'
type Notice = { tone: 'error' | 'info'; text: string }

/**
 * The form for adding a word or editing one. Adding: the Spanish word and its part of speech, then a duplicate check (nothing is
 * written on a hit), then a lookup of the translations that never waits longer than its timeout and never blocks typing them by
 * hand, then the details. Every field can be changed before saving; both translations are required.
 */
export function WordForm({ existing, words, initial, enrich = noEnrichment, onSubmit, onDone, onCancel, onOpenExisting, registerBack }: WordFormProps) {
  const editing = existing !== null
  const [phase, setPhase] = useState<Phase>(editing ? 'details' : 'word')
  const [values, setValues] = useState<WordValues>(initial)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)
  const [looking, setLooking] = useState(false)
  // Each lookup has a number; an answer that is no longer the latest (the user stopped waiting, left) is ignored.
  const lookup = useRef(0)
  useEffect(
    () => () => {
      lookup.current++
    },
    [],
  )

  const set = (patch: Partial<WordValues>) => setValues((v) => ({ ...v, ...patch }))

  // Leaving with something filled in (or filled in for the user by the lookup) asks first; an untouched form just closes.
  const [asking, setAsking] = useState(false)
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const requestClose = () => {
    if (dirty) setAsking(true)
    else onCancel()
  }
  useEffect(() => {
    if (!registerBack) return
    registerBack(() => {
      if (asking) setAsking(false)
      else if (dirty) setAsking(true)
      else onCancel()
      return true
    })
    return () => registerBack(null)
  }, [registerBack, asking, dirty, onCancel])
  const discardSheet = asking && (
    <BottomSheet label={f.discardTitle} onClose={() => setAsking(false)}>
      <div className="confirm-delete">
        <h2>{f.discardTitle}</h2>
        <p>{f.discardBody}</p>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary btn-danger" onClick={onCancel}>
            {f.discard}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
            {f.keepEditing}
          </button>
        </div>
      </div>
    </BottomSheet>
  )

  const runLookup = async (current: WordValues) => {
    const id = ++lookup.current
    setLooking(true)
    setNotice(null)
    const result = await enrich({ word: current.esWord.trim(), pos: current.pos })
    if (id !== lookup.current) return
    setLooking(false)
    if (result.ok) {
      const { value } = result
      setValues({ ...current, ...value })
      setNotice({ tone: 'info', text: f.filled })
    } else {
      setNotice({ tone: 'error', text: enrichFailureMessage(result.failure) })
    }
    setPhase('details')
  }

  const stopWaiting = () => {
    lookup.current++
    setLooking(false)
    setNotice(null)
    setPhase('details')
  }

  const next = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const spanish = checkSpanish(values.esWord)
    if (!spanish.ok) return setNotice({ tone: 'error', text: f.problems[spanish.problem] })
    if (!values.pos) return setNotice({ tone: 'error', text: f.problems.pos })
    const found = findDuplicate(words, spanish.word)
    if (found) {
      setNotice(null)
      return setDuplicate(found)
    }
    setDuplicate(null)
    void runLookup({ ...values, esWord: spanish.word })
  }

  const save = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const result = onSubmit(values)
    if (result.status === 'invalid') return setNotice({ tone: 'error', text: f.problems[result.problem] ?? result.problem })
    if (result.status === 'duplicate') {
      setPhase('word')
      return setDuplicate(result.duplicate)
    }
    onDone(result)
  }

  if (phase === 'word') {
    return (
      <form className="word-form" onSubmit={next} noValidate>
        <label className="form-field">
          <span className="form-label">{f.spanish}</span>
          <input
            className="form-input"
            lang="es"
            value={values.esWord}
            disabled={looking}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              set({ esWord: e.target.value })
              setDuplicate(null)
              setNotice(null)
            }}
          />
          <span className="form-hint">{f.spanishHint}</span>
        </label>

        <fieldset className="form-field" disabled={looking}>
          <legend className="form-label">{f.pos}</legend>
          <div className="form-pos" role="radiogroup" aria-label={f.pos}>
            {POS_CODES.map((code: PosCode) => (
              <button key={code} type="button" role="radio" aria-checked={values.pos === code} className={values.pos === code ? 'chip is-active' : 'chip'} onClick={() => set({ pos: code })}>
                {f.posNames[code]}
              </button>
            ))}
          </div>
        </fieldset>

        {duplicate && (
          <div className="form-note is-error" role="alert">
            <p>{f.duplicate(values.esWord.trim(), duplicate.word.esWord, duplicate.via)}</p>
            <button type="button" className="link-btn" onClick={() => onOpenExisting(duplicate.word)}>
              {f.openExisting(duplicate.word.esWord)}
            </button>
          </div>
        )}
        {notice && (
          <p className={notice.tone === 'error' ? 'form-note is-error' : 'form-note'} role={notice.tone === 'error' ? 'alert' : 'status'}>
            {notice.text}
          </p>
        )}

        {looking ? (
          <div className="form-note" role="status">
            <p>{f.looking}</p>
            <button type="button" className="link-btn" onClick={stopWaiting}>
              {f.fillMyself}
            </button>
          </div>
        ) : (
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {f.continue}
            </button>
            <button type="button" className="btn btn-secondary" onClick={requestClose}>
              {f.cancel}
            </button>
          </div>
        )}
        {discardSheet}
      </form>
    )
  }

  return (
    <form className="word-form" onSubmit={save} noValidate>
      <div className="form-word">
        <strong>{values.esWord}</strong>
        <span className="form-word-pos">{values.pos ? f.posNames[values.pos] : ''}</span>
        {!editing && (
          <button type="button" className="link-btn" onClick={() => setPhase('word')}>
            {f.change}
          </button>
        )}
      </div>

      {editing && (
        <fieldset className="form-field">
          <legend className="form-label">{f.pos}</legend>
          <div className="form-pos" role="radiogroup" aria-label={f.pos}>
            {POS_CODES.map((code: PosCode) => (
              <button key={code} type="button" role="radio" aria-checked={values.pos === code} className={values.pos === code ? 'chip is-active' : 'chip'} onClick={() => set({ pos: code })}>
                {f.posNames[code]}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {notice && (
        <p className={notice.tone === 'error' ? 'form-note is-error' : 'form-note'} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      <label className="form-field">
        <span className="form-label">{f.ru}</span>
        <input className="form-input" lang="ru" value={values.ruTranslation} onChange={(e) => set({ ruTranslation: e.target.value })} />
      </label>
      <label className="form-field">
        <span className="form-label">{f.en}</span>
        <input className="form-input" lang="en" value={values.enTranslation} onChange={(e) => set({ enTranslation: e.target.value })} />
        <span className="form-hint">{f.translationsHint}</span>
      </label>
      <label className="form-field">
        <span className="form-label">{f.example}</span>
        <textarea className="form-input" lang="es" rows={2} value={values.exampleSentence} onChange={(e) => set({ exampleSentence: e.target.value })} />
      </label>
      <label className="form-field">
        <span className="form-label">{f.exampleEn}</span>
        <textarea className="form-input" lang="en" rows={2} value={values.exampleTranslationEn} onChange={(e) => set({ exampleTranslationEn: e.target.value })} />
      </label>
      <label className="form-field">
        <span className="form-label">{f.exampleRu}</span>
        <textarea className="form-input" lang="ru" rows={2} value={values.exampleTranslationRu} onChange={(e) => set({ exampleTranslationRu: e.target.value })} />
      </label>
      <div className="form-field">
        <label className="form-check">
          <input type="checkbox" checked={values.isRioplatenseVariant} onChange={(e) => set({ isRioplatenseVariant: e.target.checked })} />
          <span>{f.rioplatenseCheck}</span>
        </label>
        <span className="form-hint">{f.rioplatenseHint}</span>
      </div>
      <label className="form-field">
        <span className="form-label">{f.standard}</span>
        <input className="form-input" lang="es" value={values.esStandard ?? ''} onChange={(e) => set({ esStandard: e.target.value })} />
        <span className="form-hint">{f.standardHint}</span>
      </label>
      <label className="form-field">
        <span className="form-label">{f.region}</span>
        <select className="form-input" value={values.region ?? ''} onChange={(e) => set({ region: customRegion(e.target.value) })}>
          <option value="">{f.unknown}</option>
          {CUSTOM_REGIONS.map((region) => (
            <option key={region} value={region}>
              {f.regionNames[region]}
            </option>
          ))}
        </select>
        <span className="form-hint">{f.regionHint}</span>
      </label>
      <label className="form-field">
        <span className="form-label">{f.register}</span>
        <select className="form-input" value={values.register ?? ''} onChange={(e) => set({ register: customRegister(e.target.value) })}>
          <option value="">{f.unknown}</option>
          {CUSTOM_REGISTERS.map((register) => (
            <option key={register} value={register}>
              {f.registerNames[register]}
            </option>
          ))}
        </select>
      </label>
      {values.esRioplatense && <p className="form-hint">{f.rioplatenseForm(values.esRioplatense)}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {f.save}
        </button>
        <button type="button" className="btn btn-secondary" onClick={requestClose}>
          {f.cancel}
        </button>
      </div>
      {discardSheet}
    </form>
  )
}
