import React, { useState, useEffect, useCallback } from 'react'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import AiProviderIcon from '../AiProviderIcon.jsx'
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

  // OpenRouter OAuth state
  const [openRouterConnecting, setOpenRouterConnecting] = useState(false)
  const [openRouterConnected, setOpenRouterConnected] = useState(false)
  const [openRouterError, setOpenRouterError] = useState(null)

  // API Key Providers state
  const [activeSlug, setActiveSlug] = useState('kilocode')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyStatus, setVerifyStatus] = useState(null) // null | { ok: boolean, msg: string }
  const [configuredProviders, setConfiguredProviders] = useState([])

  const apiKeyProviders = [
    {
      slug: 'kilocode',
      name: 'Kilo Code',
      defaultModel: 'kilo-auto/free',
    },
    {
      slug: 'nvidia',
      name: 'NVIDIA NIM',
      defaultModel: 'meta/llama-3.1-70b-instruct',
    },
    {
      slug: 'mistral',
      name: 'Mistral',
      defaultModel: 'mistral-large-latest',
    },
    {
      slug: 'groq',
      name: 'Groq',
      defaultModel: 'llama-3.3-70b-versatile',
    },
  ]

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
        const active = provRes.value.configured.filter((p) => p.has_key && p.enabled)
        setConfiguredProviders(active)
        if (active.some((p) => p.name === 'openrouter')) {
          setOpenRouterConnected(true)
        }
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

  // OpenRouter PKCE OAuth Flow
  const handleOpenRouterOAuth = async () => {
    setOpenRouterConnecting(true)
    setOpenRouterError(null)
    try {
      const redirectUri = typeof window !== 'undefined'
        ? `${window.location.origin}/api/auth/openrouter/callback`
        : 'http://localhost:8000/api/auth/openrouter/callback'

      const res = await api.startOpenRouterAuth(redirectUri)
      if (!res?.auth_url) {
        throw new Error('Unable to start OpenRouter OAuth session')
      }

      const width = 600
      const height = 700
      const left = window.screen.width / 2 - width / 2
      const top = window.screen.height / 2 - height / 2
      const popup = window.open(
        res.auth_url,
        'openrouter-auth',
        `toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${width},height=${height},top=${top},left=${left}`
      )

      const pollTimer = setInterval(async () => {
        try {
          if (res.state) {
            const pollRes = await api.pollOpenRouterAuth(res.state)
            if (pollRes?.status === 'completed') {
              clearInterval(pollTimer)
              if (popup && !popup.closed) popup.close()
              setOpenRouterConnected(true)
              setOpenRouterConnecting(false)
              scanEngines()
              return
            } else if (pollRes?.status === 'failed') {
              clearInterval(pollTimer)
              setOpenRouterConnecting(false)
              setOpenRouterError(pollRes.error || 'OpenRouter authentication failed')
              return
            }
          }
          if (popup && popup.closed) {
            clearInterval(pollTimer)
            setOpenRouterConnecting(false)
            scanEngines()
          }
        } catch {
          // Keep polling
        }
      }, 1000)

      const handleMsg = (e) => {
        if (e.data?.type === 'openrouter_auth_success') {
          clearInterval(pollTimer)
          window.removeEventListener('message', handleMsg)
          setOpenRouterConnected(true)
          setOpenRouterConnecting(false)
          scanEngines()
        }
      }
      window.addEventListener('message', handleMsg)
    } catch (err) {
      setOpenRouterConnecting(false)
      setOpenRouterError(err.message || 'Could not connect to OpenRouter')
    }
  }

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
    const provDef = apiKeyProviders.find((p) => p.slug === activeSlug)
    const defModel = provDef?.defaultModel

    try {
      const res = await api.verifyProvider?.(activeSlug, { api_key: key })
      if (res?.ok || res?.valid) {
        setVerifyStatus({ ok: true, msg: `Verified (${res.latency_ms || 120}ms)` })
        await api.addProvider({
          name: activeSlug,
          api_key: key,
          key: key,
          default_model: defModel,
        })
        scanEngines()
      } else {
        setVerifyStatus({ ok: false, msg: res?.error || res?.message || 'Invalid API key' })
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

  const isOpenRouterConfigured = openRouterConnected || configuredProviders.some((p) => p.name === 'openrouter')

  return (
    <div className="onb-card">
      {/* Left Form Pane */}
      <div className="onb-pane-left">
        <AmethystLogo size={28} color="#ffffff" />
        <p className="onb-eyebrow">Step 2 of 6 · AI engine</p>
        <h1 className="onb-title">Choose your AI engine</h1>
        <p className="onb-desc">
          Connect OpenRouter with 1-click for free models, add your preferred API keys, or run offline models.
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
      <div className="onb-pane-right" style={{ overflowY: 'auto' }}>
        {/* 1. Primary: OpenRouter OAuth */}
        <p className="onb-section-header">Primary · Recommended</p>
        <div className="onb-group" style={{ marginBottom: 16 }}>
          <div className="onb-row" style={{ minHeight: 56 }}>
            <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
              <AiProviderIcon provider="openrouter" size={20} />
            </div>
            <div className="onb-row-meta">
              OpenRouter
              <span>{isOpenRouterConfigured ? 'Connected · Free model auto-selected' : 'OAuth sign-in · Free cloud models'}</span>
            </div>
            {isOpenRouterConfigured ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="onb-tag-pill"
                  style={{
                    background: 'rgba(52, 211, 153, 0.15)',
                    color: '#34d399',
                    border: '1px solid rgba(52, 211, 153, 0.3)',
                    fontSize: 11,
                    padding: '3px 8px',
                  }}
                >
                  <Icon name="check" size={12} weight="bold" />
                  <span>Free Model</span>
                </span>
                <span
                  className="onb-pill-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    font: '500 11px JetBrains Mono, monospace',
                    minHeight: 32,
                    padding: '0 10px',
                    background: 'rgba(255, 255, 255, 0.08)',
                  }}
                >
                  cohere/north-mini-code:free
                </span>
              </div>
            ) : (
              <button
                type="button"
                className="onb-pill-btn"
                onClick={handleOpenRouterOAuth}
                disabled={openRouterConnecting}
                style={{
                  background: accentColor || '#7132f5',
                  color: '#ffffff',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: openRouterConnecting ? 'wait' : 'pointer',
                }}
              >
                {openRouterConnecting ? (
                  <>
                    <Icon name="loader" size={14} className="animate-spin" />
                    <span>Connecting…</span>
                  </>
                ) : (
                  <>
                    <Icon name="spark" size={14} />
                    <span>Connect with OpenRouter</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {openRouterError && (
          <div
            style={{
              fontSize: 12,
              margin: '-10px 4px 14px',
              color: '#f87171',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="warning-circle" size={14} />
            <span>{openRouterError}</span>
          </div>
        )}

        {/* 2. Middle: API Key Providers */}
        <p className="onb-section-header">API key providers</p>

        {/* API Key Quick Paste Bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="password"
            className="onb-input"
            style={{ height: 40 }}
            placeholder={`Paste API key for ${apiKeyProviders.find((c) => c.slug === activeSlug)?.name || 'provider'}`}
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
        <div className="onb-group" style={{ marginBottom: 16 }}>
          {apiKeyProviders.map((p) => {
            const isRowActive = activeSlug === p.slug
            const isConfigured = configuredProviders.some((cp) => cp.name === p.slug)
            return (
              <div
                key={p.slug}
                className="onb-row"
                onClick={() => {
                  setActiveSlug(p.slug)
                  setApiKeyInput('')
                  setVerifyStatus(null)
                }}
                style={{
                  cursor: 'pointer',
                  background: isRowActive ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                }}
              >
                <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
                  <AiProviderIcon provider={p.slug} size={20} />
                </div>
                <div className="onb-row-meta">
                  {p.name}
                  <span>{isConfigured ? 'Connected' : isRowActive ? 'Selected' : 'Available'}</span>
                </div>
                <span
                  className="onb-pill-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    font: '500 11px JetBrains Mono, monospace',
                    minHeight: 32,
                    padding: '0 12px',
                    background: 'rgba(255, 255, 255, 0.06)',
                  }}
                >
                  {p.defaultModel}
                </span>
              </div>
            )
          })}
        </div>

        {/* 3. Bottom: Local Ollama Section */}
        <p className="onb-section-header">On this {osName}</p>
        <div className="onb-group" style={{ marginBottom: 6 }}>
          <div className="onb-row">
            <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
              <AiProviderIcon provider="ollama" size={20} />
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
        <p style={{ fontSize: 12, color: '#9ea3c4', margin: '6px 4px 12px', lineHeight: 1.45 }}>
          Private · No API cost · Works offline
        </p>
      </div>
    </div>
  )
}
