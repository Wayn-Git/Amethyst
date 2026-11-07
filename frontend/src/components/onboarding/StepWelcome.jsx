import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import { useApp } from '../../store.jsx'

export default function StepWelcome({ onStart }) {
  const { accentColor } = useApp()
  const shouldReduceMotion = useReducedMotion()

  // Floating ambient satellites bobbing animation
  const floatAnim = (duration = 3.6, yOffset = 6, delay = 0) =>
    shouldReduceMotion
      ? {}
      : {
          y: [-yOffset, yOffset, -yOffset],
          transition: {
            duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay,
          },
        }

  return (
    <div className="onb-card">
      {/* Left Pitch Pane */}
      <div className="onb-pane-left">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AmethystLogo size={28} color="#ffffff" />
        </div>

        <h1 className="onb-title" style={{ fontSize: 44, marginTop: 'auto', lineHeight: 1.05 }}>
          Meet Amethyst.
        </h1>
        <p className="onb-desc" style={{ marginBottom: 'auto', fontSize: 15, lineHeight: 1.5 }}>
          Your private workspace for AI, files and everything in between.
        </p>

        <button
          type="button"
          className="onb-btn-primary"
          style={{ background: accentColor || 'var(--accent, #7132f5)' }}
          onClick={onStart}
        >
          <span>Get started</span>
          <Icon name="arrow-right" size={16} weight="bold" />
        </button>

        <p style={{ fontSize: 12, color: '#9a9aa6', textAlign: 'center', margin: '14px 0 0' }}>
          Setup takes about three minutes
        </p>
      </div>

      {/* Ticket Perforation Divider */}
      <div className="onb-perforation" aria-hidden="true" />

      {/* Right Visual Stage with Center Gem & Floating Satellites */}
      <div className="onb-pane-right" style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Center Hero Badge */}
        <motion.div
          style={{
            position: 'absolute',
            left: 'calc(50% - 82px)',
            top: 'calc(50% - 82px)',
            width: 164,
            height: 164,
            borderRadius: 44,
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)',
            zIndex: 3,
          }}
          initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.88, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <AmethystLogo size={96} color="#2441ff" />
        </motion.div>

        {/* Floating Satellites (AI, Files, Phone, Apps) */}
        <motion.span
          className="onb-tag-pill"
          style={{
            position: 'absolute',
            left: '12%',
            top: '16%',
            background: 'rgba(255, 255, 255, 0.12)',
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 500,
            backdropFilter: 'blur(8px)',
            zIndex: 4,
          }}
          animate={floatAnim(3.8, 7, 0.2)}
        >
          <Icon name="sparkle" size={16} />
          <span>AI</span>
        </motion.span>

        <motion.span
          className="onb-tag-pill"
          style={{
            position: 'absolute',
            right: '12%',
            top: '22%',
            background: 'rgba(255, 255, 255, 0.12)',
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 500,
            backdropFilter: 'blur(8px)',
            zIndex: 4,
          }}
          animate={floatAnim(4.2, 8, 0.6)}
        >
          <Icon name="folder" size={16} />
          <span>Files</span>
        </motion.span>

        <motion.span
          className="onb-tag-pill"
          style={{
            position: 'absolute',
            left: '10%',
            bottom: '22%',
            background: 'rgba(255, 255, 255, 0.12)',
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 500,
            backdropFilter: 'blur(8px)',
            zIndex: 4,
          }}
          animate={floatAnim(3.5, 6, 0.4)}
        >
          <Icon name="device-mobile" size={16} />
          <span>Phone</span>
        </motion.span>

        <motion.span
          className="onb-tag-pill"
          style={{
            position: 'absolute',
            right: '10%',
            bottom: '16%',
            background: 'rgba(255, 255, 255, 0.12)',
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 500,
            backdropFilter: 'blur(8px)',
            zIndex: 4,
          }}
          animate={floatAnim(4.0, 7, 0.8)}
        >
          <Icon name="layers" size={16} />
          <span>Apps</span>
        </motion.span>
      </div>
    </div>
  )
}

