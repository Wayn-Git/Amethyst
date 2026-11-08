import React from 'react'
import { motion } from 'framer-motion'
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

export default function MobileOnboarding({ onGetStarted, onHaveCode, direction = 1 }) {
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
        display: 'flex',
        flexDirection: 'column',
      }}
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
    >
      {/* Top Logo Badge */}
      <motion.div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 'max(48px, calc(env(safe-area-inset-top, 24px) + 24px))',
          display: 'flex',
          justifyContent: 'center',
          zIndex: 10,
        }}
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 28, delay: 0.05 }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 10px 28px rgba(20, 10, 120, 0.35)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2D2DEB" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
            <path d="M6 3h12l4 6-10 12L2 9z" />
            <path d="M2 9h20" />
            <path d="M9 3l3 6 3-6" />
            <path d="M12 21L9 9M12 21l3-12" />
          </svg>
        </div>
      </motion.div>

      {/* Middle Headline & Copy */}
      <div
        style={{
          position: 'absolute',
          left: 32,
          right: 32,
          bottom: 'max(140px, calc(env(safe-area-inset-bottom, 24px) + 116px))',
          textAlign: 'center',
          zIndex: 10,
        }}
      >
        <motion.h1
          style={{
            margin: 0,
            fontSize: 'clamp(34px, 8.5vw, 42px)',
            lineHeight: 1.06,
            fontWeight: 800,
            letterSpacing: '-0.045em',
            color: '#fff',
          }}
          initial={{ y: 22, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.1 }}
        >
          One mind for your digital life.
        </motion.h1>
        <motion.p
          style={{
            margin: '16px auto 0',
            maxWidth: 290,
            fontSize: 16,
            lineHeight: 1.4,
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.9)',
          }}
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.16 }}
        >
          Your Library, tasks and agent, with your PC always within reach.
        </motion.p>
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
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.22 }}
      >
        <motion.button
          type="button"
          style={{
            boxSizing: 'border-box',
            width: '100%',
            height: 56,
            borderRadius: 14,
            background: '#16167A',
            border: 0,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
            fontWeight: 700,
            boxShadow: '0 14px 30px rgba(10, 8, 90, 0.35)',
            cursor: 'pointer',
          }}
          onClick={onGetStarted}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
        >
          Get started
        </motion.button>
        <motion.button
          type="button"
          style={{
            height: 48,
            padding: '0 20px',
            background: 'transparent',
            border: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={onHaveCode}
          whileHover={{ opacity: 0.85 }}
          whileTap={{ scale: 0.96 }}
        >
          I have a code
        </motion.button>
      </motion.div>
    </motion.div>
  )
}
