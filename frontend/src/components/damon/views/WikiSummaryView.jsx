import Icon from '../../Icon.jsx'
import { AsciiSkeleton } from 'ascii-reveal'

export default function WikiSummaryView({
  wiki = null,
  loading = false,
  isSelected = false,
  onSelect,
}) {
  if (loading) {
    return (
      <div className="damon-loading-state" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14, padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
          <AsciiSkeleton variant="dither" width={16} height={16} circle />
          <span>Searching Wikipedia…</span>
        </div>
        <AsciiSkeleton variant="scan" lines={3} widths={['85%', '92%', '65%']} />
      </div>
    )
  }

  if (!wiki) return null

  return (
    <div
      className={`damon-wiki-card${isSelected ? ' is-active' : ''}`}
      onClick={() => onSelect(wiki)}
      role="button"
      tabIndex={0}
    >
      <div className="damon-wiki-header">
        <Icon name="book" size={16} />
        <span className="damon-wiki-badge">Wikipedia</span>
        <h4 className="damon-wiki-title">{wiki.title}</h4>
      </div>
      <div className="damon-wiki-body">
        {wiki.thumbnail && (
          <img src={wiki.thumbnail} alt="" className="damon-wiki-thumb" />
        )}
        <p className="damon-wiki-extract">{wiki.extract}</p>
      </div>
      <div className="damon-wiki-footer">
        <span className="damon-wiki-url">{wiki.url}</span>
        <kbd className="kbd">↵ Read article</kbd>
      </div>
    </div>
  )
}
