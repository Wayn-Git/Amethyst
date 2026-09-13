import Icon from '../../Icon.jsx'
import { copyText } from '../../../api.js'

/** The answer, then the articles.
 *
 *  A question typed into the palette is a question, not a search: what it wants
 *  first is the sentence that answers it, and the list under it is the
 *  evidence. When the backend could not write an answer -- no model, or none
 *  that answered -- the card says so in one quiet line and the results below
 *  stand alone, exactly as they did before.
 */
export default function AnswerCardView({ answer, sources = [], loading, onOpen, onToast }) {
  if (loading && !answer) {
    return (
      <div className="damon-answer damon-answer--loading">
        <div className="damon-spinner" />
        <span>Thinking…</span>
      </div>
    )
  }

  if (!answer) return null

  return (
    <div className="damon-answer">
      <div className="damon-answer-head">
        <Icon name="spark" size={13} />
        <span className="damon-answer-kicker">Answer</span>
      </div>
      <p className="damon-answer-body">{answer}</p>
      {sources.length > 0 && (
        <div className="damon-answer-sources">
          {sources.map((src) => (
            <button
              key={src.url}
              type="button"
              className="damon-answer-source"
              onClick={() => onOpen(src)}
              title={src.url}
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${src.domain}&sz=32`}
                alt=""
                className="damon-favicon"
                onError={(e) => { e.target.style.display = 'none' }}
              />
              <span>{src.domain}</span>
            </button>
          ))}
          <button
            type="button"
            className="damon-answer-source damon-answer-source--copy"
            onClick={async (e) => {
              e.stopPropagation()
              const ok = await copyText(answer)
              if (ok && onToast) onToast('Answer copied', 'ok')
            }}
            title="Copy the answer"
          >
            <Icon name="copy" size={12} />
            <span>Copy</span>
          </button>
        </div>
      )}
    </div>
  )
}
