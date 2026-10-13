import { useState, useMemo } from 'react'
import { ChevronLeft, Search, X } from 'lucide-react'
import PluginCard from './PluginCard.jsx'
import { PluginGridSkeleton } from './PluginSkeletons.jsx'

const CATEGORY_SUBTITLES = {
  'Installed': 'Manage your connected integrations, active credentials, and tool permissions.',
  'Communication': 'Stay in sync with messaging, email, and real-time collaboration tools.',
  'Developer Tools': 'Tools to help developers ship faster, track issues, and automate git workflows.',
  'Productivity': 'Organize tasks, docs, spreadsheets, and project roadmaps seamlessly.',
  'Web & Data': 'Search the live web, extract articles, scrape data, and compute answers.',
  'CRM & Sales': 'Tools to help businesses run, grow, and manage customer relationships.',
  'Small Business': 'Tools to help small businesses run, grow, and get paid.',
  'Media & Social': 'Manage music playback, media publishing, and community channels.',
  'Utilities': 'Direct calculation, weather, encyclopedia, and system assistance tools.',
}

export default function CategoryView({
  category,
  cards = [],
  loading = false,
  statusMap = {},
  onBack,
  onOpenDetail,
  onConnect,
  onDisconnect,
  onChat,
  busySlug = null,
}) {
  const [categoryQuery, setCategoryQuery] = useState('')

  const subtitle =
    CATEGORY_SUBTITLES[category] ||
    `Browse tools and integrations designed for ${category.toLowerCase()}.`

  const filteredCards = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase()
    if (!q) return cards
    return cards.filter(
      (c) =>
        (c.label || c.name || '').toLowerCase().includes(q) ||
        (c.blurb || c.description || '').toLowerCase().includes(q) ||
        (c.slug || '').toLowerCase().includes(q)
    )
  }, [cards, categoryQuery])

  return (
    <div className="plugin-category-view-root">
      {/* Top back navigation */}
      <div className="plugin-category-top-nav">
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

      {/* Category Header Row with Title and Search Input */}
      <div className="plugin-category-header-row">
        <div className="plugin-category-header-info">
          <h1 className="plugin-category-title">{category}</h1>
          <p className="plugin-category-subtitle">{subtitle}</p>
        </div>

        <div className="plugin-category-search-box">
          <Search size={15} className="text-dim shrink-0" />
          <input
            type="text"
            className="plugin-category-search-input"
            placeholder={`Search ${category.toLowerCase()} plugins`}
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
          />
          {categoryQuery && (
            <button
              type="button"
              className="plugin-clear-search-btn"
              onClick={() => setCategoryQuery('')}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 2-Column Grid of App Rows */}
      {loading ? (
        <PluginGridSkeleton count={6} />
      ) : filteredCards.length === 0 ? (
        <div className="plugin-empty-category">
          <p className="text-sm text-dim">
            No plugins in {category} match &ldquo;{categoryQuery}&rdquo;
          </p>
        </div>
      ) : (
        <div className="plugin-two-col-grid">
          {filteredCards.map((card) => (
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
    </div>
  )
}
