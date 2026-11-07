import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import './onboarding.css'

export default function OnboardingWindow({ children, className = '' }) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <div className="onb-overlay">
      <motion.div
        className={`onb-window ${className}`}
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -8 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* macOS Traffic Light Window Controls */}
        <div className="onb-traffic-lights" aria-hidden="true">
          <i style={{ background: '#ff5f57' }} />
          <i style={{ background: '#febc2e' }} />
          <i style={{ background: '#28c840' }} />
        </div>

        {children}
      </motion.div>
    </div>
  )
}
