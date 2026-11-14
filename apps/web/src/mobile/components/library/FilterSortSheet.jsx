import { BottomSheet } from '../libraryUi.jsx'

const TYPE_OPTIONS = [
  ['all', 'All'],
  ['video', 'Videos'],
  ['article', 'Articles'],
  ['post', 'Posts'],
  ['movie', 'Movies'],
  ['recipe', 'Recipes'],
  ['game', 'Games'],
  ['book', 'Books'],
  ['place', 'Places'],
  ['note', 'Notes'],
]

const SORT_OPTIONS = [
  { value: 'new', label: 'Newest' },
  { value: 'old', label: 'Oldest' },
  { value: 'alpha', label: 'A to Z' },
  { value: 'recent', label: 'Last opened' },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unstarted', label: 'Wishlist' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Done' },
  { value: 'favorites', label: 'Favorites' },
]

export default function FilterSortSheet({
  open,
  onClose,
  activeType = 'all',
  onTypeChange,
  sortOrder = 'new',
  onSortChange,
  statusFilter = 'all',
  onStatusChange,
  allTags = [],
  selectedTag = null,
  onTagChange,
  resultCount = 0,
  onReset,
}) {
  return (
    <BottomSheet open={open} onClose={onClose} label="Filter and sort" headTitle="Filter and sort">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8, maxHeight: '65vh', overflowY: 'auto' }}>
        {/* Type section */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#636366', marginBottom: 8 }}>
            Type
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TYPE_OPTIONS.map(([val, label]) => {
              const selected = activeType === val
              return (
                <button
                  key={val}
                  type="button"
                  style={{
                    height: 38,
                    padding: '0 14px',
                    borderRadius: 19,
                    border: selected ? '0' : '1px solid #D8D8DE',
                    background: selected ? '#151517' : '#fff',
                    color: selected ? '#fff' : '#151517',
                    fontSize: 14,
                    fontWeight: selected ? 650 : 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => onTypeChange?.(val)}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Status section */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#636366', marginBottom: 8 }}>
            Status
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {STATUS_OPTIONS.map((opt) => {
              const selected = statusFilter === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  style={{
                    height: 38,
                    padding: '0 14px',
                    borderRadius: 19,
                    border: selected ? '0' : '1px solid #D8D8DE',
                    background: selected ? '#151517' : '#fff',
                    color: selected ? '#fff' : '#151517',
                    fontSize: 14,
                    fontWeight: selected ? 650 : 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => onStatusChange?.(opt.value)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tags section */}
        {allTags.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#636366', marginBottom: 8 }}>
              Tags
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {allTags.map((tag) => {
                const selected = selectedTag === tag
                return (
                  <button
                    key={tag}
                    type="button"
                    style={{
                      height: 36,
                      padding: '0 12px',
                      borderRadius: 18,
                      border: selected ? '0' : '1px solid #D8D8DE',
                      background: selected ? '#0B5FD9' : '#fff',
                      color: selected ? '#fff' : '#151517',
                      fontSize: 13,
                      fontWeight: selected ? 650 : 500,
                      cursor: 'pointer',
                    }}
                    onClick={() => onTagChange?.(selected ? null : tag)}
                  >
                    #{tag}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Sort by section */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#636366', marginBottom: 8 }}>
            Sort by
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SORT_OPTIONS.map((opt) => {
              const selected = sortOrder === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  style={{
                    height: 38,
                    padding: '0 14px',
                    borderRadius: 19,
                    border: selected ? '0' : '1px solid #D8D8DE',
                    background: selected ? '#151517' : '#fff',
                    color: selected ? '#fff' : '#151517',
                    fontSize: 14,
                    fontWeight: selected ? 650 : 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => onSortChange?.(opt.value)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button
            type="button"
            style={{
              height: 52,
              padding: '0 20px',
              borderRadius: 14,
              border: 0,
              background: 'rgba(118,118,128,.16)',
              color: '#151517',
              fontSize: 16,
              fontWeight: 650,
              cursor: 'pointer',
            }}
            onClick={onReset}
          >
            Reset
          </button>
          <button
            type="button"
            style={{
              flex: 1,
              height: 52,
              borderRadius: 14,
              border: 0,
              background: '#0B5FD9',
              color: '#fff',
              fontSize: 17,
              fontWeight: 700,
              cursor: 'pointer',
            }}
            onClick={onClose}
          >
            {resultCount ? `Show ${resultCount} results` : 'Done'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
