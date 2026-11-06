import { useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
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
      className="m-shell"
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#ECEAE6' }}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.2 }}
    >
      <div className="m-body" style={{ paddingBottom: 20 }}>
        {/* Header */}
        <div className="m-r m-sp">
          <button
            type="button"
            className="m-ib"
            aria-label="Back to library"
            onClick={onBack}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <div className="m-ttl" style={{ fontSize: 17 }}>
            Ask Library
          </div>
          <button
            type="button"
            className="m-ib"
            aria-label="Clear chat"
            onClick={() => setAnswers([])}
            disabled={answers.length === 0}
          >
            <Icon name="trash" size={18} />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="m-r" style={{ gap: 8 }}>
          {[
            ['ask', 'Ask'],
            ['semantic', 'Semantic'],
            ['keyword', 'Keyword'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`m-ch ${mode === id ? 'on' : ''}`}
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
                padding: '40px 20px',
                color: '#6E6A64',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: '#F6F4F1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#141414',
                }}
              >
                <Icon name="sparkle" size={26} />
              </div>
              <div className="m-dsp" style={{ fontSize: 22, fontWeight: 600, color: '#141414' }}>
                Ask your personal vault
              </div>
              <div style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.5 }}>
                Query your saved articles, reels, notes, and research using hybrid retrieval.
              </div>

              {/* Starter chips */}
              <div
                className="m-col"
                style={{ width: '100%', gap: 8, marginTop: 16, maxWidth: 320 }}
              >
                {[
                  'What did I save about machine learning?',
                  'Summarize my recent research notes',
                  'Find design references',
                ].map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="m-ch"
                    style={{
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      padding: '10px 16px',
                      background: '#F9F8F6',
                    }}
                    onClick={() => handleAsk(prompt)}
                  >
                    <Icon name="search" size={14} style={{ color: '#888' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {answers.map((ans, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* User Bubble */}
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

              {/* Cited Answer Card */}
              <div className="m-c m-col" style={{ gap: 12 }}>
                <div className="m-r" style={{ gap: 6 }}>
                  <Icon name="sparkle" size={16} />
                  <span className="m-m">
                    {ans.sources.length > 0
                      ? `From ${ans.sources.length} saved item${ans.sources.length > 1 ? 's' : ''}`
                      : 'No matches'}
                  </span>
                </div>

                <div style={{ lineHeight: 1.5 }}>{ans.text}</div>

                {/* Real Sources Row */}
                {ans.sources.length > 0 && (
                  <div className="m-col" style={{ gap: 8, marginTop: 4 }}>
                    <div className="m-m" style={{ fontWeight: 600 }}>
                      Sources
                    </div>
                    {ans.sources.map((item, sIdx) => (
                      <div
                        key={item.id || item.uuid || sIdx}
                        className="m-r"
                        style={{
                          background: '#ECEAE6',
                          borderRadius: 16,
                          padding: '8px 12px',
                          gap: 10,
                          cursor: 'pointer',
                        }}
                        onClick={() => onSelectItem && onSelectItem(item)}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: '#D6F23E',
                            color: '#111113',
                            flex: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon
                            name={
                              item.kind === 'reel' || item.kind === 'video'
                                ? 'play'
                                : 'book'
                            }
                            size={14}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.title || 'Untitled save'}
                          </div>
                          <div className="m-m" style={{ fontSize: 11 }}>
                            {item.url ? new URL(item.url).hostname : 'Library save'}
                          </div>
                        </div>
                        <Icon name="arrow-up-right" size={14} style={{ color: '#6E6A64' }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {asking && (
            <div className="m-c m-r" style={{ gap: 10, width: 'fit-content' }}>
              <span className="m-spn" />
              <span className="m-m">Searching library…</span>
            </div>
          )}
        </div>

        {/* Bottom Input Bar */}
        <div
          className="m-r"
          style={{
            background: '#F9F8F6',
            borderRadius: 999,
            padding: 6,
            boxShadow: '0 8px 24px rgba(30,25,20,.1)',
            marginTop: 'auto',
          }}
        >
          <input
            className="m-in"
            style={{ paddingLeft: 12 }}
            placeholder="Ask your library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAsk()
            }}
          />
          <button
            type="button"
            className="m-ib k"
            aria-label="Send"
            disabled={!query.trim() || asking}
            onClick={() => handleAsk()}
          >
            <Icon name="arrow-up" size={20} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
