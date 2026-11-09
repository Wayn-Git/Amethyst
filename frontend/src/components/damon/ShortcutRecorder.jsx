import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'

const FORBIDDEN_KEYS = new Set([
  'Control', 'Alt', 'Shift', 'Meta', 'Escape', 'Tab', 'CapsLock',
])

const CRITICAL_CONFLICTS = new Set([
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+A', 'Alt+F4',
])

const PRESETS = [
  { label: 'Alt+Shift+Space (Default)', chord: 'Alt+Shift+Space' },
  { label: 'Ctrl+Shift+Space', chord: 'Ctrl+Shift+Space' },
  { label: 'Ctrl+Alt+Space', chord: 'Ctrl+Alt+Space' },
  { label: 'Ctrl+Space', chord: 'Ctrl+Space' },
  { label: 'Alt+Space', chord: 'Alt+Space' },
]

export function formatChordString(e) {
  const parts = []
  if (e.ctrlKey || e.metaKey) {
    parts.push(navigator.platform?.includes('Mac') ? 'CommandOrControl' : 'Ctrl')
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

export default function ShortcutRecorder({ currentShortcut: externalShortcut, onShortcutChange }) {
  const [currentShortcut, setCurrentShortcut] = useState(() => {
    return externalShortcut || localStorage.getItem('amethyst_custom_shortcut') || 'Alt+Shift+Space'
  })
  const [recording, setRecording] = useState(false)
  const [recordedCombo, setRecordedCombo] = useState(null)
  const [conflictWarning, setConflictWarning] = useState(null)
  const [saving, setSaving] = useState(false)

  // Sync external prop changes
  useEffect(() => {
    if (externalShortcut) {
      // Normalize format like <ctrl>+<alt>+<space> to Ctrl+Alt+Space
      const normalized = externalShortcut
        .replace(/<ctrl>/gi, 'Ctrl')
        .replace(/<alt>/gi, 'Alt')
        .replace(/<shift>/gi, 'Shift')
        .replace(/<super>/gi, 'Super')
        .replace(/<space>/gi, 'Space')
        .replace(/<cmd>/gi, 'Cmd')
      setCurrentShortcut(normalized)
    }
  }, [externalShortcut])

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

  const handleApplyPreset = async (chord) => {
    setConflictWarning(null)
    if (window.amethystDesktop?.setShortcut) {
      const res = await window.amethystDesktop.setShortcut(chord)
      if (!res?.ok) {
        setConflictWarning(res?.error || `Could not bind ${chord}`)
        return
      }
    }
    setCurrentShortcut(chord)
    try {
      localStorage.setItem('amethyst_custom_shortcut', chord)
    } catch {}
    onShortcutChange?.(chord)
  }

  const activeDisplay = currentShortcut || 'Alt+Shift+Space'

  return (
    <div className="set-box">
      <div className="set-box-row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div className="set-row-text" style={{ flex: '1 1 260px' }}>
          <span className="set-row-title">Global Summon Shortcut</span>
          <span className="set-row-desc">
            Global system chord to summon or toggle the Amethyst Damon launcher from any app or workspace.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <kbd className="kbd" style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            padding: '5px 12px',
            background: 'var(--surface-1, rgba(0, 0, 0, 0.25))',
            borderRadius: 7,
            border: '1px solid var(--hairline-strong)',
            color: 'var(--accent, #a78bfa)',
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}>
            {recording ? (recordedCombo || 'Press keys...') : activeDisplay}
          </kbd>

          {!recording ? (
            <button
              type="button"
              className="set-btn-sm"
              onClick={() => {
                setRecording(true)
                setRecordedCombo(null)
                setConflictWarning(null)
              }}
            >
              Change
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="set-btn-sm is-primary"
                onClick={handleSave}
                disabled={!recordedCombo || Boolean(conflictWarning) || saving}
              >
                Save
              </button>
              <button
                type="button"
                className="set-btn-sm"
                onClick={() => {
                  setRecording(false)
                  setRecordedCombo(null)
                  setConflictWarning(null)
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {recording && (
        <div className="set-box-row" style={{ padding: '10px 18px', background: 'rgba(59, 130, 246, 0.08)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
            Press your desired key combination (e.g. <code>Ctrl+Shift+Space</code> or <code>Alt+Shift+Space</code>). Press <strong>Esc</strong> to cancel.
          </div>
        </div>
      )}

      {conflictWarning && (
        <div className="set-box-row" style={{ padding: '10px 18px', background: 'rgba(239, 68, 68, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontSize: 12 }}>
            <Icon name="alert-triangle" size={14} />
            <span>{conflictWarning}</span>
          </div>
        </div>
      )}

      <div className="set-box-row set-col" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="set-row-text">
          <span className="set-row-title">Quick Presets</span>
          <span className="set-row-desc">Standard chords for system-wide spotlight launchers:</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%', justifyContent: 'flex-start' }}>
          {PRESETS.map((p) => {
            const isSel = activeDisplay.toLowerCase().replace(/[^a-z0-9]/g, '') === p.chord.toLowerCase().replace(/[^a-z0-9]/g, '')
            return (
              <button
                key={p.chord}
                type="button"
                className={`set-btn-sm${isSel ? ' is-active' : ''}`}
                onClick={() => handleApplyPreset(p.chord)}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
