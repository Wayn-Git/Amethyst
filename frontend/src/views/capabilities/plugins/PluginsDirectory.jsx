import { useMemo } from 'react'
import {
  Search,
  Plus,
  X,
  ChevronRight,
  Server,
  ArrowRight,
  Monitor,
  Terminal,
} from 'lucide-react'
import PluginCard from './PluginCard.jsx'
import ServiceIcon from './ServiceIcon.jsx'
import { SYSTEM_TOOLS, SystemToolCard } from '../SystemConnectorsPanel.jsx'
import {
  PluginGridSkeleton,
  PluginsDirectorySkeleton,
} from './PluginSkeletons.jsx'

// Curated Popular App Slugs
const POPULAR_SLUGS = [
  'gmail',
  'github',
  'slack',
  'googledrive',
  'google_drive',
  'notion',
  'linear',
  'supabase',
  'spotify',
  'web_scraper',
]

// Curated New & Noteworthy Slugs
const NOTEWORTHY_SLUGS = [
  'tavily',
  'firecrawl',
  'exa',
  'jira',
  'gitlab',
  'medium',
  'duckduckgo',
  'calculator',
]

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
  // Map of card by slug for rapid lookup
  const cardMap = useMemo(() => {
    const map = new Map()
    for (const c of cards) {
      map.set(c.slug, c)
    }
    return map
  }, [cards])

  // Extract all installed/connected cards
  const installedCards = useMemo(() => {
    return cards.filter(
      (c) =>
        Boolean(statusMap[c.slug]?.connected) ||
        Boolean(statusMap[c.slug]?.accounts?.length)
    )
  }, [cards, statusMap])

  // Curated Popular Cards
  const popularCards = useMemo(() => {
    const list = []
    const seen = new Set()
    for (const slug of POPULAR_SLUGS) {
      const found = cardMap.get(slug)
      if (found && !seen.has(found.slug)) {
        list.push(found)
        seen.add(found.slug)
      }
    }
    // Fallback if catalog not fully loaded
    if (list.length < 4) {
      for (const c of cards.slice(0, 6)) {
        if (!seen.has(c.slug)) {
          list.push(c)
          seen.add(c.slug)
        }
      }
    }
    return list.slice(0, 6)
  }, [cards, cardMap])

  // Curated New & Noteworthy Cards
  const noteworthyCards = useMemo(() => {
    const list = []
    const seen = new Set(popularCards.map((c) => c.slug))
    for (const slug of NOTEWORTHY_SLUGS) {
      const found = cardMap.get(slug)
      if (found && !seen.has(found.slug)) {
        list.push(found)
        seen.add(found.slug)
      }
    }
    if (list.length < 4) {
      for (const c of cards) {
        if (!seen.has(c.slug)) {
          list.push(c)
          seen.add(c.slug)
          if (list.length >= 6) break
        }
      }
    }
    return list.slice(0, 6)
  }, [cards, cardMap, popularCards])

  // Mini-icons for category teasers
  const productivityPreviewCards = useMemo(() => {
    return cards.filter((c) => c.category === 'Productivity').slice(0, 3)
  }, [cards])

  const devToolsPreviewCards = useMemo(() => {
    return cards.filter((c) => c.category === 'Developer Tools').slice(0, 3)
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

  return (
    <div className="plugin-directory-root">
      {/* ── Main Header Row (Title, Subtitle, Search, Plus Button) ── */}
      <div className="plugin-directory-header-row">
        <div className="plugin-directory-title-block">
          <h1 className="plugin-directory-main-title">
            {tabFilter === 'installed'
              ? 'Installed Connectors'
              : tabFilter === 'cloud'
                ? 'Cloud Apps (Composio)'
                : 'Connectors Directory'}
          </h1>
          <p className="plugin-directory-main-subtitle">
            {tabFilter === 'installed'
              ? 'Active integrations currently connected to your Amethyst environment.'
              : tabFilter === 'cloud'
                ? 'OAuth & API integrations authenticated through Composio.'
                : 'Built-in system tools, desktop actuators, and 100+ cloud integrations.'}
          </p>
        </div>

        <div className="plugin-directory-actions-block">
          <div className="plugin-directory-search-pill">
            <Search size={15} className="text-dim shrink-0" />
            <input
              type="text"
              placeholder="Search tools and apps…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="plugin-directory-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="plugin-clear-search-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <button
            type="button"
            className="plugin-directory-plus-btn"
            onClick={onOpenAuthModal}
            title="Connect Composio or Custom MCP Server"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

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
            <PluginGridSkeleton count={4} />
          ) : totalSearchCount === 0 ? (
            <div className="plugin-empty-search-state">
              <p className="text-base font-medium text-ink">No connectors found</p>
              <p className="text-xs text-dim mt-1">
                No tools matched &ldquo;{searchQuery}&rdquo;. Try another term or add a custom integration.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
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
            </div>
          )}
        </section>
      ) : loading ? (
        <>
          <PluginsDirectorySkeleton />

          {/* ── Categories Quick Navigation Strip ── */}
          <section className="plugin-directory-categories-strip">
            <div className="plugin-section-header">
              <h2 className="plugin-section-title">Browse by Category</h2>
            </div>

            <div className="plugin-category-chips-row">
              {[
                'Communication',
                'Developer Tools',
                'Productivity',
                'Web & Data',
                'CRM & Sales',
                'Media & Social',
                'Utilities',
              ].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className="plugin-category-chip-btn"
                  onClick={() => onOpenCategory(cat)}
                >
                  <span>{cat}</span>
                  <ArrowRight size={13} className="text-dim" />
                </button>
              ))}
            </div>
          </section>
        </>
      ) : tabFilter === 'installed' ? (
        installedCards.length === 0 ? (
          <div className="plugin-empty-installed-state">
            <p className="text-base font-medium text-ink">No installed connectors</p>
            <p className="text-xs text-dim mt-1">
              You haven&rsquo;t connected any apps yet. Switch to &ldquo;All Tools&rdquo; or &ldquo;Cloud Apps&rdquo; to connect integrations.
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
      ) : (
        <>
          {/* ── "Installed >" Horizontal Squircle Strip (Screenshot 3) ── */}
          {installedCards.length > 0 && (
            <section className="plugin-installed-strip-section">
              <button
                type="button"
                className="plugin-installed-strip-header"
                onClick={() => (onSwitchFilter ? onSwitchFilter('installed') : onOpenCategory('Installed'))}
                title="View all installed plugins"
              >
                <span>Installed</span>
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

          {/* ── Local & System Connectors (Prominent Featured Section) ── */}
          {tabFilter !== 'cloud' && (
            <section className="plugin-directory-section">
              <div className="plugin-section-header">
                <div>
                  <h2 className="plugin-section-title">Local &amp; System Connectors</h2>
                  <p className="plugin-section-desc">
                    Native host capabilities, terminal actuators, and runtime tools running on your machine.
                  </p>
                </div>
                <button
                  type="button"
                  className="plugin-section-more-btn"
                  onClick={() => onSwitchFilter?.('system')}
                >
                  <span>Manage System Tools</span>
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

          {/* ── Popular Cloud Apps (Composio) ── */}
          <section className="plugin-directory-section">
            <div className="plugin-section-header">
              <div>
                <h2 className="plugin-section-title">
                  {tabFilter === 'cloud' ? 'Cloud Apps (Composio)' : 'Popular Cloud Apps (Composio)'}
                </h2>
                <p className="plugin-section-desc">
                  Connect external workspace tools, issue trackers, and cloud services.
                </p>
              </div>
              {tabFilter === 'all' && (
                <button
                  type="button"
                  className="plugin-section-more-btn"
                  onClick={() => onSwitchFilter?.('cloud')}
                >
                  <span>Browse All Cloud Apps</span>
                  <ArrowRight size={13} />
                </button>
              )}
            </div>

            <div className="plugin-two-col-grid">
              {popularCards.map((card) => (
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

            {/* Overlapping mini-icons + Category Bridge Link */}
            <div className="plugin-category-bridge-row">
              <button
                type="button"
                className="plugin-category-bridge-btn"
                onClick={() => onOpenCategory('Productivity')}
              >
                <div className="plugin-bridge-mini-icons">
                  {productivityPreviewCards.map((c) => (
                    <div key={c.slug} className="plugin-bridge-mini-icon-wrap">
                      <ServiceIcon card={c} size="small" />
                    </div>
                  ))}
                </div>
                <span className="plugin-bridge-text">
                  See Notion, Productivity, and more
                </span>
              </button>
            </div>
          </section>

          {/* ── New & Noteworthy Section (2-Column Grid + Category Bridge Link) ── */}
          <section className="plugin-directory-section">
            <div className="plugin-section-header">
              <h2 className="plugin-section-title">New &amp; Noteworthy</h2>
            </div>

            <div className="plugin-two-col-grid">
              {noteworthyCards.map((card) => (
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

            {/* Overlapping mini-icons + Developer Tools Category Bridge Link */}
            <div className="plugin-category-bridge-row">
              <button
                type="button"
                className="plugin-category-bridge-btn"
                onClick={() => onOpenCategory('Developer Tools')}
              >
                <div className="plugin-bridge-mini-icons">
                  {devToolsPreviewCards.map((c) => (
                    <div key={c.slug} className="plugin-bridge-mini-icon-wrap">
                      <ServiceIcon card={c} size="small" />
                    </div>
                  ))}
                </div>
                <span className="plugin-bridge-text">
                  See Developer Tools, Web &amp; Data, and more
                </span>
              </button>
            </div>
          </section>

          {/* ── Categories Quick Navigation Strip ── */}
          <section className="plugin-directory-categories-strip">
            <div className="plugin-section-header">
              <h2 className="plugin-section-title">Browse by Category</h2>
            </div>

            <div className="plugin-category-chips-row">
              {[
                'Communication',
                'Developer Tools',
                'Productivity',
                'Web & Data',
                'CRM & Sales',
                'Media & Social',
                'Utilities',
              ].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className="plugin-category-chip-btn"
                  onClick={() => onOpenCategory(cat)}
                >
                  <span>{cat}</span>
                  <ArrowRight size={13} className="text-dim" />
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
