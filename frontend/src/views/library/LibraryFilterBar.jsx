import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'

export default function LibraryFilterBar({
  selectedKind = '',
  selectedCategory = '',
  selectedTag = '',
  selectedRating = '',
  query = '',
  onSelectKind,
  onSelectCategory,
  onSelectTag,
  onSelectRating,
  onClearQuery,
  onClearFilters,
}) {
  const hasFilter = Boolean(
    selectedKind || selectedCategory || selectedTag || selectedRating || query
  )

  if (!hasFilter) return null

  return (
    <div className="lib-active-filter-shelf w-full" data-enter>
      <AnimatePresence>
        <motion.div
          className="lib-active-filter-strip"
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <span className="lib-active-filter-title">Active:</span>

          {selectedKind && (
            <motion.span
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.12 }}
              className="lib-active-filter-chip"
            >
              <span>Format: {selectedKind}</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectKind?.('')}
                title="Remove format filter"
                aria-label="Remove format filter"
              >
                <Icon name="x" size={10} />
              </button>
            </motion.span>
          )}

          {selectedRating && (
            <motion.span
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.12 }}
              className="lib-active-filter-chip"
            >
              <Icon name="star" size={10} filled className="text-amber-400" />
              <span>
                {selectedRating === '5'
                  ? '5★ Essential'
                  : selectedRating === '4+'
                  ? '4★+ High Impact'
                  : 'Any Rated'}
              </span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectRating?.('')}
                title="Remove rating filter"
                aria-label="Remove rating filter"
              >
                <Icon name="x" size={10} />
              </button>
            </motion.span>
          )}

          {selectedCategory && (
            <motion.span
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.12 }}
              className="lib-active-filter-chip"
            >
              <span>Category: {selectedCategory}</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectCategory?.('')}
                title="Remove category filter"
                aria-label="Remove category filter"
              >
                <Icon name="x" size={10} />
              </button>
            </motion.span>
          )}

          {selectedTag && (
            <motion.span
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.12 }}
              className="lib-active-filter-chip"
            >
              <span>#{selectedTag}</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectTag?.('')}
                title="Remove tag filter"
                aria-label="Remove tag filter"
              >
                <Icon name="x" size={10} />
              </button>
            </motion.span>
          )}

          {query && (
            <motion.span
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.12 }}
              className="lib-active-filter-chip"
            >
              <span>Search: "{query}"</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onClearQuery?.()}
                title="Clear search query"
                aria-label="Clear search query"
              >
                <Icon name="x" size={10} />
              </button>
            </motion.span>
          )}

          <button
            type="button"
            className="lib-active-filter-clear-all"
            onClick={onClearFilters}
          >
            Clear all
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
