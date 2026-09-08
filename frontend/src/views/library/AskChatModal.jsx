import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'

export default function AskChatModal({ open, onClose, onSelectResource }) {
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  useModalDismiss(open, onClose)

  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setResults([])
      setHasSearched(false)
    }
  }, [open])

  if (!open) return null

  const handleAsk = async (e) => {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return

    setLoading(true)
    setHasSearched(true)
    try {
      const data = await api.library({ q, limit: 8 })
      setResults(data.items || [])
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown(onClose)}>
      <div
        className="modal lib-ask-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ask Library AI"
      >
        <div className="lib-ask-head">
          <div className="lib-ask-head-title">
            <span className="lib-ask-sparkle-icon">
              <Icon name="spark" size={16} />
            </span>
            <span>Ask Library AI</span>
          </div>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <form className="lib-ask-form" onSubmit={handleAsk}>
          <div className="lib-ask-input-wrap">
            <Icon name="search" size={16} className="lib-ask-search-icon" />
            <input
              ref={inputRef}
              className="lib-ask-input"
              placeholder="Ask anything about your saved knowledge, articles, or videos..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn--small btn--primary lib-ask-submit-btn"
              disabled={loading || !query.trim()}
            >
              {loading ? 'Searching...' : 'Ask'}
            </button>
          </div>
        </form>

        <div className="lib-ask-body">
          {!hasSearched ? (
            <div className="lib-ask-hints">
              <div className="lib-ask-hint-title mono">TRY ASKING ABOUT</div>
              <div className="lib-ask-prompt-pills">
                {[
                  'Explain the A* algorithm from my saved articles',
                  'Summarize key insights on AI agent models',
                  'What movies or series did I bookmark recently?',
                  'Find my notes on system design and architecture',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="lib-ask-prompt-pill"
                    onClick={() => {
                      setQuery(prompt)
                      api.library({ q: prompt, limit: 8 }).then((d) => {
                        setResults(d.items || [])
                        setHasSearched(true)
                      })
                    }}
                  >
                    <Icon name="spark" size={12} />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : loading ? (
            <div className="lib-ask-loading mono">
              <span className="lib-card-spinner" />
              <span>Searching semantic knowledge index...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="lib-ask-empty mono">
              No matching knowledge items found for "{query}".
            </div>
          ) : (
            <div className="lib-ask-results">
              <div className="lib-ask-results-meta mono">
                Found {results.length} relevant knowledge resources:
              </div>
              <div className="lib-ask-cards">
                {results.map((item) => (
                  <div
                    key={item.id}
                    className="lib-ask-card"
                    onClick={() => {
                      onSelectResource?.(item)
                      onClose()
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="lib-ask-card-top">
                      <span className="lib-kind-badge mono">{item.kind}</span>
                      <span className="lib-ask-card-title">{item.title}</span>
                    </div>
                    {item.summary ? (
                      <p className="lib-ask-card-summary">{item.summary}</p>
                    ) : item.excerpt ? (
                      <p className="lib-ask-card-summary">{item.excerpt}</p>
                    ) : null}
                    {item.tags?.length ? (
                      <div className="lib-ask-card-tags mono">
                        {item.tags.slice(0, 3).map((t) => (
                          <span key={t} className="lib-tag-pill">
                            #{t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
