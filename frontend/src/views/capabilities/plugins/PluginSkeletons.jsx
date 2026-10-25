import { ChevronLeft } from 'lucide-react'
import Skeleton from '../../../components/Skeleton.jsx'

const TITLE_WIDTHS = ['115px', '145px', '95px', '135px', '125px', '105px']
const BLURB_WIDTHS_1 = ['88%', '94%', '84%', '90%', '82%', '92%']
const BLURB_WIDTHS_2 = ['55%', '65%', '48%', '58%', '62%', '50%']

/**
 * Component-accurate skeleton synced with `PluginCard.jsx`.
 * Matches exact padding, flex layout, squircle icon (44px), title height,
 * blurb line heights, and circular action button.
 */
export function PluginCardSkeleton({ index = 0, style }) {
  const titleW = TITLE_WIDTHS[index % TITLE_WIDTHS.length]
  const blurbW1 = BLURB_WIDTHS_1[index % BLURB_WIDTHS_1.length]
  const blurbW2 = BLURB_WIDTHS_2[index % BLURB_WIDTHS_2.length]

  return (
    <div
      className="plugin-card-row is-skeleton"
      aria-hidden="true"
      style={style}
    >
      <div className="plugin-card-main-col">
        {/* Icon placeholder matching ServiceIcon (44x44, border-radius: 8px) */}
        <Skeleton w={44} h={44} r={8} className="shrink-0" />

        <div className="plugin-card-text-block" style={{ width: '100%', minWidth: 0 }}>
          <div className="plugin-card-title-row">
            <Skeleton w={titleW} h={16} r={4} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
            <Skeleton w={blurbW1} h={12} r={3} />
            <Skeleton w={blurbW2} h={12} r={3} />
          </div>
        </div>
      </div>

      <div className="plugin-card-action-col">
        {/* Action button placeholder matching 32px pill */}
        <Skeleton w={32} h={32} r={99} />
      </div>
    </div>
  )
}

/**
 * 2-Column Grid skeleton synced with `.plugin-two-col-grid`.
 */
export function PluginGridSkeleton({ count = 6 }) {
  return (
    <div className="plugin-two-col-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <PluginCardSkeleton key={i} index={i} />
      ))}
    </div>
  )
}

/**
 * Horizontal "Installed >" squircle icon strip skeleton.
 */
export function PluginInstalledStripSkeleton() {
  return (
    <section className="plugin-installed-strip-section is-skeleton" aria-hidden="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <Skeleton w={70} h={16} r={4} />
        <Skeleton w={12} h={12} r={3} />
      </div>
      <div className="plugin-installed-icons-row" style={{ overflow: 'hidden' }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} w={44} h={44} r={12} className="shrink-0" />
        ))}
      </div>
    </section>
  )
}

/**
 * Category bridge link row skeleton with overlapping mini-icons.
 */
export function PluginCategoryBridgeSkeleton({ index = 0 }) {
  return (
    <div className="plugin-category-bridge-row is-skeleton" aria-hidden="true">
      <div className="plugin-category-bridge-btn" style={{ pointerEvents: 'none' }}>
        <div className="plugin-bridge-mini-icons">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="plugin-bridge-mini-icon-wrap">
              <Skeleton w={20} h={20} r={6} />
            </div>
          ))}
        </div>
        <Skeleton w={index % 2 === 0 ? 190 : 230} h={13} r={4} />
      </div>
    </div>
  )
}

/**
 * Featured top carousel skeleton synced with `PluginFeaturedCarousel.jsx`.
 * Matches exact height (200px), 22px radius, squircle icon (52px), title,
 * 2-line blurb, pill button, and bottom indicator dots.
 */
export function PluginCarouselSkeleton() {
  return (
    <div className="plugin-carousel-wrap is-skeleton" aria-hidden="true">
      <div className="plugin-carousel-card plugin-carousel-card--skeleton">
        <div className="plugin-carousel-body">
          <div className="plugin-carousel-inner">
            <div className="plugin-carousel-info" style={{ pointerEvents: 'none' }}>
              <Skeleton w={52} h={52} r={14} className="shrink-0" />
              <div className="plugin-carousel-text" style={{ width: '100%', minWidth: 260 }}>
                <Skeleton w={140} h={22} r={5} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  <Skeleton w="82%" h={13} r={3} />
                  <Skeleton w="52%" h={13} r={3} />
                </div>
              </div>
            </div>

            <div className="plugin-carousel-actions">
              <Skeleton w={92} h={36} r={99} className="shrink-0" />
            </div>
          </div>

          <div className="plugin-carousel-dots" style={{ pointerEvents: 'none' }}>
            <Skeleton w={20} h={6} r={99} />
            <Skeleton w={6} h={6} r={99} />
            <Skeleton w={6} h={6} r={99} />
            <Skeleton w={6} h={6} r={99} />
            <Skeleton w={6} h={6} r={99} />
            <Skeleton w={6} h={6} r={99} />
            <Skeleton w={6} h={6} r={99} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Complete directory skeleton screen synced with `PluginsDirectory.jsx`.
 */
export function PluginsDirectorySkeleton({ showCarousel = true }) {
  return (
    <div className="plugin-directory-skeleton-body" aria-hidden="true">
      {/* Featured top carousel skeleton */}
      {showCarousel && <PluginCarouselSkeleton />}

      {/* Installed horizontal strip */}
      <PluginInstalledStripSkeleton />

      {/* Popular Section */}
      <section className="plugin-directory-section" style={{ marginTop: '1.25rem' }}>
        <div className="plugin-section-header">
          <Skeleton w={72} h={18} r={4} />
        </div>
        <PluginGridSkeleton count={6} />
        <PluginCategoryBridgeSkeleton index={0} />
      </section>

      {/* New & Noteworthy Section */}
      <section className="plugin-directory-section" style={{ marginTop: '1.75rem' }}>
        <div className="plugin-section-header">
          <Skeleton w={140} h={18} r={4} />
        </div>
        <PluginGridSkeleton count={6} />
        <PluginCategoryBridgeSkeleton index={1} />
      </section>
    </div>
  )
}

/**
 * Detail view skeleton synced with `PluginDetailView.jsx`.
 */
export function PluginDetailSkeleton({ onBack }) {
  return (
    <div className="plugin-detail-page-wrapper" aria-hidden="true">
      {/* Top Breadcrumb Skeleton */}
      <div className="plugin-detail-breadcrumb-bar">
        <div className="plugin-detail-sidebar-icon">
          <Skeleton w={16} h={16} r={3} />
        </div>
        <div className="plugin-detail-breadcrumbs">
          <button type="button" className="plugin-breadcrumb-link" onClick={onBack}>
            Plugins
          </button>
          <span className="plugin-breadcrumb-sep">&gt;</span>
          <Skeleton w={90} h={14} r={3} />
        </div>
      </div>

      <div className="plugin-detail-content-column">
        {/* Avatar Skeleton */}
        <div className="plugin-detail-avatar-container">
          <Skeleton w={72} h={72} r={18} className="shrink-0" />
        </div>

        {/* Title and Actions Row Skeleton */}
        <div className="plugin-detail-hero-row">
          <div className="plugin-detail-title-col" style={{ width: '100%', maxWidth: 280 }}>
            <Skeleton w={160} h={28} r={6} />
            <Skeleton w={95} h={14} r={4} style={{ marginTop: 6 }} />
          </div>

          <div className="plugin-detail-actions-col">
            <Skeleton w={34} h={34} r={99} />
            <Skeleton w={88} h={34} r={99} />
            <Skeleton w={108} h={34} r={99} />
          </div>
        </div>

        {/* Hero Prompt Box Skeleton */}
        <div className="plugin-detail-hero-box">
          <div className="plugin-hero-prompt-list">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="plugin-hero-prompt-card"
                style={{ pointerEvents: 'none', opacity: 0.7 }}
              >
                <div className="plugin-hero-prompt-left" style={{ width: '85%' }}>
                  <Skeleton w={18} h={18} r={4} className="shrink-0" />
                  <Skeleton w={60} h={13} r={3} className="shrink-0" />
                  <Skeleton w={`${75 - i * 10}%`} h={13} r={3} />
                </div>
                <Skeleton w={26} h={26} r={99} className="shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Description Skeleton */}
        <div className="plugin-detail-desc-block">
          <Skeleton w="100%" h={14} r={4} />
          <Skeleton w="88%" h={14} r={4} style={{ marginTop: 8 }} />
        </div>

        {/* Apps Section Skeleton */}
        <div className="plugin-detail-apps-section">
          <div className="plugin-detail-section-header">
            <Skeleton w={75} h={18} r={4} />
          </div>
          <div className="plugin-detail-apps-list">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="plugin-app-row">
                <div className="plugin-app-row-left">
                  <Skeleton w={36} h={36} r={8} className="shrink-0" />
                  <div className="plugin-app-text-block" style={{ width: '100%', minWidth: 200 }}>
                    <Skeleton w={110} h={15} r={4} />
                    <Skeleton w="70%" h={12} r={3} style={{ marginTop: 6 }} />
                  </div>
                </div>
                <Skeleton w={80} h={28} r={99} className="shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Info Table Section Skeleton */}
        <div className="plugin-detail-info-section">
          <Skeleton w={110} h={18} r={4} style={{ marginBottom: 12 }} />
          <div className="plugin-detail-info-table">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="plugin-detail-info-row">
                <Skeleton w={100} h={13} r={4} />
                <Skeleton w={130} h={13} r={4} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
