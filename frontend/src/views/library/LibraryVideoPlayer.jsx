import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export default function LibraryVideoPlayer({
  src,
  poster,
  title,
  fallbackUrl,
  embedUrl,
  isVertical = false,
  imageFitMode = 'contain',
  onToggleFit,
  cleanCoverSlug = 'video',
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
  const [showEmbed, setShowEmbed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Sync src
  useEffect(() => {
    setCurrentSrc(src)
    setIsPlaying(false)
    setHasStartedPlaying(false)
    setCurrentTime(0)
  }, [src])

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

  // Time & progress update
  const handleTimeUpdate = () => {
    if (!videoRef.current || isScrubbing) return
    setCurrentTime(videoRef.current.currentTime)
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
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (videoRef.current) {
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5)
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (videoRef.current) {
        videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5)
      }
    } else if (e.key === 'm') {
      e.preventDefault()
      toggleMute()
    } else if (e.key === 'f') {
      e.preventDefault()
      toggleFullscreen()
    }
  }

  return (
    <div
      ref={containerRef}
      className={`lib-player-root ${isVertical ? 'lib-player-root--portrait' : ''}`}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={title || 'Video Player'}
    >
      {/* 1. Embed mode (YouTube or Instagram web fallback) */}
      {showEmbed && embedUrl ? (
        <div className="lib-player-embed-wrap">
          <iframe
            src={embedUrl}
            title={title || 'Web Video Player'}
            className="lib-player-iframe"
            allowFullScreen
            scrolling="no"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>
      ) : (
        /* 2. Direct Video Player with Custom Controls */
        <div
          className="lib-player-surface"
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            src={currentSrc}
            playsInline
            loop
            poster={poster}
            className={`lib-player-video lib-player-video--${imageFitMode}`}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => {
              setIsPlaying(true)
              setHasStartedPlaying(true)
            }}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onError={() => {
              if (fallbackUrl && currentSrc !== fallbackUrl) {
                setCurrentSrc(fallbackUrl)
              } else if (embedUrl) {
                setShowEmbed(true)
              }
            }}
          />

          {/* Initial Pre-play Cover & Luminous Glass Play Badge */}
          {!hasStartedPlaying && (
            <div className="lib-player-preplay">
              {poster ? (
                <img
                  src={poster}
                  alt={title || 'Cover'}
                  className={`lib-player-poster lib-player-poster--${imageFitMode}`}
                />
              ) : (
                <div className="lib-player-graphic-card">
                  <div className="lib-player-graphic-title">{cleanCoverSlug}</div>
                </div>
              )}

              {/* Luminous Glass Play Button */}
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
                type="button"
                className="lib-player-hero-play"
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlay()
                }}
                title="Play video (Space)"
                aria-label="Play video"
              >
                <div className="lib-player-hero-circle">
                  <Icon name="play" size={24} style={{ marginLeft: 2 }} />
                </div>
              </motion.button>
            </div>
          )}

          {/* Flash Ripple Indicator on Click (Play/Pause momentary feedback) */}
          <AnimatePresence>
            {flashAction && hasStartedPlaying && (
              <motion.div
                key={flashAction}
                initial={{ scale: 0.8, opacity: 0.9 }}
                animate={{ scale: 1.25, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="lib-player-flash-badge"
              >
                <div className="lib-player-flash-circle">
                  <Icon name={flashAction === 'play' ? 'play' : 'pause'} size={28} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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

            {/* Bottom Button Row */}
            <div className="lib-player-controls-row">
              <div className="lib-player-controls-left">
                <button
                  type="button"
                  className="lib-player-btn"
                  onClick={togglePlay}
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  <Icon name={isPlaying ? 'pause' : 'play'} size={15} />
                </button>

                <span className="lib-player-time">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="lib-player-controls-right">
                {/* Mute toggle */}
                <button
                  type="button"
                  className="lib-player-btn"
                  onClick={toggleMute}
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  <Icon name={isMuted ? 'muted' : 'speaker'} size={14} />
                </button>

                {/* Aspect Ratio Fit Toggle */}
                {onToggleFit && (
                  <button
                    type="button"
                    className="lib-player-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleFit()
                    }}
                    title={imageFitMode === 'contain' ? 'Fill frame' : 'Original fit'}
                    aria-label="Toggle fit mode"
                  >
                    <Icon name={imageFitMode === 'contain' ? 'expand' : 'collapse'} size={13} />
                  </button>
                )}

                {/* Web Embed Switcher if available */}
                {embedUrl && (
                  <button
                    type="button"
                    className="lib-player-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowEmbed(true)
                    }}
                    title="Switch to Web Player"
                    aria-label="Web Player"
                  >
                    <Icon name="globe" size={13} />
                  </button>
                )}

                {/* Fullscreen */}
                <button
                  type="button"
                  className="lib-player-btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                  aria-label="Toggle Fullscreen"
                >
                  <Icon name={isFullscreen ? 'collapse' : 'maximize'} size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
