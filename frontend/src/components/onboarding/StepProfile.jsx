import React, { useState, useEffect, useMemo } from 'react'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import { useApp } from '../../store.jsx'
import { api } from '../../api.js'

const THEMES = [
  { id: 'system', label: 'System', bg: '#d9d9de', dark: false },
  { id: 'graphite', label: 'Graphite', bg: '#2c2c2e', dark: true },
  { id: 'ink', label: 'Ink', bg: '#050505', dark: true },
  { id: 'nocturne', label: 'Nocturne', bg: '#1a1b3a', dark: true },
  { id: 'nvidia', label: 'NVIDIA', bg: '#14210f', dark: true },
  { id: 'paper', label: 'Paper', bg: '#fafaf7', dark: false },
  { id: 'sand', label: 'Sand', bg: '#efe6d6', dark: false },
  { id: 'claude', label: 'Claude', bg: '#fbf7ee', dark: false },
  { id: 'cursor', label: 'Cursor', bg: '#f5f5f7', dark: false },
]

const ACCENTS = [
  { id: 'amethyst', hex: '#7132f5', label: 'Amethyst' },
  { id: 'blue', hex: '#2563eb', label: 'Cobalt' },
  { id: 'emerald', hex: '#10b981', label: 'Emerald' },
  { id: 'coral', hex: '#f43f5e', label: 'Coral' },
  { id: 'amber', hex: '#f59e0b', label: 'Amber' },
]

export default function StepProfile({ onNext, onBack }) {
  const { theme, setTheme, accentColor, setAccentColor, userProfile, updateUserProfile } = useApp()

  const [name, setName] = useState(userProfile?.name || 'Wayne')
  const [fullName, setFullName] = useState(userProfile?.full_name || 'Wayne Wayne')
  const [handle, setHandle] = useState(userProfile?.handle || '@wayne')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  // Initials calculation
  const initials = useMemo(() => {
    const trimmed = (name || 'User').trim()
    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return trimmed.slice(0, 2).toUpperCase() || 'U'
  }, [name])

  // Auto-generate handle when name changes if handle is default-like
  const handleNameChange = (val) => {
    setName(val)
    if (!handle || handle.startsWith('@')) {
      const slug = val.toLowerCase().replace(/[^a-z0-9]/g, '')
      setHandle(`@${slug || 'user'}`)
    }
  }

  const handleContinue = async () => {
    if (!name.trim()) {
      setError('Please enter a display name.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        full_name: fullName.trim() || name.trim(),
        handle: handle.trim().startsWith('@') ? handle.trim() : `@${handle.trim()}`,
      }
      await updateUserProfile?.(payload)
      await api.updateUserProfile?.(payload)
    } catch {
      // Continue even if local API call has minor network variance
    } finally {
      setSaving(false)
      onNext?.()
    }
  }

  return (
    <div className="onb-card">
      {/* Left Form Pane */}
      <div className="onb-pane-left">
        <AmethystLogo size={28} color="#ffffff" />
        <p className="onb-eyebrow">Step 1 of 5 · Profile</p>
        <h1 className="onb-title">Make it yours</h1>
        <p className="onb-desc">
          Tell Amethyst who you are and how it should look. Changes apply right away.
        </p>

        {error && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#ff8a80', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 'auto' }}>
          <div className="onb-nav-row">
            <button type="button" className="onb-btn-secondary" onClick={onBack}>
              Back
            </button>
            <button
              type="button"
              className="onb-btn-primary"
              style={{ background: accentColor || '#7132f5' }}
              disabled={saving}
              onClick={handleContinue}
            >
              <span>Continue</span>
              <Icon name="arrow-right" size={14} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      {/* Ticket Perforation Divider */}
      <div className="onb-perforation" aria-hidden="true" />

      {/* Right Content Pane */}
      <div className="onb-pane-right">
        {/* Profile Avatar & Names */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 14 }}>
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: 22,
              background: '#ffffff',
              color: '#1a1d3a',
              fontSize: 26,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {initials}
          </div>

          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="onb-label">Display name</label>
              <input
                type="text"
                className="onb-input"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Wayne"
              />
            </div>
            <div>
              <label className="onb-label">Full name</label>
              <input
                type="text"
                className="onb-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Wayne Wayne"
              />
            </div>
          </div>
        </div>

        {/* Handle */}
        <div style={{ marginBottom: 20 }}>
          <label className="onb-label">Handle</label>
          <input
            type="text"
            className="onb-input"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@wayne"
          />
        </div>

        {/* Theme Picker */}
        <p className="onb-section-header" style={{ margin: '18px 0 10px 4px' }}>Theme</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
          {THEMES.map((t) => {
            const isSelected = (theme || 'paper') === t.id
            return (
              <div
                key={t.id}
                onClick={() => setTheme?.(t.id)}
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  color: isSelected ? '#ffffff' : '#b4b8d6',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <div
                  style={{
                    height: 56,
                    borderRadius: 10,
                    background: t.bg,
                    boxShadow: isSelected
                      ? '0 0 0 2px #ffffff, 0 4px 12px rgba(0,0,0,0.3)'
                      : 'inset 0 0 0 1px rgba(255, 255, 255, 0.15)',
                    padding: 10,
                    boxSizing: 'border-box',
                    textAlign: 'left',
                    transition: 'box-shadow 0.15s ease-out, transform 0.12s ease-out',
                    transform: isSelected ? 'scale(1.03)' : 'scale(1)',
                  }}
                >
                  <i
                    style={{
                      display: 'block',
                      width: '60%',
                      height: 5,
                      borderRadius: 3,
                      background: t.dark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.2)',
                      marginBottom: 5,
                    }}
                  />
                  <i
                    style={{
                      display: 'block',
                      width: '40%',
                      height: 5,
                      borderRadius: 3,
                      background: t.dark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.2)',
                      marginBottom: 8,
                    }}
                  />
                  <i
                    style={{
                      display: 'block',
                      width: 28,
                      height: 7,
                      borderRadius: 4,
                      background: accentColor || '#7132f5',
                    }}
                  />
                </div>
                <div style={{ marginTop: 6, fontWeight: isSelected ? 600 : 400 }}>{t.label}</div>
              </div>
            )
          })}
        </div>

        {/* Accent Swatches */}
        <p className="onb-section-header" style={{ margin: '14px 0 10px 4px' }}>Accent</p>
        <div style={{ display: 'flex', gap: 14 }}>
          {ACCENTS.map((a) => {
            const isSelected = (accentColor || '#7132f5').toLowerCase() === a.hex.toLowerCase()
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccentColor?.(a.hex)}
                title={a.label}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: a.hex,
                  border: 0,
                  boxShadow: isSelected
                    ? '0 0 0 3px #1a1d3a, 0 0 0 5px #ffffff'
                    : 'inset 0 0 0 1px rgba(255, 255, 255, 0.25)',
                  cursor: 'pointer',
                  transform: isSelected ? 'scale(1.12)' : 'scale(1)',
                  transition: 'transform 0.12s ease-out, box-shadow 0.12s ease-out',
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

