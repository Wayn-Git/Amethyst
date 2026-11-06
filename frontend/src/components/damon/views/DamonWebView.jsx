import React, { useEffect, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api, openUrl } from '../../../api.js'

export default function DamonWebView({
  query = '',
  selectedIndex = 0,
  onTriggerAsk,
  onSelectResult,
}) {
  const [webResults, setWebResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setWebResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      api
        .searchWeb(q, 6, ctrl.signal)
        .then((data) => {
          setWebResults(data?.results || [])
        })
        .catch(() => {
          setWebResults([])
        })
        .finally(() => {
          setLoading(false)
        })
    }, 180)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  const cleanQ = query.trim()
  const encodedQ = encodeURIComponent(cleanQ)

  const searchEngines = [
    {
      id: 'google',
      name: 'Google',
      icon: 'globe',
      shortcut: 'G',
      url: `https://www.google.com/search?q=${encodedQ}`,
    },
    {
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      icon: 'search',
      shortcut: 'D',
      url: `https://duckduckgo.com/?q=${encodedQ}`,
    },
    {
      id: 'github',
      name: 'GitHub',
      icon: 'code',
      shortcut: 'GH',
      url: `https://github.com/search?q=${encodedQ}`,
    },
    {
      id: 'youtube',
      name: 'YouTube',
      icon: 'play',
      shortcut: 'YT',
      url: `https://www.youtube.com/results?search_query=${encodedQ}`,
    },
    {
      id: 'wikipedia',
      name: 'Wikipedia',
      icon: 'book',
      shortcut: 'W',
      url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodedQ}`,
    },
  ]

  return (
    <div className="damon-web-view-root">
      {/* 1. Ask Amethyst Hero Banner if query exists */}
      {cleanQ && (
        <div className="damon-web-ask-hero" onClick={() => onTriggerAsk(cleanQ)}>
          <div className="damon-web-ask-icon">
            <Icon name="spark" size={18} />
          </div>
          <div className="damon-web-ask-text">
            <span className="damon-web-ask-title">Ask Amethyst: “{cleanQ}”</span>
            <span className="damon-web-ask-sub">Synthesize answer from Web & Library research</span>
          </div>
          <kbd className="kbd">↵ Ask</kbd>
        </div>
      )}

      {/* 2. Direct Web Search Engines */}
      <div className="damon-section-group">
        <div className="damon-section-header">
          <div className="damon-section-title-wrap">
            <span>Search Engines</span>
          </div>
        </div>

        <div className="damon-list-container">
          {searchEngines.map((engine, idx) => (
            <button
              key={engine.id}
              type="button"
              className="damon-row palette-item"
              onClick={() => openUrl(engine.url)}
            >
              <div className="damon-row-icon-wrap">
                <Icon name={engine.icon} size={18} />
              </div>
              <div className="damon-row-main">
                <div className="damon-row-title">
                  Search {engine.name} {cleanQ ? `for “${cleanQ}”` : ''}
                </div>
                <div className="damon-row-subtitle">{engine.url}</div>
              </div>
              <div className="damon-row-trailing">
                <span className="damon-row-shortcut">{engine.shortcut}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Live Web Results if returned */}
      {webResults.length > 0 && (
        <div className="damon-section-group" style={{ marginTop: 12 }}>
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Live Web Results</span>
              <span className="damon-section-count">{webResults.length}</span>
            </div>
          </div>

          <div className="damon-list-container">
            {webResults.map((res, i) => (
              <button
                key={res.url + i}
                type="button"
                className="damon-row palette-item"
                onClick={() => openUrl(res.url)}
              >
                <div className="damon-row-icon-wrap">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${res.domain || 'google.com'}&sz=32`}
                    alt=""
                    className="damon-row-img-icon"
                    onError={(e) => {
                      e.target.style.display = 'none'
                    }}
                  />
                </div>
                <div className="damon-row-main">
                  <div className="damon-row-title">{res.title}</div>
                  <div className="damon-row-subtitle">
                    {res.domain} · {res.snippet?.slice(0, 80) || res.url}
                  </div>
                </div>
                <div className="damon-row-trailing">
                  <Icon name="arrow-up-right" size={15} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

