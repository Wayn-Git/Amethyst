import { useEffect, useState } from 'react'

export const DEFAULT_WORLD_ZONES = ['Europe/London', 'America/New_York', 'Asia/Tokyo']

const CITY_ALIASES = {
  Calcutta: 'Kolkata',
  Kolkata: 'Kolkata',
  Saigon: 'Ho Chi Minh City',
}

// Align updates to the next second or minute so the display never drifts.
export function useClock(seconds = false) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer
    const update = () => setNow(new Date())
    const schedule = () => {
      const unit = seconds ? 1000 : 60000
      const delay = unit - (Date.now() % unit) + 20
      timer = setTimeout(() => { update(); schedule() }, delay)
    }
    schedule()
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [seconds])
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
  const name = String(value ?? '').split('/').at(-1).replaceAll('_', ' ')
  return CITY_ALIASES[name] || name
}

export function zoneLabel(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function zonedParts(now, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const read = type => Number(parts.find(part => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') }
}

function zoneOffsetMinutes(now, zone) {
  try {
    const parts = zonedParts(now, zone)
    const zoned = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    return Math.round((zoned - Math.floor(now.getTime() / 1000) * 1000) / 60000)
  } catch { return 0 }
}

export function relativeOffset(now, zone) {
  try {
    return zoneOffsetMinutes(now, zone) - zoneOffsetMinutes(now, Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch { return 0 }
}

export function offsetLabel(minutes) {
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`
}

export function dayRelation(now, zone) {
  try {
    const local = zonedParts(now, Intl.DateTimeFormat().resolvedOptions().timeZone)
    const target = zonedParts(now, zone)
    const localDay = Date.UTC(local.year, local.month - 1, local.day)
    const targetDay = Date.UTC(target.year, target.month - 1, target.day)
    const delta = Math.round((targetDay - localDay) / 86400000)
    return delta === -1 ? 'Yesterday' : delta === 1 ? 'Tomorrow' : 'Today'
  } catch { return 'Today' }
}

export function formatTime(now, zone) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }).formatToParts(now)
    const read = type => parts.find(part => part.type === type)?.value || ''
    const hour = read('hour').replace(/^0(?=\d)/, '')
    const minute = read('minute').padStart(2, '0')
    return { text: `${hour}:${minute}`, period: read('dayPeriod') }
  } catch { return { text: '--:--', period: '' } }
}

export function timeLabel(time) {
  return time.period ? `${time.text} ${time.period}` : time.text
}

export function formatDate(now, zone) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(zone ? { timeZone: zone } : {}) }).formatToParts(now)
    const read = type => parts.find(part => part.type === type)?.value || ''
    return [read('weekday'), read('day'), read('month')].filter(Boolean).join(' ')
  } catch { return '' }
}
