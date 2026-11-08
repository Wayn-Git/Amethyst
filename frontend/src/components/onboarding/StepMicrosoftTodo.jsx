import React, { useState, useEffect, useCallback, useRef } from 'react'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import BrandIcon from './BrandIcon.jsx'
import { useApp } from '../../store.jsx'
import { api } from '../../api.js'

export default function StepMicrosoftTodo({ onNext, onBack, onSkip }) {
  const { accentColor, toast } = useApp()

  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [userCode, setUserCode] = useState('')
  const [verificationUri, setVerificationUri] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const pollIntervalRef = useRef(null)
  const pollAttemptRef = useRef(0)

  // Check initial connection status
  const checkStatus = useCallback(async () => {
    try {
      const res = await api.microsoftStatus?.()
      if (res?.connected) {
        setConnected(true)
      }
    } catch {
      // Non-blocking fallback
    }
  }, [])

  useEffect(() => {
    checkStatus()

    // Listen for OAuth popup completion postMessage if PKCE flow used
    const onMessage = (event) => {
      if (event.data?.type === 'microsoft_auth_success') {
        setConnected(true)
        setConnecting(false)
        setUserCode('')
        api.syncTasks?.().catch(() => {})
      }
    }
    window.addEventListener('message', onMessage)

    return () => {
      window.removeEventListener('message', onMessage)
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [checkStatus])

  // Initiate Microsoft Device Code Login
  const handleSignIn = async () => {
    const attempt = ++pollAttemptRef.current
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    setConnecting(true)
    setError('')
    setCopied(false)

    try {
      // 1. Start device code authorization
      const res = await api.startMicrosoftDeviceAuth?.()
      if (attempt !== pollAttemptRef.current) return

      if (res?.user_code && res?.device_code) {
        setUserCode(res.user_code)
        const targetUri = res.verification_uri || 'https://login.microsoft.com/device'
        setVerificationUri(targetUri)

        // Open verification URL in browser automatically
        if (typeof window !== 'undefined') {
          window.open(targetUri, '_blank', 'noopener,noreferrer')
        }

        // 2. Poll device code status
        const intervalSec = Math.max(res.interval || 5, 3)
        let checking = false

        pollIntervalRef.current = setInterval(async () => {
          if (checking || attempt !== pollAttemptRef.current) return
          checking = true
          try {
            const pollRes = await api.pollMicrosoftDeviceAuth?.(res.device_code)
            if (attempt !== pollAttemptRef.current) return

            if (pollRes?.connected) {
              clearInterval(pollIntervalRef.current)
              setConnected(true)
              setConnecting(false)
              setUserCode('')
              toast?.('Microsoft To Do connected! Syncing tasks…', 'ok')

              // Trigger immediate task sync
              await api.syncTasks?.().catch(() => {})
              window.dispatchEvent(new CustomEvent('dashboard-items-changed'))
            } else if (pollRes?.status === 'expired' || pollRes?.status === 'failed') {
              clearInterval(pollIntervalRef.current)
              setConnecting(false)
              setUserCode('')
              setError(pollRes.error || 'Authentication session expired. Try signing in again.')
            }
          } catch (pollErr) {
            // Ignore transient network hiccups while polling
          } finally {
            checking = false
          }
        }, intervalSec * 1000)
      } else {
        // Fallback to web PKCE flow if device endpoint unavailable
        const pkceRes = await api.startMicrosoftAuth?.()
        if (pkceRes?.auth_url && typeof window !== 'undefined') {
          window.open(pkceRes.auth_url, '_blank', 'width=600,height=700')
          if (pkceRes.state) {
            pollIntervalRef.current = setInterval(async () => {
              const st = await api.pollMicrosoftAuth?.(pkceRes.state)
              if (st?.connected) {
                clearInterval(pollIntervalRef.current)
                setConnected(true)
                setConnecting(false)
                api.syncTasks?.().catch(() => {})
              }
            }, 2000)
          }
        }
      }
    } catch (err) {
      if (attempt !== pollAttemptRef.current) return
      setConnecting(false)
      setError(err.message || 'Could not reach Microsoft authentication server.')
    }
  }

  const handleCopyCode = async () => {
    if (!userCode) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(userCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      }
    } catch {
      // Ignore clipboard write rejection
    }
  }

  const handleOpenLoginUrl = () => {
    const target = verificationUri || 'https://login.microsoft.com/device'
    if (typeof window !== 'undefined') {
      window.open(target, '_blank', 'noopener,noreferrer')
    }
  }

  const handleContinue = async () => {
    if (connected) {
      await api.syncTasks?.().catch(() => {})
    }
    onNext?.()
  }

  return (
    <div className="onb-card">
      {/* Left Pitch Pane */}
      <div className="onb-pane-left">
        <AmethystLogo size={28} color="#ffffff" />
        <p className="onb-eyebrow">Step 4 of 6 · Tasks</p>
        <h1 className="onb-title">Connect Microsoft To Do</h1>
        <p className="onb-desc">
          Amethyst uses Microsoft To Do for your tasks. Sign in to use it, or add it later.
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
        {/* Account Section */}
        <p className="onb-section-header">Account</p>
        <div className="onb-group" style={{ marginBottom: 20 }}>
          <div className="onb-row">
            <div
              className="onb-row-icon"
              style={{
                background: 'rgba(36, 65, 255, 0.14)',
                color: '#2441ff',
              }}
            >
              <BrandIcon name="microsoft-todo" size={18} color="#2441ff" />
            </div>
            <div className="onb-row-meta">
              Microsoft To Do
              <span>
                {connected
                  ? 'Connected · Synced across desktop & phone'
                  : userCode
                  ? 'Enter code on login.microsoft.com/device'
                  : connecting
                  ? 'Connecting to Microsoft…'
                  : 'Sign in with your Microsoft account'}
              </span>
            </div>

            {connected ? (
              <span className="onb-tag" style={{ color: '#34d399' }}>
                <Icon name="check" size={14} />
                <span>Connected</span>
              </span>
            ) : userCode ? (
              <button
                type="button"
                className="onb-pill-btn"
                style={{
                  background: accentColor || '#7132f5',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 12,
                  minHeight: 34,
                  padding: '0 14px',
                }}
                onClick={handleOpenLoginUrl}
              >
                <span>Open Login ↗</span>
              </button>
            ) : (
              <button
                type="button"
                className="onb-pill-btn"
                style={{
                  background: '#ffffff',
                  color: '#1a1d3a',
                  fontWeight: 600,
                  fontSize: 13,
                  minHeight: 36,
                  padding: '0 16px',
                }}
                disabled={connecting}
                onClick={handleSignIn}
              >
                {connecting ? 'Signing in…' : 'Sign in'}
              </button>
            )}
          </div>

          {/* Dynamic Device Code Card when Code is issued */}
          {userCode && !connected && (
            <div style={{ padding: '0 14px 14px' }}>
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.35)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#dfe5ff' }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#38bdf8',
                        boxShadow: '0 0 8px #38bdf8',
                        display: 'inline-block',
                      }}
                    />
                    <span>Enter this code in Microsoft to authenticate:</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="onb-pill-btn"
                    style={{
                      minHeight: 28,
                      padding: '0 12px',
                      fontSize: 11,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: copied ? 'rgba(52, 211, 153, 0.25)' : 'rgba(255, 255, 255, 0.15)',
                      color: copied ? '#34d399' : '#ffffff',
                    }}
                  >
                    <Icon name={copied ? 'check' : 'copy'} size={12} />
                    <span>{copied ? 'Copied' : 'Copy code'}</span>
                  </button>
                </div>

                {/* Big Code Pill */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255, 255, 255, 0.06)',
                    borderRadius: 8,
                    padding: '8px 16px',
                    letterSpacing: '0.22em',
                    fontSize: 22,
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    color: '#ffffff',
                    userSelect: 'all',
                  }}
                >
                  {userCode}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: '#9ea3c4',
                  }}
                >
                  <span>Opened {verificationUri || 'login.microsoft.com/device'} in browser</span>
                  <a
                    href={verificationUri || 'https://login.microsoft.com/device'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#dfe5ff', textDecoration: 'none', fontWeight: 500 }}
                  >
                    Reopen link ↗
                  </a>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                fontSize: 12,
                color: '#f87171',
                padding: '0 14px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="warning-circle" size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* What it powers Section */}
        <p className="onb-section-header">What it powers</p>
        <div className="onb-group" style={{ marginBottom: 8 }}>
          {/* 1. Today */}
          <div className="onb-row">
            <div className="onb-row-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l3 3 5-6" />
              </svg>
            </div>
            <div className="onb-row-meta">Today</div>
          </div>

          {/* 2. Backlog */}
          <div className="onb-row">
            <div className="onb-row-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </div>
            <div className="onb-row-meta">Backlog</div>
          </div>

          {/* 3. Deadlines */}
          <div className="onb-row">
            <div className="onb-row-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
              </svg>
            </div>
            <div className="onb-row-meta">Deadlines</div>
          </div>

          {/* 4. Reminders */}
          <div className="onb-row">
            <div className="onb-row-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8zM10 21h4" />
              </svg>
            </div>
            <div className="onb-row-meta">Reminders</div>
          </div>
        </div>

        <p style={{ fontSize: 12, color: '#9ea3c4', margin: '8px 4px 0', lineHeight: 1.45 }}>
          Tasks stay empty until you connect.
        </p>

        {/* Bottom Caption */}
        <p className="onb-bottom-caption">
          <Icon name="lock-key" size={14} color="#9ea3c4" />
          <span>You can connect this later from Settings.</span>
        </p>
      </div>
    </div>
  )
}

