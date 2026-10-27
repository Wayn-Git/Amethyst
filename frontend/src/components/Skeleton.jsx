import { Button as HouseButton } from './ui/bento/index.jsx'
import { useEffect, useState } from 'react'
import { AsciiSkeleton } from 'ascii-reveal'
import Icon from './Icon.jsx'
import BrandMark from './BrandMark.jsx'

/* The frame the interface draws while it is waiting for its first answer.
   Rendered with ASCII skeletons that paint immediately and sweep a fine dither band. */

export default function Skeleton({
  w = '100%',
  h = 12,
  r = 6,
  rounded = false,
  style,
  className = '',
  variant = 'dither',
  animate = true,
}) {
  const isCircle = rounded || (typeof r === 'number' && r >= 99)
  const numericHeight = typeof h === 'number' ? h : (parseInt(h, 10) || 12)
  const isBlock = numericHeight > 22

  if (isCircle) {
    return (
      <span
        className={`skel skel--circle ${className}`.trim()}
        aria-hidden="true"
        style={{
          width: w,
          height: h,
          borderRadius: 9999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          verticalAlign: 'middle',
          ...style,
        }}
      >
        <AsciiSkeleton
          variant={variant}
          width={w}
          height={h}
          circle
          animate={animate}
        />
      </span>
    )
  }

  if (isBlock) {
    const rows = Math.max(2, Math.round(numericHeight / 14))
    return (
      <span
        className={`skel skel--block ${className}`.trim()}
        aria-hidden="true"
        style={{
          width: w,
          height: h,
          borderRadius: r,
          display: 'block',
          overflow: 'hidden',
          ...style,
        }}
      >
        <AsciiSkeleton
          variant={variant}
          width={w}
          height={h}
          rows={rows}
          animate={animate}
        />
      </span>
    )
  }

  return (
    <span
      className={`skel skel--line ${className}`.trim()}
      aria-hidden="true"
      style={{
        width: w,
        height: h,
        borderRadius: r,
        display: 'inline-block',
        verticalAlign: 'middle',
        overflow: 'hidden',
        lineHeight: 1,
        ...style,
      }}
    >
      <AsciiSkeleton
        variant={variant}
        lines={1}
        widths={[w]}
        animate={animate}
      />
    </span>
  )
}

/** A paragraph's worth. The last line is short, because real ones are. */
export function SkeletonText({ lines = 3, gap = 8, variant = 'dither' }) {
  const widths = Array.from({ length: lines }, (_, i) => (i === lines - 1 ? '58%' : `${88 - (i % 3) * 9}%`))
  return (
    <div className="skel-stack" style={{ gap }} aria-hidden="true">
      <AsciiSkeleton variant={variant} lines={lines} widths={widths} />
    </div>
  )
}

/** Standing in for task or server rows — an optional icon/disc, title and meta, action controls. */
export function SkeletonRows({ rows = 4, controls = 2, icon = true, variant = 'dither' }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          {icon && <Skeleton w={18} h={18} r={99} rounded variant={variant} />}
          <div className="skel-row-text">
            <Skeleton w={`${48 + ((i * 13) % 32)}%`} h={13} r={4} variant={variant} />
            <Skeleton w={`${26 + ((i * 17) % 24)}%`} h={10} r={4} variant={variant} />
          </div>
          {Array.from({ length: controls }, (_, c) => (
            <Skeleton key={c} w={controls === 1 ? 52 : 20} h={controls === 1 ? 26 : 20} r={6} variant={variant} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A card with a title and some rows in it, for a view built out of cards. */
export function SkeletonCard({ title = true, rows = 3, controls = 2, icon = true, variant = 'dither' }) {
  return (
    <div className="card card-pad" aria-hidden="true">
      {title && <Skeleton w={140} h={11} variant={variant} style={{ marginBottom: 14 }} />}
      <SkeletonRows rows={rows} controls={controls} icon={icon} variant={variant} />
    </div>
  )
}

/** Table rows matching tabular lists like Automations, Runs, and Logs. */
export function SkeletonTable({ rows = 5, cols = ['30%', '25%', '15%', '10%'], variant = 'dither' }) {
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
              variant={variant}
              style={{ flexShrink: c === 0 ? 0 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Thread message preview with sender and multiline text. */
export function SkeletonMessage({ lines = 3, variant = 'dither' }) {
  const widths = ['95%']
  if (lines > 1) widths.push('82%')
  if (lines > 2) widths.push('64%')
  return (
    <div className="skel-stack" style={{ gap: 10, padding: '12px 0' }} aria-hidden="true">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton w={140} h={13} r={4} variant={variant} />
        <Skeleton w={60} h={10} r={3} variant={variant} />
      </div>
      <AsciiSkeleton variant={variant} lines={widths.length} widths={widths} />
    </div>
  )
}

/** The grid of cards the skills and catalogue pages are made of. */
export function SkeletonGrid({ cards = 6, variant = 'dither' }) {
  return (
    <div className="dir-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div className="dcard" key={i} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div className="dcard-top">
            <Skeleton w={34} h={34} r={8} variant={variant} />
            <div className="dcard-heading">
              <Skeleton w={`${46 + ((i * 13) % 26)}%`} h={14} r={4} variant={variant} />
              <Skeleton w={`${28 + ((i * 11) % 22)}%`} h={11} r={4} variant={variant} />
            </div>
            <Skeleton w={30} h={30} r={99} rounded variant={variant} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 2px' }}>
            <Skeleton w="92%" h={11} r={4} variant={variant} />
            <Skeleton w={`${65 + ((i * 9) % 25)}%`} h={11} r={4} variant={variant} />
          </div>
          <div className="dcard-badges" style={{ marginTop: 4 }}>
            <Skeleton w={52} h={18} r={99} rounded variant={variant} />
            {i % 2 === 0 && <Skeleton w={44} h={18} r={99} rounded variant={variant} />}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One bento library card: media, source line, title, excerpt lines. */
export function SkeletonLibraryCard({ tall = false, variant = 'dither' } = {}) {
  return (
    <div className={`skel-lib-card ${tall ? 'sm:row-span-2' : ''}`} aria-hidden="true">
      <div
        className="skel-lib-media"
        style={tall ? { aspectRatio: '9 / 14', maxHeight: 380, overflow: 'hidden' } : { aspectRatio: '16 / 10', overflow: 'hidden' }}
      >
        <AsciiSkeleton variant={variant} width="100%" height="100%" rows={tall ? 8 : 5} />
      </div>
      <div className="skel-lib-body">
        <div className="skel-lib-source" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Skeleton w={14} h={14} r={4} variant={variant} />
          <Skeleton w={76} h={10} r={3} variant={variant} />
        </div>
        <AsciiSkeleton variant={variant} lines={3} widths={['88%', '100%', '72%']} />
      </div>
      <div className="skel-lib-foot">
        <Skeleton w={64} h={11} r={3} variant={variant} />
      </div>
    </div>
  )
}

/** The bento column layout the library grid is made of. */
export function SkeletonLibraryGrid({ cards = 6, variant = 'dither' }) {
  return (
    <div className="skel-lib-grid lib-bento-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonLibraryCard key={i} tall={i % 3 === 1} variant={variant} />
      ))}
    </div>
  )
}

/** A whole view's worth: the header, then its body. */
export function SkeletonView({ rows = 6, aside = false, variant = 'dither' }) {
  return (
    <div className="view" aria-hidden="true">
      <div className={`view-inner${aside ? ' view-inner--wide' : ''}`}>
        <header className="vheader" style={{ marginBottom: 24 }}>
          <div className="skel-stack" style={{ gap: 10 }}>
            <Skeleton w={140} h={22} r={6} variant={variant} />
            <Skeleton w={280} h={12} r={4} variant={variant} />
          </div>
        </header>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: rows }, (_, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 7,
                border: '1px solid var(--hairline)',
                background: 'var(--surface-subtle, rgba(255, 255, 255, 0.015))',
              }}
            >
              <Skeleton w={16} h={16} r={99} rounded variant={variant} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <AsciiSkeleton variant="scan" lines={1} widths={[`${48 + ((i * 13) % 36)}%`]} />
              </div>
              <Skeleton w={14} h={14} r={4} variant={variant} />
            </div>
          ))}
        </div>
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
          <HouseButton type="button" className="btn btn--primary btn--small" onClick={onRetry}>
            <Icon name="refresh" size={13} /> Try again
          </HouseButton>
        )}

        {/* The way out for a device that is not the machine.
            Offered while it is still waking, not only once the wake has given
            up: a phone is never going to reach a laptop behind a router, and
            making it sit out ninety seconds of a wake that cannot succeed
            before it is even told pairing exists is the bug this fixes. */}
        {onRemote && (
          <HouseButton type="button" className="btn btn--small boot-remote" onClick={onRemote}>
            <Icon name="link" size={13} /> This is not the machine — pair it instead
          </HouseButton>
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

export {
  PluginCardSkeleton,
  PluginGridSkeleton,
  PluginInstalledStripSkeleton,
  PluginCategoryBridgeSkeleton,
  PluginCarouselSkeleton,
  PluginsDirectorySkeleton,
  PluginDetailSkeleton,
} from '../views/capabilities/plugins/PluginSkeletons.jsx'
