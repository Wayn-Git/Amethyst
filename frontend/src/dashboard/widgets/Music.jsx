import { useState } from 'react'
import { SkipBack, SkipForward } from '@phosphor-icons/react'
import { StateView } from '../primitives.jsx'
import { cached, remember, request } from '../api.js'
import { getBase } from '../../api.js'
import { Button, Chip, Select } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'

export default function Music({ data, refresh, full = true, size = 'l' }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState(() => cached('music-player') || '')
  const [failedArtwork, setFailedArtwork] = useState('')
  const players = data?.players || []
  const session = selectedPlayer ? players.find(player => player.player_id === selectedPlayer) : data
  const item = selectedPlayer ? session && { title: session.title || session.active_player, artists: session.artists } : data?.items?.[0]
  const playing = session?.status === 'Playing'
  const artwork = session?.artwork_url?.startsWith('/api/') ? getBase().replace(/\/api$/, '') + session.artwork_url : session?.artwork_url
  function selectPlayer(value) { setSelectedPlayer(value); remember('music-player', value); setError(''); setDraft(null) }
  async function propose(action) {
    setBusy(true); setError('')
    try {
      setDraft({ ...await request(`/widgets/glance.music/actions/${action}`, 'POST', { player: session.player_id, track_id: session.track_id || '' }), playerName: session.active_player })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/glance.music/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (approved && result.state !== 'applied') setError('Permission denied. Playback was not changed.')
      await refresh()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="desktop-music">
    {(players.length > 1 || selectedPlayer) && <label className="music-player-picker" hidden={!full && size !== 'l' && Boolean(session)}>Player<Select aria-label="Media player" disabled={busy || !!draft} value={selectedPlayer} onChange={event => selectPlayer(event.target.value)}><option value="">Automatic · active player</option>{selectedPlayer && !session && <option value={selectedPlayer}>Selected player unavailable</option>}{players.map(player => <option key={player.player_id} value={player.player_id}>{player.active_player} · {player.status}</option>)}</Select></label>}
    {error && <StateView role="alert">{error}</StateView>}
    {draft ? <section className="music-review" aria-label="Review playback change">
      <p>{draft.action} on {draft.playerName}?</p>
      <div className="music-controls"><Button size="small" loading={busy} onClick={() => decide(true)}>Approve playback</Button><Button size="small" disabled={busy} onClick={() => decide(false)}>Cancel</Button></div>
    </section> : item ? <>
      <div className="music-track"><span className="music-art" aria-hidden="true">{artwork && failedArtwork !== artwork ? <img src={artwork} alt="" referrerPolicy="no-referrer" onError={() => setFailedArtwork(artwork)} /> : <Icon name="music" size={32} />}</span><div><strong title={item.title}>{item.title}</strong><p>{item.artists?.join(', ')}</p>{session.album && <p className="music-album">{session.album}</p>}</div></div>
      <div className="music-transport"><span className="music-player">{session?.active_player} {session.status && <Chip>{session.status}</Chip>}</span><div className="music-controls">
        <Button size="small" variant="ghost" aria-label="Previous track" disabled={busy || !session.controls?.previous} onClick={() => propose('previous')}><SkipBack size={20} aria-hidden="true" /></Button>
        <Button size="small" variant="primary" aria-label={playing ? 'Pause music' : 'Play music'} disabled={busy || !session.controls?.[playing ? 'pause' : 'play']} onClick={() => propose(playing ? 'pause' : 'play')}><Icon name={playing ? 'pause' : 'play'} size={16} /></Button>
        <Button size="small" variant="ghost" aria-label="Next track" disabled={busy || !session.controls?.next} onClick={() => propose('next')}><SkipForward size={20} aria-hidden="true" /></Button>
      </div></div>
    </> : <StateView>{selectedPlayer ? 'This player is no longer available. Choose another player above.' : 'No desktop player available. Open a music player with desktop media controls.'}</StateView>}
  </div>
}
