import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { StateView } from '../primitives.jsx'
import { request } from '../api.js'
import { Button } from '../../components/ui/bento/index.jsx'
import design from '../../../../widgets/glance.music/design.json'
import template from '../../../../widgets/glance.music/template.txt?raw'
import { variationNumber } from '../widgetVariations.js'
import './music/music.css'

function resolve(value, theme) {
  if (!value || typeof value !== 'object') return value
  return value[theme] || value.light || null
}

function adaptMusic(data, layout, theme) {
  const track = Boolean(data?.title)
  const action = name => data?.controls?.[name] && data.player_id
    ? {
        type: `glance.music.${name}`,
        payload: { player: data.player_id, track_id: data.track_id || '' },
      }
    : null
  const state = data?.status === 'Playing' ? 'playing' : data?.status === 'Paused' ? 'paused' : 'stopped'
  const artist = Array.isArray(data?.artists) ? data.artists.filter(value => typeof value === 'string').join(', ') : ''
  const metadata = typeof data?.album === 'string' && data.album.trim()
    ? [{ label: 'Album', value: data.album }]
    : []

  return {
    layout,
    surfaces: Object.fromEntries(
      Object.entries(design.surfaces).map(([key, value]) => [key, resolve(value, theme)]),
    ),
    progressAccent: resolve(design.progressAccent, theme),
    labels: design.labels,
    stateLabels: design.stateLabels,
    playback: {
      hasTrack: track,
      title: track ? data.title : '',
      artist,
      state,
      elapsedSeconds: Number.isFinite(data?.position) && data.position >= 0 ? data.position : null,
      durationSeconds: Number.isFinite(data?.duration) && data.duration > 0 ? data.duration : null,
      previousAction: action('previous'),
      playAction: action('play'),
      pauseAction: action('pause'),
      nextAction: action('next'),
      metadata,
    },
  }
}

export default function Music({ data, refresh, full = false, size = 'm', design }) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  async function handleAction(action) {
    const match = typeof action?.type === 'string' && action.type.match(/^glance\.music\.(play|pause|previous|next)$/)
    if (!match || !action.payload) return
    setBusy(true)
    setError('')
    try {
      const result = await request(`/widgets/glance.music/actions/${match[1]}`, 'POST', action.payload)
      setDraft({ ...result, action: match[1], playerName: data?.active_player || 'Player' })
    } catch (cause) {
      setError(cause.message || 'Playback action could not be prepared.')
    } finally {
      setBusy(false)
    }
  }

  async function decide(approved) {
    if (!draft?.draft_id || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await request(`/widgets/glance.music/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (approved && result.state !== 'applied') setError('Permission denied. Playback was not changed.')
      if (refresh) await refresh()
    } catch (cause) {
      setError(cause.message || 'Playback approval failed.')
    } finally {
      setBusy(false)
    }
  }

  const layout = full || size === 'l' ? 'large' : size === 's' ? 'small' : 'medium'
  const widgetData = useMemo(() => adaptMusic(data, layout, theme), [data, layout, theme])

  return (
    <div className="music-widget" data-music-size={size} data-variation={variationNumber(design)}>
      <WidgetRenderer template={template} data={widgetData} theme={theme} onAction={handleAction} />
      {error && <StateView role="alert">{error}</StateView>}
      {draft && (
        <section className="music-review" aria-label="Review playback change">
          <p>{draft.action} on {draft.playerName}?</p>
          <div className="music-review-actions">
            <Button type="button" variant="primary" disabled={busy} onClick={() => decide(true)}>Approve playback</Button>
            <Button type="button" disabled={busy} onClick={() => decide(false)}>Cancel</Button>
          </div>
        </section>
      )}
    </div>
  )
}
