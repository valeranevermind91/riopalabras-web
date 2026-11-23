import { describe, expect, it } from 'vitest'
import { parseSettings } from './settings'
import { SHOW_TRANSCRIPTION_KEY, showTranscriptionPatch } from './settingsActions'
import { applySettingsPatch } from './mutations'
import { transcriptionFor, wantsTranscription } from './wordTranscription'
import { makeWord } from '../testing/makeWord'

// "Транскрипция кириллицей": a switch in Settings, kept in the settings blob like the other switches. On when nothing is stored, so everybody who has the Russian interface gets it.

describe('the show_transcription setting', () => {
  it('is on when the key is not stored (the default), and for no blob at all', () => {
    expect(SHOW_TRANSCRIPTION_KEY).toBe('show_transcription')
    expect(parseSettings({}).showTranscription).toBe(true)
    expect(parseSettings(null).showTranscription).toBe(true)
  })

  it('reads a stored boolean; anything else written to the key by another app is the default', () => {
    expect(parseSettings({ show_transcription: false }).showTranscription).toBe(false)
    expect(parseSettings({ show_transcription: true }).showTranscription).toBe(true)
    for (const junk of ['false', 0, null, { on: false }, []]) expect(parseSettings({ show_transcription: junk }).showTranscription, String(junk)).toBe(true)
  })

  it('a change writes that one key (both ways: off is false, on is true), and the rest of the blob stays', () => {
    expect(showTranscriptionPatch(false)).toEqual({ show_transcription: false })
    expect(showTranscriptionPatch(true)).toEqual({ show_transcription: true })
    const off = applySettingsPatch(parseSettings({ ui_language: 'ru' }), showTranscriptionPatch(false))
    expect(off.showTranscription).toBe(false)
    expect(off.raw.ui_language).toBe('ru')
  })
})

describe('when a card shows the transcription: the Russian interface, and the switch on', () => {
  it('needs both', () => {
    expect(wantsTranscription({ showTranscription: true }, 'ru')).toBe(true)
    expect(wantsTranscription({ showTranscription: true }, 'en')).toBe(false)
    expect(wantsTranscription({ showTranscription: false }, 'ru')).toBe(false)
  })

  it('a card that was given no settings for it does not show it', () => {
    expect(wantsTranscription({}, 'ru')).toBe(false)
  })
})

describe('what is transcribed: the headword the card shows', () => {
  it('a dictionary word is', () => {
    expect(transcriptionFor(makeWord('llevar'))?.map((p) => p.text).join('')).toBe('шебар')
  })

  it('a word the person added is not (v1): the text is theirs, and it may not be Spanish', () => {
    expect(transcriptionFor(makeWord('llevar', { isCustom: true }))).toBeNull()
  })

  it('a form that cannot be transcribed gives nothing, not a half answer', () => {
    expect(transcriptionFor(makeWord('3D'))).toBeNull()
  })
})
