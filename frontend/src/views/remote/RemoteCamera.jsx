import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api, getBase } from '../../api.js'
import * as syncClient from '../../lib/sync/client.js'

export default function RemoteCamera() {
  const [cameras, setCameras] = useState([])
  const [selectedCamera, setSelectedCamera] = useState('/dev/video0')
  const [streaming, setStreaming] = useState(false)
  const [snapshotUrl, setSnapshotUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const token = syncClient.identity()?.token || ''

  const loadCameras = useCallback(async () => {
    try {
      const res = await api.remoteCameraList()
      setCameras(res.cameras || [])
      if (res.cameras?.length && !selectedCamera) {
        setSelectedCamera(res.cameras[0].device)
      }
    } catch (err) {
      setError(err.message || 'Could not list cameras')
    }
  }, [selectedCamera])

  useEffect(() => {
    loadCameras()
  }, [loadCameras])

  const stopStream = async () => {
    setStreaming(false)
    try {
      await api.remoteCameraStop()
    } catch {}
  }

  const takeSnapshot = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.remoteCameraSnapshot(selectedCamera)
      if (res.image) {
        setSnapshotUrl(res.image)
        setStreaming(false)
      }
    } catch (err) {
      setError(`Snapshot failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 12px' }}>
      {/* Privacy Notice Banner */}
      <div
        style={{
          background: streaming ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-inset)',
          border: `1px solid ${streaming ? '#ef4444' : 'var(--hairline-strong)'}`,
          borderRadius: 8,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: streaming ? '#ef4444' : 'var(--text-faint)',
            boxShadow: streaming ? '0 0 10px #ef4444' : undefined,
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: streaming ? '#ef4444' : 'var(--text)' }}>
            {streaming ? 'CAMERA IS ACTIVE & STREAMING' : 'Webcam Standby'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>
            When streaming is turned on, Amethyst on-air indicator is active on your PC.
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Camera Selector & Controls */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            Select Camera:
          </label>
          <button
            type="button"
            className="set-btn-sm"
            onClick={loadCameras}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="refresh" size={12} />
            Refresh
          </button>
        </div>

        <select
          value={selectedCamera}
          onChange={(e) => {
            setSelectedCamera(e.target.value)
            if (streaming) stopStream()
          }}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid var(--hairline-strong)',
            color: 'var(--text)',
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          {cameras.length === 0 && <option value="/dev/video0">Default Camera (/dev/video0)</option>}
          {cameras.map((c) => (
            <option key={c.device} value={c.device}>
              {c.name} ({c.device})
            </option>
          ))}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            type="button"
            className="set-btn-sm"
            onClick={takeSnapshot}
            disabled={loading}
            style={{ padding: '10px 0', textAlign: 'center' }}
          >
            {loading ? 'Capturing…' : 'Take Snapshot'}
          </button>
          <button
            type="button"
            className="pair-go"
            onClick={() => {
              if (streaming) stopStream()
              else setStreaming(true)
            }}
            style={{
              padding: '10px 0',
              textAlign: 'center',
              background: streaming ? '#ef4444' : undefined,
            }}
          >
            {streaming ? 'Stop Live Feed' : 'Start Live Feed'}
          </button>
        </div>
      </div>

      {/* Video Viewfinder */}
      <div
        style={{
          background: '#000',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          overflow: 'hidden',
          minHeight: 240,
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
        }}
      >
        {streaming ? (
          <img
            src={`${getBase()}/remote/camera/stream?device=${encodeURIComponent(selectedCamera)}&token=${encodeURIComponent(token)}&fps=15`}
            alt="Live Webcam"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        ) : snapshotUrl ? (
          <img
            src={snapshotUrl}
            alt="Camera Snapshot"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        ) : (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', padding: 24 }}>
            <Icon name="camera" size={36} />
            <div style={{ marginTop: 10 }}>Camera is idle. Tap &ldquo;Start Live Feed&rdquo; to begin stream.</div>
          </div>
        )}
      </div>
    </div>
  )
}
