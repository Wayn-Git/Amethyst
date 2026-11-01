import { useMemo, useState, useEffect, useRef } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import { Button, Input } from '../../components/ui/bento/index.jsx'
import { deviceLocation } from '../location.js'
import Icon from '../../components/Icon.jsx'
import template from '../../../../widgets/glance.travel/template.txt?raw'

const DEFAULT_LABELS = {
  title: 'Travel time',
  nextEvent: 'Next event',
  origin: 'From',
  loading: 'Loading',
  refreshing: 'Refreshing',
  noEvent: 'No upcoming events with a location',
  setLocation: 'Set trip origin in settings',
  notConnected: 'Connect Calendar & Maps in settings',
  unavailable: 'Travel estimate unavailable',
  notAvailable: 'Not available',
}

function adaptTravel(data) {
  if (!data) {
    return {
      status: 'loading',
      labels: DEFAULT_LABELS,
    }
  }

  if (data.set_location) {
    return {
      status: 'empty',
      message: 'Choose where your trip starts in settings.',
      labels: DEFAULT_LABELS,
    }
  }

  const items = Array.isArray(data.items) ? data.items : []
  const event = items[0]
  if (!event || event.id === 'setup' || event.id === 'unavailable') {
    return {
      status: 'empty',
      message: data.message || 'No upcoming event with a location.',
      labels: DEFAULT_LABELS,
    }
  }

  const detail = event.detail || ''
  const durationMatch = detail.match(/^([0-9]+\s*min(?:ute)?s?|[0-9]+\s*h(?:our)?s?(?:\s*[0-9]+\s*min)?)/i)
  const duration = durationMatch ? durationMatch[1] : (detail.split('(')[0]?.trim() || undefined)
  const route = detail.includes('(') ? detail.slice(detail.indexOf('(') + 1).replace(/\)$/, '') : detail

  let eventTime
  if (event.start) {
    const startMs = new Date(event.start).getTime()
    if (!Number.isNaN(startMs)) {
      const diffMin = Math.round((startMs - Date.now()) / 60000)
      if (diffMin <= 0) {
        eventTime = 'Started'
      } else if (diffMin < 60) {
        eventTime = `in ${diffMin} min`
      } else {
        const hrs = Math.floor(diffMin / 60)
        const mins = diffMin % 60
        eventTime = `in ${hrs}h ${mins}m`
      }
    }
  }

  return {
    status: data.refreshing ? 'refreshing' : 'ready',
    message: data.message || '',
    lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    duration,
    eventTitle: event.title,
    eventTime,
    route,
    origin: 'Home',
    labels: DEFAULT_LABELS,
  }
}

export default function TravelGlance({ data, onAction, refresh, full = false }) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )

  // Drawer origin settings state
  const [home, setHome] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [notice, setNotice] = useState('')
  const live = useRef(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    live.current = true
    request('/widgets/glance.travel/settings')
      .then(value => { if (active) setHome(value?.home || '') })
      .catch(() => {})
    return () => { active = false; live.current = false }
  }, [])

  async function locate() {
    setBusy(true); setSettingsError(''); setNotice('')
    try {
      const value = await deviceLocation()
      if (live.current) { setHome(`${value.latitude}, ${value.longitude}`); setNotice('Current location filled. Save to use it as trip origin.') }
    } catch (err) { if (live.current) setSettingsError(err.message) }
    finally { if (live.current) setBusy(false) }
  }

  async function saveOrigin(event) {
    event.preventDefault()
    setBusy(true); setSettingsError('')
    try {
      await request('/widgets/glance.travel/settings', 'PUT', { home: home.trim(), enabled: true })
      setNotice('Trip origin saved.')
      await refresh?.()
    } catch (e) { setSettingsError(e.message) }
    finally { setBusy(false) }
  }

  const widgetData = useMemo(() => adaptTravel(data), [data])

  return (
    <div className="glance-travel-root">
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={onAction}
      />
      {full && (
        <div style={{ marginTop: '16px' }} className="adoption-stack">
          <form onSubmit={saveOrigin}>
            <label style={{ display: 'block', marginBottom: '8px' }}>
              Home trip origin
              <Input
                name="home"
                required
                maxLength={500}
                placeholder="Address or coordinates"
                value={home}
                onChange={e => setHome(e.target.value)}
                disabled={busy}
              />
            </label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <Button disabled={busy} onClick={locate} type="button">
                <Icon name="target" size={16} /> Use current location
              </Button>
              <Button variant="primary" type="submit" loading={busy} disabled={!home.trim()}>
                Save origin
              </Button>
            </div>
          </form>
          {notice && <p role="status" style={{ fontSize: '13px', color: 'var(--w-text-2)' }}>{notice}</p>}
          {settingsError && <p role="alert" style={{ fontSize: '13px', color: 'var(--w-negative)' }}>{settingsError}</p>}
        </div>
      )}
    </div>
  )
}
