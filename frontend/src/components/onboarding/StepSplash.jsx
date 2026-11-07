import React, { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import AmethystLogo from '../AmethystLogo.jsx'
import { getDisclaimerText } from './clientOS.js'
import { api } from '../../api.js'

export default function StepSplash({ onReady }) {
  const [status, setStatus] = useState('Starting local services')
  const [substatus, setSubstatus] = useState('127.0.0.1 · opening vault')
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    let cancelled = false
    const checkBoot = async () => {
      try {
        const res = await api.setupStatus?.()
        if (!cancelled && res) {
          setStatus('Local vault ready')
          setSubstatus('127.0.0.1 · connected')
        }
      } catch {
        // Fallback gracefully
      }
      setTimeout(() => {
        if (!cancelled) onReady?.()
      }, 900)
    }

    checkBoot()
    return () => { cancelled = true }
  }, [onReady])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Center Squircle Badge */}
      <motion.div
        style={{
          width: 104,
          height: 104,
          borderRadius: 28,
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 20px 50px rgba(10, 18, 96, 0.65)',
        }}
        initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.9, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <AmethystLogo size={58} color="#2441ff" />
      </motion.div>

      {/* Sleek Progress Loader Track */}
      <div
        style={{
          width: 132,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.25)',
          margin: '48px 0 20px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <motion.div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 54,
            borderRadius: 2,
            background: '#ffffff',
          }}
          animate={shouldReduceMotion ? { width: 132 } : { x: [-54, 132] }}
          transition={
            shouldReduceMotion
              ? { duration: 0.2 }
              : { repeat: Infinity, duration: 1.4, ease: 'easeInOut' }
          }
        />
      </div>

      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: '#ffffff' }}>
        {status}
      </div>
      <div className="onb-mono" style={{ marginTop: 6, fontSize: 13, color: '#dfe5ff' }}>
        {substatus}
      </div>

      {/* Dynamic OS-aware Privacy Disclaimer */}
      <p
        style={{
          position: 'absolute',
          bottom: 30,
          width: '100%',
          textAlign: 'center',
          margin: 0,
          fontSize: 13,
          color: '#dfe5ff',
          letterSpacing: '-0.01em',
        }}
      >
        {getDisclaimerText()}
      </p>
    </div>
  )
}

