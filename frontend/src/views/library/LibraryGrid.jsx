import { useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import LibraryCard from './LibraryCard.jsx'
import { groupItemsByDate } from './dateUtils.js'

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function estimateCardHeight(item) {
  const url = (item.url || '').toLowerCase()
  const app = item.app || (
    url.includes('instagram.') ? 'instagram' :
    url.includes('pinterest.') || url.includes('pin.it') ? 'pinterest' :
    url.includes('youtube.') || url.includes('youtu.be') ? 'youtube' :
    url.includes('tiktok.') ? 'tiktok' : null
  )
  const hasThumb = Boolean(item.thumbnail_path)
  
  if (!hasThumb) {
    return app || item.kind === 'video' ? 220 : 180
  }
  
  let mediaH = 220
  if (app === 'instagram' || app === 'tiktok') {
    mediaH = 360
  } else if (app === 'pinterest') {
    mediaH = 300
  } else if (app === 'youtube' || item.kind === 'video') {
    mediaH = 200
  }
  
  const bodyH = (item.summary ? 80 : 30) + (item.resources?.length ? 44 : 0) + 100
  return mediaH + bodyH
}

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
  const animatedIdsRef = useRef(new Set())
  const groups = useMemo(() => groupItemsByDate(items), [items])

  // Track responsive column count based on available container width
  // Cards breathe with minimum ~340px-380px width so they feel filling and substantial
  const [columnCount, setColumnCount] = useState(3)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateCols = () => {
      const width = el.offsetWidth
      if (width < 680) {
        setColumnCount(1)
      } else if (width < 1140) {
        setColumnCount(2)
      } else if (width < 1680) {
        setColumnCount(3)
      } else {
        setColumnCount(4)
      }
    }

    updateCols()
    const ro = new ResizeObserver(updateCols)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!containerRef.current || REDUCED) return
    const cards = Array.from(containerRef.current.querySelectorAll('.lib-card'))
    const newCards = cards.filter((c) => {
      const id = c.getAttribute('data-item-id')
      if (!id || animatedIdsRef.current.has(id)) return false
      animatedIdsRef.current.add(id)
      return true
    })
    if (!newCards.length) return

    gsap.fromTo(
      newCards,
      { autoAlpha: 0, y: 14, scale: 0.98 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.28,
        stagger: { each: 0.03, from: 'start', max: 0.15 },
        ease: 'power2.out',
        clearProps: 'transform,visibility,opacity',
      }
    )
  }, [items])

  return (
    <div className="lib-grid-view" ref={containerRef}>
      {groups.map((group) => {
        const effectiveCols = Math.min(columnCount, group.items.length)
        const columns = Array.from({ length: effectiveCols }, () => [])
        const colHeights = new Array(effectiveCols).fill(0)

        group.items.forEach((item) => {
          let minCol = 0
          for (let c = 1; c < effectiveCols; c++) {
            if (colHeights[c] < colHeights[minCol]) {
              minCol = c
            }
          }
          columns[minCol].push(item)
          colHeights[minCol] += estimateCardHeight(item)
        })

        return (
          <section key={group.dateKey} className="lib-date-group">
            <header className="lib-date-header">
              <h2 className="lib-date-title">{group.heading}</h2>
              <span className="lib-date-count">
                {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
              </span>
            </header>

            <div className="lib-masonry-grid">
              {columns.map((colItems, colIdx) => (
                <div key={colIdx} className="lib-masonry-col">
                  {colItems.map((item) => (
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
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
