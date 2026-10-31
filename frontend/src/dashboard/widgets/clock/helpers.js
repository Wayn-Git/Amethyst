import { useEffect, useState } from 'react'

export function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = setInterval(update, 1000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return now
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export function canonicalZone(value) {
  if (typeof value !== 'string') return null
  try { return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone } catch { return null }
}

export function cityName(value) {
  return String(value ?? '').split('/').at(-1).replaceAll('_', ' ')
}

export function zoneLabel(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

export function zoneOffset(now, zone) {
  try {
    return new Intl.DateTimeFormat([], { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || ''
  } catch { return '' }
}

export function timeParts(now, zone, seconds = false) {
  try {
    return new Intl.DateTimeFormat([], {
      hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
      ...(zone ? { timeZone: zone } : {}),
    }).formatToParts(now)
  } catch { return [] }
}

export function timeText(parts) {
  return parts.filter(part => !['dayPeriod', 'timeZoneName'].includes(part.type)).map(part => part.value).join('').trim()
}

export function zoneDate(now, zone, options = { month: 'short', day: 'numeric' }) {
  try { return now.toLocaleDateString([], { ...options, ...(zone ? { timeZone: zone } : {}) }) } catch { return '' }
}
