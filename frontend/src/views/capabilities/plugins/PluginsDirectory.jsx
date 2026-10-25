import { useMemo, useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Monitor,
} from 'lucide-react'
import PluginCard from './PluginCard.jsx'
import ServiceIcon from './ServiceIcon.jsx'
import PluginFeaturedCarousel from './PluginFeaturedCarousel.jsx'
import { SYSTEM_TOOLS, SystemToolCard } from '../SystemConnectorsPanel.jsx'
import {
  PluginGridSkeleton,
  PluginsDirectorySkeleton,
} from './PluginSkeletons.jsx'
import {
  CONNECTOR_CATEGORIES,
  categorizeCards,
} from './categoryConstants.js'

export default function PluginsDirectory({
  cards = [],
  loading = false,
  searchLoading = false,
  statusMap = {},
  searchQuery = '',
  setSearchQuery,
  tabFilter = 'all',
  onSwitchFilter,
  onOpenDetail,
  onOpenCategory,
  onOpenAuthModal,
  onConnect,
  onDisconnect,
  onChat,
  busySlug = null,
  newOpen,
  setNewOpen,
}) {
  // Inline expansion state for each category section
  const [expandedCategories, setExpandedCategories] = useState({})
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('all')

  const toggleCategoryExpand = (catId) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }))
  }

  // Extract all installed/connected cards
  const installedCards = useMemo(() => {
    return cards.filter(
      (c) =>
        Boolean(statusMap[c.slug]?.connected) ||
        Boolean(statusMap[c.slug]?.accounts?.length)
    )
  }, [cards, statusMap])

  // Organize cards into category sections using comprehensive mapping
  const categorizedSections = useMemo(() => {
    return categorizeCards(cards)
  }, [cards])

  // Instant search across system tools & cloud apps
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return { system: [], cloud: [] }

    const systemMatches =
      tabFilter === 'cloud'
        ? []
        : SYSTEM_TOOLS.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.desc.toLowerCase().includes(q) ||
              t.category.toLowerCase().includes(q) ||
              t.capabilities.some((c) => c.toLowerCase().includes(q))
          )

    const pool = tabFilter === 'installed' ? installedCards : cards
    const cloudMatches =
      tabFilter === 'system'
        ? []
        : pool.filter(
            (c) =>
              (c.label || c.name || '').toLowerCase().includes(q) ||
              (c.blurb || c.description || '').toLowerCase().includes(q) ||
              (c.slug || '').toLowerCase().includes(q) ||
              (c.category || '').toLowerCase().includes(q)
          )

    return { system: systemMatches, cloud: cloudMatches }
  }, [cards, installedCards, searchQuery, tabFilter])

  const hasSearch = searchQuery.trim().length > 0
  const totalSearchCount = searchResults.system.length + searchResults.cloud.length

  // Filter sections by tabFilter (when a category ID is selected)
  const visibleSections = useMemo(() => {
    if (tabFilter === 'all' || tabFilter === 'installed' || tabFilter === 'system') {
      return categorizedSections
    }
    return categorizedSections.filter((s) => s.id === tabFilter)
  }, [categorizedSections, tabFilter])

  return (
    <div className="plugin-directory-root">
      {/* ── Instant Live Search Results (Overlays directory when query is active) ── */}
      {hasSearch ? (
        <section className="plugin-directory-search-results-section">
          <div className="plugin-section-header">
            <span className="plugin-section-title">
              {searchLoading
                ? 'Searching connectors…'
                : `Search Results (${totalSearchCount})`}
            </span>
          </div>

          {searchLoading ? (
            <PluginGridSkeleton count={6} />
          ) : totalSearchCount === 0 ? (
            <div className="plugin-empty-search-state">
              <p className="text-base font-medium text-ink">No connectors found</p>
              <p className="text-xs text-dim mt-1">
                No tools matched &ldquo;{searchQuery}&rdquo;. Try another term or add a custom integration.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Cloud Results Shown First */}
              {searchResults.cloud.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-dim uppercase tracking-wider mb-3">
                    Cloud Apps ({searchResults.cloud.length})
                  </h3>
                  <div className="plugin-two-col-grid">
                    {searchResults.cloud.map((card) => (
                      <PluginCard
                        key={card.slug}
                        card={card}
                        status={statusMap[card.slug]}
                        onOpenDetail={onOpenDetail}
                        onConnect={onConnect}
                        onDisconnect={onDisconnect}
                        onChat={onChat}
                        busy={busySlug === card.slug}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* System Results Shown Second */}
              {searchResults.system.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-dim uppercase tracking-wider mb-3">
                    Local &amp; System Tools ({searchResults.system.length})
                  </h3>
                  <div className="system-tools-grid">
                    {searchResults.system.map((tool) => (
                      <SystemToolCard
                        key={tool.slug}
                        tool={tool}
                        onLaunchChat={(prompt) => onChat?.({ prompt })}
                        onOpenNewMcp={() => setNewOpen(true)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      ) : loading ? (
        <PluginsDirectorySkeleton showCarousel={tabFilter === 'all'} />
      ) : tabFilter === 'installed' ? (
        installedCards.length === 0 ? (
          <div className="plugin-empty-installed-state">
            <p className="text-base font-medium text-ink">No installed connectors</p>
            <p className="text-xs text-dim mt-1">
              You haven&rsquo;t connected any apps yet. Switch to &ldquo;All Connectors&rdquo; or &ldquo;Cloud Apps&rdquo; to connect integrations.
            </p>
          </div>
        ) : (
          <section className="plugin-directory-section">
            <div className="plugin-section-header">
              <h2 className="plugin-section-title">Connected Tools ({installedCards.length})</h2>
            </div>
            <div className="plugin-two-col-grid">
              {installedCards.map((card) => (
                <PluginCard
                  key={card.slug}
                  card={card}
                  status={statusMap[card.slug]}
                  onOpenDetail={onOpenDetail}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  onChat={onChat}
                  busy={busySlug === card.slug}
                />
              ))}
            </div>
          </section>
        )
      ) : tabFilter === 'system' ? (
        /* ── Local & System Exclusive View ── */
        <SystemConnectorsPanel
          query={searchQuery}
          newOpen={newOpen}
          setNewOpen={setNewOpen}
          embedded={false}
        />
      ) : (
        <>
          {/* ── Featured Top Carousel (Whirl Style) ── */}
          {tabFilter === 'all' && (
            <PluginFeaturedCarousel
              cards={cards}
              statusMap={statusMap}
              onOpenDetail={onOpenDetail}
              onConnect={onConnect}
              busySlug={busySlug}
            />
          )}

          {/* ── Connected Apps Strip (if any) ── */}
          {installedCards.length > 0 && tabFilter === 'all' && (
            <section className="plugin-installed-strip-section">
              <button
                type="button"
                className="plugin-installed-strip-header"
                onClick={() => (onSwitchFilter ? onSwitchFilter('installed') : onOpenCategory('Installed'))}
                title="View all installed plugins"
              >
                <span>Installed ({installedCards.length})</span>
                <ChevronRight size={15} className="text-dim" />
              </button>

              <div className="plugin-installed-icons-row">
                {installedCards.map((card) => (
                  <button
                    key={card.slug}
                    type="button"
                    className="plugin-installed-icon-btn"
                    onClick={() => onOpenDetail(card)}
                    title={`${card.label || card.name} (Connected)`}
                  >
                    <ServiceIcon card={card} size="default" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              PRIMARY: CLOUD APPS CATEGORIZED SECTIONS UPFRONT (COMPOSIO)
              ══════════════════════════════════════════════════════════════════ */}
          {visibleSections.map((section) => {
            const isSingleCategoryMode = tabFilter !== 'all' && tabFilter !== 'installed'
            const isExpanded = isSingleCategoryMode || Boolean(expandedCategories[section.id])
            const displayedCards = isExpanded ? section.cards : section.cards.slice(0, 6)
            const hasMore = !isSingleCategoryMode && section.cards.length > 6

            return (
              <section key={section.id} className="plugin-directory-section">
                <div className="plugin-section-header">
                  <div>
                    <div className="plugin-section-title-wrap">
                      <h2 className="plugin-section-title">{section.title}</h2>
                      <span className="plugin-section-badge">
                        {section.cards.length} apps
                      </span>
                    </div>
                    {section.desc && <p className="plugin-section-desc">{section.desc}</p>}
                  </div>

                  <div className="flex items-center gap-2">
                    {hasMore && (
                      <button
                        type="button"
                        className="plugin-section-toggle-btn"
                        onClick={() => toggleCategoryExpand(section.id)}
                      >
                        {isExpanded ? (
                          <>
                            <span>Show fewer</span>
                            <ChevronUp size={13} />
                          </>
                        ) : (
                          <>
                            <span>See all {section.cards.length} apps</span>
                            <ChevronDown size={13} />
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      className="plugin-section-more-btn"
                      onClick={() => onOpenCategory(section.id)}
                      title={`Open full ${section.title} view`}
                    >
                      <span>Category page</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>

                <div className="plugin-two-col-grid">
                  {displayedCards.map((card) => (
                    <PluginCard
                      key={card.slug}
                      card={card}
                      status={statusMap[card.slug]}
                      onOpenDetail={onOpenDetail}
                      onConnect={onConnect}
                      onDisconnect={onDisconnect}
                      onChat={onChat}
                      busy={busySlug === card.slug}
                    />
                  ))}
                </div>
              </section>
            )
          })}

          {/* ══════════════════════════════════════════════════════════════════
              SECONDARY: LOCAL & SYSTEM CONNECTORS (PLACED BELOW CLOUD APPS)
              ══════════════════════════════════════════════════════════════════ */}
          {tabFilter === 'all' && (
            <section className="plugin-system-section">
              <div className="plugin-section-header">
                <div>
                  <div className="plugin-section-title-wrap">
                    <Monitor size={17} className="text-dim" />
                    <h2 className="plugin-section-title">Local &amp; System Connectors</h2>
                    <span className="plugin-section-badge">
                      {SYSTEM_TOOLS.length} tools
                    </span>
                  </div>
                  <p className="plugin-section-desc">
                    Native host platform actuators, desktop automation, and runtime tools running on your machine.
                  </p>
                </div>

                <button
                  type="button"
                  className="plugin-section-more-btn"
                  onClick={() => onSwitchFilter?.('system')}
                >
                  <span>Manage System &amp; MCP</span>
                  <ArrowRight size={13} />
                </button>
              </div>

              <div className="system-tools-grid">
                {SYSTEM_TOOLS.map((tool) => (
                  <SystemToolCard
                    key={tool.slug}
                    tool={tool}
                    onLaunchChat={(prompt) => onChat?.({ prompt })}
                    onOpenNewMcp={() => setNewOpen(true)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Whirl-Style Bottom Footnote ── */}
          <div className="connectors-bottom-footnote">
            <span>Built something cool? Add your custom integration via </span>
            <button
              type="button"
              className="connectors-bottom-footnote-link"
              onClick={() => setNewOpen?.(true)}
            >
              Custom MCP Server ↗
            </button>
          </div>
        </>
      )}
    </div>
  )
}
