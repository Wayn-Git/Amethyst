import { useEffect, useMemo, useRef } from 'react'
import gsap from 'gsap'
import LibraryRow from './LibraryRow.jsx'
import { groupItemsByDate } from './dateUtils.js'

export default function LibraryListView({
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
    const rows = Array.from(containerRef.current.querySelectorAll('.lib-row:not([data-animated="true"])'))
    if (!rows.length) return

    rows.forEach(r => r.setAttribute('data-animated', 'true'))

    gsap.fromTo(
      rows,
      { autoAlpha: 0, y: 14 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.35,
        stagger: { each: 0.03, from: 'start' },
        ease: 'power2.out',
        clearProps: 'transform,visibility,opacity',
      }
    )
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
