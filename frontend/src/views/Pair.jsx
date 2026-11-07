import React, { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QrScanner from '../components/QrScanner.jsx'
import AmethystLogo from '../components/AmethystLogo.jsx'
import { decodeAndValidateQr, pairDevice } from '../mobile/pairingClient.js'
import { loadFixtureBundle } from '../mobile/bundle.js'
import '../mobile/companion.css'
import './pair.css'

const pageVariants = {
  enter: (dir) => ({
    opacity: 0,
    scale: 0.96,
    y: dir > 0 ? 14 : -14,
  }),
  center: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 380,
      damping: 30,
      mass: 0.8,
    },
  },
  exit: (dir) => ({
    opacity: 0,
    scale: 0.98,
    y: dir > 0 ? -10 : 10,
    transition: {
      duration: 0.18,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
}

export default function Pair({ onPaired, onBack, onDesktop, direction = 1 }) {
  // Phases: 'idle' | 'scanning' | 'connecting' | 'waiting_approval' | 'paired' | 'trouble'
  const [phase, setPhase] = useState('idle')
  const [trouble, setTrouble] = useState(null)
  const [loadingFixture, setLoadingFixture] = useState(false)

  const handleBack = () => {
    if (phase === 'scanning' || phase === 'trouble') {
      setPhase('idle')
      setTrouble(null)
      return
    }
    if (onBack) {
      onBack()
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    }
  }

  const handleScan = useCallback(async (raw) => {
    setTrouble(null)

    let qrPayload
    try {
      qrPayload = decodeAndValidateQr(raw)
    } catch (err) {
      setTrouble({
        title: err.code === 'EXPIRED_QR'
          ? 'That code has expired'
          : err.code === 'WRONG_VERSION'
            ? 'Unsupported pairing version'
            : 'Invalid QR code',
        body: err.message,
        retry: 'Scan new code',
      })
      setPhase('trouble')
      return
    }

    setPhase('connecting')
    try {
      await pairDevice({
        qrPayload,
        onStatusChange: (nextState) => {
          if (nextState === 'waiting_approval') {
            setPhase('waiting_approval')
          }
        },
      })

      setPhase('paired')
      setTimeout(() => onPaired?.(), 600)
    } catch (err) {
      const code = err.code || 'UNKNOWN'
      const port = err.port || qrPayload?.port
      const tried = err.triedSummary || (
        err.attempts?.length > 0
          ? err.attempts.map(a => `${a.host}:${a.port || port} (${a.message || a.errorType})`).join(', ')
          : qrPayload?.hosts?.map(h => `${h}:${port}`).join(', ')
      )

      let title = 'Connection Failed'
      let body = err.message || 'Could not complete pairing with PC.'
      let hint = null

      if (code === 'CONNECTION_REFUSED') {
        title = 'Connection Refused'
        body = `Could not connect to PC on port ${port}. The computer refused the connection.`
        hint = `Check that Amethyst is running on your PC, the pairing dialog is open, and your PC firewall allows port ${port}.`
      } else if (code === 'CONNECT_TIMEOUT') {
        title = 'Connection Timed Out'
        body = `Connection to your PC timed out on port ${port}.`
        hint = 'Make sure your phone and PC are connected to the same Wi-Fi network.'
      } else if (code === 'CERT_MISMATCH') {
        title = 'Security Verification Failed'
        body = 'TLS certificate does not match the pairing QR code.'
        hint = 'The certificate presented by the PC differs from the scanned QR code. Please close the PC pairing window and generate a new code.'
      } else if (code === 'TLS_ERROR') {
        title = 'Secure Handshake Failed'
        body = 'Could not establish a secure TLS connection with the PC.'
        hint = 'Verify your PC local network settings, then try scanning a fresh QR code.'
      } else if (code === 'DENIED') {
        title = 'Pairing Denied'
        body = 'Pairing was denied on your PC.'
        hint = "Click 'Add' in Amethyst on your PC to start a new pairing session."
      } else if (code === 'APPROVAL_TIMEOUT') {
        title = 'Approval Timed Out'
        body = 'Approval timed out on your PC.'
        hint = "The pairing window expired before approval was granted. Try again."
      } else if (code === 'TOO_MANY_ATTEMPTS') {
        title = 'Pairing Locked Out'
        body = 'Too many failed pairing attempts (HTTP 429).'
        hint = 'Please close and reopen the pairing dialog on your PC.'
      } else if (code === 'INVALID_TOKEN') {
        title = 'Invalid or Expired Token'
        body = 'The pairing token was rejected or already used.'
        hint = 'Please scan a fresh QR code from your PC.'
      } else {
        hint = `Ensure phone and PC are on the same Wi-Fi network and firewall allows port ${port}.`
      }

      setTrouble({
        title,
        body,
        hint,
        tried: ['DENIED', 'APPROVAL_TIMEOUT', 'TOO_MANY_ATTEMPTS', 'INVALID_TOKEN'].includes(code) ? null : tried,
        retry: 'Try again',
      })
      setPhase('trouble')
    }
  }, [onPaired])

  const handleLoadFixture = async () => {
    if (loadingFixture) return
    setLoadingFixture(true)
    try {
      await loadFixtureBundle()
      setPhase('paired')
      setTimeout(() => onPaired?.(), 500)
    } finally {
      setLoadingFixture(false)
    }
  }

  return (
    <motion.div
      className="m-shell s"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 480,
        height: '100dvh',
        margin: '0 auto',
        overflow: 'hidden',
        background: '#F2F2F7',
        display: 'flex',
        flexDirection: 'column',
      }}
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.8 }}
    >
      {/* Background radial gradient from Pair.dc.html */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(90% 40% at 50% 0%, #D6E6FF 0%, rgba(214,230,255,0) 75%), radial-gradient(70% 30% at 100% 100%, #FFD9C2 0%, rgba(255,217,194,0) 70%), #F2F2F7',
          pointerEvents: 'none',
        }}
      />

      {/* Subtle Noise Texture */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', mixBlendMode: 'soft-light', opacity: 0.5, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <filter id="pair-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#pair-noise)" />
      </svg>

      <div
        className="b"
        style={{
          flex: 1,
          padding: 'max(20px, env(safe-area-inset-top, 20px)) 20px max(32px, env(safe-area-inset-bottom, 32px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Header Bar */}
        <div className="r sp">
          <button
            type="button"
            className="ib"
            aria-label="Back"
            onClick={handleBack}
            style={{ cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="r" style={{ gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.25)' }} />
            <motion.span
              layoutId="stepper-active"
              style={{ width: 22, height: 6, borderRadius: 3, background: '#1D1D1F' }}
              transition={{ type: 'spring', stiffness: 350, damping: 26 }}
            />
          </div>
          <span style={{ width: 44 }} />
        </div>

        {/* Title & Instructions */}
        <div style={{ marginTop: 6 }}>
          <h1 className="h" style={{ fontSize: 'clamp(30px, 8vw, 36px)', lineHeight: 1.05, margin: 0 }}>
            Connect your PC
          </h1>
          <p style={{ margin: '8px 0 0', color: '#3A3A3C', fontSize: 14.5, lineHeight: 1.45, maxWidth: 320 }}>
            Open Amethyst on your PC, go to Settings, then Phone, and scan the code it shows.
          </p>
        </div>

        {/* Viewfinder Box / Scanning Area (Constrained 300px Card) */}
        <div
          style={{
            height: 300,
            borderRadius: 36,
            background: '#0B0B0C',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 6,
            overflow: 'hidden',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.16)',
          }}
        >
          {phase === 'scanning' ? (
            <QrScanner inline onScan={handleScan} onCancel={() => setPhase('idle')} />
          ) : phase === 'connecting' ? (
            <div className="col" style={{ alignItems: 'center', color: '#fff', gap: 12 }}>
              <span className="spn" style={{ width: 26, height: 26, borderColor: '#3A3A3E', borderTopColor: '#fff' }} />
              <div style={{ fontWeight: 600, fontSize: 15 }}>Connecting to PC…</div>
              <div className="m" style={{ color: '#A1A1A6' }}>Establishing secure connection</div>
            </div>
          ) : phase === 'waiting_approval' ? (
            <div className="col" style={{ alignItems: 'center', color: '#fff', gap: 12, padding: 20 }}>
              <span className="spn" style={{ width: 26, height: 26, borderColor: '#3A3A3E', borderTopColor: '#0071E3' }} />
              <div style={{ fontWeight: 600, fontSize: 15 }}>Waiting for approval…</div>
              <div className="m" style={{ color: '#A1A1A6', textAlign: 'center', maxWidth: 220 }}>
                Click Approve on your computer screen
              </div>
            </div>
          ) : phase === 'paired' ? (
            <div className="col" style={{ alignItems: 'center', color: '#fff', gap: 12 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#34C759', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Connected</div>
            </div>
          ) : phase === 'trouble' ? (
            <div className="col" style={{ alignItems: 'center', color: '#fff', gap: 8, padding: 20, textAlign: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#B8430F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" x2="12" y1="8" y2="12" />
                  <line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
              </div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{trouble?.title || 'Connection Failed'}</div>
              <div className="m" style={{ color: '#A1A1A6', fontSize: 12.5, maxWidth: 260 }}>{trouble?.body}</div>
            </div>
          ) : (
            <>
              {/* Authentic Amethyst Crystal Logo in Center */}
              <AmethystLogo size={64} color="#873FFF" style={{ opacity: 0.95 }} />

              {/* Viewfinder Corners from Pair.dc.html */}
              <svg width="220" height="220" viewBox="0 0 220 220" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
                <path d="M10 50V20a10 10 0 0 1 10-10h30M170 10h30a10 10 0 0 1 10 10v30M210 170v30a10 10 0 0 1-10 10h-30M50 210H20a10 10 0 0 1-10-10v-30" />
              </svg>
              <span className="m" style={{ position: 'absolute', bottom: 18, color: '#A1A1A6', fontSize: 12.5 }}>
                Point the camera at the code
              </span>
            </>
          )}
        </div>

        {/* Bottom Actions Area */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {phase === 'scanning' ? (
            <button
              type="button"
              className="bt"
              style={{ width: '100%', justifyContent: 'center', minHeight: 52, fontSize: 15 }}
              onClick={() => setPhase('idle')}
            >
              Cancel scanning
            </button>
          ) : phase === 'trouble' ? (
            <button
              type="button"
              className="bt"
              style={{ width: '100%', justifyContent: 'center', minHeight: 52, fontSize: 15 }}
              onClick={() => setPhase('scanning')}
            >
              {trouble?.retry || 'Scan code again'}
            </button>
          ) : (
            <button
              type="button"
              className="bt"
              style={{ width: '100%', justifyContent: 'space-between', minHeight: 52, padding: '0 24px', fontSize: 15 }}
              onClick={() => setPhase('scanning')}
            >
              <span>Scan code</span>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          )}

          {phase === 'idle' && (
            <button
              type="button"
              className="bt glass"
              style={{
                width: '100%',
                minHeight: 50,
                fontSize: 15,
                fontWeight: 600,
              }}
              onClick={handleLoadFixture}
              disabled={loadingFixture}
            >
              {loadingFixture ? 'Loading…' : 'Enter code instead'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
