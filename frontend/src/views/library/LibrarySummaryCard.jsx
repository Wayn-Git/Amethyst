import React, { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import AppButton from '../../components/ui/AppButton.jsx'
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
 * Parses raw markdown summary into:
 * 1. tldr: Clean 1-2 sentence overview without asterisks or headers
 * 2. details: Structured list of labeled items (Setup:, Teased moments:, etc.)
 *    rendered with bold labels, not crammed into a single blob.
 */
export function extractSummaryTldrAndDetails(rawText) {
  if (!rawText) return { tldr: '', detailItems: [] }
  const text = String(rawText).trim()

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { tldr: '', detailItems: [] }

  let tldr = ''
  const detailItems = []

  let foundTldr = false
  for (const line of lines) {
    if (line.startsWith('#')) continue

    // Check for bold labeled lines like:
    // "- **Setup:** The video shows..."
    // "* **Teased moments:** ..."
    // "**Promo hook:** ..."
    // "Setup: ..."
    const labeledMatch = line.match(/^[-*•]?\s*\*\*([^*:]+:?)\*\*\s*(.*)$/) ||
                         line.match(/^[-*•]?\s*([A-Za-z0-9\s_-]+:)\s+(.*)$/)

    if (labeledMatch) {
      let label = labeledMatch[1].trim()
      if (!label.endsWith(':')) label += ':'
      // Strip any residual asterisks from value
      const content = labeledMatch[2].replace(/\*\*/g, '').trim()
      if (content || label) {
        detailItems.push({ label, text: content })
      }
    } else if (!foundTldr) {
      // First clean narrative line is the TL;DR
      const cleanLine = line.replace(/^[#*-\s]+/, '').replace(/\*\*/g, '').trim()
      if (cleanLine) {
        tldr = cleanLine
        foundTldr = true
      }
    } else {
      // Additional body lines without labels
      const cleanLine = line.replace(/^[#*-\s]+/, '').replace(/\*\*/g, '').trim()
      if (cleanLine) {
        detailItems.push({ label: null, text: cleanLine })
      }
    }
  }

  // Fallback if no separate TL;DR was isolated
  if (!tldr && detailItems.length > 0) {
    const first = detailItems.shift()
    tldr = first.label ? `${first.label} ${first.text}` : first.text
  }

  return { tldr, detailItems }
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
  // Collapsed by default (show TL;DR only)
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

  const { tldr, detailItems } = useMemo(
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

  const isPending = isEnriching && !summaryText
  const isFailed = Boolean(enrichError)
  const isSuccess = Boolean(summaryText) && !isPending

  return (
    <motion.section
      className={`lib-summary-surface ${isEnriching ? 'lib-summary-surface--enriching' : ''}`}
      aria-label="Summary"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header Row: 12px sentence case section label, muted sparkle icon (no green) */}
      <div className="lib-summary-header">
        <div className="lib-summary-title-row">
          <Icon name="spark" size={14} className="lib-summary-icon" />
          <h2 className="lib-summary-heading">Summary</h2>
        </div>

        {/* Action Controls using shared AppButton */}
        <div className="lib-summary-actions">
          {summaryText && (
            <AppButton
              variant="secondary"
              size="sm"
              onClick={onCopySummary}
              title="Copy summary to clipboard"
              icon={<Icon name={copiedSummary ? 'check' : 'copy'} size={14} />}
            >
              {copiedSummary ? 'Copied' : 'Copy'}
            </AppButton>
          )}

          {/* Regenerate Split Button */}
          <div className="lib-split-btn-group" ref={menuRef}>
            <AppButton
              variant="secondary"
              size="sm"
              className="lib-split-btn lib-split-btn--main"
              onClick={() => onRegenerate?.()}
              disabled={isEnriching}
              title={`Regenerate summary with ${formatModelDisplayName(configuredModel || 'default model')}`}
              icon={
                <Icon
                  name={isEnriching ? 'loader' : 'refresh'}
                  size={14}
                  className={isEnriching ? 'animate-spin' : ''}
                />
              }
            >
              {isEnriching ? 'Summarizing...' : 'Regenerate'}
            </AppButton>

            <AppButton
              variant="secondary"
              size="sm"
              className="lib-split-btn lib-split-btn--chevron"
              onClick={() => setShowMenu((v) => !v)}
              disabled={isEnriching}
              title="Regenerate with other models"
              aria-label="Select model to regenerate with"
              aria-haspopup="true"
              aria-expanded={showMenu}
              icon={<Icon name="chevron-down" size={12} />}
            />

            {showMenu && (
              <div className="lib-split-menu" role="menu">
                <div className="lib-split-menu-header">Regenerate with...</div>
                {availableModels.length > 0 ? (
                  availableModels.map((m, idx) => (
                    <button
                      key={m.model || idx}
                      type="button"
                      role="menuitem"
                      className={`lib-split-menu-item ${m.model === configuredModel ? 'lib-split-menu-item--active' : ''}`}
                      onClick={() => {
                        setShowMenu(false)
                        onRegenerate?.(m)
                      }}
                    >
                      <AiProviderIcon provider={m.provider || 'google'} model={m.model} size={14} />
                      <span className="lib-split-menu-name">
                        {formatModelDisplayName(m.model || m.label)}
                      </span>
                      {m.model === configuredModel && (
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
            <AppButton
              variant="primary"
              size="sm"
              onClick={() => onRegenerate?.()}
              disabled={isEnriching}
              icon={<Icon name="refresh" size={14} />}
            >
              Retry
            </AppButton>

            {alternateModel && (
              <AppButton
                variant="secondary"
                size="sm"
                onClick={() => onRegenerate?.(alternateModel)}
                disabled={isEnriching}
              >
                Try with {formatModelDisplayName(alternateModel.model)}
              </AppButton>
            )}

            {errorInfo.type === 'auth' && onOpenModelSettings && (
              <AppButton
                variant="secondary"
                size="sm"
                onClick={onOpenModelSettings}
                icon={<Icon name="sliders" size={14} />}
              >
                Open model settings
              </AppButton>
            )}
          </div>
        </div>
      )}

      {/* State 2 & 4: Success / Fallback */}
      {isSuccess && !isFailed && (
        <div className="lib-summary-body">
          {/* TL;DR (1-2 lines, 14px, line-height 1.6) */}
          <p className="lib-summary-tldr">{tldr}</p>

          {/* Expandable Details Section: Collapsed by default */}
          {detailItems.length > 0 && (
            <div className="lib-summary-details-section">
              <button
                type="button"
                className={`lib-summary-details-toggle ${showDetails ? 'lib-summary-details-toggle--open' : ''}`}
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
              >
                <span>{showDetails ? 'Hide details' : 'Show details'}</span>
                <span className="lib-summary-chevron-icon">
                  <Icon name="chevron-down" size={12} />
                </span>
              </button>

              <AnimatePresence initial={false}>
                {showDetails && (
                  <motion.div
                    key="lib-summary-accordion-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <ul className="lib-summary-details-list">
                      {detailItems.map((item, i) => (
                        <li key={i} className="lib-summary-detail-item">
                          {item.label && (
                            <strong className="lib-summary-detail-label">{item.label}</strong>
                          )}
                          <span className="lib-summary-detail-text"> {item.text}</span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Footer Caption: 16px spacing above divider, 12px muted text */}
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
    </motion.section>
  )
}
