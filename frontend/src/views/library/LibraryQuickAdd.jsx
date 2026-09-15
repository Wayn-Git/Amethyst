import { useState } from 'react'
import Icon from '../../components/Icon.jsx'

const KINDS = [
  'article',
  'video',
  'book',
  'podcast',
  'music',
  'newsletter',
  'paper',
  'post',
  'note',
  'other',
]

export default function LibraryQuickAdd({ onSubmit, saving, onCancel }) {
  const [tab, setTab] = useState('url') // 'url' | 'manual'
  const [draft, setDraft] = useState({
    url: '',
    title: '',
    kind: '',
    author: '',
    notes: '',
  })

  const handleSubmit = (e) => {
    e?.preventDefault()
    if (tab === 'url') {
      if (!draft.url.trim()) return
      onSubmit({
        url: draft.url.trim(),
        kind: draft.kind || null,
      })
    } else {
      if (!draft.title.trim() && !draft.notes.trim()) return
      onSubmit({
        title: draft.title.trim() || 'Untitled Note',
        kind: draft.kind || 'note',
        author: draft.author.trim() || null,
        notes: draft.notes.trim() || null,
      })
    }
    setDraft({ url: '', title: '', kind: '', author: '', notes: '' })
  }

  return (
    <section className="card card-pad lib-quick-add" data-enter>
      <div className="lib-quick-add-head">
        <div className="lib-quick-add-tabs" role="tablist">
          <button
            type="button"
            className={`lib-tab ${tab === 'url' ? 'lib-tab--active' : ''}`}
            onClick={() => setTab('url')}
            role="tab"
            aria-selected={tab === 'url'}
          >
            <Icon name="link" size={13} />
            <span>Add URL / Media</span>
          </button>
          <button
            type="button"
            className={`lib-tab ${tab === 'manual' ? 'lib-tab--active' : ''}`}
            onClick={() => setTab('manual')}
            role="tab"
            aria-selected={tab === 'manual'}
          >
            <Icon name="edit" size={13} />
            <span>Note / Book / Talk</span>
          </button>
        </div>

        {onCancel && (
          <button
            type="button"
            className="icon-btn lib-quick-add-close"
            onClick={onCancel}
            aria-label="Close"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="lib-quick-add-form">
        {tab === 'url' ? (
          <div className="lib-capture-row">
            <div className="lib-input-icon-wrap">
              <Icon name="link" size={14} className="lib-input-icon" />
              <input
                className="lib-input"
                placeholder="Paste link to YouTube, article, paper, X post, podcast..."
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                autoFocus
              />
            </div>

            <select
              className="lib-select"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              aria-label="Kind"
            >
              <option value="">auto-detect</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || !draft.url.trim()}
            >
              {saving ? 'Adding...' : 'Log Resource'}
            </button>
          </div>
        ) : (
          <div className="lib-manual-form">
            <div className="lib-manual-grid">
              <input
                className="lib-input"
                placeholder="Title (e.g. Clean Architecture, Lecture on Transformers)"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                autoFocus
              />
              <input
                className="lib-input"
                placeholder="Author / Speaker / Source"
                value={draft.author}
                onChange={(e) => setDraft({ ...draft, author: e.target.value })}
              />
              <select
                className="lib-select"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                aria-label="Kind"
              >
                <option value="note">note</option>
                <option value="book">book</option>
                <option value="paper">paper</option>
                <option value="article">article</option>
                <option value="video">video</option>
              </select>
            </div>
            <textarea
              className="lib-input"
              rows={3}
              placeholder="What it discussed, quotes, key takeaways — search indexes this text."
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
            <div className="lib-manual-actions">
              {onCancel && (
                <button type="button" className="btn btn--ghost" onClick={onCancel}>
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="btn btn--primary"
                disabled={saving || (!draft.title.trim() && !draft.notes.trim())}
              >
                {saving ? 'Saving...' : 'Save to Library'}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  )
}
