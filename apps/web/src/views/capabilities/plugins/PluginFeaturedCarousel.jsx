import { Button as HouseButton } from '../../../components/ui/bento/index.jsx'
import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Check, Loader2 } from 'lucide-react'
import ServiceIcon from './ServiceIcon.jsx'

const DEFAULT_FEATURED = [
  {
    slug: 'googledrive',
    altSlug: 'google_drive',
    name: 'Google Drive',
    domain: 'drive.google.com',
    tagline: 'Search, index, and query documents, presentations, and spreadsheets across Google Workspace.',
    base: '#041426',
    glow1: 'rgba(251, 188, 4, 0.65)',   // Google Yellow
    glow2: 'rgba(66, 133, 244, 0.70)',  // Google Blue
    glow3: 'rgba(52, 168, 83, 0.60)',   // Google Green
  },
  {
    slug: 'github',
    name: 'GitHub',
    domain: 'github.com',
    tagline: 'Connect your GitHub repositories directly for pull requests, reviews, and code search.',
    base: '#080d1a',
    glow1: 'rgba(130, 80, 223, 0.65)',  // GitHub Purple
    glow2: 'rgba(88, 166, 255, 0.60)',  // GitHub Blue
    glow3: 'rgba(46, 160, 67, 0.50)',   // GitHub Green
  },
  {
    slug: 'linear',
    name: 'Linear',
    domain: 'linear.app',
    tagline: 'Connect your Linear workspace to track issues, manage active cycles, and update roadmaps.',
    base: '#0a0818',
    glow1: 'rgba(94, 106, 210, 0.70)',  // Linear Indigo
    glow2: 'rgba(244, 63, 94, 0.60)',   // Linear Rose
    glow3: 'rgba(139, 92, 246, 0.50)',  // Linear Violet
  },
  {
    slug: 'notion',
    name: 'Notion',
    domain: 'notion.so',
    tagline: 'Give Amethyst instant access to your workspace docs, engineering specs, and team wikis.',
    base: '#120d10',
    glow1: 'rgba(225, 29, 72, 0.55)',   // Crimson
    glow2: 'rgba(245, 158, 11, 0.60)',  // Warm Amber
    glow3: 'rgba(234, 88, 12, 0.50)',   // Terracotta
  },
  {
    slug: 'slack',
    name: 'Slack',
    domain: 'slack.com',
    tagline: 'Stream channel discussions, capture meeting recaps, and send messages directly from the agent.',
    base: '#18061e',
    glow1: 'rgba(224, 30, 90, 0.65)',   // Slack Red
    glow2: 'rgba(46, 182, 125, 0.60)',  // Slack Green
    glow3: 'rgba(236, 178, 46, 0.60)',  // Slack Yellow
  },
  {
    slug: 'discord',
    name: 'Discord',
    domain: 'discord.com',
    tagline: 'Connect Discord servers to monitor announcements, chat in channels, and coordinate with teams.',
    base: '#0e1026',
    glow1: 'rgba(88, 101, 242, 0.75)',  // Discord Blurple
    glow2: 'rgba(121, 131, 245, 0.60)', // Pastel Blue
    glow3: 'rgba(235, 69, 158, 0.45)',  // Fuchsia
  },
  {
    slug: 'posthog',
    name: 'PostHog',
    domain: 'posthog.com',
    tagline: "Put your product's live pulse, event telemetry, and user journeys right inside Amethyst.",
    base: '#1a0815',
    glow1: 'rgba(249, 115, 22, 0.70)',  // PostHog Orange
    glow2: 'rgba(244, 63, 94, 0.60)',   // Hot Pink
    glow3: 'rgba(250, 204, 21, 0.50)',  // Yellow
  },
]

export default function PluginFeaturedCarousel({
  cards = [],
  statusMap = {},
  onOpenDetail,
  onConnect,
  busySlug = null,
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const timerRef = useRef(null)

  // Merge catalog metadata into featured slides
  const slides = useMemo(() => {
    const cardMap = new Map((cards || []).map((c) => [c.slug, c]))
    return DEFAULT_FEATURED.map((item) => {
      const liveCard = cardMap.get(item.slug) || (item.altSlug ? cardMap.get(item.altSlug) : null)
      return {
        ...item,
        card: liveCard || {
          slug: item.slug,
          name: item.name,
          label: item.name,
          domain: item.domain,
          blurb: item.tagline,
          description: item.tagline,
        },
        name: liveCard?.label || liveCard?.name || item.name,
        tagline: liveCard?.blurb || liveCard?.description || item.tagline,
        effectiveSlug: liveCard?.slug || item.slug,
      }
    })
  }, [cards])

  // Auto-cycle every 5.5 seconds, pause when hovered
  useEffect(() => {
    if (isPaused || slides.length <= 1) return
    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length)
    }, 5500)
    return () => clearInterval(timerRef.current)
  }, [isPaused, slides.length])

  const activeSlide = slides[currentIndex] || slides[0]
  if (!activeSlide) return null

  const isConnected = Boolean(
    statusMap[activeSlide.effectiveSlug]?.connected ||
    statusMap[activeSlide.effectiveSlug]?.accounts?.length ||
    statusMap[activeSlide.slug]?.connected ||
    statusMap[activeSlide.slug]?.accounts?.length
  )
  const isBusy = busySlug === activeSlide.effectiveSlug || busySlug === activeSlide.slug

  return (
    <div
      className="plugin-carousel-wrap"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      aria-label="Featured integrations carousel"
    >
      <div
        className="plugin-carousel-card"
        style={{
          '--carousel-base': activeSlide.base,
          '--carousel-glow-1': activeSlide.glow1,
          '--carousel-glow-2': activeSlide.glow2,
          '--carousel-glow-3': activeSlide.glow3,
        }}
      >
        {/* Layer 1: App-tailored wavy aurora gradient matching app icon colors */}
        <div className="plugin-carousel-mesh" aria-hidden="true" />

        {/* Layer 2: Tactile film-grain texture (matched to reference) */}
        <div className="plugin-carousel-texture" aria-hidden="true" />

        {/* Layer 3: Contrast vignette floor */}
        <div className="plugin-carousel-vignette" aria-hidden="true" />

        {/* Carousel Content */}
        <div className="plugin-carousel-body">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSlide.slug}
              className="plugin-carousel-inner"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Left Column: Icon + Text */}
              <div
                className="plugin-carousel-info"
                onClick={() => onOpenDetail?.(activeSlide.card)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenDetail?.(activeSlide.card)
                  }
                }}
              >
                <div className="plugin-carousel-icon-box">
                  <ServiceIcon card={activeSlide.card} size="large" />
                </div>
                <div className="plugin-carousel-text">
                  <h3 className="plugin-carousel-title">{activeSlide.name}</h3>
                  <p className="plugin-carousel-tagline">{activeSlide.tagline}</p>
                </div>
              </div>

              {/* Right Column: Install / Manage Button */}
              <div className="plugin-carousel-actions">
                {isBusy ? (
                  <HouseButton
                    type="button"
                    className="plugin-carousel-cta-btn is-busy"
                    disabled
                  >
                    <Loader2 size={15} className="animate-spin" />
                    <span>Connecting…</span>
                  </HouseButton>
                ) : isConnected ? (
                  <HouseButton
                    type="button"
                    className="plugin-carousel-cta-btn is-connected"
                    onClick={() => onOpenDetail?.(activeSlide.card)}
                  >
                    <Check size={14} />
                    <span>Connected</span>
                  </HouseButton>
                ) : (
                  <HouseButton
                    type="button"
                    className="plugin-carousel-cta-btn is-install"
                    onClick={() => onConnect?.(activeSlide.effectiveSlug)}
                    title={`Connect ${activeSlide.name}`}
                  >
                    <Download size={14} />
                    <span>Install</span>
                  </HouseButton>
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Bottom Pagination Dots */}
          <div className="plugin-carousel-dots" role="tablist" aria-label="Slides">
            {slides.map((s, idx) => {
              const isActive = idx === currentIndex
              return (
                <HouseButton
                  key={s.slug}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Go to slide ${idx + 1}: ${s.name}`}
                  className={`plugin-carousel-dot ${isActive ? 'is-active' : ''}`}
                  onClick={() => setCurrentIndex(idx)}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
