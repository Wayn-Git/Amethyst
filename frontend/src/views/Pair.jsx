import React, { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QrScanner from '../components/QrScanner.jsx'
import { decodeAndValidateQr, pairDevice } from '../mobile/pairingClient.js'
import '../mobile/companion.css'

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

export default function Pair({ onPaired, onBack, onSkip, onEnterCode, direction = 1 }) {
  // Phases: 'idle' | 'scanning' | 'connecting' | 'waiting_approval' | 'paired' | 'trouble'
  const [phase, setPhase] = useState('idle')
  const [trouble, setTrouble] = useState(null)

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

      if (code === 'CONNECTION_REFUSED') {
        title = 'Connection Refused'
        body = `Could not connect to PC on port ${port}. Computer refused connection.`
      } else if (code === 'CONNECT_TIMEOUT') {
        title = 'Connection Timed Out'
        body = 'Make sure phone and PC are connected to the same Wi-Fi network.'
      } else if (code === 'DENIED') {
        title = 'Pairing Denied'
        body = 'Pairing was denied on your PC.'
      } else if (code === 'APPROVAL_TIMEOUT') {
        title = 'Approval Timed Out'
        body = 'Pairing window expired before approval was granted.'
      }

      setTrouble({
        title,
        body,
        retry: 'Try again',
      })
      setPhase('trouble')
    }
  }, [onPaired])

  return (
    <motion.div
      className="m-shell"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 480,
        height: '100dvh',
        margin: '0 auto',
        overflow: 'hidden',
        boxSizing: 'border-box',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        color: '#0F0F12',
        background: 'radial-gradient(90% 38% at 12% 0%, rgba(86,92,255,0.75) 0%, rgba(86,92,255,0) 75%), radial-gradient(70% 30% at 100% 6%, rgba(255,160,186,0.9) 0%, rgba(255,160,186,0) 75%), linear-gradient(180deg,#C9CBFF 0%,#EEF0FF 30%,#FFFFFF 52%,#FFFFFF 100%)',
        display: 'flex',
        flexDirection: 'column',
      }}
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
    >
      {/* Top Navigation Bar */}
      <div
        style={{
          position: 'absolute',
          left: 20,
          right: 20,
          top: 'max(48px, calc(env(safe-area-inset-top, 24px) + 20px))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 10,
        }}
      >
        <motion.button
          type="button"
          aria-label="Back"
          onClick={handleBack}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.9)',
            border: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 6px 18px rgba(40, 40, 160, 0.18)',
            cursor: 'pointer',
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </motion.button>
        <motion.button
          type="button"
          onClick={onSkip}
          style={{
            height: 44,
            padding: '0 12px',
            background: 'transparent',
            border: 0,
            display: 'flex',
            alignItems: 'center',
            fontSize: 16,
            fontWeight: 700,
            color: '#0F0F12',
            cursor: 'pointer',
          }}
          whileHover={{ opacity: 0.7 }}
          whileTap={{ scale: 0.94 }}
        >
          Skip
        </motion.button>
      </div>

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          left: 32,
          right: 32,
          top: 'max(110px, calc(env(safe-area-inset-top, 24px) + 70px))',
          textAlign: 'center',
          zIndex: 10,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'clamp(32px, 8.5vw, 40px)', lineHeight: 1.04, fontWeight: 800, letterSpacing: '-0.045em', color: '#2D2DEB' }}>
          Connect<br />your PC
        </h1>
        <p style={{ margin: '14px auto 0', maxWidth: 300, fontSize: 15, lineHeight: 1.45, color: '#16161C' }}>
          Open Amethyst on your PC, go to <b>Settings</b>, then <b>Phone</b>, and scan the code it shows.
        </p>
      </div>

      {/* Viewfinder Card */}
      <div
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          top: 'max(260px, calc(env(safe-area-inset-top, 24px) + 210px))',
          height: 268,
          borderRadius: 32,
          background: '#0B0B0E',
          boxShadow: '0 24px 50px rgba(15, 15, 60, 0.3)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        {phase === 'scanning' ? (
          <QrScanner inline onScan={handleScan} onCancel={() => setPhase('idle')} />
        ) : phase === 'connecting' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#fff' }}>
            <span className="spn" style={{ width: 28, height: 28, borderColor: '#3A3A3E', borderTopColor: '#5B9BFF' }} />
            <div style={{ fontWeight: 600, fontSize: 15 }}>Connecting to PC…</div>
          </div>
        ) : phase === 'waiting_approval' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#fff', padding: 20, textAlign: 'center' }}>
            <span className="spn" style={{ width: 28, height: 28, borderColor: '#3A3A3E', borderTopColor: '#2D2DEB' }} />
            <div style={{ fontWeight: 600, fontSize: 16 }}>Waiting for approval…</div>
            <div style={{ color: '#B4B7C2', fontSize: 13, maxWidth: 220 }}>Click Approve on your computer screen</div>
          </div>
        ) : phase === 'paired' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#fff' }}>
            <div style={{ width: 52, height: 52, borderRadius: 999, background: '#22A559', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Connected</div>
          </div>
        ) : phase === 'trouble' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#fff', padding: 20, textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 999, background: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{trouble?.title || 'Connection Failed'}</div>
            <div style={{ color: '#B4B7C2', fontSize: 13, maxWidth: 260 }}>{trouble?.body}</div>
          </div>
        ) : (
          <>
            {/* Viewfinder Corners from Connect.dc.html */}
            <div style={{ position: 'absolute', left: 44, top: 40, width: 36, height: 36, borderLeft: '3px solid #fff', borderTop: '3px solid #fff', borderTopLeftRadius: 14 }} />
            <div style={{ position: 'absolute', right: 44, top: 40, width: 36, height: 36, borderRight: '3px solid #fff', borderTop: '3px solid #fff', borderTopRightRadius: 14 }} />
            <div style={{ position: 'absolute', left: 44, bottom: 64, width: 36, height: 36, borderLeft: '3px solid #fff', borderBottom: '3px solid #fff', borderBottomLeftRadius: 14 }} />
            <div style={{ position: 'absolute', right: 44, bottom: 64, width: 36, height: 36, borderRight: '3px solid #fff', borderBottom: '3px solid #fff', borderBottomRightRadius: 14 }} />

            {/* Glowing Laser Scan Line */}
            <motion.div
              style={{
                position: 'absolute',
                left: 60,
                right: 60,
                height: 2,
                borderRadius: 2,
                background: 'linear-gradient(90deg, rgba(91,155,255,0), #7B7BFF, rgba(91,155,255,0))',
              }}
              animate={{ y: [-40, 40, -40] }}
              transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
            />

            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 24, textAlign: 'center', fontSize: 13, color: '#B4B7C2' }}>
              Point the camera at the code
            </div>
          </>
        )}
      </div>

      {/* Status Row */}
      <div
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          top: 'max(544px, calc(env(safe-area-inset-top, 24px) + 494px))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontSize: 14,
          color: '#3A3C47',
          zIndex: 10,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: phase === 'trouble' ? '#EF4444' : '#2D2DEB', display: 'inline-block' }} />
        <span>{phase === 'scanning' ? 'Scanning QR code…' : phase === 'trouble' ? 'Connection trouble' : 'Waiting for your PC'}</span>
      </div>

      {/* Bottom Action Buttons */}
      <motion.div
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          bottom: 'max(36px, env(safe-area-inset-bottom, 24px))',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          zIndex: 10,
        }}
      >
        {phase === 'scanning' ? (
          <motion.button
            type="button"
            onClick={() => setPhase('idle')}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              height: 56,
              border: 0,
              borderRadius: 14,
              background: '#0F0F12',
              color: '#fff',
              fontSize: 17,
              fontWeight: 700,
              boxShadow: '0 14px 30px rgba(15,15,18,0.25)',
              cursor: 'pointer',
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
          >
            Cancel scanning
          </motion.button>
        ) : phase === 'trouble' ? (
          <motion.button
            type="button"
            onClick={() => setPhase('scanning')}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              height: 56,
              border: 0,
              borderRadius: 14,
              background: '#2D2DEB',
              color: '#fff',
              fontSize: 17,
              fontWeight: 700,
              boxShadow: '0 14px 30px rgba(45,45,235,0.35)',
              cursor: 'pointer',
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
          >
            {trouble?.retry || 'Scan code again'}
          </motion.button>
        ) : (
          <motion.button
            type="button"
            onClick={() => setPhase('scanning')}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              height: 56,
              border: 0,
              borderRadius: 14,
              background: '#2D2DEB',
              color: '#fff',
              fontSize: 17,
              fontWeight: 700,
              boxShadow: '0 14px 30px rgba(45,45,235,0.35)',
              cursor: 'pointer',
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
          >
            Scan code
          </motion.button>
        )}

        <motion.button
          type="button"
          onClick={onEnterCode}
          style={{
            height: 48,
            padding: '0 20px',
            background: 'transparent',
            border: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0F0F12',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          whileHover={{ opacity: 0.7 }}
          whileTap={{ scale: 0.96 }}
        >
          Enter code instead
        </motion.button>
      </motion.div>
    </motion.div>
  )
}
