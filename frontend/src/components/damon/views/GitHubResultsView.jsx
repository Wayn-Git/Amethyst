import Icon from '../../Icon.jsx'

export default function GitHubResultsView({
  results = [],
  loading = false,
  activeIndex = 0,
  onSelect,
}) {
  if (loading && results.length === 0) {
    return (
      <div className="damon-loading-state">
        <div className="damon-spinner" />
        <span>Searching GitHub…</span>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="damon-empty-state">
        <Icon name="code" size={24} />
        <p>No GitHub repositories found.</p>
      </div>
    )
  }

  return (
    <div className="damon-github-list" role="listbox" aria-label="GitHub repositories">
      {results.map((repo, i) => {
        const isSelected = i === activeIndex
        return (
          <div
            key={repo.name}
            role="option"
            aria-selected={isSelected}
            data-active={isSelected}
            className={`damon-gh-item${isSelected ? ' is-active' : ''}`}
            style={{ '--i': i }}
            onClick={() => onSelect(repo)}
          >
            <div className="damon-gh-header">
              <Icon name="code" size={16} />
              <span className="damon-gh-name">{repo.name}</span>
              <span className="damon-gh-pill">{repo.language}</span>
            </div>
            {repo.description && <p className="damon-gh-desc">{repo.description}</p>}
            <div className="damon-gh-meta">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="star" size={11} filled /> {repo.stars?.toLocaleString()}
              </span>
              <span>{repo.forks?.toLocaleString()} forks</span>
              <span className="damon-gh-url">{repo.url}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
