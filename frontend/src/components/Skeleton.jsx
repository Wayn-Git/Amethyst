import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import BrandMark from './BrandMark.jsx'

/* The frame the interface draws while it is waiting for its first answer.

   Two different waits, and they deserve different treatment.

   The ordinary one is a request in flight against a backend that is already up:
   under a second, and what belongs there is the *shape* of what is coming, so
   the page does not jump when it arrives. That is `Skeleton` and the helpers
   below it — blocks the size of the rows they stand in for.

   The other is a container that was stopped for want of traffic and is booting.
   That is tens of seconds, and a shimmering rectangle for tens of seconds reads
   as a hang. So `BootScreen` says what is happening and counts, which is the
   difference between "this is broken" and "this is nearly ready".

   Nothing here animates under `prefers-reduced-motion` — a page of pulsing
   blocks is exactly the kind of thing that rule exists for. */

export default function Skeleton({ w = '100%', h = 12, r = 6, rounded = false, style, className = '' }) {
  const radius = rounded ? 9999 : r
  return (
    <span
      className={`skel ${className}`.trim()}
      aria-hidden="true"
      style={{ width: w, height: h, borderRadius: radius, ...style }}
    />
  )
}

/** A paragraph's worth. The last line is short, because real ones are. */
export function SkeletonText({ lines = 3, gap = 8 }) {
  return (
    <div className="skel-stack" style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? '58%' : `${88 - (i % 3) * 9}%`} h={11} />
      ))}
    </div>
  )
}

/** Standing in for task or server rows — an optional icon/disc, title and meta, action controls. */
export function SkeletonRows({ rows = 4, controls = 2, icon = true }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          {icon && <Skeleton w={18} h={18} r={99} />}
          <div className="skel-row-text">
            <Skeleton w={`${48 + ((i * 13) % 32)}%`} h={13} r={4} />
            <Skeleton w={`${26 + ((i * 17) % 24)}%`} h={10} r={4} />
          </div>
          {Array.from({ length: controls }, (_, c) => (
            <Skeleton key={c} w={controls === 1 ? 52 : 20} h={controls === 1 ? 26 : 20} r={6} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A card with a title and some rows in it, for a view built out of cards. */
export function SkeletonCard({ title = true, rows = 3, controls = 2, icon = true }) {
  return (
    <div className="card card-pad" aria-hidden="true">
      {title && <Skeleton w={140} h={11} style={{ marginBottom: 14 }} />}
      <SkeletonRows rows={rows} controls={controls} icon={icon} />
    </div>
  )
}

/** Table rows matching tabular lists like Automations, Runs, and Logs. */
export function SkeletonTable({ rows = 5, cols = ['30%', '25%', '15%', '10%'] }) {
  return (
    <div className="skel-table-wrap" aria-hidden="true" style={{ width: '100%' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '13px 14px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          {cols.map((colW, c) => (
            <Skeleton
              key={c}
              w={colW}
              h={c === 0 ? 14 : 11}
              r={4}
              style={{ flexShrink: c === 0 ? 0 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Thread message preview with sender and multiline text. */
export function SkeletonMessage({ lines = 3 }) {
  return (
    <div className="skel-stack" style={{ gap: 10, padding: '12px 0' }} aria-hidden="true">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton w={140} h={13} r={4} />
        <Skeleton w={60} h={10} r={3} />
      </div>
      <Skeleton w="95%" h={12} r={3} />
      {lines > 1 && <Skeleton w="82%" h={12} r={3} />}
      {lines > 2 && <Skeleton w="64%" h={12} r={3} />}
    </div>
  )
}

/** The grid of cards the skills and catalogue pages are made of. */
export function SkeletonGrid({ cards = 6 }) {
  return (
    <div className="dir-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div className="dcard" key={i} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div className="dcard-top">
            <Skeleton w={34} h={34} r={8} />
            <div className="dcard-heading">
              <Skeleton w={`${46 + ((i * 13) % 26)}%`} h={14} r={4} />
              <Skeleton w={`${28 + ((i * 11) % 22)}%`} h={11} r={4} />
            </div>
            <Skeleton w={30} h={30} r={99} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 2px' }}>
            <Skeleton w="92%" h={11} r={4} />
            <Skeleton w={`${65 + ((i * 9) % 25)}%`} h={11} r={4} />
          </div>
          <div className="dcard-badges" style={{ marginTop: 4 }}>
            <Skeleton w={52} h={18} r={99} />
            {i % 2 === 0 && <Skeleton w={44} h={18} r={99} />}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One bento library card: media, source line, title, excerpt lines. */
export function SkeletonLibraryCard({ tall = false } = {}) {
  return (
    <div className={`skel-lib-card ${tall ? 'sm:row-span-2' : ''}`} aria-hidden="true">
      <div
        className="skel-lib-media"
        style={tall ? { aspectRatio: '9 / 14', maxHeight: 380 } : { aspectRatio: '16 / 10' }}
      />
      <div className="skel-lib-body">
        <div className="skel-lib-source">
          <Skeleton w={14} h={14} r={4} />
          <Skeleton w={76} h={10} r={3} />
        </div>
        <Skeleton w="88%" h={14} r={4} />
        <Skeleton w="100%" h={11} r={3} />
        <Skeleton w="72%" h={11} r={3} />
      </div>
      <div className="skel-lib-foot">
        <Skeleton w={64} h={11} r={3} />
      </div>
    </div>
  )
}

/** The bento column layout the library grid is made of. */
export function SkeletonLibraryGrid({ cards = 9 }) {
  return (
    <div className="skel-lib-grid lib-bento-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonLibraryCard key={i} tall={i % 3 === 1} />
      ))}
    </div>
  )
}

/** A whole view's worth: the header, then its body. */
export function SkeletonView({ rows = 5, aside = false }) {
  return (
    <div className="view">
      <div className={`view-inner${aside ? ' view-inner--wide' : ''}`}>
        <header className="vheader">
          <div className="skel-stack" style={{ gap: 10 }}>
            <Skeleton w={132} h={20} r={7} />
            <Skeleton w={320} h={10} />
          </div>
        </header>
        {aside ? (
          <div className="task-layout">
            <nav className="skel-rail" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} w="100%" h={30} r={9} />)}
            </nav>
            <section><SkeletonCard rows={rows} /></section>
          </div>
        ) : (
          <SkeletonCard rows={rows} />
        )}
      </div>
    </div>
  )
}

/* How long the wait has been going, in whole seconds.

   Shown only once it is long enough to be worth mentioning. A counter that
   starts at zero on a backend that answers in 80ms is a flash of noise; one
   that appears at four seconds is the page telling you it knows it is slow. */
function useElapsed(since) {
  const [now, setNow] = useState(() => Date.now())
  // Keyed on `since`, so pressing "Try again" restarts the count rather than
  // continuing to report how long ago the *first* attempt began.
  useEffect(() => {
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [since])
  // Derived, never read from a ref: render itself does not touch the clock.
  return since ? Math.max(0, Math.round((now - since) / 1000)) : 0
}

export function BootScreen({ server, onRetry, onRemote }) {
  // `server.since ?? Date.now()` read the clock during render, which makes the
  // component impure and the elapsed count restart on every re-render. The
  // hook holds the fallback instead, where it is read once.
  const seconds = useElapsed(server.since)
  const down = server.phase === 'down'
  const slow = seconds >= 4

  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot-inner">
        <div className={`boot-mark${down ? ' is-down' : ''}`}>
          {down ? <Icon name="alert" size={22} /> : <BrandMark size={46} />}
        </div>
        <h1 className="boot-title">{down ? 'The backend did not answer' : 'Waking the backend'}</h1>
        <p className="boot-note">
          {down
            ? server.error
            : slow
              ? 'A container that has been idle is starting up. This is the slow path and it'
                + ' only happens on the first request after a quiet spell.'
              : 'One moment.'}
        </p>

        {!down && (
          <>
            <div className="boot-bar"><span /></div>
            {slow && <div className="boot-count">{seconds}s</div>}
          </>
        )}

        {down && (
          <button type="button" className="btn btn--primary btn--small" onClick={onRetry}>
            <Icon name="refresh" size={13} /> Try again
          </button>
        )}

        {/* The way out for a device that is not the machine.
            Offered while it is still waking, not only once the wake has given
            up: a phone is never going to reach a laptop behind a router, and
            making it sit out ninety seconds of a wake that cannot succeed
            before it is even told pairing exists is the bug this fixes. */}
        {onRemote && (
          <button type="button" className="btn btn--small boot-remote" onClick={onRemote}>
            <Icon name="link" size={13} /> This is not the machine — pair it instead
          </button>
        )}

        {/* The page underneath, in outline, so the wait is spent looking at
            where things will be rather than at a spinner in the void. */}
        <div className="boot-ghost" aria-hidden="true">
          <div className="boot-ghost-rail">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} w="100%" h={26} r={8} />)}
          </div>
          <div className="boot-ghost-main">
            <Skeleton w="46%" h={16} r={7} />
            <SkeletonText lines={3} />
            <Skeleton w="100%" h={44} r={12} />
          </div>
        </div>
      </div>
    </div>
  )
}
