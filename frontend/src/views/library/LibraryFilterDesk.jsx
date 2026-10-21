import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'

const PLATFORM_META = [
  ['instagram', 'Instagram', 'instagram'], ['youtube', 'YouTube', 'youtube'],
  ['x', 'X (Twitter)', 'x'], ['pinterest', 'Pinterest', 'pinterest'],
  ['reddit', 'Reddit', 'reddit'], ['github', 'GitHub', 'github'],
  ['spotify', 'Spotify', 'spotify'], ['threads', 'Threads', 'threads'],
]

const FACETS = [
  ['sources', 'Sources', 'globe'], ['categories', 'Categories', 'layers'],
  ['significance', 'Significance', 'star'], ['formats', 'Formats', 'file'], ['tags', 'Tags', 'bookmark'],
]

const toggle = (values, value) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

export default function LibraryFilterDesk({
  open, onClose, total, showing, counts = {}, categoryCounts = {}, tagCounts = {}, appCounts = {}, ratingCounts = {},
  selectedKinds = [], selectedCategories = [], selectedTags = [], selectedRatings = [],
  onSelectKinds, onSelectCategories, onSelectTags, onSelectRatings, onClear,
}) {
  const [section, setSection] = useState('sources')
  const [search, setSearch] = useState('')
  const searchRef = useRef(null)
  const optionRefs = useRef([])
  const activeCount = selectedKinds.length + selectedCategories.length + selectedTags.length + selectedRatings.length
  const tagEntries = useMemo(() => Object.entries(tagCounts)
    .filter(([tag]) => !PLATFORM_META.some(([id]) => id === tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [tagCounts])
  const visibleTags = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? tagEntries.filter(([tag]) => tag.toLowerCase().includes(q)) : tagEntries.slice(0, 14)
  }, [search, tagEntries])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); setSection('tags'); requestAnimationFrame(() => searchRef.current?.focus()) }
      if (event.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && activeCount) {
        event.preventDefault()
        if (selectedTags.length) onSelectTags(selectedTags.slice(0, -1))
        else if (selectedCategories.length) onSelectCategories(selectedCategories.slice(0, -1))
        else if (selectedKinds.length) onSelectKinds(selectedKinds.slice(0, -1))
        else onSelectRatings(selectedRatings.slice(0, -1))
      }
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && optionRefs.current.length) {
        const current = optionRefs.current.indexOf(document.activeElement)
        const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + optionRefs.current.length) % optionRefs.current.length
        event.preventDefault(); optionRefs.current[next]?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, activeCount, selectedTags, selectedCategories, selectedKinds, selectedRatings, onSelectTags, onSelectCategories, onSelectKinds, onSelectRatings])

  useEffect(() => { if (open) { optionRefs.current = []; setSearch('') } }, [open])
  if (!open) return null
  const optionRef = (node) => { if (node && !optionRefs.current.includes(node)) optionRefs.current.push(node) }
  const checkbox = (selected, label, count, icon, click, bar = null) => (
    <button ref={optionRef} type="button" role="checkbox" aria-checked={selected} className={`filter-desk-option ${selected ? 'is-selected' : ''}`} onClick={click}>
      <span className="filter-desk-check">{selected && <Icon name="check-simple" size={11} />}</span>
      {icon && <Icon name={icon} size={15} className="filter-desk-option-icon" />}
      <span className="filter-desk-option-label">{label}</span>
      {bar !== null && <span className="filter-desk-distribution"><i style={{ width: `${Math.max(3, bar)}%` }} /></span>}
      <span className="filter-desk-count">{count}</span>
    </button>
  )
  const platformMax = Math.max(...PLATFORM_META.map(([id]) => appCounts[id] || tagCounts[id] || 0), 1)

  return (
    <div className="filter-desk-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="filter-desk" role="dialog" aria-modal="true" aria-label="Filter library" aria-describedby="filter-desk-rule">
        <header className="filter-desk-header">
          <div><span className="filter-desk-kicker">Library facets</span><h2>Filter the signal</h2></div>
          <button type="button" className="filter-desk-close" onClick={onClose} aria-label="Close filters"><Icon name="x" size={17} /></button>
        </header>
        <div className="filter-desk-summary">
          <strong>Showing {showing} of {total}</strong><span id="filter-desk-rule">Matches every facet. Multiple choices within a facet are combined.</span>
          {activeCount > 0 && <button type="button" onClick={onClear}>Clear all <span>{activeCount}</span></button>}
        </div>
        <div className="filter-desk-body">
          <nav className="filter-desk-rail" aria-label="Filter facets">
            {FACETS.map(([id, label, icon]) => <button key={id} type="button" className={section === id ? 'is-active' : ''} onClick={() => setSection(id)}><Icon name={icon} size={15} /><span>{label}</span>{id === 'tags' && <em>{tagEntries.length}</em>}</button>)}
          </nav>
          <section className="filter-desk-content" aria-live="polite">
            {section === 'sources' && <><div className="filter-desk-section-head"><h3>Where it came from</h3><p>Source is a useful first cut. The bar shows its share of the library.</p></div><div className="filter-desk-options" role="group" aria-label="Source platforms">{PLATFORM_META.filter(([id]) => (appCounts[id] || tagCounts[id])).map(([id, label, icon]) => checkbox(selectedTags.includes(id), label, appCounts[id] || tagCounts[id], icon, () => onSelectTags(toggle(selectedTags, id)), ((appCounts[id] || tagCounts[id]) / platformMax) * 100))}</div></>}
            {section === 'categories' && <><div className="filter-desk-section-head"><h3>What it is about</h3><p>Categories organize intent. Format lives separately, so Book and Music never compete twice.</p></div><div className="filter-desk-options" role="group" aria-label="Categories">{Object.entries(categoryCounts).sort((a,b) => b[1] - a[1]).map(([id, count]) => checkbox(selectedCategories.includes(id), id, count, null, () => onSelectCategories(toggle(selectedCategories, id))))}</div></>}
            {section === 'significance' && <><div className="filter-desk-section-head"><h3>Worth returning to</h3><p>Use significance as a quality floor, not a decorative score.</p></div><div className="filter-desk-options" role="group" aria-label="Significance">{checkbox(selectedRatings.includes('5'), 'Essential · 5 stars', ratingCounts['5'] || 0, 'star', () => onSelectRatings(toggle(selectedRatings, '5')))}{checkbox(selectedRatings.includes('4+'), 'High impact · 4 stars or more', ratingCounts['4+'] || 0, 'star', () => onSelectRatings(toggle(selectedRatings, '4+')))}</div></>}
            {section === 'formats' && <><div className="filter-desk-section-head"><h3>Format</h3><p>A separate physical format facet—not another category.</p></div><div className="filter-desk-options" role="group" aria-label="Formats">{Object.entries(counts).filter(([id, count]) => id !== 'total' && count > 0).sort((a,b) => b[1] - a[1]).map(([id, count]) => checkbox(selectedKinds.includes(id), id, count, 'file', () => onSelectKinds(toggle(selectedKinds, id))))}</div></>}
            {section === 'tags' && <><div className="filter-desk-section-head filter-desk-section-head--search"><div><h3>Tags</h3><p>{tagEntries.length} tags are searchable. Press <kbd>/</kbd> from anywhere in this panel.</p></div><label className="filter-desk-search"><Icon name="search" size={15}/><input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a tag" aria-label="Find a tag" /></label></div><div className="filter-desk-options" role="group" aria-label="Tags">{visibleTags.map(([id, count]) => checkbox(selectedTags.includes(id), `#${id}`, count, null, () => onSelectTags(toggle(selectedTags, id))))}{visibleTags.length === 0 && <div className="filter-desk-empty"><Icon name="search" size={18}/><strong>No tags match “{search}”</strong><span>Try a shorter word, or clear the search.</span></div>}</div></>}
          </section>
        </div>
        <footer className="filter-desk-footer"><span><kbd>↑↓</kbd> move <kbd>Space</kbd> toggle</span><span><kbd>⌫</kbd> remove last <kbd>Esc</kbd> close</span></footer>
      </aside>
    </div>
  )
}
