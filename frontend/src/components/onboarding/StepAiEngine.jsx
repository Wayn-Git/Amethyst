import React, { useState, useEffect, useCallback } from 'react'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import { getClientOS } from './clientOS.js'
import { useApp } from '../../store.jsx'
import { api } from '../../api.js'

export default function StepAiEngine({ onNext, onBack, onSkip }) {
  const { accentColor } = useApp()
  const osName = getClientOS()

  // Detection & Providers state
  const [ollamaDetected, setOllamaDetected] = useState(false)
  const [ollamaModels, setOllamaModels] = useState([])
  const [selectedOllamaModel, setSelectedOllamaModel] = useState('')
  const [probing, setProbing] = useState(true)

  // Cloud Providers state
  const [activeSlug, setActiveSlug] = useState('groq')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyStatus, setVerifyStatus] = useState(null) // null | { ok: boolean, msg: string }
  const [configuredProviders, setConfiguredProviders] = useState([])

  // Probe Ollama & Providers
  const scanEngines = useCallback(async () => {
    setProbing(true)
    try {
      const [detectRes, provRes] = await Promise.allSettled([
        api.detectModels?.(),
        api.providers?.(),
      ])

      if (detectRes.status === 'fulfilled' && detectRes.value?.detections) {
        const ollamaHit = detectRes.value.detections.find((d) => d.slug === 'ollama' || d.type === 'ollama')
        if (ollamaHit) {
          setOllamaDetected(true)
          const models = ollamaHit.models || ['llama3.2:3b', 'qwen2.5:7b', 'mistral:7b']
          setOllamaModels(models)
          setSelectedOllamaModel(models[0] || 'llama3.2:3b')
        }
      }

      if (provRes.status === 'fulfilled' && provRes.value?.configured) {
        setConfiguredProviders(provRes.value.configured.filter((p) => p.has_key && p.enabled))
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setProbing(false)
    }
  }, [])

  useEffect(() => {
    scanEngines()
  }, [scanEngines])

  // Paste from clipboard accelerator
  const handlePaste = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text) {
          setApiKeyInput(text.trim())
          autoVerifyKey(text.trim())
        }
      }
    } catch {
      // Ignore clipboard permission refuse
    }
  }

  const autoVerifyKey = async (key) => {
    if (!key || key.length < 8) return
    setVerifying(true)
    setVerifyStatus(null)
    try {
      const res = await api.verifyProvider?.(activeSlug, { api_key: key })
      if (res?.ok) {
        setVerifyStatus({ ok: true, msg: `Verified (${res.latency_ms || 120}ms)` })
        await api.saveKey?.(activeSlug, key)
      } else {
        setVerifyStatus({ ok: false, msg: res?.error || 'Invalid API key' })
      }
    } catch (err) {
      setVerifyStatus({ ok: false, msg: err.message || 'Key check failed' })
    } finally {
      setVerifying(false)
    }
  }

  const handleContinue = () => {
    onNext?.()
  }

  const cloudList = [
    {
      slug: 'groq',
      name: 'Groq',
      letter: 'G',
      defaultModel: 'llama-3.3-70b-versatile',
      models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    },
    {
      slug: 'google',
      name: 'Google Gemini',
      letter: 'G',
      defaultModel: 'gemini-2.0-flash',
      models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    },
    {
      slug: 'kilocode',
      name: 'Kilo Code',
      letter: 'K',
      defaultModel: 'kilo-auto/free',
      models: ['kilo-auto/free'],
    },
  ]

  return (
    <div className="onb-card">
      {/* Left Form Pane */}
      <div className="onb-pane-left">
        <AmethystLogo size={28} color="#ffffff" />
        <p className="onb-eyebrow">Step 2 of 5 · AI engine</p>
        <h1 className="onb-title">Choose your AI engine</h1>
        <p className="onb-desc">
          Run a model on this {osName}, or connect a free cloud provider. You can add more later.
        </p>

        <div style={{ marginTop: 'auto' }}>
          <div className="onb-nav-row">
            <button type="button" className="onb-btn-secondary" onClick={onBack}>
              Back
            </button>
            <button
              type="button"
              className="onb-btn-primary"
              style={{ background: accentColor || '#7132f5' }}
              onClick={handleContinue}
            >
              <span>Continue</span>
              <Icon name="arrow-right" size={14} weight="bold" />
            </button>
          </div>

          <button type="button" className="onb-btn-skip" onClick={onSkip}>
            Skip for now
          </button>
        </div>
      </div>

      {/* Ticket Perforation Divider */}
      <div className="onb-perforation" aria-hidden="true" />

      {/* Right Content Pane */}
      <div className="onb-pane-right">
        {/* Local Ollama Section */}
        <p className="onb-section-header">On this {osName}</p>
        <div className="onb-group" style={{ marginBottom: 6 }}>
          <div className="onb-row">
            <div className="onb-row-icon">
              <Icon name="cpu" size={18} />
            </div>
            <div className="onb-row-meta">
              Ollama
              <span className="onb-mono">localhost:11434/v1</span>
            </div>
            <span className="onb-tag">
              {probing
                ? 'Scanning…'
                : ollamaDetected
                ? `Found on this ${osName}`
                : 'Offline · Optional'}
            </span>
          </div>

          {ollamaDetected && ollamaModels.length > 0 && (
            <div style={{ padding: '0 14px 14px' }}>
              <div
                style={{
                  display: 'flex',
                  background: 'rgba(0, 0, 0, 0.25)',
                  borderRadius: 10,
                  padding: 3,
                  gap: 4,
                }}
              >
                {ollamaModels.slice(0, 3).map((m) => {
                  const isModelSelected = selectedOllamaModel === m
                  return (
                    <span
                      key={m}
                      onClick={() => setSelectedOllamaModel(m)}
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        fontSize: 12,
                        padding: '7px 4px',
                        borderRadius: 8,
                        color: isModelSelected ? '#1a1d3a' : '#b4b8d6',
                        background: isModelSelected ? '#ffffff' : 'transparent',
                        fontWeight: isModelSelected ? 600 : 400,
                        cursor: 'pointer',
                        userSelect: 'none',
                        transition: 'all 0.12s ease-out',
                      }}
                    >
                      {m}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <p style={{ fontSize: 12, color: '#9ea3c4', margin: '6px 4px 18px', lineHeight: 1.45 }}>
          Private · No API cost · Works offline
        </p>

        {/* Free Cloud Providers Section */}
        <p className="onb-section-header" style={{ marginTop: 12 }}>Free cloud providers</p>

        {/* API Key Quick Paste Bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="password"
            className="onb-input"
            style={{ height: 40 }}
            placeholder={`Paste API key for ${cloudList.find((c) => c.slug === activeSlug)?.name || 'cloud provider'}`}
            value={apiKeyInput}
            onChange={(e) => {
              setApiKeyInput(e.target.value)
              autoVerifyKey(e.target.value)
            }}
          />
          <button
            type="button"
            className="onb-pill-btn"
            style={{ minHeight: 40, whiteSpace: 'nowrap' }}
            onClick={handlePaste}
          >
            Paste
          </button>
        </div>

        {verifyStatus && (
          <div
            style={{
              fontSize: 12,
              marginBottom: 10,
              color: verifyStatus.ok ? '#34d399' : '#f87171',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name={verifyStatus.ok ? 'check' : 'warning-circle'} size={14} />
            <span>{verifyStatus.msg}</span>
          </div>
        )}

        {/* Provider List Rows */}
        <div className="onb-group">
          {cloudList.map((p) => {
            const isRowActive = activeSlug === p.slug
            const isConfigured = configuredProviders.some((cp) => cp.name === p.slug)
            return (
              <div
                key={p.slug}
                className="onb-row"
                onClick={() => setActiveSlug(p.slug)}
                style={{
                  cursor: 'pointer',
                  background: isRowActive ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                }}
              >
                <div className="onb-row-icon">
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{p.letter}</span>
                </div>
                <div className="onb-row-meta">
                  {p.name}
                  <span>{isConfigured ? 'Connected' : isRowActive ? 'Selected' : 'Available'}</span>
                </div>
                <button
                  type="button"
                  className="onb-pill-btn"
                  style={{
                    display: 'inline-flex',
                    gap: 8,
                    alignItems: 'center',
                    font: '500 11px JetBrains Mono, monospace',
                    minHeight: 34,
                    padding: '0 12px',
                  }}
                >
                  <span>{p.defaultModel}</span>
                  <Icon name="caret-down" size={12} weight="bold" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
