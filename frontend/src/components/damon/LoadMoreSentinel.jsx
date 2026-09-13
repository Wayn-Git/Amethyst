import { useEffect, useRef } from 'react'

/* A bottom-of-list sentinel that asks for the next page when scrolled into view.
 *
 * One place for the IntersectionObserver so every damon result view scrolls the
 * same way. `onLoadMore` fires when the sentinel becomes visible and there is
 * more to fetch; the observer is torn down and rebuilt when those inputs change,
 * so it never holds a stale callback. Renders a small "loading more" row while a
 * page is in flight and nothing at all once the pool is exhausted.
 */
export default function LoadMoreSentinel({ hasMore, loading, onLoadMore, label = 'Loading more…' }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!hasMore || !ref.current) return undefined
    const el = ref.current
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading) onLoadMore()
      },
      { rootMargin: '240px' }, // fetch just before the reader reaches the end
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, onLoadMore])

  if (!hasMore && !loading) return null
  return (
    <div ref={ref} className="damon-load-more" aria-live="polite">
      {loading && <div className="damon-spinner" />}
      {loading && <span>{label}</span>}
    </div>
  )
}
