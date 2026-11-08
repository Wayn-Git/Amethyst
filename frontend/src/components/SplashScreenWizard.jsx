import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import OnboardingWindow from './onboarding/OnboardingWindow.jsx'
import StepSplash from './onboarding/StepSplash.jsx'
import StepWelcome from './onboarding/StepWelcome.jsx'
import StepProfile from './onboarding/StepProfile.jsx'
import StepAiEngine from './onboarding/StepAiEngine.jsx'
import StepStorage from './onboarding/StepStorage.jsx'
import StepMicrosoftTodo from './onboarding/StepMicrosoftTodo.jsx'
import StepMobile from './onboarding/StepMobile.jsx'
import StepLaunch from './onboarding/StepLaunch.jsx'
import { triggerConfetti } from './ConfettiCannon.jsx'
import { api } from '../api.js'
import { isNativeMobile } from '../lib/credentials.js'
import { useApp } from '../store.jsx'
import './onboarding/onboarding.css'

/* ==========================================================================
   AMETHYST DESKTOP ONBOARDING WIZARD
   High-craft floating window setup experience matching:
   docs/UI/mobile/Amethyst Desktop Onboarding.html
   ========================================================================== */

const STEPS = ['splash', 'welcome', 'profile', 'ai_engine', 'storage', 'microsoft_todo', 'mobile', 'launch']

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? 20 : -20, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir < 0 ? 20 : -20, opacity: 0 }),
}

export default function SplashScreenWizard() {
  const { onboardingDone, setOnboardingDone, toast } = useApp()
  const [stepIndex, setStepIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const shouldReduceMotion = useReducedMotion()

  const currentStep = STEPS[stepIndex]

  const next = useCallback(() => {
    setDir(1)
    setStepIndex((idx) => Math.min(idx + 1, STEPS.length - 1))
  }, [])

  const prev = useCallback(() => {
    setDir(-1)
    setStepIndex((idx) => Math.max(idx - 1, 1)) // Don't go back to splash once past it
  }, [])

  const finish = useCallback(async () => {
    try {
      await api.completeSetup?.({
        browser_enabled: false,
        tray_enabled: true,
      })
    } catch {
      // Non-blocking
    }
    setOnboardingDone(true)
    triggerConfetti?.()
    toast?.('Setup complete. Welcome to Amethyst!', 'ok')
  }, [setOnboardingDone, toast])

  // Don't show on mobile companion app or if already completed
  if (
    isNativeMobile?.() ||
    (typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/pair') || (window.location.hash || '').includes('pair'))) ||
    onboardingDone
  ) {
    return null
  }

  const renderStep = () => {
    switch (currentStep) {
      case 'splash':
        return <StepSplash onReady={next} />
      case 'welcome':
        return <StepWelcome onStart={next} />
      case 'profile':
        return <StepProfile onNext={next} onBack={prev} />
      case 'ai_engine':
        return <StepAiEngine onNext={next} onBack={prev} onSkip={next} />
      case 'storage':
        return <StepStorage onNext={next} onBack={prev} />
      case 'microsoft_todo':
        return <StepMicrosoftTodo onNext={next} onBack={prev} onSkip={next} />
      case 'mobile':
        return <StepMobile onNext={next} onBack={prev} onSkip={next} />
      case 'launch':
        return <StepLaunch onFinish={finish} onBack={prev} />
      default:
        return null
    }
  }

  return (
    <OnboardingWindow>
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flex: 1 }}>
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={currentStep}
            custom={dir}
            variants={shouldReduceMotion ? {} : slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ width: '100%', height: '100%', display: 'flex', flex: 1 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>
    </OnboardingWindow>
  )
}
