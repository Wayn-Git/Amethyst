import { useState, useEffect, useRef } from 'react'
import { BLUE, BLUE_SOFT, INK, MUTED, CANVAS } from './tokens.js'

export default function CookingModeScreen({ recipe, onClose }) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0)
  const [timerSeconds, setTimerSeconds] = useState(120)
  const [timerRunning, setTimerRunning] = useState(false)
  const [keepScreenOn, setKeepScreenOn] = useState(true)
  const [checkedIngredients, setCheckedIngredients] = useState({})
  const timerRef = useRef(null)

  const steps = recipe?.steps || [
    { title: 'Prep the ingredients', desc: 'Dice shallots, mince garlic cloves, measure heavy cream.', time: 180, ingredients: [{ name: 'Garlic cloves', qty: '4' }, { name: 'Butter', qty: '2 tbsp' }] },
    { title: 'Sauté the garlic', desc: 'In butter, on medium heat.', time: 120, ingredients: [{ name: 'Garlic cloves', qty: '4' }, { name: 'Butter', qty: '2 tbsp' }] },
    { title: 'Boil pasta & simmer sauce', desc: 'Cook fettuccine al dente. Stir heavy cream into garlic.', time: 480, ingredients: [{ name: 'Fettuccine', qty: '250g' }, { name: 'Heavy cream', qty: '1 cup' }] },
    { title: 'Toss & finish with parmesan', desc: 'Grate freshly over warm pasta with cracked pepper.', time: 90, ingredients: [{ name: 'Parmesan', qty: '50g' }, { name: 'Black pepper', qty: 'to taste' }] },
  ]

  const totalSteps = steps.length
  const currentStep = steps[currentStepIdx] || steps[0]

  useEffect(() => {
    if (currentStep?.time) {
      setTimerSeconds(currentStep.time)
      setTimerRunning(false)
    }
  }, [currentStepIdx, currentStep?.time])

  // Timer interval
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current)
            setTimerRunning(false)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [timerRunning])

  // Screen wake lock API
  useEffect(() => {
    let wakeLock = null
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && keepScreenOn) {
          wakeLock = await navigator.wakeLock.request('screen')
        }
      } catch {
        // Ignored
      }
    }
    requestWakeLock()
    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {})
      }
    }
  }, [keepScreenOn])

  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const toggleIngredient = (name) => {
    setCheckedIngredients((prev) => ({
      ...prev,
      [name]: !prev[name],
    }))
  }

  const nextStep = () => {
    if (currentStepIdx < totalSteps - 1) {
      setCurrentStepIdx((prev) => prev + 1)
    } else {
      onClose()
    }
  }

  const prevStep = () => {
    if (currentStepIdx > 0) {
      setCurrentStepIdx((prev) => prev - 1)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: CANVAS,
        color: INK,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44 }}>
          <button
            aria-label="Exit cooking mode"
            onClick={onClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              border: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              color: INK,
              cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{recipe?.title || 'Recipe'}</div>
            <div style={{ fontSize: 13, color: MUTED }}>
              Step {currentStepIdx + 1} of {totalSteps}
            </div>
          </div>

          <div style={{ width: 44 }} />
        </div>

        {/* Step progress pills */}
        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 3,
                background: i <= currentStepIdx ? BLUE : '#D1D1D6',
                transition: 'background 0.25s',
              }}
            />
          ))}
        </div>
      </div>

      {/* Main Step Body */}
      <div style={{ padding: '0 20px', flex: 1, paddingBottom: 120 }}>
        {/* Step number badge */}
        <div
          style={{
            marginTop: 32,
            width: 44,
            height: 44,
            borderRadius: 22,
            background: BLUE_SOFT,
            color: '#0A55C4',
            fontSize: 20,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {currentStepIdx + 1}
        </div>

        <h1 style={{ margin: '14px 0 0', fontSize: 36, lineHeight: '42px', fontWeight: 800, letterSpacing: '-0.035em' }}>
          {currentStep.title}
        </h1>

        <p style={{ margin: '10px 0 0', fontSize: 20, lineHeight: '28px', color: '#3A3A3C' }}>
          {currentStep.desc}
        </p>

        {/* You need */}
        {currentStep.ingredients && currentStep.ingredients.length > 0 && (
          <div>
            <h2 style={{ margin: '28px 0 8px', fontSize: 13, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED }}>
              You need
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {currentStep.ingredients.map((ing) => {
                const checked = checkedIngredients[ing.name]
                return (
                  <div
                    key={ing.name}
                    onClick={() => toggleIngredient(ing.name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      height: 56,
                      padding: '0 14px',
                      borderRadius: 14,
                      background: '#fff',
                      boxShadow: '0 0 0 1px #E3E3E8',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        flex: 'none',
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        background: checked ? BLUE : 'transparent',
                        border: checked ? 'none' : '2px solid #C7C7CC',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                      }}
                    >
                      {checked && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      )}
                    </span>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 600, textDecoration: checked ? 'line-through' : 'none', color: checked ? MUTED : INK }}>
                      {ing.name}
                    </span>
                    <span style={{ fontSize: 15, color: MUTED }}>{ing.qty}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Step Timer */}
        <div style={{ marginTop: 24, padding: '18px 16px 16px', borderRadius: 22, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED }}>
            Timer
          </div>
          <div style={{ marginTop: 2, fontSize: 60, lineHeight: '68px', fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimer(timerSeconds)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => setTimerRunning((prev) => !prev)}
              style={{
                flex: 2,
                height: 52,
                borderRadius: 14,
                border: 0,
                background: BLUE,
                color: '#fff',
                fontSize: 17,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: 'pointer',
              }}
            >
              {timerRunning ? 'Pause' : 'Start'}
            </button>
            <button
              onClick={() => {
                setTimerRunning(false)
                setTimerSeconds(currentStep.time || 120)
              }}
              style={{
                flex: 1,
                height: 52,
                borderRadius: 14,
                border: 0,
                background: 'rgba(118,118,128,.16)',
                color: INK,
                fontSize: 17,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Keep Screen On Switch */}
        <div
          onClick={() => setKeepScreenOn((prev) => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 14,
            height: 56,
            padding: '0 14px',
            borderRadius: 14,
            background: '#fff',
            boxShadow: '0 0 0 1px #E3E3E8',
            cursor: 'pointer',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3A3A3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
            <path d="M11 18.5h2" />
          </svg>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Keep screen on</span>
          <span
            role="switch"
            aria-checked={keepScreenOn}
            style={{
              width: 52,
              height: 32,
              borderRadius: 16,
              background: keepScreenOn ? '#34C759' : '#E5E5EA',
              position: 'relative',
              transition: 'background 0.2s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: keepScreenOn ? 23 : 3,
                top: 3,
                width: 26,
                height: 26,
                borderRadius: 13,
                background: '#fff',
                boxShadow: '0 2px 5px rgba(0,0,0,.25)',
                transition: 'left 0.2s',
              }}
            />
          </span>
        </div>
      </div>

      {/* Pinned Bottom Controls */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '0 16px calc(env(safe-area-inset-bottom, 0px) + 20px)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          zIndex: 10,
          background: 'linear-gradient(to top, rgba(242,242,247,0.95) 80%, rgba(242,242,247,0))',
        }}
      >
        {currentStepIdx > 0 && (
          <button
            onClick={prevStep}
            aria-label="Previous step"
            style={{
              flex: 'none',
              width: 58,
              height: 58,
              borderRadius: 29,
              border: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(28px)',
              WebkitBackdropFilter: 'blur(28px)',
              color: INK,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(0,0,0,.08)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <button
          onClick={nextStep}
          style={{
            flex: 1,
            height: 58,
            borderRadius: 18,
            border: 0,
            background: BLUE,
            color: '#fff',
            fontSize: 18,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(11,95,217,0.3)',
          }}
        >
          {currentStepIdx < totalSteps - 1
            ? `Next: ${steps[currentStepIdx + 1]?.title || 'Continue'}`
            : 'Finish cooking'}
        </button>
      </div>
    </div>
  )
}

