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
        {/* Squircle Icon placeholder matching ServiceIcon (44x44, border-radius: 12px) */}
        <Skeleton w={44} h={44} r={12} className="shrink-0" />

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
 * Complete directory skeleton screen synced with `PluginsDirectory.jsx`.
 */
export function PluginsDirectorySkeleton() {
  return (
    <div className="plugin-directory-skeleton-body" aria-hidden="true">
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
    <div className="plugin-detail-root is-skeleton" aria-hidden="true">
      {/* Top back navigation */}
      <div className="plugin-detail-top-nav">
        <button
          type="button"
          className="plugin-back-btn"
          onClick={onBack}
          aria-label="Back to plugins"
        >
          <ChevronLeft size={18} />
          <span>Plugins</span>
        </button>
      </div>

      <div className="plugin-detail-container">
        {/* Header Block */}
        <div className="plugin-detail-header">
          <div className="plugin-detail-header-left">
            <Skeleton w={64} h={64} r={16} className="shrink-0" />
            <div className="plugin-detail-title-block" style={{ width: '100%', minWidth: 200 }}>
              <Skeleton w={180} h={26} r={6} />
              <Skeleton w="75%" h={14} r={4} style={{ marginTop: 8 }} />
            </div>
          </div>

          <div className="plugin-detail-header-actions">
            <Skeleton w={104} h={38} r={99} />
          </div>
        </div>

        {/* Hero Preview Card Skeleton */}
        <div className="plugin-hero-preview-wrapper">
          <div className="plugin-hero-preview-backdrop">
            <div className="plugin-hero-user-bubble">
              <Skeleton w="65%" h={14} r={4} />
            </div>
            <div className="plugin-hero-assistant-card">
              <div className="plugin-hero-execution-meta" style={{ gap: 8 }}>
                <Skeleton w={14} h={14} r={99} />
                <Skeleton w={120} h={12} r={3} />
              </div>
              <div className="plugin-hero-response-body" style={{ marginTop: 12 }}>
                <Skeleton w="88%" h={13} r={3} style={{ marginBottom: 12 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton w="40%" h={12} r={3} />
                  <Skeleton w="95%" h={12} r={3} />
                  <Skeleton w="80%" h={12} r={3} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Long Description Skeleton */}
        <div className="plugin-detail-description" style={{ marginTop: 24 }}>
          <Skeleton w="100%" h={14} r={4} />
          <Skeleton w="90%" h={14} r={4} style={{ marginTop: 8 }} />
          <Skeleton w="55%" h={14} r={4} style={{ marginTop: 8 }} />
        </div>

        {/* Info Table Section Skeleton */}
        <div className="plugin-info-section" style={{ marginTop: 32 }}>
          <Skeleton w={110} h={18} r={4} style={{ marginBottom: 16 }} />
          <div className="plugin-info-table">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="plugin-info-row">
                <Skeleton w={100} h={13} r={4} />
                <Skeleton w={140} h={13} r={4} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
