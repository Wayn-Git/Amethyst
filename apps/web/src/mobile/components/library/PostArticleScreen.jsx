import { useState } from 'react'
import { INK, MUTED, DEEP_BLUE, CARD_SHADOW } from './tokens.js'

export default function PostArticleScreen({
  item,
  onOpenLink,
  onReEnrich,
  showToast,
}) {
  const summary = item.summary || item.executive_summary || ''
  const takeaways = Array.isArray(item.takeaways)
    ? item.takeaways
    : typeof item.takeaways === 'string'
    ? item.takeaways.split('\n').filter(Boolean)
    : []
  const textContent = item.text_content || item.content || item.notes || ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero Badge & Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: '#E4EDFC',
              color: DEEP_BLUE,
            }}
          >
            {item.kind === 'post' ? 'Post' : 'Article'}
          </span>
          {item.read_time && (
            <span style={{ fontSize: 13, color: MUTED }}>{item.read_time}</span>
          )}
        </div>

        <h1 style={{ margin: 0, fontSize: 26, lineHeight: '32px', fontWeight: 800, letterSpacing: '-0.025em', color: INK }}>
          {item.title || item.url || 'Untitled save'}
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: MUTED }}>
          <span>
            {item.author ? `${item.author} · ` : ''}
            {item.site_name || item.domain || 'Web'}
            {item.time_ago ? ` · ${item.time_ago}` : ''}
          </span>
          {item.url && (
            <button
              type="button"
              style={{ border: 0, background: 'transparent', color: DEEP_BLUE, fontSize: 14, fontWeight: 650, cursor: 'pointer', padding: 0 }}
              onClick={() => onOpenLink?.(item.url)}
            >
              Read original
            </button>
          )}
        </div>
      </div>

      {/* Quick Summary Callout */}
      {summary && (
        <div style={{ background: '#fff', borderRadius: 22, padding: 16, boxShadow: CARD_SHADOW }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
            Quick Summary
          </div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: '24px', color: '#2C2C2E' }}>
            {summary}
          </p>
        </div>
      )}

      {/* Key Takeaways */}
      {takeaways.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 22, padding: 16, boxShadow: CARD_SHADOW }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
            Key Takeaways
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {takeaways.map((point, i) => (
              <li key={i} style={{ fontSize: 15, lineHeight: '22px', color: '#2C2C2E' }}>
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Content Body Reader */}
      {textContent && (
        <div style={{ background: '#fff', borderRadius: 22, padding: '18px 16px', boxShadow: CARD_SHADOW }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
            Full Text
          </div>
          <div
            style={{
              fontSize: 16,
              lineHeight: '26px',
              color: '#2C2C2E',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            {textContent}
          </div>
        </div>
      )}

      {/* Details Box */}
      <div style={{ background: '#fff', borderRadius: 22, padding: '0 16px', boxShadow: CARD_SHADOW }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: 48, alignItems: 'center', borderBottom: '1px solid #ECECF0' }}>
          <span style={{ fontSize: 14, color: MUTED }}>Type</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{item.kind === 'post' ? 'Social Post' : 'Article'}</span>
        </div>
        {item.domain && (
          <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: 48, alignItems: 'center', borderBottom: '1px solid #ECECF0' }}>
            <span style={{ fontSize: 14, color: MUTED }}>Site</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{item.domain}</span>
          </div>
        )}
        {item.author && (
          <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: 48, alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: MUTED }}>Author</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{item.author}</span>
          </div>
        )}
      </div>
    </div>
  )
}

