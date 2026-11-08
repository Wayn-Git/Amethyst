import { useState } from 'react'
import { variationNumber } from '../widgetVariations.js'
import { request } from '../api.js'
import './music/music.css'

function formatSeconds(secs) {
  if (!Number.isFinite(secs) || secs < 0) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Music({ data, onAction, size = 'm', design = 'media-sm-01' }) {
  const variation = variationNumber(design)
  const [busy, setBusy] = useState(false)

  const isPlaying = data?.status === 'Playing'
  const title = data?.title || 'Evening Drive'
  const artists = Array.isArray(data?.artists) && data.artists.length > 0 ? data.artists.join(', ') : (data?.album || 'Lo-fi Tapes')
  const duration = Number.isFinite(data?.duration) && data.duration > 0 ? data.duration : 232
  const position = Number.isFinite(data?.position) && data.position >= 0 ? data.position : 84
  const progressPercent = Math.min(100, Math.max(0, (position / duration) * 100))

  async function handleControl(action) {
    if (busy) return
    setBusy(true)
    try {
      if (data?.active_player) {
        await request(`/widgets/glance.music/actions/${action}`, 'POST', {
          player: data.active_player,
          track_id: data.track_id || '',
          status: data.status || 'Playing',
        })
      }
      onAction?.(action)
    } catch {
      // quiet fallback
    } finally {
      setBusy(false)
    }
  }

  const styleName = variation === 2 ? 'waveform' : variation === 3 ? 'cassette' : variation === 4 ? 'album' : 'vinyl'

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="glance-music" data-size="s">
        <p className="gm-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          </svg>
          <span>Music</span>
        </p>
        <div style={{ marginTop: 'auto' }}>
          <div className="n" style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <p className="t" style={{ fontSize: '13px', opacity: 0.75, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artists}
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
            <button className="bt" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => handleControl(isPlaying ? 'pause' : 'play')} style={{ background: 'var(--mst, #1d1650)', color: 'var(--ms, #fff)', width: '38px', height: '38px' }}>
              {isPlaying ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 5v14M15 5v14" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                </svg>
              )}
            </button>
            <button className="bt" aria-label="Next" onClick={() => handleControl('next')} style={{ width: '34px', height: '34px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 5l9 7-9 7zM18 5v14" />
              </svg>
            </button>
          </div>
        </div>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="glance-music" data-size="l">
        <p className="gm-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          </svg>
          <span>Desktop music</span>
        </p>
        <div style={{ display: 'flex', gap: '24px', marginTop: '16px', alignItems: 'center' }}>
          <div style={{ width: '130px', height: '130px', borderRadius: '22px', background: '#7c6cf0', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ position: 'absolute', width: '100px', height: '100px', borderRadius: '50%', background: '#ffb4c8', right: '-20px', top: '-20px' }} />
            <div style={{ position: 'absolute', width: '70px', height: '70px', borderRadius: '16px', background: '#1d1650', left: '16px', bottom: '16px' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="n" style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            <p className="t" style={{ fontSize: '15px', fontWeight: 500, opacity: 0.75, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artists}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: '6px', borderRadius: '3px', background: 'var(--wt, rgba(255,255,255,0.3))', margin: '20px 0 6px', position: 'relative' }}>
          <div style={{ width: `${progressPercent}%`, height: '100%', borderRadius: '3px', background: 'currentColor' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 500 }}>
          <span>{formatSeconds(position)}</span>
          <span>{formatSeconds(duration)}</span>
        </div>

        {/* Transport controls */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: 'auto' }}>
          <button className="bt" aria-label="Previous" onClick={() => handleControl('previous')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 5l-9 7 9 7zM6 5v14" />
            </svg>
          </button>
          <button className="bt" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => handleControl(isPlaying ? 'pause' : 'play')} style={{ background: 'var(--mst, #fff)', color: 'var(--ms, #1d1650)', width: '52px', height: '52px' }}>
            {isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 5v14M15 5v14" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
              </svg>
            )}
          </button>
          <button className="bt" aria-label="Next" onClick={() => handleControl('next')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 5l9 7-9 7zM18 5v14" />
            </svg>
          </button>
        </div>
      </section>
    )
  }

  // Medium (2x1) with 4 styles
  if (styleName === 'waveform') {
    const bars = [30, 50, 80, 60, 90, 40, 70, 100, 60, 80, 50, 30, 60, 90, 70, 40, 80, 60, 35, 55, 85, 50, 30, 60]
    return (
      <section className="glance-music style-waveform" data-size="m" data-style="waveform">
        <p className="gm-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          </svg>
          <span>Desktop music</span>
        </p>
        <div style={{ position: 'absolute', left: '24px', top: '48px', maxWidth: '380px' }}>
          <div className="n" style={{ fontSize: '28px', letterSpacing: '-0.04em', lineHeight: 1.1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <p className="t" style={{ fontSize: '13px', fontWeight: 500, opacity: 0.7, marginTop: '4px' }}>
            {artists} · {formatSeconds(position)} / {formatSeconds(duration)}
          </p>
        </div>
        <div style={{ position: 'absolute', right: '22px', top: '20px' }}>
          <button className="bt" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => handleControl(isPlaying ? 'pause' : 'play')} style={{ background: '#d4f53c', color: '#141414', width: '48px', height: '48px' }}>
            {isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 5v14M15 5v14" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
        <div style={{ position: 'absolute', left: '22px', right: '22px', bottom: '18px', height: '70px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {bars.map((h, idx) => {
            const isLit = idx / bars.length <= progressPercent / 100
            return (
              <span
                key={idx}
                style={{
                  flex: 1,
                  height: `${h}%`,
                  borderRadius: '4px',
                  background: isLit ? '#d4f53c' : 'rgba(255,255,255,0.22)',
                  transition: 'height 0.2s ease',
                }}
              />
            )
          })}
        </div>
      </section>
    )
  }

  if (styleName === 'cassette') {
    return (
      <section className="glance-music style-cassette" data-size="m" data-style="cassette">
        <div style={{ position: 'absolute', left: '24px', top: '20px', width: '280px', height: '150px', borderRadius: '16px', background: '#e4d6b8', boxShadow: 'inset 0 0 0 2.5px #2b2318' }}>
          <div style={{ position: 'absolute', left: '20px', right: '20px', top: '14px', height: '52px', background: '#fff8e8', borderRadius: '8px', padding: '8px 12px', boxSizing: 'border-box' }}>
            <p className="t" style={{ fontSize: '16px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
            <p className="t" style={{ fontSize: '11px', fontWeight: 500, opacity: 0.7, marginTop: '2px' }}>{artists} · Side A</p>
          </div>
          <div style={{ position: 'absolute', left: '44px', bottom: '14px', width: '48px', height: '48px', borderRadius: '50%', background: '#2b2318' }}>
            <i style={{ position: 'absolute', inset: '14px', borderRadius: '50%', background: '#f1e9d8' }} />
          </div>
          <div style={{ position: 'absolute', right: '44px', bottom: '14px', width: '48px', height: '48px', borderRadius: '50%', background: '#2b2318' }}>
            <i style={{ position: 'absolute', inset: '14px', borderRadius: '50%', background: '#f1e9d8' }} />
          </div>
        </div>
        <div style={{ position: 'absolute', left: '330px', right: '24px', top: '20px', bottom: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <p className="gm-label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
            </svg>
            <span>Desktop music</span>
          </p>
          <div>
            <p className="t" style={{ fontSize: '13px', fontWeight: 600, opacity: 0.7, marginBottom: '6px' }}>
              {formatSeconds(position)} / {formatSeconds(duration)}
            </p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="bt" aria-label="Previous" onClick={() => handleControl('previous')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 5l-9 7 9 7zM6 5v14" />
                </svg>
              </button>
              <button className="bt" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => handleControl(isPlaying ? 'pause' : 'play')} style={{ background: '#2b2318', color: '#fff', width: '42px', height: '42px' }}>
                {isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 5v14M15 5v14" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                  </svg>
                )}
              </button>
              <button className="bt" aria-label="Next" onClick={() => handleControl('next')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 5l9 7-9 7zM18 5v14" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (styleName === 'album') {
    return (
      <section className="glance-music style-album" data-size="m" data-style="album">
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '180px', background: '#ff8fb1', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: '-20px', top: '-20px', width: '120px', height: '120px', borderRadius: '50%', background: '#7c6cf0' }} />
          <div style={{ position: 'absolute', right: '14px', bottom: '14px', width: '70px', height: '70px', borderRadius: '16px', background: '#d4f53c' }} />
        </div>
        <div style={{ position: 'absolute', left: '200px', right: '22px', top: '20px', bottom: '18px', display: 'flex', flexDirection: 'column' }}>
          <p className="gm-label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
            </svg>
            <span>Now playing</span>
          </p>
          <div style={{ marginTop: 'auto' }}>
            <div className="n" style={{ fontSize: '24px', letterSpacing: '-0.04em', lineHeight: 1.1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            <p className="t" style={{ fontSize: '13px', fontWeight: 500, opacity: 0.7, margin: '2px 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artists}
            </p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="bt" aria-label="Previous" onClick={() => handleControl('previous')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 5l-9 7 9 7zM6 5v14" />
                </svg>
              </button>
              <button className="bt" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => handleControl(isPlaying ? 'pause' : 'play')} style={{ background: '#fff', color: '#1d1d1f', width: '42px', height: '42px' }}>
                {isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 5v14M15 5v14" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                  </svg>
                )}
              </button>
              <button className="bt" aria-label="Next" onClick={() => handleControl('next')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 5l9 7-9 7zM18 5v14" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // Default Medium (Vinyl)
  return (
    <section className="glance-music" data-size="m" data-style="vinyl">
      <div style={{ position: 'absolute', left: '-50px', top: '10px', width: '180px', height: '180px', borderRadius: '50%', background: '#111', flexShrink: 0 }}>
        <div style={{ position: 'absolute', inset: '12px', borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.12)' }} />
        <div style={{ position: 'absolute', inset: '24px', borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.12)' }} />
        <div style={{ position: 'absolute', inset: '36px', borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.12)' }} />
        <div style={{ position: 'absolute', inset: '56px', borderRadius: '50%', background: '#ff6a2b' }} />
        <div style={{ position: 'absolute', inset: '80px', borderRadius: '50%', background: 'var(--ms, #e3dfff)' }} />
      </div>
      <div style={{ position: 'absolute', left: '150px', right: '22px', top: '20px', bottom: '16px', display: 'flex', flexDirection: 'column' }}>
        <p className="gm-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          </svg>
          <span>Desktop music</span>
        </p>
        <div style={{ marginTop: 'auto' }}>
          <div className="n" style={{ fontSize: '24px', letterSpacing: '-0.04em', lineHeight: 1.1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <p className="t" style={{ fontSize: '13px', fontWeight: 500, opacity: 0.7, margin: '2px 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artists}
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="bt" aria-label="Previous" onClick={() => handleControl('previous')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 5l-9 7 9 7zM6 5v14" />
              </svg>
            </button>
            <button className="bt" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => handleControl(isPlaying ? 'pause' : 'play')} style={{ background: '#141414', color: '#fff', width: '42px', height: '42px' }}>
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 5v14M15 5v14" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                </svg>
              )}
            </button>
            <button className="bt" aria-label="Next" onClick={() => handleControl('next')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 5l9 7-9 7zM18 5v14" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
