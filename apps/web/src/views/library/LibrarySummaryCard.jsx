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
  onTestAndSetModel,
  onCopySummary,
  copiedSummary = false,
  onOpenModelSettings,
}) {
  // Collapsed by default (show TL;DR only)
  const [showDetails, setShowDetails] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showErrorMenu, setShowErrorMenu] = useState(false)
  const [testingModel, setTestingModel] = useState(null)
  const menuRef = useRef(null)
  const errorMenuRef = useRef(null)

  const handleSelectModel = async (m) => {
    setShowMenu(false)
    setShowErrorMenu(false)
    if (onTestAndSetModel) {
      setTestingModel(m.model)
      try {
        const res = await onTestAndSetModel(m.provider, m.model)
        if (res?.ok) {
          onRegenerate?.(m)
        }
      } finally {
        setTestingModel(null)
      }
    } else {
      onRegenerate?.(m)
    }
  }

  // Outside click for split button menu & error menu
  useEffect(() => {
    if (!showMenu && !showErrorMenu) return
    const handleClick = (e) => {
      if (showMenu && menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
      if (showErrorMenu && errorMenuRef.current && !errorMenuRef.current.contains(e.target)) {
        setShowErrorMenu(false)
      }
    }
    window.addEventListener('mousedown', handleClick, true)
    return () => window.removeEventListener('mousedown', handleClick, true)
  }, [showMenu, showErrorMenu])

  const { tldr, detailItems } = useMemo(
    () => extractSummaryTldrAndDetails(summaryText),
    [summaryText]
  )

  const errorInfo = useMemo(() => mapErrorMessage(enrichError), [enrichError])

  // Working free model selection
  const workingFreeModel = useMemo(() => {
    if (!availableModels || availableModels.length === 0) {
      return { provider: 'openrouter', model: 'cohere/north-mini-code:free', label: 'Cohere North Mini (Free)' }
    }
    const cohere = availableModels.find((m) => m.model === 'cohere/north-mini-code:free')
    if (cohere) return cohere
    const orFree = availableModels.find((m) => m.provider === 'openrouter' && (m.model.includes('free') || m.model.includes('cohere')))
    if (orFree) return orFree
    const anyFree = availableModels.find((m) => m.model.includes('free'))
    if (anyFree) return anyFree
    return availableModels[0]
  }, [availableModels])

  const canSwitchToFree = Boolean(
    workingFreeModel &&
    configuredModel !== workingFreeModel.model &&
    !String(configuredModel || '').includes('north-mini-code')
  )

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
              disabled={isEnriching || Boolean(testingModel)}
              title={`Regenerate summary with ${formatModelDisplayName(configuredModel || 'default model')}`}
              icon={
                <Icon
                  name={isEnriching || testingModel ? 'loader' : 'refresh'}
                  size={14}
                  className={isEnriching || testingModel ? 'animate-spin' : ''}
                />
              }
            >
              {testingModel
                ? `Testing ${formatModelDisplayName(testingModel)}...`
                : isEnriching
                ? 'Summarizing...'
                : 'Regenerate'}
            </AppButton>

            <AppButton
              variant="secondary"
              size="sm"
              className="lib-split-btn lib-split-btn--chevron"
              onClick={() => setShowMenu((v) => !v)}
              disabled={isEnriching || Boolean(testingModel)}
              title="Regenerate with other models"
              aria-label="Select model to regenerate with"
              aria-haspopup="true"
              aria-expanded={showMenu}
              icon={<Icon name="chevron-down" size={12} />}
            />

            {showMenu && (
              <div className="lib-split-menu" role="menu">
                <div className="lib-split-menu-header">Regenerate & set default...</div>
                {availableModels.length > 0 ? (
                  availableModels.map((m, idx) => (
                    <button
                      key={`${m.provider}-${m.model}` || idx}
                      type="button"
                      role="menuitem"
                      className={`lib-split-menu-item ${m.model === configuredModel ? 'lib-split-menu-item--active' : ''}`}
                      disabled={Boolean(testingModel) || isEnriching}
                      onClick={() => handleSelectModel(m)}
                    >
                      <AiProviderIcon provider={m.provider || 'google'} model={m.model} size={14} />
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <span className="lib-split-menu-name">
                          {formatModelDisplayName(m.model || m.label)}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim, var(--muted))' }}>
                          {m.provider}
                        </span>
                      </div>
                      {m.model === configuredModel ? (
                        <span className="lib-split-menu-badge">Default</span>
                      ) : (
                        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 'auto' }}>Test & use</span>
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
            <Icon name="alert" size={16} className="lib-summary-error-icon" />
            <div className="lib-summary-error-message">
              <div className="lib-summary-error-title-row">
                <span className="lib-summary-error-title">Synthesis failed</span>
                {configuredModel && (
                  <div className="lib-failed-model-badge" title={`Failed on ${configuredProvider || 'AI'}:${configuredModel}`}>
                    <span className="lib-failed-model-badge__label">Failed with:</span>
                    <span className="lib-failed-model-badge__pill">
                      <AiProviderIcon provider={configuredProvider || 'google'} model={configuredModel} size={12} />
                      <span>{formatModelDisplayName(configuredModel)}</span>
                    </span>
                  </div>
                )}
              </div>
              <p className="lib-summary-error-desc">{errorInfo.reason}</p>
            </div>
          </div>

          <div className="lib-summary-error-actions">
            <AppButton
              variant="secondary"
              size="sm"
              onClick={() => onRegenerate?.()}
              disabled={isEnriching || Boolean(testingModel)}
              icon={
                <Icon
                  name={isEnriching ? 'loader' : 'refresh'}
                  size={13}
                  className={isEnriching ? 'animate-spin' : ''}
                />
              }
            >
              Retry
            </AppButton>

            {canSwitchToFree && (
              <AppButton
                variant="secondary"
                size="sm"
                className="lib-btn-free-model"
                onClick={() => handleSelectModel(workingFreeModel)}
                disabled={isEnriching || Boolean(testingModel)}
                icon={<Icon name="spark" size={13} />}
                title={`Switch to verified free model ${formatModelDisplayName(workingFreeModel.model)}`}
              >
                {testingModel === workingFreeModel.model
                  ? 'Testing Free Model...'
                  : `Try with ${formatModelDisplayName(workingFreeModel.model)}`}
              </AppButton>
            )}

            {/* Model switcher dropdown inside error state */}
            {availableModels.length > 0 && (
              <div className="lib-summary-error-menu-wrap" ref={errorMenuRef}>
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowErrorMenu((v) => !v)}
                  disabled={isEnriching || Boolean(testingModel)}
                  icon={<Icon name="cpu" size={13} />}
                >
                  <span>{testingModel ? `Testing ${formatModelDisplayName(testingModel)}...` : 'Switch model'}</span>
                  <Icon name="chevron-down" size={11} style={{ marginLeft: 3 }} />
                </AppButton>

                {showErrorMenu && (
                  <div className="lib-split-menu lib-summary-error-menu" role="menu">
                    <div className="lib-split-menu-header">Select model to test & use...</div>
                    {availableModels.map((m, idx) => (
                      <button
                        key={`${m.provider}-${m.model}` || idx}
                        type="button"
                        role="menuitem"
                        className={`lib-split-menu-item ${m.model === configuredModel ? 'lib-split-menu-item--active' : ''}`}
                        disabled={Boolean(testingModel) || isEnriching}
                        onClick={() => {
                          setShowErrorMenu(false)
                          handleSelectModel(m)
                        }}
                      >
                        <AiProviderIcon provider={m.provider || 'google'} model={m.model} size={14} />
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <span className="lib-split-menu-name">
                            {formatModelDisplayName(m.model || m.label)}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-dim, var(--muted))' }}>
                            {m.provider}
                          </span>
                        </div>
                        {m.model.includes('free') ? (
                          <span className="lib-model-free-badge">Free</span>
                        ) : m.model === configuredModel ? (
                          <span className="lib-split-menu-badge">Current</span>
                        ) : (
                          <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 'auto' }}>Test & use</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {errorInfo.type === 'auth' && onOpenModelSettings && (
              <AppButton
                variant="secondary"
                size="sm"
                onClick={onOpenModelSettings}
                icon={<Icon name="sliders" size={13} />}
              >
                Model settings
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
