import Icon from '../../Icon.jsx'

export default function WikiSummaryView({
  wiki = null,
  loading = false,
  isSelected = false,
  onSelect,
}) {
  if (loading) {
    return (
      <div className="damon-loading-state">
        <div className="damon-spinner" />
        <span>Searching Wikipedia…</span>
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
