import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../../../api.js'
import { CARD_EASE } from '../libraryUi.jsx'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import { KIND_META, CARD_SHADOW, canonicalKind } from './tokens.js'
import './podcast.css'

/* Podcast detail screen — library revamp artboard 8.12.
   Docs: docs/agent-context/sections/library-revamp-design.md §1 + §8.12. */

const RATES = [1, 1.25, 1.5, 2]
const STATUS_OPTIONS = [
  ['unstarted', 'Queue'],
  ['in_progress', 'Listening'],
  ['completed', 'Done'],
]

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)(\?|#|$)/i

function parseDurationValue(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  const text = String(raw || '').trim()
  if (!text) return 0
  const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)
  if (clock) {
    const [, a, b, c] = clock
    return c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b)
  }
  const hours = text.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i)
  if (hours) return Math.round(Number(hours[1]) * 3600)
  const mins = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i)
  if (mins) return Math.round(Number(mins[1]) * 60)
  const secs = text.match(/^(\d+)\s*(?:s|sec|secs|second|seconds)\b/i)
  if (secs) return Number(secs[1])
  return 0
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function getItemDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/* Real audio only: local audio file (served by the host media route),
   an explicit audio resource, or a source URL that points at an audio file. */
function resolveAudioSource(item, resources) {
  const id = item?.id
  const hasHostMedia = item?.media_path && AUDIO_EXT.test(item.media_path) &&
    id != null && Number.isSafeInteger(Number(id))
  if (hasHostMedia) return api.mediaUrl(id)

  const list = Array.isArray(resources) ? resources : []
  for (const resource of list) {
    if (!resource || typeof resource !== 'object') continue
    const url = resource.remote_url || resource.url || ''
    if (!url || !/^(https?:|file:)/i.test(url)) continue
    if (String(resource.type || '').toLowerCase() === 'audio' && /^https?:/i.test(url)) return url
    if (AUDIO_EXT.test(url)) return url
  }

  if (item?.url && /^https?:\/\//i.test(item.url) && AUDIO_EXT.test(item.url)) return item.url
  return ''
}

function MicIcon({ size, stroke }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
    </svg>
  )
}

/* Scrubber styled per artboard 8.12: 8px track, blue fill, 18px white knob. */
function Scrubber({ time, duration, onSeek }) {
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  return (
    <input
      type="range"
      className="pc-scrub"
      style={{ '--pc-fill': `${pct}%` }}
      min="0"
      max={duration > 0 ? duration : 100}
      step="0.1"
      value={Math.min(time, duration > 0 ? duration : 100)}
      disabled={duration <= 0}
      aria-label="Playback position"
      onChange={(event) => onSeek(Number(event.target.value))}
    />
  )
}

function PlayerCard({ audioSrc, sourceUrl, fallbackDuration, showToast, onAudioError }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(() => fallbackDuration || 0)
  const [rate, setRate] = useState(1)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setPlaying(false)
    setTime(0)
    setDuration(fallbackDuration || 0)
    setRate(1)
    setFailed(false)
  }, [audioSrc, fallbackDuration])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      return
    }
    audio.play().catch(() => {
      showToast('Playback failed — open the source instead')
    })
  }

  const skipBy = (delta) => {
    const audio = audioRef.current
    if (!audio || duration <= 0) return
    const next = Math.min(duration, Math.max(0, audio.currentTime + delta))
    audio.currentTime = next
    setTime(next)
  }

  const cycleRate = () => {
    const audio = audioRef.current
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    if (audio) audio.playbackRate = next
    setRate(next)
  }

  const onSeek = (value) => {
    const audio = audioRef.current
    if (!audio || duration <= 0) return
    audio.currentTime = value
    setTime(value)
  }

  const pct = duration > 0 ? Math.round((time / duration) * 100) : 0

  return (
    <>
      <section className="pc-card pc-player" style={{ boxShadow: CARD_SHADOW }}>
        <Scrubber time={time} duration={duration} onSeek={onSeek} />
        <div className="pc-times">
          <span>{formatTime(time)}</span>
          <span>−{formatTime(Math.max(0, duration - time))}</span>
        </div>
        <div className="pc-transport">
          <motion.button type="button" className="pc-skip" disabled={duration <= 0}
            aria-label="Back 15 seconds" whileTap={{ scale: 0.92 }} onClick={() => skipBy(-15)}>
            −15
          </motion.button>
          <motion.button type="button" className="pc-play" aria-label={playing ? 'Pause' : 'Play'}
            whileTap={{ scale: 0.92 }} onClick={togglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </motion.button>
          <motion.button type="button" className="pc-skip" disabled={duration <= 0}
            aria-label="Forward 30 seconds" whileTap={{ scale: 0.92 }} onClick={() => skipBy(30)}>
            +30
          </motion.button>
        </div>
        <div className="pc-sub">
          <motion.button type="button" className="pc-chipbtn" style={{ flex: 1 }}
            whileTap={{ scale: 0.96 }} onClick={cycleRate}>
            {rate.toFixed(1)}×
          </motion.button>
          <a className="pc-chipbtn" style={{ flex: 2 }} href={sourceUrl || '#'} target="_blank" rel="noreferrer">
            Open source
          </a>
        </div>
      </section>
      <span className="pc-a11y" aria-live="polite">{playing ? `Playing, ${pct}% complete` : 'Paused'}</span>
      {failed ? null : (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setTime(0) }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration
            if (Number.isFinite(value) && value > 0) setDuration(value)
          }}
          onError={() => {
            setFailed(true)
            setPlaying(false)
            onAudioError()
          }}
        />
      )}
    </>
  )
}

function SourceCard({ item, cover }) {
  const domain = getItemDomain(item?.url)
  return (
    <a className="pc-card pc-src" style={{ boxShadow: CARD_SHADOW }}
      href={item?.url || '#'} target="_blank" rel="noreferrer">
      <span className="pc-art">
        {cover
          ? <img src={cover} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <MicIcon size={28} stroke={1.6} />}
      </span>
      <span className="pc-src-text">
        <span className="pc-src-name">Open source</span>
        <span className="pc-src-sub">{domain || 'External link'}</span>
      </span>
      <span className="pc-src-chevron"><ChevronIcon /></span>
    </a>
  )
}

function StatusTrio({ item, onUpdate, showToast }) {
  const [busy, setBusy] = useState(false)
  const value = STATUS_OPTIONS.some(([key]) => key === item?.progress) ? item.progress : 'unstarted'
  const canUpdate = item?.id != null && Number.isSafeInteger(Number(item.id))

  const choose = async (progress) => {
    if (busy || progress === value) return
    setBusy(true)
    try {
      await onUpdate({ progress })
    } catch (error) {
      showToast(`Could not save status: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="group" aria-label="Podcast status" className="pc-status">
      {STATUS_OPTIONS.map(([key, label]) => (
        <motion.button key={key} type="button"
          className={`pc-st ${value === key ? 'on' : ''}`}
          aria-pressed={value === key}
          disabled={busy || !canUpdate}
          whileTap={{ scale: 0.96 }}
          onClick={() => choose(key)}>
          {label}
        </motion.button>
      ))}
    </div>
  )
}

function Chapters({ resources }) {
  const chapters = (Array.isArray(resources) ? resources : [])
    .filter((r) => r && typeof r === 'object' && String(r.type || '').toLowerCase() === 'chapter' && r.name)
    .map((r) => ({ name: String(r.name), time: parseDurationValue(r.detail) }))
  if (!chapters.length) return null
  return (
    <>
      <h2 className="pc-lbl">Chapters <span className="pc-lbl-cnt">{chapters.length}</span></h2>
      <section className="pc-card pc-chapters" style={{ boxShadow: CARD_SHADOW }}>
        {chapters.map((chapter, index) => (
          <div key={`${chapter.name}-${index}`} className="pc-chapter">
            {chapter.time > 0
              ? <span className="pc-chapter-time">{formatTime(chapter.time)}</span>
              : <span className="pc-chapter-time" />}
            <span className="pc-chapter-name">{chapter.name}</span>
          </div>
        ))}
      </section>
    </>
  )
}

export default function PodcastScreen({ item, resources = [], onUpdate, showToast }) {
  if (!item) return null
  return <PodcastBody item={item} resources={resources} onUpdate={onUpdate} showToast={showToast} />
}

function PodcastBody({ item, resources, onUpdate, showToast }) {
  const cover = useItemThumbnail(item)
  const entity = item?.entity && typeof item.entity === 'object' ? item.entity : {}
  const kind = canonicalKind(item?.kind)
  const meta = KIND_META[kind] || KIND_META.other
  const notify = typeof showToast === 'function' ? showToast : () => {}
  const [audioFailed, setAudioFailed] = useState(false)

  const audioSrc = useMemo(() => resolveAudioSource(item, resources), [item, resources])
  const fallbackDuration = useMemo(() => (
    parseDurationValue(item?.duration_seconds) || parseDurationValue(item?.duration) ||
    parseDurationValue(entity.attributes?.Length)
  ), [item?.duration_seconds, item?.duration, entity.attributes])

  const summaryText = useMemo(() => {
    const summary = typeof item?.summary === 'string' ? item.summary.trim() : ''
    const synopsis = typeof entity.synopsis === 'string' ? entity.synopsis.trim() : ''
    return summary || synopsis
  }, [item?.summary, entity.synopsis])

  const attributeRows = useMemo(() => {
    const attributes = entity.attributes && typeof entity.attributes === 'object'
      ? Object.entries(entity.attributes)
      : []
    if (attributes.length) {
      return attributes.map(([name, value]) => ({ key: name, name, value: String(value) }))
    }
    const show = entity.subtitle || item?.channel || item?.author
    const rows = []
    if (show) rows.push({ key: 'show', name: 'Show', value: String(show) })
    if (item?.duration) rows.push({ key: 'length', name: 'Length', value: String(item.duration) })
    return rows
  }, [entity.attributes, entity.subtitle, item?.channel, item?.author, item?.duration])

  const actions = useMemo(() => (
    Array.isArray(entity.actions)
      ? entity.actions.filter((action) => /^https?:\/\//i.test(action?.url || ''))
      : []
  ), [entity.actions])

  const notesText = useMemo(() => {
    const raw = typeof item?.notes === 'string' ? item.notes.trim() : ''
    if (!raw || raw.startsWith('http')) return ''
    return raw
  }, [item?.notes])

  const hasAudio = Boolean(audioSrc) && !audioFailed

  return (
    <motion.div className="pc-wrap"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: CARD_EASE }}
    >
      {/* Hero band + title (artboard 8.12) */}
      <div className="pc-hero">
        {cover
          ? <img className="pc-hero-art" src={cover} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : (
            <div className="pc-hero-art">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" /></svg>
            </div>
          )}
        <span className="pc-hero-tag">Podcast</span>
      </div>
      <h1 className="pc-title">{item?.title || 'Untitled episode'}</h1>
      {(() => {
        const bits = [entity.subtitle, item?.duration].filter(Boolean).map(String)
        return bits.length ? <div className="pc-title-meta">{bits.join(' · ')}</div> : null
      })()}

      {hasAudio
        ? (
          <PlayerCard audioSrc={audioSrc} sourceUrl={item?.url} fallbackDuration={fallbackDuration}
            showToast={notify} onAudioError={() => setAudioFailed(true)} />
        )
        : <SourceCard item={item} cover={cover} />}

      <h2 className="pc-lbl">Your status</h2>
      <StatusTrio item={item} onUpdate={onUpdate} showToast={notify} />

      {summaryText ? (
        <>
          <h2 className="pc-lbl">Summary</h2>
          <section className="pc-card pc-summary" style={{ boxShadow: CARD_SHADOW }}>
            <p>{summaryText}</p>
          </section>
        </>
      ) : null}

      <Chapters resources={resources} />

      {attributeRows.length ? (
        <>
          <h2 className="pc-lbl">Details</h2>
          <section className="pc-card pc-kv" style={{ boxShadow: CARD_SHADOW }}>
            {attributeRows.map((row) => (
              <div key={row.key} className="pc-kv-row">
                <span className="pc-kv-key">{row.name}</span>
                <span className="pc-kv-val">{row.value}</span>
              </div>
            ))}
          </section>
        </>
      ) : null}

      {actions.length ? (
        <div className="pc-actions">
          {actions.map((action) => (
            <a key={`${action.label}-${action.url}`} className="pc-action"
              style={{ background: meta.tint, color: meta.tintText }}
              href={action.url} target="_blank" rel="noreferrer">
              {action.label || 'Open'} ↗
            </a>
          ))}
        </div>
      ) : null}

      {notesText ? (
        <>
          <h2 className="pc-lbl">Notes</h2>
          <section className="pc-card pc-notes" style={{ boxShadow: CARD_SHADOW }}>
            <p>{notesText}</p>
          </section>
        </>
      ) : null}
    </motion.div>
  )
}
