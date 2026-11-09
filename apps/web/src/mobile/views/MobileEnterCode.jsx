import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { saveBundle } from '../bundle.js'
import { saveIdentity } from '../../lib/credentials.js'
import '../companion.css'

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

export default function MobileEnterCode({ onBack, onSkip, onScanCode, onPaired, direction = 1 }) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [waitingApproval, setWaitingApproval] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const pollTimerRef = useRef(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const handleDigit = (d) => {
    if (submitting || waitingApproval) return
    if (code.length < 6) {
      setCode((prev) => prev + d)
      setErrorMessage('')
    }
  }

  const handleDelete = () => {
    if (submitting || waitingApproval) return
    setCode((prev) => prev.slice(0, -1))
    setErrorMessage('')
  }

  const handleConnect = async () => {
    if (code.length !== 6 || submitting || waitingApproval) return
    setSubmitting(true)
    setErrorMessage('')

    try {
      const res = await api.claimPairingCode(code, 'Mobile Companion')
      if (res.status === 'waiting_approval' || res.ok) {
        setWaitingApproval(true)
        // Poll for approval
        pollTimerRef.current = setInterval(async () => {
          try {
            const st = await api.getPairingCodeStatus(code)
            if (st.status === 'approved' && st.bundle) {
              stopPolling()
              await saveBundle(st.bundle)
              const matchedHost = st.bundle.hosts?.[0] || ''
              const apiPort = st.bundle.api_port || 8000
              const computedHost = matchedHost ? (matchedHost.startsWith('http') ? matchedHost : `http://${matchedHost}:${apiPort}`) : ''

              await saveIdentity({
                deviceId: st.bundle.device_id,
                token: st.bundle.token,
                hostUrl: computedHost,
                name: 'Paired Phone',
                permissions: { library: true, agent: true, terminal: true, pc: true },
              })
              onPaired?.()
            } else if (st.status === 'expired' || st.status === 'invalid') {
              stopPolling()
              setWaitingApproval(false)
              setErrorMessage('Pairing window closed or expired. Please generate a new code on your PC.')
            }
          } catch {
            // keep polling
          }
        }, 1500)
      } else {
        throw new Error(res.error || 'Code verification failed')
      }
    } catch (err) {
      setErrorMessage(err.message || 'Could not verify code. Ensure PC is running on the same Wi-Fi.')
    } finally {
      setSubmitting(false)
    }
  }

  const ready = code.length === 6

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
        background: 'radial-gradient(90% 34% at 12% 0%, rgba(86,92,255,0.75) 0%, rgba(86,92,255,0) 75%), radial-gradient(70% 26% at 100% 4%, rgba(255,160,186,0.9) 0%, rgba(255,160,186,0) 75%), linear-gradient(180deg,#C9CBFF 0%,#EEF0FF 24%,#FFFFFF 44%,#FFFFFF 100%)',
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
          onClick={() => {
            stopPolling()
            onBack?.()
          }}
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
          onClick={() => {
            stopPolling()
            onSkip?.()
          }}
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
          top: 'max(104px, calc(env(safe-area-inset-top, 24px) + 68px))',
          textAlign: 'center',
          zIndex: 10,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'clamp(32px, 8.5vw, 40px)', lineHeight: 1.04, fontWeight: 800, letterSpacing: '-0.045em', color: '#2D2DEB' }}>
          Enter<br />your code
        </h1>
        <p style={{ margin: '12px auto 0', maxWidth: 300, fontSize: 15, lineHeight: 1.45, color: '#16161C' }}>
          Find the 6-digit code in <b>Settings</b>, then <b>Phone</b>, on your PC.
        </p>
      </div>

      {/* 6 Digits Display */}
      <div
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          top: 'max(248px, calc(env(safe-area-inset-top, 24px) + 195px))',
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 8,
          zIndex: 10,
        }}
      >
        {[0, 1, 2, 3, 4, 5].map((idx) => {
          const char = code[idx] || ''
          const isActive = idx === code.length
          return (
            <div
              key={idx}
              style={{
                height: 58,
                boxSizing: 'border-box',
                borderRadius: 16,
                background: '#fff',
                border: isActive ? '2px solid #2D2DEB' : '2px solid #D3D6F4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                fontWeight: 700,
                color: '#0F0F12',
                boxShadow: '0 6px 16px rgba(45, 45, 235, 0.08)',
              }}
            >
              {char}
            </div>
          )
        })}
      </div>

      {/* Counter or Status */}
      <div
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          top: 'max(318px, calc(env(safe-area-inset-top, 24px) + 262px))',
          textAlign: 'center',
          fontSize: 13,
          color: waitingApproval ? '#2D2DEB' : errorMessage ? '#EF4444' : '#3A3C47',
          fontWeight: waitingApproval ? 600 : 500,
          zIndex: 10,
        }}
        aria-live="polite"
      >
        {waitingApproval
          ? 'Waiting for approval on your PC…'
          : errorMessage || `${code.length} of 6 digits`}
      </div>

      {/* 3-Column Numeric Keypad */}
      <div
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          top: 'max(352px, calc(env(safe-area-inset-top, 24px) + 294px))',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          zIndex: 10,
        }}
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <motion.button
            key={digit}
            type="button"
            onClick={() => handleDigit(digit)}
            style={{
              width: '100%',
              height: 50,
              border: 0,
              borderRadius: 16,
              background: '#F1F2FD',
              color: '#0F0F12',
              fontSize: 22,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.94 }}
          >
            {digit}
          </motion.button>
        ))}

        {/* Empty space */}
        <div style={{ height: 50 }} />

        {/* 0 digit */}
        <motion.button
          type="button"
          onClick={() => handleDigit('0')}
          style={{
            width: '100%',
            height: 50,
            border: 0,
            borderRadius: 16,
            background: '#F1F2FD',
            color: '#0F0F12',
            fontSize: 22,
            fontWeight: 600,
            cursor: 'pointer',
          }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
        >
          0
        </motion.button>

        {/* Delete backspace */}
        <motion.button
          type="button"
          aria-label="Delete"
          onClick={handleDelete}
          style={{
            width: '100%',
            height: 50,
            border: 0,
            borderRadius: 16,
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" />
            <path d="M12 9.5l5 5M17 9.5l-5 5" />
          </svg>
        </motion.button>
      </div>

      {/* Bottom Actions */}
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
        <motion.button
          type="button"
          disabled={!ready || submitting || waitingApproval}
          onClick={handleConnect}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            height: 56,
            borderRadius: 14,
            background: ready && !submitting && !waitingApproval ? '#2D2DEB' : '#8F91E8',
            border: 0,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
            fontWeight: 700,
            boxShadow: ready ? '0 14px 30px rgba(45,45,235,0.35)' : 'none',
            cursor: ready && !submitting ? 'pointer' : 'default',
            opacity: submitting || waitingApproval ? 0.8 : 1,
          }}
          whileHover={ready && !submitting ? { scale: 1.02 } : {}}
          whileTap={ready && !submitting ? { scale: 0.96 } : {}}
        >
          {waitingApproval ? 'Waiting for PC…' : submitting ? 'Connecting…' : 'Connect'}
        </motion.button>
        <motion.button
          type="button"
          onClick={() => {
            stopPolling()
            onScanCode?.()
          }}
          style={{
            height: 44,
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
          Scan code instead
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

