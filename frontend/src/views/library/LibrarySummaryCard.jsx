import React, { useState, useMemo, useRef, useEffect } from 'react'
import Icon from '../../components/Icon.jsx'
import AiProviderIcon from '../../components/AiProviderIcon.jsx'
import { AsciiSkeleton } from 'ascii-reveal'
import { formatModelDisplayName } from './LibraryDetailModal.jsx'
import { formatRelativeDate } from './dateUtils.js'

function mapErrorMessage(err) {
  if (!err) return { reason: 'An error occurred during AI synthesis.', type: 'unknown' }
  const s = String(err).toLowerCase()
  if (s.includes('rate limit') || s.includes('429') || s.includes('too many requests')) {
    return {
      reason: 'Rate limit exceeded. The provider is temporarily throttling requests.',
      type: 'rate_limit',
    }
  }
  if (
    s.includes('api_key') ||
    s.includes('api key') ||
    s.includes('auth') ||
    s.includes('unauthorized') ||
    s.includes('401') ||
    s.includes('403') ||
    s.includes('quota') ||
    s.includes('credit')
  ) {
    return {
      reason: 'Invalid, missing API key, or quota exhausted on the AI provider.',
      type: 'auth',
    }
  }
  if (s.includes('timeout') || s.includes('timed out') || s.includes('deadline')) {
    return {
      reason: 'Request timed out while transcribing speech or generating insights.',
      type: 'timeout',
    }
  }
  if (s.includes('empty') || s.includes('invalid response') || s.includes('unparseable')) {
    return {
      reason: 'Received empty or unparseable response from the model.',
      type: 'empty',
    }
  }
  if (s.includes('unreachable') || s.includes('network') || s.includes('offline') || s.includes('502') || s.includes('503') || s.includes('504')) {
    return {
      reason: 'AI provider service is unreachable or currently offline.',
      type: 'network',
    }
  }
  return {
    reason: `Synthesis error: ${String(err).replace(/^error:\s*/i, '')}`,
    type: 'generic',
  }
}

/**
 * Parses raw markdown summary into a clean 1-2 line TL;DR and plain paragraphs
 * for the details disclosure, eliminating rigid bold-label bullets.
 */
export function extractSummaryTldrAndDetails(rawText) {
  if (!rawText) return { tldr: '', paragraphs: [] }
  const text = String(rawText).trim()

  // Split into paragraphs by double newlines or single newlines
  const rawParagraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (rawParagraphs.length === 0) return { tldr: '', paragraphs: [] }

  // 1. TL;DR from first paragraph or first sentence
  let firstPara = rawParagraphs[0]
  // Strip markdown headings or bold label prefixes like **Header:**
  const leadMatch = firstPara.match(/^\*\*[^*]+:\*\*\s*(.+)$/)
  let tldr = leadMatch ? leadMatch[1].trim() : firstPara.replace(/^[#*-\s]+/, '').trim()

  // If first paragraph is very long, extract the first 1-2 sentences
  const sentenceMatch = tldr.match(/^([^.!?]+[.!?]+(?:\s+[^.!?]+[.!?]+)?)/)
  if (sentenceMatch && tldr.length > 220) {
    tldr = sentenceMatch[1].trim()
  }

  // 2. Details paragraphs: convert remaining lines / bullets to 2-3 plain paragraphs
  const remaining = rawParagraphs.slice(1)
  const paragraphs = []
  let buffer = []

  for (const block of remaining) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const line of lines) {
      if (line.startsWith('#')) continue
      // Convert "- **Setup:** The video shows..." to "Setup: The video shows..."
      const cleaned = line
        .replace(/^[-*•]\s*/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .trim()
      if (cleaned) {
        buffer.push(cleaned)
        if (buffer.length >= 2) {
          paragraphs.push(buffer.join(' '))
          buffer = []
        }
      }
    }
  }

  if (buffer.length > 0) {
    paragraphs.push(buffer.join(' '))
  }

  // If there are no detail paragraphs from remainder, use any remaining text
  if (paragraphs.length === 0 && rawParagraphs.length === 1 && firstPara.length > tldr.length) {
    const rest = firstPara.slice(tldr.length).trim()
    if (rest) paragraphs.push(rest)
  }

  return { tldr, paragraphs: paragraphs.slice(0, 3) }
}

export default function LibrarySummaryCard({
  summaryText,
  isEnriching = false,
  enrichError = null,
  enrichmentModel = null,
  enrichedAt = null,
  fallbackInfo = null,
  configuredModel = null,
  configuredProvider = null,
  availableModels = [],
  onRegenerate,
  onCopySummary,
  copiedSummary = false,
  onOpenModelSettings,
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef(null)

  // Outside click for split button menu
  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }
    window.addEventListener('mousedown', handleClick, true)
    return () => window.removeEventListener('mousedown', handleClick, true)
  }, [showMenu])

  const { tldr, paragraphs } = useMemo(
    () => extractSummaryTldrAndDetails(summaryText),
    [summaryText]
  )

  const errorInfo = useMemo(() => mapErrorMessage(enrichError), [enrichError])

  // Is configured model different from the model that generated this summary?
  const isStale = useMemo(() => {
    if (!summaryText || !enrichmentModel || !configuredModel) return false
    const normGen = String(enrichmentModel).toLowerCase().trim()
    const normCfg = String(configuredModel).toLowerCase().trim()
    return normGen !== normCfg && !normGen.includes(normCfg) && !normCfg.includes(normGen)
  }, [summaryText, enrichmentModel, configuredModel])

  // Alternate model for retry if available
  const alternateModel = useMemo(() => {
    if (!availableModels || availableModels.length <= 1) return null
    return availableModels.find((m) => m.model !== configuredModel) || null
  }, [availableModels, configuredModel])

  // Determine which state to render
  const isPending = isEnriching && !summaryText
  const isFailed = Boolean(enrichError)
  const isSuccess = Boolean(summaryText) && !isPending

  return (
    <section className="lib-summary-surface" aria-label="Summary">
      {/* Header Row */}
      <div className="lib-summary-header">
        <div className="lib-summary-title-row">
          <Icon name="spark" size={14} className="lib-summary-icon" />
          <h2 className="lib-summary-heading">Summary</h2>
        </div>

        {/* Action Controls */}
        <div className="lib-summary-actions">
          {summaryText && (
            <button
              type="button"
              className="lib-summary-btn"
              onClick={onCopySummary}
              title="Copy summary to clipboard"
              aria-label="Copy summary"
            >
              <Icon name={copiedSummary ? 'check' : 'copy'} size={13} />
              <span>{copiedSummary ? 'Copied' : 'Copy'}</span>
            </button>
          )}

          {/* Regenerate Split Button */}
          <div className="lib-split-btn-group" ref={menuRef}>
            <button
              type="button"
              className="lib-split-btn lib-split-btn--main"
              onClick={() => onRegenerate?.()}
              disabled={isEnriching}
              title={`Regenerate summary with ${formatModelDisplayName(configuredModel || 'default model')}`}
              aria-label="Regenerate summary"
            >
              <Icon
                name={isEnriching ? 'loader' : 'refresh'}
                size={13}
                className={isEnriching ? 'animate-spin' : ''}
              />
              <span>{isEnriching ? 'Summarizing...' : 'Regenerate'}</span>
            </button>

            <button
              type="button"
              className="lib-split-btn lib-split-btn--chevron"
              onClick={() => setShowMenu((v) => !v)}
              disabled={isEnriching}
              title="Regenerate with other models"
              aria-label="Select model to regenerate with"
              aria-haspopup="true"
              aria-expanded={showMenu}
            >
              <Icon name="chevron-down" size={11} />
            </button>

            {showMenu && (
              <div className="lib-split-menu" role="menu">
                <div className="lib-split-menu-header">Regenerate with...</div>
                {availableModels.length > 0 ? (
                  availableModels.map((item, idx) => (
                    <button
                      key={item.model || idx}
                      type="button"
                      role="menuitem"
                      className={`lib-split-menu-item ${item.model === configuredModel ? 'lib-split-menu-item--active' : ''}`}
                      onClick={() => {
                        setShowMenu(false)
                        onRegenerate?.(item)
                      }}
                    >
                      <AiProviderIcon provider={item.provider || 'google'} model={item.model} size={13} />
                      <span className="lib-split-menu-name">
                        {formatModelDisplayName(item.model || item.label)}
                      </span>
                      {item.model === configuredModel && (
                        <span className="lib-split-menu-badge">Default</span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="lib-split-menu-empty">No other configured models</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* State 1: Pending */}
      {isPending && (
        <div className="lib-summary-pending" role="status" aria-live="polite">
          <div className="lib-summary-skeleton">
            <AsciiSkeleton variant="scan" lines={3} widths={['95%', '85%', '60%']} />
          </div>
          <p className="lib-summary-pending-label">
            <span className="lib-dash-indicator animate-pulse" />
            <span>Summarizing content with {formatModelDisplayName(configuredModel || 'AI')}...</span>
          </p>
        </div>
      )}

      {/* If Failed but previous good summary exists: keep previous good summary visible above error */}
      {isFailed && summaryText && (
        <div className="lib-summary-previous-wrap">
          <div className="lib-summary-previous-badge">Previous Summary</div>
          <p className="lib-summary-tldr">{tldr}</p>
        </div>
      )}

      {/* State 3: Failed (Inline State) */}
      {isFailed && (
        <div className="lib-summary-error-box" role="alert">
          <div className="lib-summary-error-header">
            <Icon name="alert" size={14} className="lib-summary-error-icon" />
            <div className="lib-summary-error-message">
              <span className="lib-summary-error-title">Synthesis failed</span>
              <p className="lib-summary-error-desc">{errorInfo.reason}</p>
            </div>
          </div>

          <div className="lib-summary-error-actions">
            <button
              type="button"
              className="lib-summary-err-btn lib-summary-err-btn--primary"
              onClick={() => onRegenerate?.()}
              disabled={isEnriching}
            >
              <Icon name="refresh" size={12} />
              <span>Retry</span>
            </button>

            {alternateModel && (
              <button
                type="button"
                className="lib-summary-err-btn"
                onClick={() => onRegenerate?.(alternateModel)}
                disabled={isEnriching}
              >
                <span>Try with {formatModelDisplayName(alternateModel.model)}</span>
              </button>
            )}

            {errorInfo.type === 'auth' && onOpenModelSettings && (
              <button
                type="button"
                className="lib-summary-err-btn"
                onClick={onOpenModelSettings}
              >
                <Icon name="sliders" size={12} />
                <span>Open model settings</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* State 2 & 4: Success / Fallback */}
      {isSuccess && !isFailed && (
        <div className="lib-summary-body">
          {/* TL;DR (1-2 lines) */}
          <p className="lib-summary-tldr">{tldr}</p>

          {/* Expandable Details Section */}
          {paragraphs.length > 0 && (
            <div className="lib-summary-details-section">
              <button
                type="button"
                className="lib-summary-details-toggle"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
              >
                <span>{showDetails ? 'Hide details' : 'Show details'}</span>
                <Icon name={showDetails ? 'chevron-up' : 'chevron-down'} size={12} />
              </button>

              {showDetails && (
                <div className="lib-summary-details-prose">
                  {paragraphs.map((para, i) => (
                    <p key={i} className="lib-summary-detail-p">
                      {para}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer Caption */}
          <div className="lib-summary-footer">
            <span className="lib-summary-footer-text">
              {fallbackInfo ? (
                <>
                  Summarized with {formatModelDisplayName(fallbackInfo.model || enrichmentModel)}
                  {' '}(fallback; {formatModelDisplayName(fallbackInfo.failedModel || 'primary')} failed)
                </>
              ) : (
                <>
                  Summarized with {formatModelDisplayName(enrichmentModel || configuredModel || 'AI')}
                  {enrichedAt ? ` · ${formatRelativeDate(enrichedAt)}` : ''}
                </>
              )}
            </span>

            {/* Stale Hint */}
            {isStale && configuredModel && (
              <button
                type="button"
                className="lib-summary-stale-link"
                onClick={() => onRegenerate?.()}
                title={`Generate new summary using ${formatModelDisplayName(configuredModel)}`}
              >
                Regenerate with {formatModelDisplayName(configuredModel)}?
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
