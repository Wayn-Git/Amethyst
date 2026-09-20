import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api, getBase } from '../../api.js'
import * as syncClient from '../../lib/sync/client.js'

export default function RemoteMedia() {
  const [media, setMedia] = useState(null)
  const [volume, setVolume] = useState(50)
  const [muted, setMuted] = useState(false)
  const [sinks, setSinks] = useState([])
  const [currentSink, setCurrentSink] = useState('')
  const [isTalking, setIsTalking] = useState(false)
  const [pttError, setPttError] = useState(null)
  const [notice, setNotice] = useState(null)

  const token = syncClient.identity()?.token || ''
  const wsRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioStreamRef = useRef(null)

  const fetchMedia = useCallback(async () => {
    try {
      const res = await api.remoteMedia()
      setMedia(res)
      if (res?.volume !== undefined) setVolume(res.volume)
      if (res?.muted !== undefined) setMuted(res.muted)
      if (res?.sinks) setSinks(res.sinks)
      if (res?.default_sink) setCurrentSink(res.default_sink)
    } catch {
      // Ignore
    }
  }, [])

  useEffect(() => {
    fetchMedia()
    const int = setInterval(fetchMedia, 3000)
    return () => clearInterval(int)
  }, [fetchMedia])

  // Volume slider change
  const handleVolumeChange = async (e) => {
    const val = parseInt(e.target.value, 10)
    setVolume(val)
    try {
      await api.remoteVolume(val)
    } catch (err) {
      setNotice(`Volume failed: ${err.message}`)
    }
  }

  // Mute toggle
  const toggleMute = async () => {
    const nextMuted = !muted
    setMuted(nextMuted)
    try {
      await api.remoteMute(nextMuted)
    } catch (err) {
      setNotice(`Mute failed: ${err.message}`)
    }
  }

  // Switch sink
  const handleSinkChange = async (e) => {
    const sink = e.target.value
    setCurrentSink(sink)
    try {
      await api.remoteSink(sink)
      setNotice(`Switched audio output to ${sink}`)
    } catch (err) {
      setNotice(`Sink change failed: ${err.message}`)
    }
  }

  // Media playback action
  const handleAction = async (action) => {
    try {
      await api.remoteMediaAction(action)
      setTimeout(fetchMedia, 300)
    } catch (err) {
      setNotice(`Action failed: ${err.message}`)
    }
  }

  // Push-To-Talk Microphone Streaming
  const startTalking = async () => {
    setPttError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      audioStreamRef.current = stream

      // Establish WebSocket connection
      const base = getBase()
      const proto = base.startsWith('https') ? 'wss:' : 'ws:'
      if (typeof window !== 'undefined' && window.location.protocol === 'https:' && proto === 'ws:') {
        setPttError('Push-to-talk mic requires a Direct LAN connection to PC. Tap the banner above to switch.')
        return
      }
      const host = base.replace(/^https?:\/\//, '').replace(/\/api$/, '')
      const wsUrl = `${proto}//${host}/api/remote/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

        ws.onopen = () => {
          setIsTalking(true)
        // Use MediaRecorder to push chunks
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : ''

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            const buffer = await e.data.arrayBuffer()
            ws.send(buffer)
          }
        }

        recorder.start(100) // 100ms slices for low latency
      }

      ws.onerror = () => {
        setPttError('Could not connect audio stream to PC')
        stopTalking()
      }
    } catch (err) {
      setPttError(`Microphone access error: ${err.message}`)
      setIsTalking(false)
    }
  }

  const stopTalking = () => {
    setIsTalking(false)
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    } catch {}

    try {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop())
      }
    } catch {}

    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'mic_stop' }))
        wsRef.current.close()
      }
    } catch {}
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 12px' }}>
      {notice && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'var(--bg-inset)',
            border: '1px solid var(--accent)',
            fontSize: 12,
            color: 'var(--text)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer' }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* 1. Master Volume & Mute */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="music" size={18} />
            <strong style={{ fontSize: 14, color: 'var(--text)' }}>Master Volume</strong>
          </div>
          <button
            type="button"
            className="set-btn-sm"
            onClick={toggleMute}
            style={{
              color: muted ? '#ef4444' : 'var(--text)',
              borderColor: muted ? '#ef4444' : undefined,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name={muted ? 'minus-circle' : 'dash'} size={14} />
            {muted ? 'Muted' : 'Mute'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={handleVolumeChange}
            style={{ flex: 1, accentColor: 'var(--accent, #6366f1)', height: 6, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 16, fontWeight: 700, minWidth: 42, textAlign: 'right', color: 'var(--text)' }}>
            {volume}%
          </span>
        </div>

        {/* Audio Sink Switcher */}
        {sinks.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline-strong)' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-sub)', marginBottom: 6 }}>
              Output Device (Audio Sink):
            </label>
            <select
              value={currentSink}
              onChange={handleSinkChange}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--hairline-strong)',
                color: 'var(--text)',
                fontSize: 12,
              }}
            >
              {sinks.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.description || s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 2. MPRIS Media Playback */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 8, textTransform: 'uppercase' }}>
          Now Playing
        </div>

        {media?.active_player ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {media.title || 'Unknown Title'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2 }}>
              {media.artist || 'Unknown Artist'} {media.album ? `· ${media.album}` : ''}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              Via {media.active_player} ({media.status || 'Active'})
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, marginBottom: 14 }}>
            No media player currently active on PC.
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => handleAction('previous')}
            style={{ width: 44, height: 44, borderRadius: '50%', padding: 0, display: 'grid', placeItems: 'center' }}
            title="Previous"
          >
            ⏮
          </button>
          <button
            type="button"
            className="pair-go"
            onClick={() => handleAction('play-pause')}
            style={{ width: 56, height: 56, borderRadius: '50%', padding: 0, display: 'grid', placeItems: 'center', fontSize: 20 }}
            title="Play / Pause"
          >
            {media?.status === 'Playing' ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => handleAction('next')}
            style={{ width: 44, height: 44, borderRadius: '50%', padding: 0, display: 'grid', placeItems: 'center' }}
            title="Next"
          >
            ⏭
          </button>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => handleAction('stop')}
            style={{ width: 44, height: 44, borderRadius: '50%', padding: 0, display: 'grid', placeItems: 'center' }}
            title="Stop"
          >
            ⏹
          </button>
        </div>
      </div>

      {/* 3. Push-To-Talk Phone Mic to PC Speakers */}
      <div
        style={{
          background: isTalking ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-inset)',
          border: `1px solid ${isTalking ? '#ef4444' : 'var(--hairline-strong)'}`,
          borderRadius: 8,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          transition: 'all 0.2s ease',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 4, textTransform: 'uppercase' }}>
          Intercom / Push-To-Talk
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 16px', maxWidth: 280 }}>
          Hold the button below to stream your voice directly through your computer speakers.
        </p>

        {isTalking && (
          <div
            style={{
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: '#ef4444',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#ef4444',
                boxShadow: '0 0 8px #ef4444',
                animation: 'pulse 1s infinite',
              }}
            />
            TRANSMITTING TO PC SPEAKERS
          </div>
        )}

        <button
          type="button"
          onMouseDown={startTalking}
          onMouseUp={stopTalking}
          onTouchStart={(e) => {
            e.preventDefault()
            startTalking()
          }}
          onTouchEnd={(e) => {
            e.preventDefault()
            stopTalking()
          }}
          style={{
            width: 84,
            height: 84,
            borderRadius: '50%',
            border: `3px solid ${isTalking ? '#ef4444' : 'var(--accent, #6366f1)'}`,
            background: isTalking ? '#ef4444' : 'rgba(99, 102, 241, 0.1)',
            color: isTalking ? '#fff' : 'var(--accent, #6366f1)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            userSelect: 'none',
            touchAction: 'none',
            boxShadow: isTalking ? '0 0 20px rgba(239, 68, 68, 0.4)' : undefined,
            transform: isTalking ? 'scale(1.08)' : 'scale(1)',
            transition: 'transform 0.1s ease',
          }}
        >
          <Icon name="microphone" size={32} />
        </button>

        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10 }}>
          {isTalking ? 'Release to stop talking' : 'Hold to speak'}
        </span>

        {pttError && (
          <div style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>
            {pttError}
          </div>
        )}
      </div>
    </div>
  )
}
