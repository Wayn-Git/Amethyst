import { useState, useEffect } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

function formatPrompt(fact) {
  if (!fact) return ''
  let cleaned = fact.trim()
  // If fact already starts with "Do you remember", clean it
  if (/^do you remember/i.test(cleaned)) {
    return cleaned.endsWith('?') ? cleaned : `${cleaned}?`
  }
  // Otherwise frame as prompt: "Do you remember..."
  // Remove leading dash or bullet if present
  cleaned = cleaned.replace(/^[-•*]\s*/, '')
  // Lowercase first letter if appropriate
  const firstLower = cleaned.charAt(0).toLowerCase() + cleaned.slice(1)
  return `Do you remember that ${firstLower.endsWith('?') || firstLower.endsWith('.') ? firstLower.replace(/\.$/, '?') : `${firstLower}?`}`
}

/**
 * Recent Memory Card:
 * - Surfaces recently stored memories, framed as prompts: "Do you remember…"
 * - Shows exactly two memories at a time (not more)
 * - Fixed permanent size — does not grow with content
 * - Background: gradient built from the accent color
 * - Text color: follows active theme's text color (not the accent color)
 * - Styled per reference image
 */
export default function TodayMemoryCard({ setView }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await api.memory()
        if (!cancelled && res?.facts) {
          // Take the two most recent memories
          setMemories(res.facts.slice(0, 2))
        }
      } catch {
        if (!cancelled) setMemories([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Exactly two memories at a time (not more)
  const displayMemories = memories.slice(0, 2)

  return (
    <section className="today-card today-card--accent-grad">
      {/* Header */}
      <div className="today-card-head">
        <div className="today-card-title-group">
          <div
            className="today-card-icon-pill"
            style={{
              background: 'color-mix(in srgb, var(--canvas) 70%, transparent)',
              borderColor: 'color-mix(in srgb, var(--hairline) 60%, transparent)',
              color: 'var(--text)',
            }}
          >
            <Icon name="sparkle" size={16} />
          </div>
          <h3 className="today-card-title" style={{ color: 'var(--text)' }}>
            Recent Memory
          </h3>
          <span
            className="today-card-badge"
            style={{
              background: 'color-mix(in srgb, var(--canvas) 60%, transparent)',
              color: 'var(--text)',
              borderColor: 'color-mix(in srgb, var(--hairline) 50%, transparent)',
            }}
          >
            {displayMemories.length} / 2
          </span>
        </div>

        <div className="today-card-actions">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            style={{
              borderRadius: 9999,
              padding: '4px 10px',
              fontSize: 12,
              background: 'color-mix(in srgb, var(--canvas) 60%, transparent)',
              borderColor: 'color-mix(in srgb, var(--hairline) 50%, transparent)',
              color: 'var(--text)',
            }}
            onClick={() => setView?.('memory')}
          >
            All <Icon name="arrow-up-right" size={12} />
          </button>
        </div>
      </div>

      {/* Internal Content Area: Shows exactly two memories */}
      <div className="today-card-scroll">
        {displayMemories.length === 0 ? (
          <div className="today-card-empty">
            <div
              className="today-empty-icon-wrap"
              style={{
                background: 'color-mix(in srgb, var(--canvas) 60%, transparent)',
                borderColor: 'color-mix(in srgb, var(--hairline) 50%, transparent)',
                color: 'var(--text)',
              }}
            >
              <Icon name="sparkle" size={24} />
            </div>
            <div className="today-empty-title" style={{ color: 'var(--text)' }}>
              {loading ? 'Recalling memories…' : 'No memories yet.'}
            </div>
            <div className="today-empty-desc" style={{ color: 'var(--text-dim)' }}>
              Memories extracted during conversations will be surfaced here as prompts.
            </div>
          </div>
        ) : (
          <div className="today-memory-container">
            {displayMemories.map((item, idx) => (
              <div key={item.id || idx} className="today-memory-tile">
                <div className="today-memory-prompt-lead">
                  <Icon name="sparkle" size={12} />
                  <span>Memory #{idx + 1}</span>
                </div>

                <p className="today-memory-text">
                  {formatPrompt(item.fact)}
                </p>

                <div className="today-memory-meta">
                  <Icon name="clock" size={12} />
                  <span>
                    {item.created_at
                      ? `Recorded ${new Date(item.created_at.replace(' ', 'T')).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                      : 'Recently stored'}
                  </span>
                </div>
              </div>
            ))}

            {/* If only 1 memory exists, show a second placeholder prompt tile */}
            {displayMemories.length === 1 && (
              <div
                className="today-memory-tile"
                style={{
                  background: 'color-mix(in srgb, var(--canvas) 40%, transparent)',
                  borderStyle: 'dashed',
                  opacity: 0.85,
                }}
              >
                <div className="today-memory-prompt-lead">
                  <Icon name="plus" size={12} />
                  <span>Next Memory</span>
                </div>
                <p className="today-memory-text" style={{ fontStyle: 'italic', color: 'var(--text-dim)' }}>
                  Chat with Amethyst to capture more memories and facts.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
