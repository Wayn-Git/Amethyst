import React from 'react'
import { motion } from 'framer-motion'
import AmethystLogo from '../../components/AmethystLogo.jsx'
import '../companion.css'

export default function MobileSplash() {
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
        background: '#F4F6FB',
        display: 'flex',
        flexDirection: 'column',
      }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background Pastel Gradient */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(90% 55% at 12% 100%, #FFB68A 0%, rgba(255,182,138,0) 70%), radial-gradient(90% 60% at 100% 80%, #5B9BFF 0%, rgba(91,155,255,0) 70%), radial-gradient(80% 50% at 50% 0%, #DCE9FF 0%, rgba(220,233,255,0) 75%), #F4F6FB',
          pointerEvents: 'none',
        }}
      />

      {/* Subtle Noise Texture */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', mixBlendMode: 'soft-light', opacity: 0.5, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <filter id="splash-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#splash-noise)" />
      </svg>

      {/* Center Logo Lockup */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          zIndex: 10,
        }}
      >
        <motion.div
          className="glass"
          style={{
            width: 96,
            height: 96,
            borderRadius: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.95)',
          }}
          initial={{ scale: 0.86, opacity: 0, y: 16 }}
          animate={{ scale: [0.86, 1, 1.03, 1], opacity: 1, y: 0 }}
          transition={{
            scale: { repeat: Infinity, duration: 2.6, ease: 'easeInOut' },
            opacity: { duration: 0.4 },
            y: { type: 'spring', stiffness: 340, damping: 24, delay: 0.05 },
          }}
        >
          <AmethystLogo size={52} color="#873FFF" />
        </motion.div>

        <motion.div
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.045em',
            color: '#1D1D1F',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
        >
          Amethyst
        </motion.div>
      </div>

      {/* Bottom Tagline */}
      <motion.div
        className="m"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 'max(48px, env(safe-area-inset-bottom, 48px))',
          textAlign: 'center',
          color: '#3A3A3C',
          fontSize: 14,
          fontWeight: 500,
          zIndex: 10,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.25 }}
      >
        One mind for your digital life.
      </motion.div>
    </motion.div>
  )
}

