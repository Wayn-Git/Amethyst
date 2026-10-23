/**
 * useAgentStage - React hook wrapping StageEngine
 * Provides real-time stage detection, synonym rotation, stall monitoring,
 * and timer tracking for the agent live status indicator.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { computeAgentStage, StageEngine } from './agentStageCore.js'

export function useAgentStage({
  running = false,
  status = null,
  liveTool = null,
  liveReasoning = '',
  liveBuffer = '',
  lastEventAt = 0,
  error = null,
  onRetry = null,
} = {}) {
  const engineRef = useRef(null)
  if (!engineRef.current) {
    engineRef.current = new StageEngine()
  }
  const engine = engineRef.current

  // Detect reduced motion
  const [isReducedMotion, setIsReducedMotion] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setIsReducedMotion(mq.matches)
    const handler = (e) => setIsReducedMotion(e.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])

  // Derive stage from active stream state
  const stage = useMemo(() => {
    return computeAgentStage({
      running,
      status,
      liveTool,
      liveReasoning,
      liveBuffer,
      error,
    })
  }, [running, status, liveTool, liveReasoning, liveBuffer, error])

  // Track turn start / reset
  const prevRunningRef = useRef(false)
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      engine.startTurn(Date.now())
    }
    prevRunningRef.current = running
  }, [running, engine])

  // Keep engine in sync with stage, liveTool, and lastEventAt
  useEffect(() => {
    engine.setStage(stage, liveTool)
  }, [stage, liveTool, engine])

  useEffect(() => {
    if (lastEventAt) {
      engine.setLastEventAt(lastEventAt)
    }
  }, [lastEventAt, engine])

  // Local state for UI re-render on ticks
  const [displayState, setDisplayState] = useState(() => ({
    displayLabel: engine.getDisplayLabel(),
    elapsedSeconds: engine.getElapsedSeconds(),
    showTimer: engine.shouldShowTimer(),
    isStalled: false,
  }))

  useEffect(() => {
    if (!running && stage === 'idle') {
      setDisplayState({
        displayLabel: engine.getDisplayLabel(),
        elapsedSeconds: engine.getElapsedSeconds(),
        showTimer: engine.shouldShowTimer(),
        isStalled: false,
      })
      return
    }

    const interval = setInterval(() => {
      engine.tick()
      const label = engine.getDisplayLabel()
      const elapsed = engine.getElapsedSeconds()
      const showTimer = engine.shouldShowTimer()
      const isStalled = label === 'Still working...' || label === 'Provider seems slow'

      setDisplayState({
        displayLabel: label,
        elapsedSeconds: elapsed,
        showTimer,
        isStalled,
      })
    }, 400)

    return () => clearInterval(interval)
  }, [running, stage, engine])

  return {
    stage,
    displayLabel: displayState.displayLabel,
    elapsedSeconds: displayState.elapsedSeconds,
    showTimer: displayState.showTimer,
    isStalled: displayState.isStalled,
    isReducedMotion,
    onRetry,
  }
}

export default useAgentStage
