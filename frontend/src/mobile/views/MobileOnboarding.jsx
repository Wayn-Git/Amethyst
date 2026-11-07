import React from 'react'
import { motion } from 'framer-motion'
import AmethystLogo from '../../components/AmethystLogo.jsx'
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

export default function MobileOnboarding({ onGetStarted, onSkip, onHaveCode, direction = 1 }) {
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
        background: '#EEF3FF',
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
      {/* Background Pastel Gradient from Onboarding.dc.html */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(110% 65% at 0% 95%, #FFAE7C 0%, rgba(255,174,124,0) 68%), radial-gradient(100% 70% at 100% 60%, #4F92FF 0%, rgba(79,146,255,0) 70%), radial-gradient(90% 55% at 40% 0%, #CFE0FF 0%, rgba(207,224,255,0) 75%), #EEF3FF',
          pointerEvents: 'none',
        }}
      />

      {/* Subtle Noise Texture */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', mixBlendMode: 'soft-light', opacity: 0.5, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <filter id="onboarding-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#onboarding-noise)" />
      </svg>

      {/* Top Header Row with animated entrance */}
      <motion.div
        className="r sp"
        style={{
          position: 'absolute',
          top: 'max(24px, env(safe-area-inset-top, 24px))',
          left: 24,
          right: 24,
          zIndex: 10,
        }}
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 28, delay: 0.05 }}
      >
        <div className="r" style={{ gap: 10 }}>
          <AmethystLogo size={24} color="#873FFF" />
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em', color: '#1D1D1F' }}>
            Amethyst
          </span>
        </div>
        <motion.button
          type="button"
          className="ch glass"
          style={{
            font: "600 13px 'Inter', sans-serif",
            padding: '9px 16px',
            border: '1px solid rgba(255, 255, 255, 0.75)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.05)',
            cursor: 'pointer',
          }}
          onClick={onSkip}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
        >
          Skip
        </motion.button>
      </motion.div>

      {/* Bottom Content Card with Staggered Entrance */}
      <div
        className="col"
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          bottom: 'max(36px, env(safe-area-inset-bottom, 36px))',
          gap: 16,
          zIndex: 10,
        }}
      >
        {/* Stepper Dots */}
        <motion.div
          className="r"
          style={{ gap: 6, marginBottom: 4 }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 26, delay: 0.1 }}
        >
          <motion.span
            layoutId="stepper-active"
            style={{ width: 22, height: 6, borderRadius: 3, background: '#1D1D1F' }}
            transition={{ type: 'spring', stiffness: 350, damping: 26 }}
          />
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.25)' }} />
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.25)' }} />
        </motion.div>

        {/* Title */}
        <motion.h1
          style={{
            margin: 0,
            fontSize: 'clamp(36px, 9vw, 44px)',
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: '-0.05em',
            color: '#1D1D1F',
          }}
          initial={{ y: 26, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.12 }}
        >
          One mind for your digital life.
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          style={{
            margin: 0,
            fontSize: 16,
            lineHeight: 1.45,
            color: '#1D1D1F',
            maxWidth: 320,
            opacity: 0.9,
          }}
          initial={{ y: 22, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.18 }}
        >
          Your Library, tasks and agent, with your PC always within reach.
        </motion.p>

        {/* Primary Action Button */}
        <motion.button
          type="button"
          className="bt"
          style={{
            width: '100%',
            justifyContent: 'space-between',
            marginTop: 6,
            minHeight: 52,
            padding: '0 24px',
            fontSize: 15,
            fontWeight: 600,
          }}
          onClick={onGetStarted}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.24 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
        >
          <span>Get started</span>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </motion.button>

        {/* Secondary Action Button */}
        <motion.button
          type="button"
          className="bt glass"
          style={{
            width: '100%',
            color: '#1D1D1F',
            minHeight: 50,
            fontSize: 15,
            fontWeight: 600,
          }}
          onClick={onHaveCode}
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.3 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
        >
          I have a code
        </motion.button>
      </div>
    </motion.div>
  )
}
