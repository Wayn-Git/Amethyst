import { useState } from 'react'
import { SkipBack, SkipForward } from '@phosphor-icons/react'
import { StateView } from '../primitives.jsx'
import { request } from '../api.js'
import { Button, Chip } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'

export default function Music({ data, refresh }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const item = data?.items?.[0]
  const playing = data?.status === 'Playing'
  async function propose(action) {
    setBusy(true); setError('')
    try {
      setDraft(await request(`/widgets/glance.music/actions/${action}`, 'POST', { player: data.player_id, track_id: data.track_id || '' }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/glance.music/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (approved && result.state !== 'applied') setError('Permission denied. Playback was not changed.')
      await refresh()
    } catch (err) { setError(err.message); setDraft(null) } finally { setBusy(false) }
  }
  return <div className="desktop-music">
    {error && <StateView role="alert">{error}</StateView>}
    {draft ? <section className="music-review" aria-label="Review playback change">
      <p>{draft.action} on {data.active_player}?</p>
      <div className="music-controls"><Button size="small" loading={busy} onClick={() => decide(true)}>Approve playback</Button><Button size="small" disabled={busy} onClick={() => decide(false)}>Cancel</Button></div>
    </section> : item ? <>
      <div className="music-track"><span className="music-art" aria-hidden="true"><Icon name="music" size={32} /></span><div><strong title={item.title}>{item.title}</strong><p>{item.artists?.join(', ')}</p>{data.album && <p className="music-album">{data.album}</p>}</div></div>
      <div className="music-transport"><span className="music-player">{data.active_player} {data.status && <Chip>{data.status}</Chip>}</span><div className="music-controls">
        <Button size="small" variant="ghost" aria-label="Previous track" disabled={busy || !data.controls?.previous} onClick={() => propose('previous')}><SkipBack size={20} aria-hidden="true" /></Button>
        <Button size="small" variant="primary" aria-label={playing ? 'Pause music' : 'Play music'} disabled={busy || !data.controls?.[playing ? 'pause' : 'play']} onClick={() => propose(playing ? 'pause' : 'play')}><Icon name={playing ? 'pause' : 'play'} size={16} /></Button>
        <Button size="small" variant="ghost" aria-label="Next track" disabled={busy || !data.controls?.next} onClick={() => propose('next')}><SkipForward size={20} aria-hidden="true" /></Button>
      </div></div>
    </> : <StateView>No desktop player available. Open a music player with desktop media controls.</StateView>}
  </div>
}
