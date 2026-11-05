import { memo, useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import LibraryRow from './LibraryRow.jsx'
import { groupItemsByDate } from './dateUtils.js'
import LoadMoreSentinel from '../../components/damon/LoadMoreSentinel.jsx'

function LibraryListViewComponent({
  items,
  totalShowing = 0,
  hasMore = false,
  onLoadMore,
  busyId,
  onSelect,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
  onTogglePin,
  onProgressChange,
  onSaveReminder,
  onClearReminder,
  onReorder,
}) {
  const containerRef = useRef(null)
  const animatedIdsRef = useRef(new Set())
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  const handleDragStart = (e, item) => {
    if (!onReorder) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(item.id))
    setDraggedId(item.id)
  }

  const handleDragOver = (e, item) => {
    if (!onReorder) return
    e.preventDefault()
    if (draggedId && draggedId !== item.id) {
      setDragOverId(item.id)
    }
  }

  const handleDragLeave = () => {
    setDragOverId(null)
  }

  const handleDrop = (e, targetItem) => {
    if (!onReorder) return
    e.preventDefault()
    setDragOverId(null)
    if (!draggedId || draggedId === targetItem.id) {
      setDraggedId(null)
      return
    }
    const fromIndex = items.findIndex((it) => it.id === draggedId)
    const toIndex = items.findIndex((it) => it.id === targetItem.id)
    if (fromIndex !== -1 && toIndex !== -1) {
      const next = [...items]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      onReorder(next)
    }
    setDraggedId(null)
  }

  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
  }

  const groups = useMemo(() => groupItemsByDate(items), [items])

  useEffect(() => {
    if (!containerRef.current) return
    const rows = Array.from(containerRef.current.querySelectorAll('.lib-row'))
    const newRows = rows.filter((r) => {
      const id = r.getAttribute('data-item-id')
      if (!id || animatedIdsRef.current.has(id)) return false
      animatedIdsRef.current.add(id)
      return true
    })
    if (!newRows.length) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        newRows,
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.3,
          stagger: { each: 0.02, from: 'start', max: 0.12 },
          ease: 'power2.out',
          clearProps: 'transform,visibility,opacity',
        }
      )
    }, containerRef)

    return () => ctx.revert()
  }, [items])

  return (
    <div className="lib-list-view" ref={containerRef}>
      {groups.map((group) => (
        <section key={group.dateKey} className="lib-date-group">
          <header className="lib-date-header">
            <h2 className="lib-date-title">{group.heading}</h2>
            <span className="lib-date-count mono">
              {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
            </span>
          </header>

          <div className="lib-rows">
            {group.items.map((item) => (
              <LibraryRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onSelect={onSelect}
                onReindex={onReindex}
                onEnrich={onEnrich}
                onDelete={onDelete}
                onTagClick={onTagClick}
                onTogglePin={onTogglePin}
                onProgressChange={onProgressChange}
                onSaveReminder={onSaveReminder}
                onClearReminder={onClearReminder}
                isDraggable={Boolean(onReorder)}
                onDragStart={(e) => handleDragStart(e, item)}
                onDragOver={(e) => handleDragOver(e, item)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, item)}
                onDragEnd={handleDragEnd}
                isDragOver={dragOverId === item.id}
                isDragged={draggedId === item.id}
              />
            ))}
          </div>
        </section>
      ))}

      {hasMore && (
        <div className="lib-load-more-container flex flex-col items-center justify-center py-6 gap-3">
          <LoadMoreSentinel
            hasMore={hasMore}
            loading={false}
            onLoadMore={onLoadMore}
            label="Loading more items…"
          />
          <button
            type="button"
            className="lib-btn lib-btn--secondary"
            onClick={onLoadMore}
            style={{
              padding: '7px 18px',
              fontSize: '12px',
              borderRadius: 'var(--radius-buttons, 6px)',
              cursor: 'pointer',
            }}
          >
            Show more ({totalShowing ? Math.max(0, totalShowing - items.length) : 'more'} remaining)
          </button>
        </div>
      )}
    </div>
  )
}

export const LibraryListView = memo(LibraryListViewComponent)
export default LibraryListView
