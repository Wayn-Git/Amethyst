import { useState, useMemo } from 'react'
import {
  Search,
  Plus,
  X,
  ChevronRight,
  Server,
  Layers,
  Sparkles,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import PluginCard from './PluginCard.jsx'
import ServiceIcon from './ServiceIcon.jsx'
import McpServersPanel from '../McpServersPanel.jsx'

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
  statusMap = {},
  searchQuery = '',
  setSearchQuery,
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
  const [filterView, setFilterView] = useState('all') // 'all' | 'installed' | 'mcp'

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

  // Instant global search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return cards.filter(
      (c) =>
        (c.label || c.name || '').toLowerCase().includes(q) ||
        (c.blurb || c.description || '').toLowerCase().includes(q) ||
        (c.slug || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q)
    )
  }, [cards, searchQuery])

  const hasSearch = searchQuery.trim().length > 0

  return (
    <div className="plugin-directory-root">
      {/* ── Main Header Row (Title, Subtitle, Search, Plus Button) ── */}
      <div className="plugin-directory-header-row">
        <div className="plugin-directory-title-block">
          <h1 className="plugin-directory-main-title">Plugins</h1>
          <p className="plugin-directory-main-subtitle">
            Work with Amethyst across your favorite tools.
          </p>
        </div>

        <div className="plugin-directory-actions-block">
          <div className="plugin-directory-search-pill">
            <Search size={14} className="text-dim shrink-0" />
            <input
              type="text"
              placeholder="Search plugins"
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
                <X size={12} />
              </button>
            )}
          </div>

          <button
            type="button"
            className="plugin-directory-plus-btn"
            onClick={onOpenAuthModal}
            title="Connect Composio or Custom MCP Server"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* ── Instant Live Search Results (Overlays directory when query is active) ── */}
      {hasSearch ? (
        <section className="plugin-directory-search-results-section">
          <div className="plugin-section-header">
            <span className="plugin-section-title">
              Search Results ({searchResults.length})
            </span>
          </div>

          {searchResults.length === 0 ? (
            <div className="plugin-empty-search-state">
              <p className="text-base font-medium text-ink">No plugins found</p>
              <p className="text-xs text-dim mt-1">
                No apps matched &ldquo;{searchQuery}&rdquo;. Try another term or add a custom integration.
              </p>
            </div>
          ) : (
            <div className="plugin-two-col-grid">
              {searchResults.map((card) => (
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
          )}
        </section>
      ) : (
        <>
          {/* ── Filter Pills Bar (All, Installed, MCP) ── */}
          <div className="plugin-filter-pills-row">
            <div className="connectors-filter-pills" role="tablist">
              <button
                type="button"
                className={`connector-filter-btn ${filterView === 'all' ? 'is-active' : ''}`}
                onClick={() => setFilterView('all')}
              >
                <Layers size={13} />
                <span>All Plugins</span>
              </button>
              <button
                type="button"
                className={`connector-filter-btn ${filterView === 'installed' ? 'is-active' : ''}`}
                onClick={() => setFilterView('installed')}
              >
                <Sparkles size={13} />
                <span>Installed</span>
                {installedCards.length > 0 && (
                  <span className="connector-filter-badge">
                    {installedCards.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`connector-filter-btn ${filterView === 'mcp' ? 'is-active' : ''}`}
                onClick={() => setFilterView('mcp')}
              >
                <Server size={13} />
                <span>Local MCP</span>
              </button>
            </div>
          </div>

          {filterView === 'mcp' ? (
            /* Dedicated Local MCP View */
            <div className="plugin-mcp-dedicated-view">
              <McpServersPanel
                embedded={false}
                newOpen={newOpen}
                setNewOpen={setNewOpen}
                query=""
              />
            </div>
          ) : filterView === 'installed' ? (
            /* Dedicated Installed Apps View */
            <section className="plugin-directory-installed-full-section">
              <div className="plugin-section-header">
                <span className="plugin-section-title">
                  Installed Plugins ({installedCards.length})
                </span>
              </div>
              {installedCards.length === 0 ? (
                <div className="plugin-empty-installed-state">
                  <p className="text-sm font-medium">No plugins connected yet</p>
                  <p className="text-xs text-dim mt-1">
                    Connect your favorite apps from the directory to start taking actions.
                  </p>
                </div>
              ) : (
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
              )}
            </section>
          ) : (
            /* Standard Directory Experience */
            <>
              {/* ── "Installed >" Horizontal Squircle Strip (Screenshot 3) ── */}
              {installedCards.length > 0 && (
                <section className="plugin-installed-strip-section">
                  <button
                    type="button"
                    className="plugin-installed-strip-header"
                    onClick={() => setFilterView('installed')}
                    title="View all installed plugins"
                  >
                    <span>Installed</span>
                    <ChevronRight size={14} className="text-dim" />
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

              {/* ── Popular Section (2-Column Grid + Category Bridge Link) ── */}
              <section className="plugin-directory-section">
                <div className="plugin-section-header">
                  <h2 className="plugin-section-title">Popular</h2>
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
                  <h2 className="plugin-section-title">New & Noteworthy</h2>
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
                      See Developer Tools, Web & Data, and more
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
                      <ArrowRight size={12} className="text-dim" />
                    </button>
                  ))}
                </div>
              </section>

              {/* ── Local & MCP Servers (Bottom Dedicated Section) ── */}
              <section className="plugin-directory-mcp-section">
                <div className="plugin-section-header">
                  <div className="flex items-center gap-2">
                    <Server size={16} className="text-accent" />
                    <h2 className="plugin-section-title">Local & System Connectors</h2>
                  </div>
                  <span className="text-xs text-dim">
                    Direct agent tools and custom stdio MCP servers
                  </span>
                </div>

                <McpServersPanel
                  embedded={true}
                  newOpen={newOpen}
                  setNewOpen={setNewOpen}
                  query=""
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
