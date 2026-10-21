import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from '../strings'
import { ru } from '../strings.ru'

// The offer to practise the batch just learned: its words, in both languages (the user's own wording), and the rules the screens keep to in source.
describe('the practice offer: the words', () => {
  it('English', () => {
    expect(en.learn.practiceLine).toBe('These words come back for review tomorrow.')
    expect(en.learn.practiceButton).toBe('Practise these words now')
    expect(en.learn.practiceNote).toBe("Matching on the words from this batch. It doesn't affect the schedule.")
    expect(en.practice.groupComplete).toBe('Session complete')
    expect(en.practice.nextWords).toBe('Next words')
    expect(en.practice.practiceDone).toBe('Done')
  })

  it('Russian', () => {
    expect(ru.learn.practiceLine).toBe('Эти слова придут на повторение завтра.')
    expect(ru.learn.practiceButton).toBe('Потренировать эти слова сейчас')
    expect(ru.learn.practiceNote).toBe('Matching на словах из этой подборки. На расписание это не влияет.')
    expect(ru.practice.groupComplete).toBe('Сессия завершена')
    expect(ru.practice.nextWords).toBe('Следующие слова')
    expect(ru.practice.practiceDone).toBe('Готово')
  })
})

describe('the practice offer: what the screens may not do (the real-browser test proves it by running it)', () => {
  const matching = readFileSync('src/screens/Matching.tsx', 'utf8')
  const learn = readFileSync('src/screens/Learn.tsx', 'utf8')

  it('Matching, practising a batch, counts nothing toward the streak or the day and logs the mode "practice"', () => {
    expect(matching).toMatch(/if \(!practice\) recordPracticeCompleted\(deps\)/)
    expect(matching).toMatch(/if \(!practice && next\.matched\.size > current\.matched\.size\) recordPracticeCards\(/)
    expect(matching).toContain("mode: practice ? 'practice' : 'matching'")
    expect(matching.match(/recordPractice(Cards|Completed)\(/g)).toHaveLength(2) // no third, unguarded call
  })

  it('Learn gives the practice nothing to write with: its screen is handed no progress or settings writers of its own', () => {
    const block = learn.slice(learn.indexOf('{practising && <MatchingScreen'), learn.indexOf('</main>', learn.indexOf('{practising && <MatchingScreen')))
    expect(block).toContain('practice={{ rounds: practising, onFinish: exitPractice }}')
    expect(block).not.toMatch(/applyProgress|applySettings|enqueueBatch|createBatchFinisher/)
  })
})
