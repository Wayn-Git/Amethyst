import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'

const FORBIDDEN_KEYS = new Set([
  'Control', 'Alt', 'Shift', 'Meta', 'Escape', 'Tab', 'CapsLock',
])

const CRITICAL_CONFLICTS = new Set([
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+A', 'Alt+F4',
])

export function formatChordString(e) {
  const parts = []
  if (e.ctrlKey || e.metaKey) {
    parts.push(navigator.platform.includes('Mac') ? 'CommandOrControl' : 'Ctrl')
  }
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = e.code || e.key
  if (key === 'Space') key = 'Space'
  else if (key.startsWith('Key')) key = key.slice(3)
  else if (key.startsWith('Digit')) key = key.slice(5)

  if (!FORBIDDEN_KEYS.has(e.key) && key) {
    parts.push(key)
    return parts.join('+')
  }
  return null
}

export default function ShortcutRecorder({ onShortcutChange }) {
  const [currentShortcut, setCurrentShortcut] = useState(() => {
    return localStorage.getItem('amethyst_custom_shortcut') || 'Alt+Shift+Space'
  })
  const [recording, setRecording] = useState(false)
  const [recordedCombo, setRecordedCombo] = useState(null)
  const [conflictWarning, setConflictWarning] = useState(null)
  const [saving, setSaving] = useState(false)

  // Sync with electron on mount
  useEffect(() => {
    if (window.amethystDesktop?.getShortcut) {
      window.amethystDesktop.getShortcut().then((sc) => {
        if (sc) {
          setCurrentShortcut(sc)
          try {
            localStorage.setItem('amethyst_custom_shortcut', sc)
          } catch {}
        }
      }).catch(() => {})
    }
  }, [])

  const handleKeyDown = useCallback(
    async (e) => {
      if (!recording) return
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(false)
        setRecordedCombo(null)
        setConflictWarning(null)
        return
      }

      const chord = formatChordString(e)
      if (!chord) return

      setRecordedCombo(chord)
      setConflictWarning(null)

      if (CRITICAL_CONFLICTS.has(chord)) {
        setConflictWarning(`Shortcut '${chord}' conflicts with standard system edit actions.`)
        return
      }

      if (window.amethystDesktop?.checkShortcutConflict) {
        try {
          const res = await window.amethystDesktop.checkShortcutConflict(chord)
          if (res?.conflict) {
            setConflictWarning(`Shortcut '${chord}' conflicts with another application or OS shortcut.`)
          }
        } catch {}
      }
    },
    [recording]
  )

  useEffect(() => {
    if (recording) {
      window.addEventListener('keydown', handleKeyDown, { capture: true })
      return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [recording, handleKeyDown])

  const handleSave = async () => {
    if (!recordedCombo || conflictWarning) return
    setSaving(true)
    try {
      if (window.amethystDesktop?.setShortcut) {
        const res = await window.amethystDesktop.setShortcut(recordedCombo)
        if (!res?.ok) {
          setConflictWarning(res?.error || 'Failed to register shortcut with operating system')
          setSaving(false)
          return
        }
      }
      setCurrentShortcut(recordedCombo)
      try {
        localStorage.setItem('amethyst_custom_shortcut', recordedCombo)
      } catch {}
      onShortcutChange?.(recordedCombo)
      setRecording(false)
      setRecordedCombo(null)
      setConflictWarning(null)
    } finally {
      setSaving(false)
    }
  }

  const handleResetDefault = async () => {
    const def = 'Alt+Shift+Space'
    if (window.amethystDesktop?.setShortcut) {
      await window.amethystDesktop.setShortcut(def)
    }
    setCurrentShortcut(def)
    try {
      localStorage.setItem('amethyst_custom_shortcut', def)
    } catch {}
    onShortcutChange?.(def)
    setRecording(false)
    setRecordedCombo(null)
    setConflictWarning(null)
  }

  return (
    <div className="shortcut-recorder-card" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: '16px 20px',
      background: 'var(--bg-surface, rgba(255, 255, 255, 0.04))',
      border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
      borderRadius: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
            Global Summon Hotkey
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
            Opens the independent Amethyst Daemon from any application or workspace.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            padding: '4px 10px',
            background: 'var(--bg-inset, rgba(0, 0, 0, 0.2))',
            borderRadius: 6,
            border: '1px solid var(--border)',
            color: 'var(--accent, #a78bfa)',
            fontWeight: 600,
          }}>
            {recording ? (recordedCombo || 'Press keys...') : currentShortcut}
          </span>

          {!recording ? (
            <button
              type="button"
              className="bt s"
              onClick={() => {
                setRecording(true)
                setRecordedCombo(null)
                setConflictWarning(null)
              }}
              style={{ fontSize: 12 }}
            >
              Change
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="bt s"
                onClick={handleSave}
                disabled={!recordedCombo || Boolean(conflictWarning) || saving}
                style={{ fontSize: 12, background: 'var(--accent)', color: '#fff' }}
              >
                Save
              </button>
              <button
                type="button"
                className="bt s"
                onClick={() => {
                  setRecording(false)
                  setRecordedCombo(null)
                  setConflictWarning(null)
                }}
                style={{ fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {recording && (
        <div style={{
          fontSize: 12,
          padding: '8px 12px',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          borderRadius: 8,
          color: 'var(--text)',
        }}>
          Press your desired key combination (e.g. <code>Ctrl+Shift+Space</code> or <code>Alt+Shift+P</code>). Press <strong>Esc</strong> to cancel.
        </div>
      )}

      {conflictWarning && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: '#ef4444',
          background: 'rgba(239, 68, 68, 0.1)',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }}>
          <Icon name="alert-triangle" size={14} />
          <span>{conflictWarning}</span>
        </div>
      )}

      {currentShortcut !== 'Alt+Shift+Space' && !recording && (
        <div style={{ alignSelf: 'flex-start' }}>
          <button
            type="button"
            onClick={handleResetDefault}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 11,
              color: 'var(--text-sub)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Reset to recommended default (Alt+Shift+Space)
          </button>
        </div>
      )}
    </div>
  )
}

