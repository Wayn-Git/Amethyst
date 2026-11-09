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

export default function MobileSkipConfirm({ onConnect, onSkip, direction = 1 }) {
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
        background: 'radial-gradient(90% 30% at 8% 0%, rgba(86,92,255,0.7) 0%, rgba(86,92,255,0) 75%), radial-gradient(70% 26% at 100% 0%, rgba(255,160,186,0.9) 0%, rgba(255,160,186,0) 75%), linear-gradient(180deg,#D3D5FF 0%,#EEF0FF 18%,#FFFFFF 34%,#FFFFFF 100%)',
        display: 'flex',
        flexDirection: 'column',
      }}
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
    >
      {/* Title & Explainer */}
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
        <motion.h1
          style={{
            margin: 0,
            fontSize: 'clamp(36px, 9.5vw, 44px)',
            lineHeight: 1.02,
            fontWeight: 800,
            letterSpacing: '-0.045em',
            color: '#2D2DEB',
          }}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.08 }}
        >
          Are<br />you sure?
        </motion.h1>
        <motion.p
          style={{
            margin: '22px auto 0',
            maxWidth: 310,
            fontSize: 16,
            lineHeight: 1.5,
            color: '#16161C',
          }}
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.14 }}
        >
          Amethyst works best with your PC connected. In case you&apos;re on the fence, here&apos;s what you&apos;ll be missing:
        </motion.p>
      </div>

      {/* Feature Bullet Points */}
      <motion.div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '52%',
          transform: 'translateY(-50%)',
          display: 'flex',
          justifyContent: 'center',
          zIndex: 10,
        }}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.2 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0F0F12' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
            </svg>
            <span>Approve agent runs</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0F0F12' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13C17 4 14 4.5 12 6z" />
              <path d="M12 6v13" />
            </svg>
            <span>Your Library, synced</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0F0F12' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
            <span>Live PC status</span>
          </div>
        </div>
      </motion.div>

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
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28, delay: 0.26 }}
      >
        <motion.button
          type="button"
          style={{
            boxSizing: 'border-box',
            width: '100%',
            height: 56,
            borderRadius: 14,
            background: '#2D2DEB',
            border: 0,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
            fontWeight: 700,
            boxShadow: '0 14px 30px rgba(45, 45, 235, 0.35)',
            cursor: 'pointer',
          }}
          onClick={onConnect}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
        >
          Connect my PC
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
            color: '#0F0F12',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={onSkip}
          whileHover={{ opacity: 0.7 }}
          whileTap={{ scale: 0.96 }}
        >
          Seriously, skip for now!
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

