import React from 'react'
import { motion } from 'framer-motion'
import '../companion.css'

export default function MobileSplash() {
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
        color: '#fff',
        background: 'radial-gradient(70% 40% at 105% 8%, rgba(255,176,196,0.95) 0%, rgba(255,176,196,0) 70%), radial-gradient(75% 34% at 100% 42%, #F2214B 0%, rgba(242,33,75,0.65) 40%, rgba(242,33,75,0) 100%), radial-gradient(60% 30% at 38% 36%, rgba(194,60,170,0.7) 0%, rgba(194,60,170,0) 100%), radial-gradient(90% 40% at 0% 8%, #2A19C9 0%, rgba(42,25,201,0) 80%), linear-gradient(180deg,#3B2BE6 0%,#3A32F2 50%,#2E22D8 100%)',
      }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
    >
      {/* Center Brand Lockup */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '38%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 22,
          zIndex: 10,
        }}
      >
        <motion.div
          style={{
            width: 104,
            height: 104,
            borderRadius: 30,
            background: '#fff',
            boxShadow: '0 24px 60px rgba(20, 10, 120, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          initial={{ scale: 0.88, opacity: 0, y: 16 }}
          animate={{ scale: [0.92, 1, 1.02, 1], opacity: 1, y: 0 }}
          transition={{
            scale: { repeat: Infinity, duration: 2.4, ease: 'easeInOut' },
            opacity: { duration: 0.35 },
            y: { type: 'spring', stiffness: 360, damping: 26 },
          }}
        >
          <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#2D2DEB" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
            <path d="M6 3h12l4 6-10 12L2 9z" />
            <path d="M2 9h20" />
            <path d="M9 3l3 6 3-6" />
            <path d="M12 21L9 9M12 21l3-12" />
          </svg>
        </motion.div>

        <motion.div
          style={{
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: '-0.045em',
            color: '#fff',
          }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12 }}
        >
          Amethyst
        </motion.div>
      </div>

      {/* Tagline */}
      <motion.div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 'max(92px, calc(env(safe-area-inset-bottom, 24px) + 68px))',
          textAlign: 'center',
          fontSize: 15,
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.88)',
          zIndex: 10,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        One mind for your digital life.
      </motion.div>

      {/* 3 Pagination / Loading Dots */}
      <motion.div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 'max(56px, calc(env(safe-area-inset-bottom, 24px) + 32px))',
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          zIndex: 10,
        }}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.25 }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 999, background: '#fff' }} />
        <div style={{ width: 8, height: 8, borderRadius: 999, background: 'rgba(255, 255, 255, 0.5)' }} />
        <div style={{ width: 8, height: 8, borderRadius: 999, background: 'rgba(255, 255, 255, 0.25)' }} />
      </motion.div>
    </motion.div>
  )
}
