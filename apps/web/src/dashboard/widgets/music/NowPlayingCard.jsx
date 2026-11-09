import {
  CaretDown,
  Heart,
  MusicNotes,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Headphones,
  Article,
  Stack,
} from '@phosphor-icons/react'
import { useState } from 'react'
import Select from '../../../components/ui/NativeSelect.jsx'
import { Input } from '../../../components/ui/bento/index.jsx'
import {
  AVAILABLE_IMAGES,
  DEMO_ART_PATHS,
  EQUALIZER_FRAMES,
  LYRICS,
  MUSIC_LABELS,
  SPEED_OPTIONS,
  TRACKS,
  VOLUME_OPTIONS,
  WEEK_STATS,
} from './designs.js'

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ArtworkImage({
  src,
  alt = '',
  size = 48,
  radius = 'sm',
  className = '',
  onError,
}) {
  const [error, setError] = useState(false)
  const radiusClass =
    radius === 'none'
      ? 'rounded-none'
      : radius === 'xs'
      ? 'rounded-xs'
      : radius === 'sm'
      ? 'rounded-sm'
      : radius === 'md'
      ? 'rounded-md'
      : radius === 'lg'
      ? 'rounded-lg'
      : radius === '2xl'
      ? 'rounded-2xl'
      : 'rounded-sm'

  const radiusMap = {
    none: '0px',
    xs: '4px',
    sm: '8px',
    md: '14px',
    lg: '18px',
    '2xl': '24px',
    full: '9999px',
  }

  return (
    <div
      className={`music-art music-art--${radius} ${radiusClass} ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        borderRadius: radiusMap[radius] || '8px',
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {!error && src ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => {
            setError(true)
            onError?.()
          }}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div className="music-art-fallback" style={{ width: '100%', height: '100%' }}>
          <MusicNotes size={Math.max(16, Math.floor(size * 0.45))} weight="regular" />
        </div>
      )}
    </div>
  )
}

export function EqualizerStrip({ phase = 0, playing = false, count = 3, color = 'var(--w-positive, #30d158)', height = 20 }) {
  const frame = EQUALIZER_FRAMES[phase % EQUALIZER_FRAMES.length]
  return (
    <div
      className="music-equalizer-strip"
      style={{
        display: 'flex',
        gap: '2px',
        alignItems: 'flex-end',
        height: `${height}px`,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => {
        const val = playing ? (frame[i % frame.length] / 26) * height : 4
        return (
          <span
            key={i}
            className="music-equalizer-bar"
            style={{
              width: '3px',
              height: `${Math.max(3, Math.min(height, val))}px`,
              backgroundColor: color,
              borderRadius: '9999px',
              transition: 'height 150ms ease',
            }}
          />
        )
      })}
    </div>
  )
}

export default function NowPlayingCard({
  player,
  track,
  session,
  playing = false,
  position = 0,
  phase = 0,
  size = 'm',
  favorite = false,
  shuffle = false,
  repeat = false,
  volume = '75',
  speed = '1',
  detailsOpen = false,
  busy = false,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onToggleFavorite,
  onToggleShuffle,
  onToggleRepeat,
  onChangeVolume,
  onChangeSpeed,
  onToggleDetails,
  onSelectTrack,
  onLoadDemo,
}) {
  const [showSeekPopover, setShowSeekPopover] = useState(false)
  const [seekInput, setSeekInput] = useState(String(position))

  const layout = player?.layout || 'linear'
  const isDesktopSession = Boolean(session?.active_player)
  const isLight = player?.theme === 'light' || player?.background === '#e8e5db' || player?.background === '#fff8f7' || player?.background === '#f4efe5' || player?.background === '#e8ece9'
  const defaultFillColor = isLight ? '#1c1815' : 'var(--w-accent, #ff9f0a)'
  const defaultTrackColor = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)'

  const title = track?.title || 'No title'
  const artist = track?.artist || session?.active_player || 'Unknown artist'
  const album = track?.album || ''
  const durationSec = Math.max(1, track?.seconds || 180)
  const durationLabel = track?.duration || formatTime(durationSec)
  const currentPos = Math.min(position, durationSec)
  const timeLabel = formatTime(currentPos)

  const imageSrc = track?.artwork || AVAILABLE_IMAGES[track?.imageIndex ?? 0]?.url
  const imageAlt = AVAILABLE_IMAGES[track?.imageIndex ?? 0]?.alt || `${title} artwork`

  // Desktop capability gating
  const canPlay = session ? Boolean(session.controls?.play || session.controls?.pause) : true
  const canPrev = session ? Boolean(session.controls?.previous) : true
  const canNext = session ? Boolean(session.controls?.next) : true

  function handleSeekSubmit(e) {
    e.preventDefault()
    e.stopPropagation()
    const val = parseInt(seekInput, 10)
    if (!Number.isNaN(val)) {
      onSeek?.(Math.max(0, Math.min(durationSec, val)))
    }
    setShowSeekPopover(false)
  }

  // Common Seek & Progress Component
  const progressScrubber = (color = defaultFillColor, trackColor = defaultTrackColor) => (
    <div
      className="music-progress-section"
      onClick={e => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', gap: size === 'm' ? '2px' : '6px', width: '100%' }}
    >
      <div
        className="music-progress-bar-wrap"
        role="progressbar"
        aria-valuenow={currentPos}
        aria-valuemin={0}
        aria-valuemax={durationSec}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          onSeek?.(Math.floor(ratio * durationSec))
        }}
        style={{
          width: '100%',
          height: '4px',
          background: trackColor,
          borderRadius: '9999px',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <div
          className="music-progress-bar"
          style={{
            height: '100%',
            width: `${Math.min(100, (currentPos / durationSec) * 100)}%`,
            background: color,
            borderRadius: '9999px',
            transition: 'width 200ms linear',
          }}
        />
      </div>

      <div
        className="music-time-row"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11px',
          color: isLight ? '#6b6a65' : 'var(--w-text-2, #8e8e93)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span className="music-time-current">{timeLabel}</span>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="music-pill-btn music-seek-btn"
            onClick={e => {
              e.stopPropagation()
              setSeekInput(String(Math.floor(currentPos)))
              setShowSeekPopover(prev => !prev)
            }}
            aria-label="Seek position"
            style={{
              background: 'transparent',
              border: 0,
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 6px',
              borderRadius: '9999px',
            }}
          >
            <SlidersHorizontal size={12} />
            <span>Seek</span>
          </button>

          {showSeekPopover && (
            <div
              className="music-seek-popover"
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--w-card, #1c1c1e)',
                border: '1px solid var(--w-border, rgba(255,255,255,0.1))',
                borderRadius: '8px',
                padding: '8px 10px',
                zIndex: 40,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                width: '140px',
              }}
            >
              <label style={{ fontSize: '10px', color: 'var(--w-text-2)' }}>
                Position in sec:
              </label>
              <Input
                type="number"
                min={0}
                max={durationSec}
                value={seekInput}
                onChange={e => setSeekInput(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--w-inset, #111113)',
                  border: '1px solid var(--w-border)',
                  color: 'var(--w-text, #fff)',
                  padding: '4px',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              />
              <button
                type="button"
                className="music-pill-btn"
                onClick={handleSeekSubmit}
                style={{
                  background: 'var(--w-text, #fff)',
                  color: 'var(--w-card, #000)',
                  border: 0,
                  borderRadius: '9999px',
                  padding: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Set
              </button>
            </div>
          )}
        </div>
        <span className="music-time-total">{durationLabel}</span>
      </div>
    </div>
  )

  // Common Transport Row
  const transportRow = (accentColor = isLight ? '#1c1815' : 'var(--w-text, #ffffff)', isClassic = false) => (
    <div
      className="music-transport-row music-controls--medium"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        width: '100%',
      }}
    >
      {!isClassic && (
        <button
          type="button"
          className={`music-pill-btn music-ctrl-btn ${shuffle ? 'is-active' : ''}`}
          onClick={onToggleShuffle}
          aria-label={shuffle ? MUSIC_LABELS.shuffleOff : MUSIC_LABELS.shuffleOn}
          style={{
            background: shuffle ? 'rgba(0,0,0,0.06)' : 'transparent',
            border: 0,
            color: shuffle ? accentColor : (isLight ? '#6b6a65' : 'var(--w-text-2)'),
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '9999px',
            display: 'flex',
          }}
        >
          <Shuffle size={18} />
        </button>
      )}

      <button
        type="button"
        className="music-pill-btn music-ctrl-btn"
        disabled={busy || !canPrev}
        onClick={onPrevious}
        aria-label="Previous track"
        style={{
          background: 'transparent',
          border: 0,
          color: canPrev ? (isLight ? '#2c2c2e' : accentColor) : (isLight ? '#aaa9a4' : 'var(--w-text-2)'),
          cursor: canPrev ? 'pointer' : 'not-allowed',
          padding: size === 'm' ? '4px' : '6px',
          opacity: canPrev ? 1 : 0.4,
          borderRadius: '9999px',
          display: 'flex',
        }}
      >
        <SkipBack size={size === 'm' ? 18 : 20} weight="fill" />
      </button>

      <button
        type="button"
        className="music-pill-btn music-ctrl-btn music-play-btn"
        disabled={busy || !canPlay}
        onClick={onPlayPause}
        aria-label={playing ? 'Pause music' : 'Play music'}
        style={{
          width: (isLight || player?.id === 'media-md-04' || size !== 'm') ? '44px' : '36px',
          height: (isLight || player?.id === 'media-md-04' || size !== 'm') ? '44px' : '36px',
          minWidth: (isLight || player?.id === 'media-md-04' || size !== 'm') ? '44px' : '36px',
          minHeight: (isLight || player?.id === 'media-md-04' || size !== 'm') ? '44px' : '36px',
          borderRadius: '9999px',
          background: '#111113',
          color: '#ffffff',
          border: 0,
          cursor: canPlay ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isLight ? '0 6px 16px rgba(0,0,0,0.22)' : '0 4px 12px rgba(0,0,0,0.2)',
          transition: 'transform 100ms ease',
        }}
      >
        {playing ? (
          <Pause size={(isLight || player?.id === 'media-md-04' || size !== 'm') ? 18 : 16} weight="fill" />
        ) : (
          <Play size={(isLight || player?.id === 'media-md-04' || size !== 'm') ? 18 : 16} weight="fill" style={{ marginLeft: '2px' }} />
        )}
      </button>

      <button
        type="button"
        className="music-pill-btn music-ctrl-btn"
        disabled={busy || !canNext}
        onClick={onNext}
        aria-label="Next track"
        style={{
          background: 'transparent',
          border: 0,
          color: canNext ? (isLight ? '#2c2c2e' : accentColor) : (isLight ? '#aaa9a4' : 'var(--w-text-2)'),
          cursor: canNext ? 'pointer' : 'not-allowed',
          padding: size === 'm' ? '4px' : '6px',
          opacity: canNext ? 1 : 0.4,
          borderRadius: '9999px',
          display: 'flex',
        }}
      >
        <SkipForward size={size === 'm' ? 18 : 20} weight="fill" />
      </button>

      {!isClassic && (
        <button
          type="button"
          className={`music-pill-btn music-ctrl-btn ${repeat ? 'is-active' : ''}`}
          onClick={onToggleRepeat}
          aria-label={repeat ? MUSIC_LABELS.repeatOff : MUSIC_LABELS.repeatOn}
          style={{
            background: repeat ? 'rgba(0,0,0,0.06)' : 'transparent',
            border: 0,
            color: repeat ? accentColor : (isLight ? '#6b6a65' : 'var(--w-text-2)'),
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '9999px',
            display: 'flex',
          }}
        >
          <Repeat size={18} />
        </button>
      )}
    </div>
  )

  // 1. LINEAR (#01 - Compact)
  if (layout === 'linear') {
    return (
      <div
        className="music-body music-body--linear"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          height: '100%',
          justifyContent: 'space-between',
        }}
      >
        <ArtworkImage src={imageSrc} alt={imageAlt} size={48} radius="sm" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--w-text, #111113)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--w-text-2, #8e8e93)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artist}
          </span>
        </div>
        <button
          type="button"
          className="music-pill-btn music-ctrl-btn music-play-btn"
          disabled={busy || !canPlay}
          onClick={e => {
            e.stopPropagation()
            onPlayPause?.()
          }}
          aria-label={playing ? 'Pause music' : 'Play music'}
          style={{
            width: '44px',
            height: '44px',
            minWidth: '44px',
            minHeight: '44px',
            maxWidth: '44px',
            maxHeight: '44px',
            borderRadius: '9999px',
            background: '#111113',
            color: '#ffffff',
            border: 0,
            cursor: canPlay ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            aspectRatio: '1 / 1',
          }}
        >
          {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" style={{ marginLeft: '2px' }} />}
        </button>
      </div>
    )
  }

  // 2. SIGNAL STRIP (#02 - Compact)
  if (layout === 'signal') {
    return (
      <div
        className="music-body music-body--signal"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          height: '100%',
          justifyContent: 'space-between',
        }}
      >
        <ArtworkImage src={imageSrc} alt={imageAlt} size={28} radius="xs" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ fontSize: '11px', color: '#9aa09d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artist}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '3px', height: '20px', alignItems: 'flex-end', flexShrink: 0 }}>
          {Array.from({ length: 3 }).map((_, bar) => {
            const h = playing ? EQUALIZER_FRAMES[phase % EQUALIZER_FRAMES.length][bar] : 4
            return (
              <div
                key={bar}
                style={{
                  width: '3px',
                  height: `${Math.max(4, h)}px`,
                  background: '#30d158',
                  borderRadius: '9999px',
                  transition: 'height 150ms ease',
                }}
              />
            )
          })}
        </div>
        <button
          type="button"
          className="music-pill-btn music-ctrl-btn"
          disabled={busy || !canPlay}
          onClick={e => {
            e.stopPropagation()
            onPlayPause?.()
          }}
          aria-label={playing ? 'Pause music' : 'Play music'}
          style={{
            width: '36px',
            height: '36px',
            minWidth: '36px',
            minHeight: '36px',
            maxWidth: '36px',
            maxHeight: '36px',
            borderRadius: '9999px',
            background: 'transparent',
            color: '#ffffff',
            border: 0,
            cursor: canPlay ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            aspectRatio: '1 / 1',
          }}
        >
          {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" style={{ marginLeft: '1px' }} />}
        </button>
      </div>
    )
  }

  // 3. FLOATING RADIO (#03 - Compact)
  if (layout === 'floating') {
    return (
      <div
        className="music-body music-body--floating"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
        }}
      >
        <div
          style={{
            background: 'var(--w-card, #ffffff)',
            borderRadius: '16px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
            <ArtworkImage src={imageSrc} alt={imageAlt} size={48} radius="lg" />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--w-text, #111113)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--w-text-2, #8e8e93)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {artist}
              </span>
            </div>
            <button
              type="button"
              className="music-pill-btn music-ctrl-btn music-play-btn"
              disabled={busy || !canPlay}
              onClick={e => {
                e.stopPropagation()
                onPlayPause?.()
              }}
              aria-label={playing ? 'Pause music' : 'Play music'}
              style={{
                width: '40px',
                height: '40px',
                minWidth: '40px',
                minHeight: '40px',
                maxWidth: '40px',
                maxHeight: '40px',
                borderRadius: '9999px',
                background: '#111113',
                color: '#ffffff',
                border: 0,
                cursor: canPlay ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                aspectRatio: '1 / 1',
              }}
            >
              {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" style={{ marginLeft: '1px' }} />}
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: '12px', color: 'var(--w-text-2, #8e8e93)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {album || 'Single'}
            </span>
            <button
              type="button"
              className="music-pill-btn music-ctrl-btn"
              disabled={busy || !canNext}
              onClick={e => {
                e.stopPropagation()
                onNext?.()
              }}
              aria-label="Next track"
              style={{
                background: 'transparent',
                border: 0,
                color: 'var(--w-text, #111113)',
                cursor: canNext ? 'pointer' : 'not-allowed',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '9999px',
                width: '32px',
                height: '32px',
                minWidth: '32px',
                minHeight: '32px',
                aspectRatio: '1 / 1',
              }}
            >
              <SkipForward size={16} weight="fill" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 4. THE TIMEKEEPER (#04 - Compact)
  if (layout === 'progress') {
    return (
      <div
        className="music-body music-body--progress"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '10px',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={44} radius="sm" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--w-text, #111113)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--w-text-2, #8e8e93)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artist}
            </span>
          </div>
          <button
            type="button"
            className={`music-pill-btn music-ctrl-btn ${favorite ? 'is-favorited' : ''}`}
            aria-label={(favorite ? MUSIC_LABELS.unfavorite : MUSIC_LABELS.favorite) + title}
            aria-pressed={favorite ? 'true' : 'false'}
            onClick={e => {
              e.stopPropagation()
              onToggleFavorite?.()
            }}
            style={{
              background: 'transparent',
              border: 0,
              color: favorite ? '#ff453a' : 'var(--w-text-2, #8e8e93)',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '9999px',
              width: '36px',
              height: '36px',
              minWidth: '36px',
              minHeight: '36px',
              flexShrink: 0,
              aspectRatio: '1 / 1',
            }}
          >
            <Heart size={18} weight={favorite ? 'fill' : 'regular'} />
          </button>
          <button
            type="button"
            className="music-pill-btn music-ctrl-btn music-play-btn"
            disabled={busy || !canPlay}
            onClick={e => {
              e.stopPropagation()
              onPlayPause?.()
            }}
            aria-label={playing ? 'Pause music' : 'Play music'}
            style={{
              width: '44px',
              height: '44px',
              minWidth: '44px',
              minHeight: '44px',
              maxWidth: '44px',
              maxHeight: '44px',
              borderRadius: '9999px',
              background: '#111113',
              color: '#ffffff',
              border: 0,
              cursor: canPlay ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              aspectRatio: '1 / 1',
            }}
          >
            {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" style={{ marginLeft: '1px' }} />}
          </button>
        </div>
        {progressScrubber('var(--w-text, #111113)', 'rgba(0,0,0,0.08)')}
      </div>
    )
  }

  // 5. ANALOG PULSE (#05 - Compact)
  if (layout === 'equalizer') {
    return (
      <div
        className="music-body music-body--equalizer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          width: '100%',
          height: '100%',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: '3px', height: '28px', width: '32px', alignItems: 'flex-end', flexShrink: 0 }}>
          {Array.from({ length: 5 }).map((_, bar) => {
            const h = playing ? EQUALIZER_FRAMES[phase % EQUALIZER_FRAMES.length][bar] : 4
            return (
              <div
                key={bar}
                style={{
                  width: '3px',
                  height: `${Math.max(4, h)}px`,
                  background: '#d9ad68',
                  borderRadius: '9999px',
                  transition: 'height 150ms ease',
                }}
              />
            )
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: 500, color: '#f3efdf', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ fontSize: '12px', color: '#b8b2a3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artist}
          </span>
        </div>
        <button
          type="button"
          className="music-pill-btn music-ctrl-btn"
          disabled={busy || !canPlay}
          onClick={e => {
            e.stopPropagation()
            onPlayPause?.()
          }}
          aria-label={playing ? 'Pause music' : 'Play music'}
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            minHeight: '40px',
            maxWidth: '40px',
            maxHeight: '40px',
            borderRadius: '9999px',
            background: 'transparent',
            border: '1.5px solid #d9ad68',
            color: '#d9ad68',
            cursor: canPlay ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            aspectRatio: '1 / 1',
          }}
        >
          {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" style={{ marginLeft: '1px' }} />}
        </button>
      </div>
    )
  }


  // 6. THE CLASSIC (#06 - Medium)
  if (layout === 'classic') {
    if (size === 's') {
      return (
        <div
          className="music-body music-body--classic"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            gap: '2px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <ArtworkImage src={imageSrc} alt={imageAlt} size={40} radius="md" />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--w-text-2)', lineHeight: '12px' }}>
                {MUSIC_LABELS.nowPlaying}
              </span>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--w-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '18px' }}>
                {title}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--w-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '14px' }}>
                {artist} {album ? `· ${album}` : ''}
              </span>
            </div>
            <button
              type="button"
              className={`music-pill-btn music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
              aria-label={(favorite ? MUSIC_LABELS.unfavorite : MUSIC_LABELS.favorite) + title}
              aria-pressed={favorite ? 'true' : 'false'}
              onClick={e => {
                e.stopPropagation()
                onToggleFavorite?.()
              }}
              style={{
                background: 'transparent',
                border: 0,
                color: favorite ? '#ff453a' : 'var(--w-text-2)',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '9999px',
                width: '28px',
                height: '28px',
                minWidth: '28px',
                minHeight: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                aspectRatio: '1 / 1',
              }}
            >
              <Heart size={16} weight={favorite ? 'fill' : 'regular'} />
            </button>
          </div>
          {progressScrubber()}
          {transportRow('var(--w-text, #ffffff)', true)}
        </div>
      )
    }

    return (
      <div
        className="music-body music-body--classic"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          width: '100%',
          height: '100%',
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--w-text-2)' }}>
          {MUSIC_LABELS.nowPlaying}
        </span>
        <ArtworkImage src={imageSrc} alt={imageAlt} size={136} radius="lg" className="music-art--m" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '280px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--w-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--w-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artist} {album ? `· ${album}` : ''}
          </span>
        </div>
        {progressScrubber()}
        {transportRow('var(--w-text, #ffffff)', true)}
      </div>
    )
  }

  // 7. SIDE A / SIDE B (#07 - Medium)
  if (layout === 'split') {
    return (
      <div
        className="music-body music-body--split"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '8px',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={size === 's' ? 64 : 106} radius="md" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#f3e8f8', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </span>
              <span style={{ fontSize: '12px', color: '#c9b4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {artist}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className="music-pill-btn music-ctrl-btn"
                disabled={busy || !canPrev}
                onClick={e => {
                  e.stopPropagation()
                  onPrevious?.()
                }}
                aria-label="Previous track"
                style={{
                  background: 'transparent',
                  border: 0,
                  color: '#f3e8f8',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '9999px',
                  width: '28px',
                  height: '28px',
                  minWidth: '28px',
                  minHeight: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  aspectRatio: '1 / 1',
                }}
              >
                <SkipBack size={18} weight="fill" />
              </button>
              <button
                type="button"
                className="music-pill-btn music-ctrl-btn music-play-btn"
                disabled={busy || !canPlay}
                onClick={e => {
                  e.stopPropagation()
                  onPlayPause?.()
                }}
                aria-label={playing ? 'Pause music' : 'Play music'}
                style={{
                  width: '32px',
                  height: '32px',
                  minWidth: '32px',
                  minHeight: '32px',
                  maxWidth: '32px',
                  maxHeight: '32px',
                  borderRadius: '9999px',
                  background: '#f3e8f8',
                  color: '#302538',
                  border: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  aspectRatio: '1 / 1',
                }}
              >
                {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
              </button>
              <button
                type="button"
                className="music-pill-btn music-ctrl-btn"
                disabled={busy || !canNext}
                onClick={e => {
                  e.stopPropagation()
                  onNext?.()
                }}
                aria-label="Next track"
                style={{
                  background: 'transparent',
                  border: 0,
                  color: '#f3e8f8',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '9999px',
                  width: '28px',
                  height: '28px',
                  minWidth: '28px',
                  minHeight: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  aspectRatio: '1 / 1',
                }}
              >
                <SkipForward size={18} weight="fill" />
              </button>
              <button
                type="button"
                className={`music-pill-btn music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
                aria-label={(favorite ? MUSIC_LABELS.unfavorite : MUSIC_LABELS.favorite) + title}
                aria-pressed={favorite ? 'true' : 'false'}
                onClick={e => {
                  e.stopPropagation()
                  onToggleFavorite?.()
                }}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: favorite ? '#ff79c6' : '#c9b4d4',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '9999px',
                  width: '28px',
                  height: '28px',
                  minWidth: '28px',
                  minHeight: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  aspectRatio: '1 / 1',
                }}
              >
                <Heart size={16} weight={favorite ? 'fill' : 'regular'} />
              </button>
            </div>
          </div>
        </div>
        {progressScrubber('#c9b4d4')}
      </div>
    )
  }

  // 8. NIGHT ROTATION (#08 - Medium)
  if (layout === 'green') {
    const isSmall = size === 's'
    const artSize = isSmall ? 56 : 140
    const titleSize = isSmall ? '15px' : '22px'
    const titleLineHeight = isSmall ? '18px' : '26px'
    const artistSize = isSmall ? '11px' : '13px'
    const artistLineHeight = isSmall ? '14px' : '16px'
    const labelSize = isSmall ? '10px' : '11px'
    const gapSize = isSmall ? '10px' : '14px'

    return (
      <div
        className="music-body music-body--immersive music-body--green"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: isSmall ? '4px' : '8px',
          width: '100%',
          height: '100%',
          padding: '16px',
          boxSizing: 'border-box',
        }}
      >
        <div className="music-immersive-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px', height: isSmall ? '18px' : '22px', minHeight: isSmall ? '18px' : '22px' }}>
          <span style={{ fontSize: labelSize, fontWeight: 600, letterSpacing: '0.06em', color: '#30d158', lineHeight: isSmall ? '14px' : '16px' }}>
            {MUSIC_LABELS.rotation}
          </span>
          <button
            type="button"
            className={`music-pill-btn music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
            aria-label={(favorite ? MUSIC_LABELS.unfavorite : MUSIC_LABELS.favorite) + title}
            aria-pressed={favorite ? 'true' : 'false'}
            onClick={e => {
              e.stopPropagation()
              onToggleFavorite?.()
            }}
            style={{
              background: 'transparent',
              border: 0,
              color: favorite ? '#30d158' : '#727e77',
              cursor: 'pointer',
              padding: 0,
              borderRadius: '9999px',
              width: '24px',
              height: '24px',
              minWidth: '24px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              aspectRatio: '1 / 1',
            }}
          >
            <Heart size={15} weight={favorite ? 'fill' : 'regular'} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: gapSize, alignItems: 'center' }}>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={artSize} radius="sm" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span className="music-night-title" style={{ fontSize: titleSize, fontWeight: 700, color: '#f1f6f2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: titleLineHeight }}>
              {title}
            </span>
            <span style={{ fontSize: artistSize, color: '#9ba7a0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: artistLineHeight }}>
              {artist} {album ? `· ${album}` : ''}
            </span>
          </div>
        </div>
        {progressScrubber('#30d158')}
        <div className="music-controls--immersive-m" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: 0, margin: 0 }}>
          {transportRow('#30d158')}
        </div>
      </div>
    )
  }

  // 9. SOFT FOCUS (#09 - Medium / Square)
  if (layout === 'light') {
    const isSquare = size === 'l' || size === 'preview' || player?.id === 'media-md-04'
    const artSize = 76
    return (
      <div
        className="music-body music-body--light"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={artSize} radius="md" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#b9325c' }}>
              <MusicNotes size={13} weight="fill" />
              <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SOFT FOCUS</span>
            </div>
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#1c1815', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '22px' }}>
              {title}
            </span>
            <span style={{ fontSize: '13px', color: '#6b6a65', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artist}
            </span>
          </div>
          <button
            type="button"
            className={`music-pill-btn music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
            aria-label={(favorite ? MUSIC_LABELS.unfavorite : MUSIC_LABELS.favorite) + title}
            aria-pressed={favorite ? 'true' : 'false'}
            onClick={e => {
              e.stopPropagation()
              onToggleFavorite?.()
            }}
            style={{
              background: 'transparent',
              border: 0,
              color: favorite ? '#b9325c' : '#6b6a65',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '9999px',
              width: '28px',
              height: '28px',
              minWidth: '28px',
              minHeight: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              aspectRatio: '1 / 1',
            }}
          >
            <Heart size={20} weight={favorite ? 'fill' : 'regular'} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: '16px' }} />
        {progressScrubber('#b9325c')}
        <div style={{ height: '14px' }} />
        {transportRow('#b9325c')}
      </div>
    )
  }

  // 10. BLACK / WHITE (#10 - Medium)
  if (layout === 'mono') {
    return (
      <div
        className="music-body music-body--editorial music-body--mono"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '8px',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
          <span className="music-editorial-label" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: '#888' }}>
            {MUSIC_LABELS.monoHeader}
          </span>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={size === 's' ? 44 : 88} radius="none" />
        </div>
        <div>
          <span className="music-title--editorial" style={{ fontSize: '15px', fontWeight: 600, color: '#fff', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ fontSize: '12px', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artist} {album ? `/ ${album}` : ''}
          </span>
        </div>
        {progressScrubber('#fff')}
        {transportRow('#fff')}
      </div>
    )
  }


  // 11. STUDIO DECK (#11 - Expanded)
  if (layout === 'studio') {
    const subtitleText = isDesktopSession
      ? (session?.active_player ? session.active_player.toUpperCase() : 'DESKTOP PLAYBACK')
      : 'SILENT PREVIEW'

    return (
      <div
        className="music-body music-body--studio"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '6px',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: '#6b6a65', textTransform: 'uppercase' }}>
            {MUSIC_LABELS.deckHeader}
          </span>
          <Headphones size={18} color="#6b6a65" />
        </div>

        <div
          style={{
            background: '#252820',
            borderRadius: '8px',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <ArtworkImage src={imageSrc} alt={imageAlt} size={44} radius="xs" />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#d9ad68', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {subtitleText}
              </span>
              <span style={{ fontSize: '15px', fontWeight: 500, color: '#f3efdf', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {title}
              </span>
              <span style={{ fontSize: '12px', color: '#d6d7cc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {artist}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '16px', width: '100%' }}>
            {Array.from({ length: 20 }).map((_, bar) => {
              const frame = EQUALIZER_FRAMES[phase % EQUALIZER_FRAMES.length]
              const h = playing ? frame[bar % 5] : EQUALIZER_FRAMES[0][bar % 5]
              return (
                <div
                  key={bar}
                  style={{
                    flex: 1,
                    minWidth: '2px',
                    height: `${Math.max(3, Math.round((h / 24) * 16))}px`,
                    background: '#d9ad68',
                    borderRadius: '1px',
                    transition: 'height 150ms ease',
                  }}
                />
              )
            })}
          </div>
        </div>

        {progressScrubber('#1c1815', 'rgba(0, 0, 0, 0.08)')}
        {transportRow('#1c1815')}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '10px', fontWeight: 500, color: '#6b6a65' }}>
              Volume setting
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={volume}
                onChange={e => onChangeVolume?.(e.target.value)}
                style={{
                  width: '100%',
                  height: '28px',
                  background: '#ffffff',
                  border: '1px solid rgba(0, 0, 0, 0.12)',
                  borderRadius: '6px',
                  padding: '0 22px 0 8px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#1c1815',
                  appearance: 'none',
                  cursor: 'pointer',
                  outline: 'none',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                }}
              >
                {VOLUME_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <CaretDown
                size={12}
                weight="bold"
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: '#6b6a65',
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '10px', fontWeight: 500, color: '#6b6a65' }}>
              Preview speed
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={speed}
                onChange={e => onChangeSpeed?.(e.target.value)}
                style={{
                  width: '100%',
                  height: '28px',
                  background: '#ffffff',
                  border: '1px solid rgba(0, 0, 0, 0.12)',
                  borderRadius: '6px',
                  padding: '0 22px 0 8px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#1c1815',
                  appearance: 'none',
                  cursor: 'pointer',
                  outline: 'none',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                }}
              >
                {SPEED_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <CaretDown
                size={12}
                weight="bold"
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: '#6b6a65',
                }}
              />
            </div>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: '10px', color: '#6b6a65', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {MUSIC_LABELS.deckNote}
        </p>
      </div>
    )
  }

  // 12. WORDS IN MOTION / LYRICS (#12 - Expanded)
  if (layout === 'lyrics') {
    const isDemo = Boolean(track?.demo)
    return (
      <div
        className="music-body music-body--lyrics"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '10px',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isDemo ? (
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '8px',
                background: '#d7b7d9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={MUSIC_LABELS.demoArtAlt}
            >
              <svg width="36" height="36" viewBox="0 0 100 100">
                {DEMO_ART_PATHS.map((p, i) => (
                  <path key={i} d={p.d} fill={p.fill} />
                ))}
              </svg>
            </div>
          ) : (
            <ArtworkImage src={imageSrc} alt={imageAlt} size={48} radius="md" />
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#f3e8f8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
            <span style={{ fontSize: '12px', color: '#c9b4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artist}
            </span>
          </div>
          <button
            type="button"
            className="music-pill-btn music-ctrl-btn"
            onClick={onToggleDetails}
            aria-label={detailsOpen ? MUSIC_LABELS.hideLyrics : MUSIC_LABELS.showLyrics}
            style={{
              background: detailsOpen ? 'rgba(255,255,255,0.15)' : 'transparent',
              border: 0,
              color: '#f3e8f8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Article size={20} weight={detailsOpen ? 'fill' : 'regular'} />
          </button>
        </div>

        {detailsOpen && (
          <div
            style={{
              padding: '10px 0',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {isDemo ? (
              <>
                <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: '#d7b7d9' }}>
                  ORIGINAL DEMO LYRICS
                </span>
                {LYRICS.map((line, i) => {
                  const active = currentPos >= line.start && currentPos < line.end
                  return (
                    <span
                      key={i}
                      style={{
                        fontSize: active ? '15px' : '13px',
                        fontWeight: active ? 700 : 400,
                        color: active ? '#ffffff' : '#99879f',
                        transition: 'color 150ms ease, font-size 150ms ease',
                      }}
                    >
                      {line.text}
                    </span>
                  )
                })}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: '#c9b4d4' }}>
                  {MUSIC_LABELS.noLyrics}
                </span>
                <button
                  type="button"
                  onClick={onLoadDemo}
                  style={{
                    background: 'transparent',
                    border: '1px solid #d7b7d9',
                    color: '#f3e8f8',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                  }}
                >
                  {MUSIC_LABELS.loadDemo}
                </button>
              </div>
            )}
          </div>
        )}

        {progressScrubber('#d7b7d9')}
        {transportRow('#f3e8f8')}
      </div>
    )
  }

  // 13. THE NEXT CHAPTER / QUEUE (#13 - Expanded)
  if (layout === 'queue') {
    return (
      <div
        className="music-body music-body--queue"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '10px',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--w-text)' }}>
            A little further on
          </span>
          <button
            type="button"
            className="music-pill-btn music-ctrl-btn"
            onClick={onToggleDetails}
            aria-label={detailsOpen ? MUSIC_LABELS.hideQueue : MUSIC_LABELS.showQueue}
            style={{
              background: detailsOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 0,
              color: 'var(--w-text)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Stack size={18} weight={detailsOpen ? 'fill' : 'regular'} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={54} radius="md" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--w-text-2)' }}>
              Now playing
            </span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--w-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--w-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artist}
            </span>
          </div>
        </div>

        {detailsOpen && (
          <div
            style={{
              padding: '8px 0',
              borderTop: '1px solid var(--w-border, rgba(255,255,255,0.08))',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--w-text-2)' }}>
              UP NEXT / SELECT A TRACK
            </span>
            {[1, 2, 3].map(offset => {
              const qIndex = ((track?.trackIndex || 0) + offset) % 6
              const qTrack = TRACKS[qIndex]
              return (
                <div
                  key={offset}
                  onClick={e => {
                    e.stopPropagation()
                    onSelectTrack?.(qIndex)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    background: 'var(--w-inset, rgba(255,255,255,0.03))',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '11px', fontVariantNumeric: 'tabular-nums', color: 'var(--w-text-2)' }}>
                    0{offset}
                  </span>
                  <ArtworkImage src={AVAILABLE_IMAGES[qTrack.imageIndex]?.url} size={32} radius="xs" />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--w-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {qTrack.title}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--w-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {qTrack.artist}
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--w-text-2)', fontVariantNumeric: 'tabular-nums' }}>
                    {qTrack.duration}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {progressScrubber()}
        {transportRow()}
      </div>
    )
  }

  // 14. LISTENING DESK / DASHBOARD (#14 - Expanded)
  if (layout === 'dashboard') {
    return (
      <div
        className="music-body music-body--dashboard"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '10px',
          width: '100%',
          height: '100%',
        }}
      >
        <div>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--w-text)', display: 'block' }}>
            A week in rotation
          </span>
          <span style={{ fontSize: '11px', color: 'var(--w-text-2)' }}>
            Illustrative listening history · seven days
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={48} radius="md" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--w-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--w-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artist}
            </span>
          </div>
        </div>

        {progressScrubber()}
        {transportRow()}

        <div style={{ borderTop: '1px solid var(--w-border, rgba(255,255,255,0.08))', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--w-text-2)', fontWeight: 700, letterSpacing: '0.04em' }}>
            <span>DAILY LISTENING / MINUTES</span>
            <span>42 PLAYS</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '54px', width: '100%' }}>
            {WEEK_STATS.map(stat => (
              <div key={stat.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <div
                  style={{
                    width: '100%',
                    height: `${(stat.minutes / 60) * 36}px`,
                    background: 'var(--w-accent, #ff9f0a)',
                    borderRadius: '2px',
                    opacity: 0.85,
                  }}
                  title={`${stat.day}: ${stat.minutes} min`}
                />
                <span style={{ fontSize: '9px', color: 'var(--w-text-2)' }}>{stat.day}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // 15. SLEEVE NOTES / ALBUM (#15 - Expanded)
  if (layout === 'album') {
    return (
      <div
        className="music-body music-body--album"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '10px',
          width: '100%',
          height: '100%',
          color: 'var(--w-text)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--w-text-2)' }}>
            THE ALBUM EDITION
          </span>
          <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--w-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {album || title}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--w-text-2)' }}>
            {artist}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ArtworkImage src={imageSrc} alt={imageAlt} size={size === 's' ? 110 : 180} radius="none" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--w-text-2)' }}>
              Now playing
            </span>
            <span style={{ fontSize: '14px', fontWeight: 600, display: 'block', color: 'var(--w-text)' }}>
              {title}
            </span>
          </div>
          <button
            type="button"
            className={`music-pill-btn music-favorite-btn ${favorite ? 'is-favorited' : ''}`}
            aria-label={(favorite ? MUSIC_LABELS.unfavorite : MUSIC_LABELS.favorite) + title}
            aria-pressed={favorite ? 'true' : 'false'}
            onClick={e => {
              e.stopPropagation()
              onToggleFavorite?.()
            }}
            style={{
              background: 'transparent',
              border: 0,
              color: favorite ? '#ff453a' : 'var(--w-text-2)',
              cursor: 'pointer',
              borderRadius: '9999px',
              width: '32px',
              height: '32px',
              minWidth: '32px',
              minHeight: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              aspectRatio: '1 / 1',
            }}
          >
            <Heart size={20} weight={favorite ? 'fill' : 'regular'} />
          </button>
        </div>

        {progressScrubber()}
        {transportRow()}
      </div>
    )
  }

  // Fallback: render Linear
  return (
    <div className="music-body music-body--linear">
      <ArtworkImage src={imageSrc} alt={imageAlt} size={48} radius="sm" />
      <div>
        <span>{title}</span>
        <span>{artist}</span>
      </div>
    </div>
  )
}
