/* The camera, pointed at a pairing code.
 *
 * Built on `BarcodeDetector`, which is a browser API rather than a library:
 * Chrome on Android has it, and where it does the scan costs this application
 * nothing in bundle size and runs in the browser's own decoder rather than a
 * megabyte of wasm on the main thread.
 *
 * Where it does not exist -- Safari on iOS, most notably -- there is no
 * fallback here on purpose, because iOS does not need one. The machine's QR
 * code is an ordinary https link, so the *system camera app* scans it and opens
 * the pairing screen with the code already in it. That is one fewer tap than an
 * in-app scanner, not one more, and it is why `supported()` is exported: the
 * caller offers this button only where it will do something, and shows the
 * typed code everywhere else rather than a camera button that fails on tap.
 * That check is `canScan` in `views/Pair.jsx`, beside the button it governs.
 *
 * The stream is stopped in every exit path. A camera left running is a light on
 * somebody's phone that this app turned on and did not turn off.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import Icon from './Icon.jsx'

/** How often to look at the frame. Ten a second reads instantly to a person and
 *  leaves the phone's decoder idle most of the time. */
const SCAN_INTERVAL_MS = 100

export default function QrScanner({ onScan, onCancel }) {
  const videoRef = useRef(null)
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
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, which is the one pointed at the other screen.
          // `ideal` rather than `exact` so a device with only one still works.
          video: { facingMode: { ideal: 'environment' } },
        })
      } catch (err) {
        // Denied, or no camera. Both are ordinary answers, not faults: the
        // typed code is still there behind this.
        if (!cancelled) {
          setError(
            err?.name === 'NotAllowedError'
              ? 'Camera access was declined. You can type the code instead.'
              : 'No camera available here. You can type the code instead.',
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

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      timer = setInterval(async () => {
        if (cancelled || !videoRef.current || videoRef.current.readyState < 2) return
        let found = []
        try {
          found = await detector.detect(videoRef.current)
        } catch {
          // A frame the decoder could not read is the normal case between one
          // aimed at the code and the next. Nothing to report.
          return
        }
        const value = found.find((code) => code.rawValue)?.rawValue
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
      <p className="qr-scan-hint">
        {error || 'Point this at the code on your computer.'}
      </p>
      <button type="button" className="pair-secondary" onClick={onCancel}>
        <Icon name="x" size={16} />
        Cancel
      </button>
    </div>
  )
}
