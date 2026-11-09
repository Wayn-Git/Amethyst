import { useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../../api.js'

export default function MobileAskLibrary({ onBack, onSelectItem }) {
  const [mode, setMode] = useState('ask') // 'ask' | 'semantic' | 'keyword'
  const [query, setQuery] = useState('')
  const [answers, setAnswers] = useState([])
  const [asking, setAsking] = useState(false)

  const handleAsk = async (qText) => {
    const q = (qText || query).trim()
    if (!q || asking) return

    setAsking(true)
    setQuery('')

    try {
      // Real hybrid search across library items
      const searchRes = await api.library({ q, limit: 6 })
      const foundItems = searchRes?.items || []

      let responseText = ''
      if (foundItems.length > 0) {
        const topItem = foundItems[0]
        responseText =
          topItem.summary ||
          topItem.description ||
          `Found ${foundItems.length} matching items in your vault regarding "${q}".`
      } else {
        responseText = `No matching items found in your library for "${q}".`
      }

      setAnswers((prev) => [
        ...prev,
        {
          question: q,
          text: responseText,
          sources: foundItems.slice(0, 3),
        },
      ])
    } catch (err) {
      console.warn('[MobileAskLibrary] Query failed:', err.message)
      setAnswers((prev) => [
        ...prev,
        {
          question: q,
          text: `Search error: ${err.message}`,
          sources: [],
        },
      ])
    } finally {
      setAsking(false)
    }
  }

  return (
    <motion.div
      className="s"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: '#F2F2F7',
        maxWidth: 480,
        margin: '0 auto',
      }}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="b" style={{ paddingBottom: 20 }}>
        {/* Header */}
        <div className="r sp">
          <button
            type="button"
            className="ib"
            aria-label="Back to library"
            onClick={onBack}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="ttl" style={{ fontSize: 17 }}>
            Ask Library
          </div>
          <button
            type="button"
            className="ib"
            aria-label="Clear chat"
            onClick={() => setAnswers([])}
            disabled={answers.length === 0}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>

        {/* Mode Selector */}
        <div className="r" style={{ gap: 8 }}>
          {[
            ['ask', 'Ask'],
            ['semantic', 'Semantic'],
            ['keyword', 'Keyword'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`ch ${mode === id ? 'on' : ''}`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Conversation Stream */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {answers.length === 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                textAlign: 'center',
                color: '#6E6E73',
                padding: '40px 16px',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0071E3',
                  boxShadow: '0 2px 8px rgba(0,0,0,.06)',
                }}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 7v14" />
                  <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
                </svg>
              </div>
              <div className="dsp" style={{ fontSize: 20, fontWeight: 600, color: '#1D1D1F' }}>
                Query your Library
              </div>
              <div style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.5 }}>
                Ask anything about the articles, videos, and papers you saved.
              </div>
            </div>
          )}

          {answers.map((ans, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Question bubble */}
              <div
                style={{
                  alignSelf: 'flex-end',
                  background: '#111113',
                  color: '#fff',
                  borderRadius: '22px 22px 6px 22px',
                  padding: '12px 16px',
                  maxWidth: 290,
                }}
              >
                {ans.question}
              </div>

              {/* Answer card */}
              <div
                className="c"
                style={{
                  alignSelf: 'flex-start',
                  borderRadius: '22px 22px 22px 6px',
                  maxWidth: '92%',
                }}
              >
                <div style={{ lineHeight: 1.5, color: '#1D1D1F' }}>{ans.text}</div>

                {ans.sources && ans.sources.length > 0 && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #E5E5EA' }}>
                    <div className="m" style={{ marginBottom: 6, fontWeight: 600 }}>
                      Sources found:
                    </div>
                    <div className="col" style={{ gap: 6 }}>
                      {ans.sources.map((s, sIdx) => (
                        <div
                          key={sIdx}
                          className="r"
                          style={{
                            padding: '6px 8px',
                            background: '#F2F2F7',
                            borderRadius: 10,
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            if (onSelectItem) onSelectItem(s)
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.title}
                          </span>
                          <span className="m" style={{ fontSize: 11 }}>
                            View →
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Query Input Pill */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleAsk()
          }}
          className="r"
          style={{
            background: '#FFFFFF',
            borderRadius: 999,
            padding: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,.1)',
            marginTop: 'auto',
          }}
        >
          <input
            className="in"
            style={{ paddingLeft: 12 }}
            placeholder="Ask your library anything…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            disabled={!query.trim() || asking}
            className="ib k"
            aria-label="Ask"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 7-7 7 7" />
              <path d="M12 19V5" />
            </svg>
          </button>
        </form>
      </div>
    </motion.div>
  )
}
