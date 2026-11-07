import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import Icon from './Icon.jsx'

/** How often to look at the frame. Ten a second reads instantly to a person and
 *  leaves the phone's decoder idle most of the time. */
const SCAN_INTERVAL_MS = 100

export default function QrScanner({ onScan, onCancel }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [error, setError] = useState(null)
  // Held in a ref so the effect's cleanup can stop it without the stream being
  // a dependency that restarts the camera every render.
  const streamRef = useRef(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer = null

    const run = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setError(
            typeof window !== 'undefined' && window.isSecureContext === false
              ? 'Camera requires HTTPS or localhost on mobile browsers.'
              : 'Camera access is not supported on this device.'
          )
        }
        return
      }

      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, which is the one pointed at the other screen.
          // `ideal` rather than `exact` so a device with only one still works.
          video: { facingMode: { ideal: 'environment' } },
        })
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.name === 'NotAllowedError'
              ? 'Camera access was declined. Please allow camera permissions to scan the pairing QR code.'
              : 'No camera available on this device.'
          )
        }
        return
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        // Safari refuses to play without this even muted and inline.
        await video.play().catch(() => {})
      }

      const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window
      let detector = null
      let canvas = null
      let ctx = null

      if (hasBarcodeDetector) {
        try {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        } catch {
          detector = null
        }
      }

      if (!detector) {
        canvas = document.createElement('canvas')
        ctx = canvas.getContext('2d', { willReadFrequently: true })
        canvasRef.current = canvas
      }

      timer = setInterval(async () => {
        if (cancelled || !videoRef.current || videoRef.current.readyState < 2) return
        let value = null

        if (detector) {
          try {
            const found = await detector.detect(videoRef.current)
            value = found.find((c) => c.rawValue)?.rawValue
          } catch {
            // normal frame without detected code
          }
        } else if (ctx && videoRef.current.videoWidth > 0) {
          try {
            const v = videoRef.current
            const w = v.videoWidth
            const h = v.videoHeight
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w
              canvas.height = h
            }
            ctx.drawImage(v, 0, 0, w, h)
            const imageData = ctx.getImageData(0, 0, w, h)
            const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            })
            if (decoded?.data) {
              value = decoded.data
            }
          } catch {
            // normal frame without detected code
          }
        }

        if (value && !cancelled) {
          cancelled = true
          clearInterval(timer)
          stop()
          onScan(value)
        }
      }, SCAN_INTERVAL_MS)
    }

    run()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      stop()
    }
  }, [onScan, stop])

  return (
    <div className="qr-scan">
      <div className="qr-scan-frame">
        {/* `playsInline` is what stops iOS taking the video fullscreen, and
            `muted` is what lets it autoplay at all. */}
        <video ref={videoRef} className="qr-scan-video" playsInline muted />
        <div className="qr-scan-reticle" aria-hidden="true" />
      </div>
      <p className="qr-scan-hint" style={{ color: error ? '#ef4444' : '#141414', opacity: error ? 1 : 0.75 }}>
        {error || 'Point this at the code on your computer.'}
      </p>
      <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'center', marginTop: 4 }}>
        <button
          type="button"
          style={{
            background: '#111113',
            color: '#fff',
            borderRadius: 999,
            padding: '10px 20px',
            border: 0,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
