import React, { useState, useEffect, useCallback } from 'react'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import { useApp } from '../../store.jsx'
import { api } from '../../api.js'

export default function StepMobile({ onNext, onBack, onSkip }) {
  const { accentColor } = useApp()
  const [tab, setTab] = useState('scan') // 'scan' | 'download'
  const [pairingData, setPairingData] = useState(null)
  const [qrSvg, setQrSvg] = useState('')
  const [downloadQrUrl, setDownloadQrUrl] = useState('')
  const [listening, setListening] = useState(true)

  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:8000' : window.location.origin
  const apkDownloadUrl = `${origin}/install`

  const startPairingSession = useCallback(async () => {
    try {
      const res = await api.startPairingV2?.()
      if (res?.ok) {
        setPairingData(res)
        if (res.qr_svg) {
          setQrSvg(res.qr_svg)
        }
      }
    } catch {
      // Non-blocking fallback for pairing server initialization
    }
  }, [])

  useEffect(() => {
    startPairingSession()

    // Generate download QR code
    api.converterGenerateQR?.({
      content: apkDownloadUrl,
      kind: 'png',
      scale: 4,
      border: 1,
    })
      .then((res) => {
        if (res?.data_url) setDownloadQrUrl(res.data_url)
      })
      .catch(() => {})

    return () => {
      api.cancelPairingV2?.().catch(() => {})
    }
  }, [startPairingSession, apkDownloadUrl])

  return (
    <div className="onb-card">
      {/* Left Pitch Pane */}
      <div className="onb-pane-left">
        <AmethystLogo size={28} color="#ffffff" />
        <p className="onb-eyebrow">Step 4 of 5 · Mobile</p>
        <h1 className="onb-title">Bring Amethyst to your phone</h1>
        <p className="onb-desc">
          Send things to your library from anywhere. Optional, and you can do it later.
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
              onClick={onNext}
            >
              <span>Continue</span>
              <Icon name="arrow-right" size={14} weight="bold" />
            </button>
          </div>

          <button type="button" className="onb-btn-skip" onClick={onSkip}>
            Pair later from Settings
          </button>
        </div>
      </div>

      {/* Ticket Perforation Divider */}
      <div className="onb-perforation" aria-hidden="true" />

      {/* Right Content Pane */}
      <div className="onb-pane-right">
        {/* Segmented Control Switcher */}
        <div
          style={{
            display: 'inline-flex',
            background: 'rgba(0, 0, 0, 0.25)',
            borderRadius: 10,
            padding: 3,
            marginBottom: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setTab('scan')}
            className={`onb-pill-btn ${tab === 'scan' ? 'on' : ''}`}
            style={{
              background: tab === 'scan' ? '#ffffff' : 'transparent',
              color: tab === 'scan' ? '#1a1d3a' : '#b4b8d6',
              fontWeight: tab === 'scan' ? 600 : 500,
            }}
          >
            Scan to pair
          </button>
          <button
            type="button"
            onClick={() => setTab('download')}
            className={`onb-pill-btn ${tab === 'download' ? 'on' : ''}`}
            style={{
              background: tab === 'download' ? '#ffffff' : 'transparent',
              color: tab === 'download' ? '#1a1d3a' : '#b4b8d6',
              fontWeight: tab === 'download' ? 600 : 500,
            }}
          >
            Download app
          </button>
        </div>

        {tab === 'scan' ? (
          /* Tab 1: Scan to Pair */
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            {/* QR Card */}
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 16,
                background: '#ffffff',
                padding: 10,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.3)',
                flexShrink: 0,
              }}
            >
              {qrSvg ? (
                <div
                  style={{ width: '100%', height: '100%' }}
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#1a1d3a' }}>
                  <Icon name="qr-code" size={48} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Port :8443</span>
                </div>
              )}
            </div>

            {/* Steps & Status */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#ffffff' }}>
                Scan with the Amethyst app
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', fontSize: 14 }}>
                <span className="onb-row-icon" style={{ width: 26, height: 26, borderRadius: '50%', fontSize: 12, fontWeight: 600 }}>
                  1
                </span>
                <span>Open Amethyst on your phone</span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', fontSize: 14 }}>
                <span className="onb-row-icon" style={{ width: 26, height: 26, borderRadius: '50%', fontSize: 12, fontWeight: 600 }}>
                  2
                </span>
                <span>Tap Pair with desktop</span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', fontSize: 14 }}>
                <span className="onb-row-icon" style={{ width: 26, height: 26, borderRadius: '50%', fontSize: 12, fontWeight: 600 }}>
                  3
                </span>
                <span>Point the camera at this code</span>
              </div>

              {/* Protocol Badge & Listening Radar */}
              <div className="onb-mono" style={{ margin: '14px 0 10px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#dfe5ff' }}>
                <Icon name="shield-check" size={15} />
                <span>LAN :8443 · AES-256 · cert-pinned</span>
              </div>

              <span className="onb-tag-pill" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#34d399',
                    boxShadow: '0 0 8px #34d399',
                    display: 'inline-block',
                  }}
                />
                <span>Listening for your phone…</span>
              </span>
            </div>
          </div>
        ) : (
          /* Tab 2: Download App */
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 16,
                background: '#ffffff',
                padding: 10,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.3)',
                flexShrink: 0,
              }}
            >
              {downloadQrUrl ? (
                <img src={downloadQrUrl} alt="Scan to download" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#1a1d3a' }}>
                  <Icon name="device-mobile" size={48} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Android APK</span>
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#ffffff' }}>
                Download Amethyst Companion
              </div>
              <p style={{ margin: '0 0 14px 0', fontSize: 13, color: '#b4b8d6', lineHeight: 1.5 }}>
                Scan the QR code with your phone camera or download directly to install the companion APK.
              </p>
              <a
                href={apkDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="onb-pill-btn"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '8px 18px',
                }}
              >
                <Icon name="download" size={14} />
                <span>Download APK (.apk)</span>
              </a>
            </div>
          </div>
        )}

        {/* Local Network Privacy Guarantee */}
        <p className="onb-bottom-caption">
          <Icon name="lock-key" size={14} color="#9ea3c4" />
          <span>Pairing happens over your local network. Nothing goes through a server.</span>
        </p>
      </div>
    </div>
  )
}
