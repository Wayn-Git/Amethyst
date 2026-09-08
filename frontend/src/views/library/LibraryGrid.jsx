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
    const cards = Array.from(containerRef.current.querySelectorAll('.lib-card:not([data-animated="true"])'))
    if (!cards.length) return

    cards.forEach(c => c.setAttribute('data-animated', 'true'))

    gsap.fromTo(
      cards,
      { autoAlpha: 0, scale: 0.94, y: 16 },
      {
        autoAlpha: 1,
        scale: 1,
        y: 0,
        duration: 0.5,
        stagger: { each: 0.02, from: 'start' },
        ease: 'back.out(1.2)',
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
            {group.items.map((item, idx) => (
              <LibraryCard
                key={item.id}
                item={item}
                index={idx}
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
