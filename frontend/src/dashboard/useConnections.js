import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from './api.js'

export default function useConnections() {
  const [data, setData] = useState({ items: [], configured: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const active = useRef(false)
  const pending = useRef(null)
  const previous = useRef(null)
  const refresh = useCallback(() => {
    if (pending.current) return pending.current
    setBusy(true)
    pending.current = request('/connectors/health?force=true').then(value => {
      if (!active.current) return
      const rows = value.items || []
      const changed = rows.filter(row => !previous.current || previous.current[row.id] !== `${row.status}:${row.account_id || ''}`).map(row => row.id)
      previous.current = Object.fromEntries(rows.map(row => [row.id, `${row.status}:${row.account_id || ''}`]))
      setData(old => JSON.stringify(old) === JSON.stringify(value) ? old : value)
      setError('')
      if (changed.length) window.dispatchEvent(new CustomEvent('dashboard-connectors-changed', { detail: { toolkits: changed } }))
    }).catch(cause => { if (active.current) setError(cause.message) }).finally(() => { pending.current = null; if (active.current) setBusy(false) })
    return pending.current
  }, [])
  useEffect(() => {
    active.current = true
    refresh()
    const visible = () => { if (!document.hidden) refresh() }
    const storage = event => { if (event.key === 'amethyst.connectors.changed') refresh() }
    window.addEventListener('focus', visible)
    window.addEventListener('connectors-changed', refresh)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', visible)
    return () => { active.current = false; window.removeEventListener('focus', visible); window.removeEventListener('connectors-changed', refresh); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  return { data, error, busy, refresh }
}
