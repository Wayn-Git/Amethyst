import { Button as HouseButton } from '../ui/bento/index.jsx'
/**
 * ToolApprovalCard - Inline Craftwork / beUI Tool Approval Component
 * Implements specifications from @UIInspirations/components/newlyadded/approval.md
 * Strictly enforces 44px minimum touch targets and scoped revocable permissions.
 */

import { useState, useMemo, useCallback } from 'react'
import { ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react'
import { computeApprovalScope, formatToolArguments } from './toolApprovalUtils.js'
import './tool-approval-card.css'

export { computeApprovalScope, formatToolArguments }

export default function ToolApprovalCard({
  item,
  onDecide,
  disabled = false,
  className = '',
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const toolName = item?.tool_name || item?.name || 'terminal.run'
  const args = item?.arguments || {}
  const details = useMemo(() => formatToolArguments(toolName, args), [toolName, args])

  const description = useMemo(() => {
    if (item?.reason && !/^\S+ is rated \w+ risk\.?$/.test(item.reason.trim())) {
      return item.reason
    }
    if (details.command) {
      return `The agent wants to execute a command in the current workspace.`
    }
    if (details.path) {
      return `The agent wants to modify a file on disk.`
    }
    return `The agent requested permission to run ${toolName}.`
  }, [item?.reason, details, toolName])

  const handleDecision = useCallback(async (allow, remember) => {
    if (disabled || busy || !onDecide) return
    setBusy(true)
    try {
      const scope = remember ? computeApprovalScope(toolName, args) : null
      await onDecide(item.id, { allow, remember, scope })
    } finally {
      setBusy(false)
    }
  }, [disabled, busy, onDecide, item?.id, toolName, args])

  if (!item) return null

  return (
    <div className={`tool-approval-card ${className}`} role="region" aria-label="Tool approval request">
      {/* Header */}
      <div className="tool-approval-header">
        <div className="tool-approval-header-left">
          <div className="tool-approval-icon-badge" aria-hidden="true">
            <ShieldAlert size={18} />
          </div>
          <div className="tool-approval-title-box">
            <h4 className="tool-approval-title">Allow this tool to run?</h4>
            <span className="tool-approval-tool-name">{toolName}</span>
          </div>
        </div>

        <span className="tool-approval-status-badge">Approval required</span>
      </div>

      {/* Description */}
      <p className="tool-approval-description">{description}</p>

      {/* Collapsible Details */}
      {(details.command || details.directory || details.path) && (
        <>
          <HouseButton
            type="button"
            className="tool-approval-details-toggle"
            onClick={() => setDetailsOpen((o) => !o)}
            aria-expanded={detailsOpen}
          >
            <span>View details</span>
            {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </HouseButton>

          {detailsOpen && (
            <div className="tool-approval-details-box">
              {details.command && (
                <div className="tool-approval-detail-row">
                  <span className="tool-approval-detail-label">Command</span>
                  <div className="tool-approval-command-pill">{details.command}</div>
                </div>
              )}
              {details.directory && (
                <div className="tool-approval-detail-row">
                  <span className="tool-approval-detail-label">Directory</span>
                  <span className="tool-approval-detail-value">{details.directory}</span>
                </div>
              )}
              {details.path && (
                <div className="tool-approval-detail-row">
                  <span className="tool-approval-detail-label">Path</span>
                  <span className="tool-approval-detail-value">{details.path}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Actions (44px min targets) */}
      <div className="tool-approval-actions">
        <HouseButton
          type="button"
          disabled={disabled || busy}
          onClick={() => handleDecision(true, false)}
          className="tool-approval-btn-primary"
        >
          Allow once
        </HouseButton>

        <HouseButton
          type="button"
          disabled={disabled || busy}
          onClick={() => handleDecision(true, true)}
          className="tool-approval-btn-secondary"
        >
          Always allow
        </HouseButton>

        <HouseButton
          type="button"
          disabled={disabled || busy}
          onClick={() => handleDecision(false, false)}
          className="tool-approval-btn-ghost"
        >
          Deny
        </HouseButton>

        <span className="tool-approval-revocation-hint">
          Revocable in Settings
        </span>
      </div>
    </div>
  )
}
