import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { StateView } from '../primitives.jsx'
import { request } from '../api.js'
import { Button } from '../../components/ui/bento/index.jsx'
import template from '../../../../widgets/glance.music/template.txt?raw'
import { variationNumber } from '../widgetVariations.js'
import './music/music.css'

const FALLBACK_IMAGES = {
  minimal: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/cc/0d/a7/cc0da7d8-e73c-ca80-d3d9-347a99254c7f/cover.jpg/1200x1200bf-60.jpg',
  immersive: 'https://f4.bcbits.com/img/a3309701101_16.jpg',
  rich: 'https://images.universal-music.de/img/assets/236/236934/4/2048/norah-jones-come-away-with-me-cover.jpg',
  editorial: 'https://cdn.shopify.com/s/files/1/0881/4568/products/BonIver-ForEmmaForeverAgo_1_800x.jpg?v=1605041850',
}

const DESIGN_MAP = {
  minimal: 'minimal',
  woodland: 'minimal',
  immersive: 'immersive',
  'open-water': 'immersive',
  'deep-water': 'immersive',
  rich: 'rich',
  'blue-note': 'rich',
  editorial: 'editorial',
  'white space': 'editorial',
  window: 'editorial',
}

function resolveActiveDesign(selectedDesign) {
  const s = String(selectedDesign || '').toLowerCase()
  if (DESIGN_MAP[s]) return DESIGN_MAP[s]
  const num = variationNumber(s)
  if (num === 1) return 'minimal'
  if (num === 2) return 'immersive'
  if (num === 3) return 'rich'
  if (num === 4) return 'editorial'
  return 'minimal'
}

function formatMinutes(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const PREVIEW_FIXTURES = {
  minimal: {
    title: 'Ghost',
    artist: 'Justin Bieber',
    album: 'Justice',
    artwork_url: FALLBACK_IMAGES.minimal,
    status: 'Playing',
    position: 48,
    duration: 153,
    active_player: 'Apple Music',
  },
  immersive: {
    title: 'Starboy',
    artist: 'The Weeknd, Daft Punk',
    album: 'Starboy',
    artwork_url: FALLBACK_IMAGES.immersive,
    status: 'Playing',
    position: 72,
    duration: 230,
    active_player: 'Apple Music',
  },
  rich: {
    title: 'Come Away With Me',
    artist: 'Norah Jones',
    album: 'Come Away With Me',
    artwork_url: FALLBACK_IMAGES.rich,
    status: 'Playing',
    position: 95,
    duration: 198,
    active_player: 'Apple Music',
  },
  editorial: {
    title: 'Skinny Love',
    artist: 'Bon Iver',
    album: 'For Emma, Forever Ago',
    artwork_url: FALLBACK_IMAGES.editorial,
    status: 'Playing',
    position: 64,
    duration: 239,
    active_player: 'Apple Music',
  },
}

function adaptMusic(data, size, selectedDesign, preview = false) {
  const activeDesign = resolveActiveDesign(selectedDesign)
  const isPreviewFallback = preview && !data?.title
  const effectiveData = isPreviewFallback ? (PREVIEW_FIXTURES[activeDesign] || PREVIEW_FIXTURES.minimal) : data

  const hasTrack = Boolean(effectiveData?.title)
  const playing = effectiveData?.status === 'Playing'

  const title = hasTrack ? effectiveData.title : 'Nothing playing'
  const artist = Array.isArray(effectiveData?.artists) && effectiveData.artists.length
    ? effectiveData.artists.filter(Boolean).join(', ')
    : (effectiveData?.artist || (hasTrack ? 'Unknown Artist' : 'No active player'))
  const album = effectiveData?.album || (hasTrack ? 'Desktop Audio' : 'Sound Studies')
  const shortAlbum = effectiveData?.album ? effectiveData.album.slice(0, 20) : (hasTrack ? 'Now Playing' : 'Silent')
  const year = typeof effectiveData?.year === 'string' || typeof effectiveData?.year === 'number' ? String(effectiveData.year) : '2026'

  const elapsed = Number.isFinite(effectiveData?.position) && effectiveData.position >= 0 ? effectiveData.position : 0
  const duration = Number.isFinite(effectiveData?.duration) && effectiveData.duration > 0 ? effectiveData.duration : (elapsed > 0 ? elapsed + 60 : 180)
  const elapsedStr = formatMinutes(elapsed)
  const remainingStr = `−${formatMinutes(Math.max(0, duration - elapsed))}`
  const durationStr = formatMinutes(duration)

  const image = effectiveData?.artwork_url || FALLBACK_IMAGES[activeDesign]
  const immersiveBg = `linear-gradient(135deg, rgba(20, 15, 22, 0.88), rgba(16, 12, 18, 0.65)), url('${image}') center / cover`
  const device = effectiveData?.active_player ? `${effectiveData.active_player} · Mac` : 'Mac Speakers'

  const makeAction = actionName => effectiveData?.player_id
    ? {
        type: `glance.music.${actionName}`,
        payload: { player: effectiveData.player_id, track_id: effectiveData.track_id || '' },
      }
    : null

  const previousAction = makeAction('previous')
  const toggleAction = makeAction(playing ? 'pause' : 'play')
  const nextAction = makeAction('next')

  return {
    activeDesign,
    size,
    hasTrack,
    image,
    immersiveBg,
    title,
    artist,
    album,
    shortAlbum,
    year,
    elapsed,
    duration,
    elapsedStr,
    remainingStr,
    durationStr,
    playing,
    device,
    previousAction,
    toggleAction,
    nextAction,
  }
}

export default function Music({ data, refresh, size = 'm', design, preview = false }) {
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

  const widgetData = useMemo(() => adaptMusic(data, size, design, preview), [data, size, design, preview])

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
