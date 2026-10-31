import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { useState } from 'react'
import { StateView } from '../primitives.jsx'
import { cached, remember, request } from '../api.js'
import { getBase } from '../../api.js'
import { Button, Select } from '../../components/ui/bento/index.jsx'
import { useDashboard } from '../context.js'
import { DEFAULT_MUSIC_DESIGN, getMusicDesign, MUSIC_DESIGNS } from './music/designs.js'
import NowPlayingCard from './music/NowPlayingCard.jsx'
import './music/music.css'

function DesignPicker({ design, changeDesign }) {
  return (
    <fieldset className="music-picker">
      <legend>Now Playing style</legend>
      <RadioGroup
        className="music-picker-grid"
        value={design}
        onValueChange={value => changeDesign?.('glance.music', value)}
      >
        {MUSIC_DESIGNS.map(d => (
          <Radio.Root className="music-picker-option" key={d.id} value={d.id}>
            <strong>{d.name}</strong>
            <small>{d.caption}</small>
          </Radio.Root>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

export default function Music({
  data,
  refresh,
  full = false,
  size = 'm',
  design = DEFAULT_MUSIC_DESIGN,
  onOpen,
}) {
  const { changeDesign } = useDashboard() || {}
  const activeDesign = getMusicDesign(design)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState(() => cached('music-player') || '')
  const [failedArtwork, setFailedArtwork] = useState('')

  const players = data?.players || []
  const session = selectedPlayer ? players.find(player => player.player_id === selectedPlayer) : data
  const item = selectedPlayer
    ? session && { title: session.title || session.active_player, artists: session.artists }
    : data?.items?.[0]
  const playing = session?.status === 'Playing'
  const artwork = session?.artwork_url?.startsWith('/api/')
    ? getBase().replace(/\/api$/, '') + session.artwork_url
    : session?.artwork_url

  function selectPlayer(value) {
    setSelectedPlayer(value)
    remember('music-player', value)
    setError('')
    setDraft(null)
  }

  async function propose(action) {
    setBusy(true)
    setError('')
    try {
      const payload = {
        player: session?.player_id,
        track_id: session?.track_id || '',
      }
      const response = await request(`/widgets/glance.music/actions/${action}`, 'POST', payload)
      setDraft({ ...response, playerName: session?.active_player || 'Player' })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function decide(approved) {
    setBusy(true)
    setError('')
    try {
      const result = await request(`/widgets/glance.music/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (approved && result.state !== 'applied') {
        setError('Permission denied. Playback was not changed.')
      }
      if (refresh) await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const playerPicker = (players.length > 1 || selectedPlayer) && (
    <label className="music-player-picker" hidden={!full && size !== 'l' && Boolean(session)}>
      Player
      <Select
        aria-label="Media player"
        disabled={busy || !!draft}
        value={selectedPlayer}
        onChange={event => selectPlayer(event.target.value)}
      >
        <option value="">Automatic · active player</option>
        {selectedPlayer && !session && (
          <option value={selectedPlayer}>Selected player unavailable</option>
        )}
        {players.map(player => (
          <option key={player.player_id} value={player.player_id}>
            {player.active_player} · {player.status}
          </option>
        ))}
      </Select>
    </label>
  )

  // Drawer / Full settings view
  if (full) {
    return (
      <div className="music-widget music-widget--settings" data-music-size={size} data-music-design={activeDesign.id}>
        <DesignPicker design={activeDesign.id} changeDesign={changeDesign} />
        {playerPicker}
        {error && <StateView role="alert">{error}</StateView>}
        {draft ? (
          <section className="music-review" aria-label="Review playback change">
            <p>{draft.action} on {draft.playerName}?</p>
            <div className="music-controls music-review-actions">
              <Button size="small" loading={busy} onClick={() => decide(true)}>Approve playback</Button>
              <Button size="small" disabled={busy} onClick={() => decide(false)}>Cancel</Button>
            </div>
          </section>
        ) : item ? (
          <div className="music-card" style={{ cursor: 'default' }}>
            <NowPlayingCard
              size={size}
              design={activeDesign.id}
              item={item}
              session={session}
              artwork={failedArtwork === artwork ? null : artwork}
              playing={playing}
              busy={busy}
              propose={propose}
              onArtworkError={setFailedArtwork}
            />
          </div>
        ) : (
          <StateView>
            {selectedPlayer
              ? 'This player is no longer available. Choose another player above.'
              : 'Open a desktop music player to start listening.'}
          </StateView>
        )}
      </div>
    )
  }

  // Dashboard / Inline view
  if (!item && !session?.active_player) {
    return (
      <div className="music-widget" data-music-size={size} data-music-design={activeDesign.id}>
        {playerPicker}
        <StateView>
          {selectedPlayer
            ? 'This player is no longer available. Choose another player above.'
            : 'Open a desktop music player to start listening.'}
        </StateView>
      </div>
    )
  }

  return (
    <div className="music-widget" data-music-size={size} data-music-design={activeDesign.id}>
      {playerPicker}
      {error && <StateView role="alert">{error}</StateView>}
      <Button
        type="button"
        variant="plain"
        className="music-card"
        onClick={onOpen}
        aria-label={`Now Playing, ${item?.title || 'No track'}`}
      >
        <NowPlayingCard
          size={size}
          design={activeDesign.id}
          item={item}
          session={session}
          artwork={failedArtwork === artwork ? null : artwork}
          playing={playing}
          busy={busy}
          propose={propose}
          onArtworkError={setFailedArtwork}
        />
        {draft && (
          <section className="music-review music-review-overlay" aria-label="Review playback change" onClick={e => e.stopPropagation()}>
            <p>{draft.action} on {draft.playerName}?</p>
            <div className="music-controls music-review-actions">
              <Button size="small" loading={busy} onClick={() => decide(true)}>Approve playback</Button>
              <Button size="small" disabled={busy} onClick={() => decide(false)}>Cancel</Button>
            </div>
          </section>
        )}
      </Button>
    </div>
  )
}
