import { useEffect, useMemo, useRef } from 'react'
import gsap from 'gsap'
import LibraryCard from './LibraryCard.jsx'
import { groupItemsByDate } from './dateUtils.js'

export default function LibraryGrid({
  items,
  busyId,
  onSelect,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
}) {
  const containerRef = useRef(null)
  const groups = useMemo(() => groupItemsByDate(items), [items])

  useEffect(() => {
    if (!containerRef.current) return
    const cards = containerRef.current.querySelectorAll('.lib-card')
    if (!cards.length) return

    gsap.fromTo(
      cards,
      { autoAlpha: 0, y: 18 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.4,
        stagger: { each: 0.035, from: 'start' },
        ease: 'power2.out',
        clearProps: 'transform,visibility,opacity',
      }
    )
  }, [items])

  return (
    <div className="lib-grid-view" ref={containerRef}>
      {groups.map((group, groupIdx) => (
        <section key={group.dateKey} className="lib-date-group">
          <header className="lib-date-header">
            <h2 className="lib-date-title">{group.heading}</h2>
            <span className="lib-date-count mono">
              {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
            </span>
          </header>

          <div className="lib-cards-grid">
            {group.items.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onSelect={onSelect}
                onReindex={() => onReindex(item)}
                onEnrich={() => onEnrich(item)}
                onDelete={() => onDelete(item)}
                onTagClick={onTagClick}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
