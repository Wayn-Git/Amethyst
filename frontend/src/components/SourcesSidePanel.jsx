import { useEffect, useRef, useState } from 'react'
import SidePanel from './SidePanel.jsx'
import Icon from './Icon.jsx'

export function extractDomain(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function cleanSnippet(text) {
  if (!text) return ''
  return text.replace(/\s+/g, ' ').trim()
}

export function extractSourcesFromMessage(item) {
  const map = new Map()

  // 1. Explicit sources on message item
  if (Array.isArray(item.sources)) {
    for (const s of item.sources) {
      const url = s.url || s.link
      if (url && !map.has(url)) {
        map.set(url, {
          url,
          title: s.title || s.name || extractDomain(url),
          domain: s.domain || extractDomain(url),
          snippet: s.snippet || s.summary || s.description || '',
          published_date: s.published_date || s.date || '',
          authority_tier: s.authority_tier || '',
        })
      }
    }
  }

  // 2. Extract from tool calls (search_web, research_web, fetch_url)
  if (Array.isArray(item.toolCalls)) {
    for (const call of item.toolCalls) {
      const content = call.content || ''
      if (typeof content !== 'string') continue

      // Look for Title\nURL\nSnippet patterns
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (/^https?:\/\//i.test(line)) {
          const url = line
          const title = lines[i - 1]?.trim() || extractDomain(url)
          const snippet = lines[i + 1]?.trim() || ''
          if (url && !map.has(url)) {
            map.set(url, {
              url,
              title: title.length > 3 ? title : extractDomain(url),
              domain: extractDomain(url),
              snippet: cleanSnippet(snippet),
              published_date: '',
            })
          }
        }
      }
    }
  }

  // 3. Extract from markdown links in text: [Title](url)
  if (typeof item.text === 'string') {
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g
    let match
    while ((match = linkRegex.exec(item.text)) !== null) {
      const title = match[1].trim()
      const url = match[2].trim()
      if (url && !map.has(url)) {
        map.set(url, {
          url,
          title: title.length > 2 ? title : extractDomain(url),
          domain: extractDomain(url),
          snippet: '',
          published_date: '',
        })
      }
    }
  }

  return Array.from(map.values())
}

export default function SourcesSidePanel({
  sources = [],
  activeUrl,
  duration = '3s',
  onClose,
}) {
  const [highlightedUrl, setHighlightedUrl] = useState(activeUrl || null)
  const cardRefs = useRef({})

  useEffect(() => {
    if (activeUrl) {
      setHighlightedUrl(activeUrl)
      const el = cardRefs.current[activeUrl]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activeUrl])

  return (
    <SidePanel
      title={`Activity · ${duration}`}
      eyebrow="Research"
      count={sources.length}
      onClose={onClose}
      closeLabel="Close sources drawer"
    >
      <div className="sources-drawer-container">
        <div className="sources-drawer-header">
          <span className="sources-count-label">Sources · {sources.length}</span>
        </div>

        {sources.length === 0 ? (
          <div className="sources-empty-state">
            <Icon name="book" size={24} />
            <p className="sources-empty-text">No external sources cited for this response.</p>
          </div>
        ) : (
          <div className="sources-card-list">
          {sources.map((src, index) => {
            const host = src.domain || extractDomain(src.url)
            const isHighlighted = highlightedUrl && (highlightedUrl === src.url || src.url.includes(highlightedUrl))
            const initial = (host.charAt(0) || 'S').toUpperCase()

            return (
              <a
                key={src.url || index}
                ref={(el) => { if (el && src.url) cardRefs.current[src.url] = el }}
                href={src.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`source-activity-card ${isHighlighted ? 'is-highlighted' : ''}`}
                title={`Open ${src.title || host}`}
              >
                <div className="source-card-header">
                  <div className="source-avatar-wrap">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                      alt=""
                      className="source-card-favicon"
                      onError={(e) => {
                        e.target.style.display = 'none'
                        e.target.nextSibling.style.display = 'flex'
                      }}
                    />
                    <div className="source-fallback-badge" style={{ display: 'none' }}>
                      {initial}
                    </div>
                  </div>
                  <span className="source-publisher-name">{host}</span>
                </div>

                <div className="source-card-title">
                  {src.title || host}
                </div>

                {(src.snippet || src.published_date) && (
                  <div className="source-card-snippet">
                    {src.published_date && (
                      <span className="source-date-tag">{src.published_date} — </span>
                    )}
                    {src.snippet}
                  </div>
                )}
              </a>
            )
          })}
        </div>
      )}
      </div>
    </SidePanel>
  )
}
