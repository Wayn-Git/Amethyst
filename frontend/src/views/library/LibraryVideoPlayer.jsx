import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import AppButton from '../../components/ui/AppButton.jsx'

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function isPlayableDirectVideo(url) {
  if (!url || typeof url !== 'string') return false
  return /\.(mp4|webm|mov|mkv)(\?|$)/i.test(url) || url.startsWith('/api/library/')
}

export default function LibraryVideoPlayer({
  src,
  poster,
  title,
  fallbackUrl,
  embedUrl,
  isYouTube = false,
  isVertical = false,
  cleanCoverSlug = 'video',
  isTheater = false,
  subtitles = null,
  onTimeUpdate = null,
  seekToTime = null,
}) {
  const containerRef = useRef(null)
  const videoRef = useRef(null)
  const scrubberRef = useRef(null)
  const hideControlsTimeoutRef = useRef(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false)
  const [flashAction, setFlashAction] = useState(null)
  const [currentSrc, setCurrentSrc] = useState(src)
  const [showEmbed, setShowEmbed] = useState(() => Boolean(embedUrl && (isYouTube || !isPlayableDirectVideo(src))))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showCaptions, setShowCaptions] = useState(true)

  // Parse whisper / speech sentences for synchronized subtitles
  const captionSentences = useMemo(() => {
    if (!subtitles) return []
    const raw = String(subtitles).replace(/\[[^\]]*\]/g, '').replace(/https?:\/\/\S+/g, '').trim()
    if (!raw) return []
    return raw
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'))
  }, [subtitles])

  const activeCaption = useMemo(() => {
    if (!captionSentences.length || !duration || duration <= 0) {
      return captionSentences[0] || null
    }
    const idx = Math.min(
      captionSentences.length - 1,
      Math.floor((currentTime / duration) * captionSentences.length)
    )
    return captionSentences[idx] || null
  }, [captionSentences, currentTime, duration])

  // Sync src & embed
  useEffect(() => {
    setCurrentSrc(src)
    const shouldEmbed = Boolean(embedUrl && (isYouTube || !isPlayableDirectVideo(src)))
    setShowEmbed(shouldEmbed)
    setIsPlaying(false)
    setHasStartedPlaying(false)
    setCurrentTime(0)
  }, [src, embedUrl, isYouTube])

  // Auto-hide controls timer
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current)
    }
    if (isPlaying) {
      hideControlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false)
      }, 2500)
    }
  }, [isPlaying])

  useEffect(() => {
    resetHideTimer()
    return () => {
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current)
      }
    }
  }, [resetHideTimer])

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => {
        setIsPlaying(true)
        setHasStartedPlaying(true)
        setFlashAction('play')
        setTimeout(() => setFlashAction(null), 500)
      }).catch(() => {
        // Fallback for autoplay rejection
      })
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
      setFlashAction('pause')
      setTimeout(() => setFlashAction(null), 500)
    }
  }, [])

  // Toggle mute
  const toggleMute = useCallback((e) => {
    e?.stopPropagation()
    if (!videoRef.current) return
    const next = !videoRef.current.muted
    videoRef.current.muted = next
    setIsMuted(next)
  }, [])

  // Toggle fullscreen
  const toggleFullscreen = useCallback((e) => {
    e?.stopPropagation()
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // Sync external seek
  useEffect(() => {
    if (seekToTime != null && Number.isFinite(seekToTime) && videoRef.current) {
      videoRef.current.currentTime = seekToTime
      setCurrentTime(seekToTime)
    }
  }, [seekToTime])

  // Time & progress update
  const handleTimeUpdate = () => {
    if (!videoRef.current || isScrubbing) return
    const t = videoRef.current.currentTime
    setCurrentTime(t)
    onTimeUpdate?.(t)
  }

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return
    setDuration(videoRef.current.duration || 0)
  }

  // Scrubber seeking
  const handleScrubSeek = (e) => {
    if (!scrubberRef.current || !videoRef.current) return
    const rect = scrubberRef.current.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const seekTime = pos * (duration || 1)
    videoRef.current.currentTime = seekTime
    setCurrentTime(seekTime)
  }

  const handleScrubberMouseDown = (e) => {
    e.stopPropagation()
    setIsScrubbing(true)
    handleScrubSeek(e)

    const handleMouseMove = (moveEvent) => {
      handleScrubSeek(moveEvent)
    }

    const handleMouseUp = () => {
      setIsScrubbing(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  // Keyboard navigation on video
  const handleKeyDown = (e) => {
    if (['Space', ' ', 'k', 'K'].includes(e.key)) {
      e.preventDefault()
      togglePlay()
    } else if (['m', 'M'].includes(e.key)) {
      e.preventDefault()
      toggleMute()
    } else if (['f', 'F'].includes(e.key)) {
      e.preventDefault()
      toggleFullscreen()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (videoRef.current) {
        const nextTime = Math.max(0, currentTime - 5)
        videoRef.current.currentTime = nextTime
        setCurrentTime(nextTime)
        setFlashAction('backward')
        setTimeout(() => setFlashAction(null), 500)
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (videoRef.current) {
        const nextTime = Math.min(duration, currentTime + 5)
        videoRef.current.currentTime = nextTime
        setCurrentTime(nextTime)
        setFlashAction('forward')
        setTimeout(() => setFlashAction(null), 500)
      }
    }
  }

  const handleError = () => {
    if (fallbackUrl && currentSrc !== fallbackUrl) {
      setCurrentSrc(fallbackUrl)
    } else if (embedUrl) {
      setShowEmbed(true)
    }
  }

  return (
    <div
      ref={containerRef}
      className={`lib-player ${isVertical ? 'lib-player--vertical' : 'lib-player--landscape'} ${isTheater ? 'lib-player--theater' : ''} ${isFullscreen ? 'lib-player--fullscreen' : ''}`}
      onMouseMove={resetHideTimer}
      onClick={showEmbed ? undefined : togglePlay}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Video Player"
    >
      {/* Fallback to Web Embed if direct MP4 stream fails or embed is primary */}
      {showEmbed && embedUrl ? (
        <div className="lib-player-embed-wrap">
          <iframe
            src={embedUrl}
            title={title || 'Video Player'}
            className="lib-player-embed"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="lib-player-media-wrap">
          <video
            ref={videoRef}
            src={currentSrc}
            poster={poster}
            className="lib-player-video"
            playsInline
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            onError={handleError}
          />

          {/* Center Play Button on initial idle/pause */}
          {!hasStartedPlaying && (
            <div className="lib-player-center-play">
              <div className="lib-player-play-disc" aria-label="Play video">
                <Icon name="play" size={24} />
              </div>
            </div>
          )}

          {/* Center Action Feedback Flash (Play / Pause / Seek) */}
          <AnimatePresence>
            {flashAction && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.2 }}
                className="lib-player-feedback-badge"
              >
                <Icon
                  name={
                    flashAction === 'play'
                      ? 'play'
                      : flashAction === 'pause'
                      ? 'pause'
                      : flashAction === 'forward'
                      ? 'rotate-cw'
                      : 'rotate-ccw'
                  }
                  size={28}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Synchronized Closed Captions / Subtitles Overlay (Only while playing) */}
          {isPlaying && showCaptions && activeCaption && (
            <div className="lib-player-captions-overlay">
              <span>{activeCaption}</span>
            </div>
          )}

          {/* Custom Floating Control Bar (Auto-hides during playback) */}
          <div
            className={`lib-player-controls ${showControls || !isPlaying ? 'lib-player-controls--visible' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Timeline Scrubber */}
            <div
              ref={scrubberRef}
              className="lib-player-scrubber-track"
              onMouseDown={handleScrubberMouseDown}
              title="Seek"
            >
              <div
                className="lib-player-scrubber-fill"
                style={{ width: `${progressPercent}%` }}
              >
                <div className="lib-player-scrubber-thumb" />
              </div>
            </div>

            {/* Bottom Button Row using AppButton */}
            <div className="lib-player-controls-row">
              <div className="lib-player-controls-left">
                <AppButton
                  variant="ghost"
                  size="icon"
                  className="lib-player-btn"
                  onClick={togglePlay}
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  icon={<Icon name={isPlaying ? 'pause' : 'play'} size={14} />}
                />

                <span className="lib-player-time">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="lib-player-controls-right">
                {/* Mute toggle */}
                <AppButton
                  variant="ghost"
                  size="icon"
                  className="lib-player-btn"
                  onClick={toggleMute}
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  icon={<Icon name={isMuted ? 'muted' : 'speaker'} size={14} />}
                />

                {/* Subtitles / Closed Captions Toggle */}
                {captionSentences.length > 0 && (
                  <AppButton
                    variant="ghost"
                    size="icon"
                    className={`lib-player-btn ${showCaptions ? 'lib-player-btn--active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowCaptions((prev) => !prev)
                    }}
                    title={showCaptions ? 'Disable subtitles (C)' : 'Enable subtitles (C)'}
                    aria-label="Toggle Subtitles"
                  >
                    <span className="lib-player-cc-badge">CC</span>
                  </AppButton>
                )}

                {/* Web Embed Switcher if available */}
                {embedUrl && (
                  <AppButton
                    variant="ghost"
                    size="icon"
                    className="lib-player-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowEmbed(true)
                    }}
                    title="Switch to Web Player"
                    aria-label="Web Player"
                    icon={<Icon name="globe" size={14} />}
                  />
                )}

                {/* Fullscreen */}
                <AppButton
                  variant="ghost"
                  size="icon"
                  className="lib-player-btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                  aria-label="Toggle Fullscreen"
                  icon={<Icon name={isFullscreen ? 'collapse' : 'maximize'} size={14} />}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
