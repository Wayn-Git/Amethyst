import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QrScanner from '../../components/QrScanner.jsx'
import { decodeAndValidateQr, pairDevice } from '../pairingClient.js'
import { savePairingToken, clearPairingTokenRejected } from '../pairingVault.js'

export default function PairPrompt({
  onPaired,
  onScan,
  isRejected = false,
  onRescan,
  title = 'Connect Desktop',
  description = 'Pair with your PC to launch apps and use the terminal',
  className = '',
}) {
  const [scanning, setScanning] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [loading, setLoading] = useState(false)

  const handleStartScan = () => {
    if (onScan) {
      onScan()
      return
    }
    setErrorMsg('')
    setScanning(true)
  }

  const handleProcessPayload = useCallback(async (raw) => {
    if (!raw || typeof raw !== 'string') return
    const text = raw.trim()
    if (!text) return

    setLoading(true)
    setErrorMsg('')

    try {
      let tokenToSave = ''

      // 1. Try decoding CONTRACT v2 QR payload
      try {
        const qrPayload = decodeAndValidateQr(text)
        await pairDevice({ qrPayload })
        tokenToSave = qrPayload.token
      } catch (qrErr) {
        // If not a CONTRACT v2 QR structure, check if it is a raw bearer token or direct payload
        if (text.startsWith('tok_') || text.length >= 8) {
          tokenToSave = text
        } else {
          throw qrErr
        }
      }

      // 2. Persist in vault and clear rejection
      await savePairingToken(tokenToSave)
      await clearPairingTokenRejected()

      setScanning(false)
      onPaired?.(tokenToSave)
    } catch (err) {
      setErrorMsg(err.message || 'Could not complete pairing')
    } finally {
      setLoading(false)
    }
  }, [onPaired])

  return (
    <div
      className={`c pair-prompt-card ${className}`}
      style={{
        padding: '24px 20px',
        borderRadius: 24,
        background: '#FFFFFF',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 16,
        margin: '12px 0',
      }}
    >
      {/* Icon Badge */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          background: isRejected ? 'rgba(217, 84, 30, 0.12)' : 'rgba(0, 113, 227, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isRejected ? '#D9541E' : '#0071E3',
        }}
      >
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="20" height="14" x="2" y="3" rx="2" />
          <line x1="8" x2="16" y1="21" y2="21" />
          <line x1="12" x2="12" y1="17" y2="21" />
        </svg>
      </div>

      {/* Copy */}
      <div style={{ maxWidth: 320 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: isRejected ? '#D9541E' : '#0071E3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          {isRejected ? 'Token Rejected' : title}
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#1D1D1F', lineHeight: 1.35, letterSpacing: '-0.02em' }}>
          {description}
        </div>
        <div style={{ fontSize: 12.5, color: '#6E6E73', marginTop: 6, lineHeight: 1.4 }}>
          {isRejected
            ? 'The previous pairing token was rejected by your PC. Re-scan the pairing QR code to restore control.'
            : 'Access live system status, interactive terminal, and app launcher over your local Wi-Fi.'}
        </div>
      </div>

      {/* CTA Button */}
      {isRejected ? (
        <button
          type="button"
          className="bt l"
          style={{ width: '100%', maxWidth: 280, height: 48, background: '#D9541E' }}
          onClick={onRescan || handleStartScan}
          aria-label="Re-scan QR"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
          Re-scan QR
        </button>
      ) : (
        <button
          type="button"
          className="bt l"
          style={{ width: '100%', maxWidth: 280, height: 48 }}
          onClick={handleStartScan}
          aria-label="Scan QR Code"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          Scan QR Code
        </button>
      )}

      {/* In-app QR Scanner Modal */}
      <AnimatePresence>
        {scanning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 300,
              background: '#000000',
              display: 'flex',
              flexDirection: 'column',
              padding: 'max(16px, env(safe-area-inset-top, 16px)) 16px max(24px, env(safe-area-inset-bottom, 24px))',
            }}
          >
            {/* Modal Header */}
            <div className="r sp" style={{ marginBottom: 16 }}>
              <div style={{ color: '#fff', fontSize: 17, fontWeight: 600 }}>
                {isRejected ? 'Re-scan Pairing QR' : 'Scan Pairing QR'}
              </div>
              <button
                type="button"
                className="ch"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                onClick={() => setScanning(false)}
              >
                Cancel
              </button>
            </div>

            {/* Viewfinder instructions */}
            <div style={{ color: '#A1A1A6', fontSize: 12.5, textAlign: 'center', marginBottom: 12 }}>
              Point camera at the QR code shown on your PC in Settings &gt; Devices.
            </div>

            {/* Video Viewfinder */}
            <div
              style={{
                flex: 1,
                minHeight: 260,
                borderRadius: 20,
                overflow: 'hidden',
                background: '#1C1C1E',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <QrScanner
                onScan={handleProcessPayload}
                onCancel={() => setScanning(false)}
                inline
              />

              {loading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  Pairing with PC…
                </div>
              )}
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div
                style={{
                  background: 'rgba(255, 69, 58, 0.15)',
                  border: '1px solid rgba(255, 69, 58, 0.3)',
                  borderRadius: 12,
                  padding: '8px 12px',
                  color: '#FF453A',
                  fontSize: 12,
                  marginTop: 12,
                  textAlign: 'center',
                }}
              >
                {errorMsg}
              </div>
            )}

            {/* Manual test/code input fallback */}
            <div
              className="r"
              style={{
                marginTop: 12,
                gap: 8,
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 14,
                padding: '4px 6px 4px 14px',
              }}
            >
              <input
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 0,
                  outline: 0,
                  color: '#fff',
                  fontSize: 13,
                }}
                placeholder="Or paste code / token…"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
              />
              <button
                type="button"
                className="ch"
                style={{ background: '#0071E3', color: '#fff', fontSize: 12, padding: '6px 12px' }}
                disabled={!manualCode.trim() || loading}
                onClick={() => handleProcessPayload(manualCode)}
              >
                Pair
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
