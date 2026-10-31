import { BookmarkSimple, Heart, MusicNotes, Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react'
import { useState } from 'react'
import Button from '../../../components/ui/AppButton.jsx'

export function Seek15Back({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 14.93-4" />
      <polyline points="4 8 4 12 8 12" />
      <text x="12" y="16" fill="currentColor" stroke="none" fontSize="8" fontWeight="700" fontFamily="Inter, sans-serif" textAnchor="middle">15</text>
    </svg>
  )
}

export function Seek15Forward({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 12a8 8 0 0 0-14.93-4" />
      <polyline points="20 8 20 12 16 12" />
      <text x="12" y="16" fill="currentColor" stroke="none" fontSize="8" fontWeight="700" fontFamily="Inter, sans-serif" textAnchor="middle">15</text>
    </svg>
  )
}

export function Artwork({ artwork, title, size = 's', onArtworkError }) {
  const [error, setError] = useState(false)
  const showImg = Boolean(artwork && !error)

  return (
    <span className={`music-art music-art--${size}`} aria-hidden="true">
      {showImg ? (
        <img
          src={artwork}
          alt={title ? `${title} album art` : ''}
          referrerPolicy="no-referrer"
          onError={() => {
            setError(true)
            onArtworkError?.(artwork)
          }}
        />
      ) : (
        <div className="music-art-fallback">
          <MusicNotes size={size === 'l' ? 48 : size === 'm' ? 28 : 22} weight="duotone" />
        </div>
      )}
    </span>
  )
}

export default function NowPlayingCard({
  size = 's',
  design = 'now-playing-01',
  item,
  session,
  artwork,
  playing,
  busy,
  propose,
  onArtworkError,
}) {
  const [favorite, setFavorite] = useState(false)
  const title = item?.title || session?.title || 'No track'
  const artists = (item?.artists || session?.artists || []).join(', ') || session?.active_player || ''
  const album = session?.album || ''
  const controls = session?.controls || {}

  function toggleFavorite(e) {
    e.stopPropagation()
    setFavorite(prev => !prev)
  }

  // Pill / Dynamic Island Variation (now-playing-02 from Image 2)
  if (design === 'now-playing-02') {
    return (
      <div className={`music-body music-body--island music-body--${size}`}>
        <div className="music-island-container">
          <Artwork artwork={artwork} title={title} size="pill" onArtworkError={onArtworkError} />
          <div className="music-track-info music-track-info--pill">
            <strong className="music-title" title={title}>{title}</strong>
            <p className="music-subtitle" title={artists}>{artists}</p>
          </div>
          <div className="music-island-controls">
            <Button
              type="button"
              variant="plain"
              className="music-ctrl-btn"
              aria-label="Previous track"
              disabled={busy || !controls.previous}
              onClick={e => { e.stopPropagation(); propose('previous') }}
            >
              <SkipBack size={18} weight="fill" />
            </Button>
            <Button
              type="button"
              variant="plain"
              className="music-ctrl-btn music-ctrl-btn--circle"
              aria-label={playing ? 'Pause music' : 'Play music'}
              disabled={busy || !controls[playing ? 'pause' : 'play']}
              onClick={e => { e.stopPropagation(); propose(playing ? 'pause' : 'play') }}
            >
              {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" style={{ marginLeft: 2 }} />}
            </Button>
            <Button
              type="button"
              variant="plain"
              className="music-ctrl-btn"
              aria-label="Next track"
              disabled={busy || !controls.next}
              onClick={e => { e.stopPropagation(); propose('next') }}
            >
              <SkipForward size={18} weight="fill" />
            </Button>
          </div>
          <div className="music-progress-wrapper" aria-label="Playback progress">
            <div className="music-progress-bar">
              <div className="music-progress-fill" style={{ width: playing ? '60%' : '35%' }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Large Size (356x356)
  if (size === 'l') {
    return (
      <div className="music-body music-body--large">
        <header className="music-large-header">
          <Button
            type="button"
            variant="plain"
            className="music-btn-icon music-bookmark-btn"
            aria-label="Playlist queue"
            onClick={e => e.stopPropagation()}
          >
            <BookmarkSimple size={20} weight="regular" />
          </Button>
          <Button
            type="button"
            variant="plain"
            className={`music-btn-icon music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={favorite}
            onClick={toggleFavorite}
          >
            <Heart size={20} weight={favorite ? 'fill' : 'regular'} />
          </Button>
        </header>

        <div className="music-large-main">
          <Artwork artwork={artwork} title={title} size="l" onArtworkError={onArtworkError} />
          <div className="music-track-info music-track-info--centered">
            <strong className="music-title" title={title}>{title}</strong>
            <p className="music-subtitle" title={`${artists}${album ? ` • ${album}` : ''}`}>
              <span>{artists}</span>
              {album && (
                <>
                  <span className="music-separator" aria-hidden="true"> • </span>
                  <span className="music-album">{album}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="music-controls music-controls--large">
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn"
            aria-label="Previous track"
            disabled={busy || !controls.previous}
            onClick={e => { e.stopPropagation(); propose('previous') }}
          >
            <SkipBack size={22} weight="fill" />
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn music-seek-btn"
            aria-label="Skip back 15 seconds"
            disabled={busy}
            onClick={e => { e.stopPropagation(); propose('previous') }}
          >
            <Seek15Back size={22} />
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn music-ctrl-btn--primary"
            aria-label={playing ? 'Pause music' : 'Play music'}
            disabled={busy || !controls[playing ? 'pause' : 'play']}
            onClick={e => { e.stopPropagation(); propose(playing ? 'pause' : 'play') }}
          >
            {playing ? <Pause size={26} weight="fill" /> : <Play size={26} weight="fill" style={{ marginLeft: 2 }} />}
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn music-seek-btn"
            aria-label="Skip forward 15 seconds"
            disabled={busy}
            onClick={e => { e.stopPropagation(); propose('next') }}
          >
            <Seek15Forward size={22} />
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn"
            aria-label="Next track"
            disabled={busy || !controls.next}
            onClick={e => { e.stopPropagation(); propose('next') }}
          >
            <SkipForward size={22} weight="fill" />
          </Button>
        </div>
      </div>
    )
  }

  // Medium Size (356x170)
  if (size === 'm') {
    return (
      <div className="music-body music-body--medium">
        <div className="music-medium-top">
          <Artwork artwork={artwork} title={title} size="m" onArtworkError={onArtworkError} />
          <div className="music-track-info">
            <strong className="music-title" title={title}>{title}</strong>
            <p className="music-subtitle" title={`${artists}${album ? ` • ${album}` : ''}`}>
              <span>{artists}</span>
              {album && (
                <>
                  <span className="music-separator" aria-hidden="true"> • </span>
                  <span className="music-album">{album}</span>
                </>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="plain"
            className={`music-btn-icon music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={favorite}
            onClick={toggleFavorite}
          >
            <Heart size={20} weight={favorite ? 'fill' : 'regular'} />
          </Button>
        </div>

        <div className="music-controls music-controls--medium">
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn"
            aria-label="Previous track"
            disabled={busy || !controls.previous}
            onClick={e => { e.stopPropagation(); propose('previous') }}
          >
            <SkipBack size={20} weight="fill" />
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn music-seek-btn"
            aria-label="Skip back 15 seconds"
            disabled={busy}
            onClick={e => { e.stopPropagation(); propose('previous') }}
          >
            <Seek15Back size={20} />
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn music-ctrl-btn--primary"
            aria-label={playing ? 'Pause music' : 'Play music'}
            disabled={busy || !controls[playing ? 'pause' : 'play']}
            onClick={e => { e.stopPropagation(); propose(playing ? 'pause' : 'play') }}
          >
            {playing ? <Pause size={24} weight="fill" /> : <Play size={24} weight="fill" style={{ marginLeft: 2 }} />}
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn music-seek-btn"
            aria-label="Skip forward 15 seconds"
            disabled={busy}
            onClick={e => { e.stopPropagation(); propose('next') }}
          >
            <Seek15Forward size={20} />
          </Button>
          <Button
            type="button"
            variant="plain"
            className="music-ctrl-btn"
            aria-label="Next track"
            disabled={busy || !controls.next}
            onClick={e => { e.stopPropagation(); propose('next') }}
          >
            <SkipForward size={20} weight="fill" />
          </Button>
        </div>
      </div>
    )
  }

  // Small Size (170x170) Default
  return (
    <div className="music-body music-body--small">
      <div className="music-small-top">
        <Artwork artwork={artwork} title={title} size="s" onArtworkError={onArtworkError} />
        <Button
          type="button"
          variant="plain"
          className={`music-btn-icon music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={favorite}
          onClick={toggleFavorite}
        >
          <Heart size={18} weight={favorite ? 'fill' : 'regular'} />
        </Button>
      </div>

      <div className="music-track-info music-track-info--small">
        <strong className="music-title" title={title}>{title}</strong>
        <p className="music-subtitle" title={`${artists}${album ? ` • ${album}` : ''}`}>
          <span>{artists}</span>
          {album && (
            <>
              <span className="music-separator" aria-hidden="true"> • </span>
              <span className="music-album">{album}</span>
            </>
          )}
        </p>
      </div>

      <div className="music-controls music-controls--small">
        <Button
          type="button"
          variant="plain"
          className="music-ctrl-btn"
          aria-label="Previous track"
          disabled={busy || !controls.previous}
          onClick={e => { e.stopPropagation(); propose('previous') }}
        >
          <SkipBack size={18} weight="fill" />
        </Button>
        <Button
          type="button"
          variant="plain"
          className="music-ctrl-btn music-ctrl-btn--primary"
          aria-label={playing ? 'Pause music' : 'Play music'}
          disabled={busy || !controls[playing ? 'pause' : 'play']}
          onClick={e => { e.stopPropagation(); propose(playing ? 'pause' : 'play') }}
        >
          {playing ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" style={{ marginLeft: 2 }} />}
        </Button>
        <Button
          type="button"
          variant="plain"
          className="music-ctrl-btn"
          aria-label="Next track"
          disabled={busy || !controls.next}
          onClick={e => { e.stopPropagation(); propose('next') }}
        >
          <SkipForward size={18} weight="fill" />
        </Button>
      </div>
    </div>
  )
}
