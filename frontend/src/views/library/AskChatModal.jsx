import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import Skeleton from '../../components/Skeleton.jsx'
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
        aria-label="Query Library"
      >
        <div className="lib-ask-head">
          <div className="lib-ask-head-title">
            <span className="lib-ask-icon">
              <Icon name="chat" size={16} />
            </span>
            <span>Query Library</span>
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
              <div className="lib-ask-hint-title">TRY ASKING ABOUT</div>
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
                    <Icon name="search" size={12} />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : loading ? (
            <div className="lib-ask-cards" aria-hidden="true" style={{ padding: '8px 0' }}>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="lib-ask-card" style={{ pointerEvents: 'none' }}>
                  <div className="lib-ask-card-top">
                    <Skeleton w={45} h={16} r={99} />
                    <Skeleton w={`${50 + (i * 15)}%`} h={14} r={4} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '6px 0' }}>
                    <Skeleton w="95%" h={11} r={3} />
                    <Skeleton w="70%" h={11} r={3} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Skeleton w={50} h={16} r={99} />
                    <Skeleton w={40} h={16} r={99} />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="lib-ask-empty">
              No matching knowledge items found for "{query}".
            </div>
          ) : (
            <div className="lib-ask-results">
              <div className="lib-ask-results-meta">
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
                      <span className="lib-kind-badge">{item.kind}</span>
                      <span className="lib-ask-card-title">{item.title}</span>
                    </div>
                    {item.summary ? (
                      <p className="lib-ask-card-summary">{item.summary}</p>
                    ) : item.excerpt ? (
                      <p className="lib-ask-card-summary">{item.excerpt}</p>
                    ) : null}
                    {item.tags?.length ? (
                      <div className="lib-ask-card-tags">
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
