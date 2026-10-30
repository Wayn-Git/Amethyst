import { useEffect, useMemo, useRef, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import { Button, Input } from '../../components/ui/bento/index.jsx'
import { deviceLocation } from '../location.js'
import design from '../../../../widgets/glance.travel/design.json'
import template from '../../../../widgets/glance.travel/template.txt?raw'
import { variationNumber } from '../widgetVariations.js'
import './travel/travel.css'

function themePalette(theme) {
  return Object.fromEntries(
    Object.entries(design.palette).map(([key, value]) => [key, value[theme] || value.light]),
  )
}

function eventTime(value, timezone) {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined,
    }).format(date)
  } catch {
    return ''
  }
}

function adaptTravel(data, layout, theme) {
  const event = Array.isArray(data?.items) ? data.items[0] : null
  const unavailable = event?.id === 'unavailable'
  const hasDuration = Number.isFinite(data?.duration_seconds) && data.duration_seconds >= 0
  return {
    layout,
    durationMinutes: hasDuration ? Math.ceil(data.duration_seconds / 60) : null,
    eventName: typeof data?.event_title === 'string' ? data.event_title : '',
    destination: typeof data?.destination === 'string' ? data.destination : event?.location || '',
    eventStartTime: eventTime(data?.start || event?.start, data?.timezone),
    homeOrigin: typeof data?.home === 'string' ? data.home : '',
    labels: {
      ...design.labels,
      waiting: data?.set_location
        ? 'Set a trip origin in settings.'
        : data?.message || (unavailable ? 'Travel estimate unavailable.' : design.labels.waiting),
    },
    palette: themePalette(theme),
  }
}

export default function TravelGlance({ data, size = 'm', full = false, refresh, design }) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  const [home, setHome] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [notice, setNotice] = useState('')
  const live = useRef(false)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    live.current = true
    request('/widgets/glance.travel/settings')
      .then(value => { if (live.current && value?.home) setHome(value.home) })
      .catch(() => {})
    return () => { live.current = false }
  }, [])

  async function locate() {
    setBusy(true)
    setSettingsError('')
    setNotice('')
    try {
      const value = await deviceLocation()
      if (live.current) {
        setHome(`${value.latitude}, ${value.longitude}`)
        setNotice('Current location filled. Save to use it as trip origin.')
      }
    } catch (error) {
      if (live.current) setSettingsError(error.message)
    } finally {
      if (live.current) setBusy(false)
    }
  }

  async function saveOrigin(event) {
    event.preventDefault()
    setBusy(true)
    setSettingsError('')
    try {
      await request('/widgets/glance.travel/settings', 'PUT', {
        home: home.trim(),
        direction: 'minimal',
        enabled: true,
      })
      setNotice('Trip origin saved.')
      await refresh?.()
    } catch (error) {
      setSettingsError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const layout = full || size === 'l' ? 'large' : size === 's' ? 'small' : 'medium'
  const widgetData = useMemo(() => adaptTravel(data, layout, theme), [data, layout, theme])

  return (
    <div className="glance-travel-root" data-variation={variationNumber(design)}>
      <WidgetRenderer template={template} data={widgetData} theme={theme} />
      {full && (
        <form className="adoption-stack" onSubmit={saveOrigin}>
          <label htmlFor="travel-origin">Home trip origin</label>
          <Input
            id="travel-origin"
            name="home"
            required
            maxLength={500}
            placeholder="Address or coordinates"
            value={home}
            onChange={event => setHome(event.target.value)}
            disabled={busy}
          />
          <div>
            <Button type="button" disabled={busy} onClick={locate}>Use current location</Button>
            <Button type="submit" disabled={busy || !home.trim()}>{busy ? 'Saving…' : 'Save origin'}</Button>
          </div>
          {notice && <p role="status">{notice}</p>}
          {settingsError && <p role="alert">{settingsError}</p>}
        </form>
      )}
    </div>
  )
}
