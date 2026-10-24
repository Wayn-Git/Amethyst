import { useCallback, useEffect, useRef, useState } from 'react'
import { cached, remember, request } from './api.js'

export function useWidget(manifest, quiet, refreshVersion, onData) {
  const [data, setData] = useState(() => {
    const old = cached(manifest.id)
    return old ? { ...old, state: old.payload == null ? old.state : 'stale', stale: old.payload != null } : { state: 'loading', payload: null, synced_at: null }
  })
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const serial = useRef(0)
  const load = useCallback(async (force = false) => {
    const token = ++serial.current
    setBusy(true)
    try {
      const value = await request(`/widgets/${manifest.id}/${force ? 'refresh' : 'data'}`, force ? 'POST' : 'GET')
      if (!mounted.current || token !== serial.current) return
      setData(value); remember(manifest.id, value)
    } catch (error) {
      if (!mounted.current || token !== serial.current) return
      setData(old => ({ ...old, state: old.payload != null ? 'stale' : 'error', stale: old.payload != null, refreshing: false, error: error.message }))
    } finally { if (mounted.current && token === serial.current) setBusy(false) }
  }, [manifest.id])
  useEffect(() => {
    mounted.current = true
    // External data synchronization; each widget owns its request lifecycle.
    // oxlint-disable-next-line react/set-state-in-effect
    load()
    // Invalidate the latest request, including requests started after this effect.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; ++serial.current }
  }, [load])
  useEffect(() => {
    if (!refreshVersion) return
    // oxlint-disable-next-line react/set-state-in-effect
    load(true)
  }, [refreshVersion, load])
  useEffect(() => {
    const changed = () => { if (manifest.id.startsWith('task.') || manifest.id.startsWith('need.') || manifest.id.startsWith('lib.') || manifest.id.startsWith('dev.') || manifest.id.startsWith('feed.')) load(true) }
    window.addEventListener('dashboard-items-changed', changed)
    return () => window.removeEventListener('dashboard-items-changed', changed)
  }, [load, manifest.id])
  useEffect(() => {
    onData(manifest.id, data)
  }, [manifest.id, data, onData])
  useEffect(() => {
    if (!data.refreshing) return
    const timer = setTimeout(() => load(), 500)
    return () => clearTimeout(timer)
  }, [data.refreshing, data, load])
  useEffect(() => {
    if (quiet || manifest.refresh.mode !== 'poll') return
    const timer = setInterval(() => { if (!document.hidden) load() }, manifest.refresh.interval_s * 1000)
    return () => clearInterval(timer)
  }, [quiet, manifest.refresh.mode, manifest.refresh.interval_s, load])
  return { data, busy, refresh: () => load(true) }
}
