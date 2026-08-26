import Icon from '../../Icon.jsx'
import { AsciiSkeleton } from 'ascii-reveal'

export default function GitHubResultsView({
  results = [],
  loading = false,
  activeIndex = 0,
  onSelect,
}) {
  if (loading && results.length === 0) {
    return (
      <div className="damon-loading-state" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14, padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
          <AsciiSkeleton variant="dither" width={16} height={16} circle />
          <span>Searching GitHub…</span>
        </div>
        <AsciiSkeleton variant="scan" lines={3} widths={['78%', '94%', '62%']} />
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
