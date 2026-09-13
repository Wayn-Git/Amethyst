import { useState } from 'react'
import Button from '../ui/Button.jsx'
import Icon from '../Icon.jsx'

/* Multiple choice that marks itself.
 *
 * Feedback is immediate and the answer is final: a quiz you can change your
 * mind on after being told you were wrong is a reading exercise, and scores
 * nothing worth knowing. Flashcard mode is the same questions with the marking
 * taken out, for when the point is revision rather than testing. */

export default function Quiz({ data }) {
  const questions = data.questions ?? []
  const [at, setAt] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [cards, setCards] = useState(false)
  const [shown, setShown] = useState(false)

  if (!questions.length) return null

  const q = questions[Math.min(at, questions.length - 1)]
  const last = at >= questions.length - 1
  const done = answered >= questions.length

  const restart = () => {
    setAt(0); setPicked(null); setScore(0); setAnswered(0); setShown(false)
  }

  const choose = (i) => {
    if (picked !== null) return
    setPicked(i)
    setAnswered((n) => n + 1)
    if (i === q.correct_index) setScore((n) => n + 1)
  }

  const next = () => {
    setPicked(null)
    setShown(false)
    setAt((n) => Math.min(n + 1, questions.length - 1))
  }

  return (
    <div className="widget widget-quiz">
      <div className="widget-head">
        <span className="widget-count">{at + 1} / {questions.length}</span>
        {!cards && <span className="widget-score">{score} correct</span>}
      </div>

      <div className="widget-modes">
        <Button
          size="small"
          variant={cards ? 'ghost' : 'primary'}
          onClick={() => { setCards(false); restart() }}
        >
          Quiz
        </Button>
        <Button
          size="small"
          variant={cards ? 'primary' : 'ghost'}
          onClick={() => { setCards(true); restart() }}
        >
          Flashcards
        </Button>
      </div>

      <p className="widget-question">{q.question}</p>

      {cards ? (
        <div className="widget-card">
          {shown ? (
            <>
              <p className="widget-card-answer">{q.options?.[q.correct_index]}</p>
              {q.explanation && <p className="widget-why">{q.explanation}</p>}
            </>
          ) : (
            <Button size="small" onClick={() => setShown(true)}>Show answer</Button>
          )}
        </div>
      ) : (
        <ul className="widget-options">
          {(q.options ?? []).map((option, i) => {
            const isRight = i === q.correct_index
            // Nothing is marked until an answer is in: colouring the right row
            // before the click would give the game away.
            const state = picked === null ? '' : isRight ? ' is-right' : picked === i ? ' is-wrong' : ''
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`widget-option${state}`}
                  disabled={picked !== null}
                  aria-pressed={picked === i}
                  onClick={() => choose(i)}
                >
                  <span className="widget-option-mark">
                    {picked !== null && isRight && <Icon name="check" size={13} />}
                    {picked === i && !isRight && <Icon name="x" size={13} />}
                  </span>
                  {option}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!cards && picked !== null && q.explanation && <p className="widget-why">{q.explanation}</p>}

      <div className="widget-nav">
        {done && !cards ? (
          <span className="widget-final">Scored {score} of {questions.length}</span>
        ) : <span />}
        <div className="widget-nav-side">
          <Button size="small" variant="ghost" onClick={restart}>
            <Icon name="refresh" size={13} /> Restart
          </Button>
          <Button size="small" disabled={last || (!cards && picked === null)} onClick={next}>
            Next <Icon name="chevron" size={13} />
          </Button>
        </div>
      </div>
    </div>
  )
}
