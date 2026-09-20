import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { copyText } from '../../api.js'
import { parseBlocks, parseInline, SAFE_PROTOCOL } from './parse.js'
import { grammarFor, loadGrammar, tokenize } from './highlight.js'

/* Model output, rendered to React elements rather than HTML.
 *
 * Nothing here reaches `dangerouslySetInnerHTML`, so a model that emits a
 * `<script>` tag or an `onerror=` attribute produces visible text and not an
 * execution. The syntax highlighter is held to the same rule — `highlight.js`
 * returns a token tree for this file to build spans from, never markup.
 *
 * The parsing lives in `parse.js`, which has no React in it and is asserted
 * against by `tests/markdown.mjs`. This file is the mapping and nothing else.
 */

/* ---------------------------------------------------------------- inline */

/* Extract the domain from a URL for display in source pills. */
function domain(url) {
  try { return new URL(String(url)).host.replace(/^www\./, '') } catch { return '' }
}

/* Lightbox modal with smooth frosted backdrop for full-size visual inspection. */
function LightboxModal({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = item.alt || 'Visual context'

  return (
    <div
      className="md-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <button
        type="button"
        className="md-lightbox-close"
        onClick={onClose}
        aria-label="Close image preview"
      >
        <Icon name="x" size={16} />
      </button>
      <div className="md-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img
          src={item.href}
          alt={label}
          className="md-lightbox-img"
        />
        <div className="md-lightbox-caption">
          <span>{label}</span>
          {item.href && (
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="md-lightbox-link"
            >
              Open original ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/* OpenAI-style visual context gallery: clean 16:9 thumbnail strip with subtle borders,
 * hover elevation, count badge on overflow, and click-to-enlarge lightbox modal.
 * No dark gradient text overlays blocking the images. */
function ImageGallery({ items }) {
  const [activeItem, setActiveItem] = useState(null)
  if (!items || items.length === 0) return null

  const isSingle = items.length === 1
  const displayCount = isSingle ? 1 : Math.min(items.length, 3)
  const displayItems = items.slice(0, displayCount)
  const totalCount = items.length

  return (
    <div className={`md-gallery-container${isSingle ? ' is-single' : ''}`}>
      <div className={isSingle ? 'md-image-single' : `md-image-gallery md-image-gallery--count-${displayCount}`}>
        {displayItems.map((item, idx) => {
          const label = item.alt || 'Visual context'
          const isLast = idx === displayItems.length - 1 && totalCount > displayItems.length

          return (
            <figure
              key={idx}
              className="md-image-card"
              role="button"
              tabIndex={0}
              title={`Click to enlarge: ${label}`}
              onClick={() => setActiveItem(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActiveItem(item)
                }
              }}
            >
              <div className="md-image-thumb-wrap">
                <img
                  src={item.href}
                  alt={label}
                  loading="lazy"
                  className="md-image-thumb"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
                {isLast && (
                  <div className="md-image-count-badge" title={`${totalCount} images total`}>
                    <Icon name="image" size={13} />
                    <span>{totalCount}</span>
                  </div>
                )}
              </div>
            </figure>
          )
        })}
      </div>

      {activeItem && (
        <LightboxModal item={activeItem} onClose={() => setActiveItem(null)} />
      )}
    </div>
  )
}

function ImageRef({ alt, href }) {
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const label = alt || 'Visual context'
  if (!SAFE_PROTOCOL.test(href || '') || failed) {
    return <span className="md-image-fallback" title={href}>{label}</span>
  }
  return (
    <>
      <figure
        className="md-image-card md-image-card--inline"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        title={`Click to enlarge: ${label}`}
      >
        <div className="md-image-thumb-wrap">
          <img
            src={href}
            alt={label}
            loading="lazy"
            className="md-image-thumb"
            onError={() => setFailed(true)}
          />
        </div>
      </figure>
      {open && <LightboxModal item={{ href, alt: label }} onClose={() => setOpen(false)} />}
    </>
  )
}

function SourcePill({ href, children }) {
  const host = domain(href)
  const linkText = children
  const textStr = (Array.isArray(linkText) ? linkText.filter((c) => typeof c === 'string').join('') : String(linkText || '')).trim()
  const isUrl = /^https?:\/\//i.test(textStr) || textStr === host || textStr === `www.${host}`

  // Check for badge counter e.g. "Rockstar Games +2" or "+1" (Image 1)
  const badgeMatch = textStr.match(/\+(\d+)$/)
  const badgeCount = badgeMatch ? badgeMatch[1] : null
  const displayLabel = isUrl ? host : (badgeMatch ? textStr.replace(/\s*\+\d+$/, '').trim() : textStr)
  const initial = (host.charAt(0) || 'S').toUpperCase()

  const handleClick = (e) => {
    if (e.metaKey || e.ctrlKey) return
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('amethyst-open-sources', {
      detail: { url: href, host, title: displayLabel },
    }))
  }

  return (
    <span className="md-citation-pill-wrap">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener nofollow"
        className="md-citation-badge"
        title={`Source: ${displayLabel} (${href})`}
        onClick={handleClick}
      >
        <span className="citation-badge-avatar">
          <img
            src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
            alt=""
            className="citation-badge-favicon"
            onError={(e) => {
              e.target.style.display = 'none'
              if (e.target.nextSibling) e.target.nextSibling.style.display = 'inline-flex'
            }}
          />
          <span className="citation-fallback-char" style={{ display: 'none' }}>
            {initial}
          </span>
        </span>
        <span className="citation-badge-label">{displayLabel}</span>
        {badgeCount && (
          <span className="citation-badge-counter">+{badgeCount}</span>
        )}
      </a>
    </span>
  )
}

/* OpenAI-style horizontal article cards carousel at the bottom of research responses.
 * Renders rich cards with 16:9 thumbnail, favicon, domain name, headline, and timestamp. */
function ArticleCarousel({ items, galleryImages = [] }) {
  const scrollRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 10)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScroll, { passive: true })
    window.addEventListener('resize', checkScroll)
    return () => {
      el.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [checkScroll, items])

  const handleScroll = (dir) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * 260, behavior: 'smooth' })
  }

  if (!items || items.length === 0) return null

  return (
    <div className="openai-carousel-wrap">
      {canScrollLeft && (
        <button
          type="button"
          className="openai-carousel-nav openai-carousel-nav--left"
          onClick={() => handleScroll(-1)}
          aria-label="Previous articles"
        >
          <Icon name="caret-left" size={16} />
        </button>
      )}

      <div className="openai-carousel-track" ref={scrollRef}>
        {items.map((art, idx) => {
          const host = art.domain || domain(art.url)
          const previewService = art.url && /^https?:\/\//i.test(art.url)
            ? `https://api.microlink.io/?url=${encodeURIComponent(art.url)}&screenshot=true&embed=screenshot.url`
            : null
          const thumb = art.image || (galleryImages.length > 0 ? galleryImages[idx % galleryImages.length]?.href : null) || previewService
          const label = art.title || host
          const dateStr = art.date || (art.snippet && /\b\d{4}\b/.test(art.snippet) ? art.snippet : null)

          const handleClick = (e) => {
            if (e.metaKey || e.ctrlKey) return
            window.dispatchEvent(new CustomEvent('amethyst-open-sources', {
              detail: { url: art.url, host, title: label },
            }))
          }

          return (
            <a
              key={idx}
              href={art.url || '#'}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="openai-article-card"
              onClick={handleClick}
              title={`Read: ${label} (${host})`}
            >
              <div className="openai-article-thumb-wrap">
                {thumb ? (
                  <img
                    src={thumb}
                    alt={label}
                    loading="lazy"
                    className="openai-article-thumb"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      if (e.currentTarget.nextSibling) {
                        e.currentTarget.nextSibling.style.display = 'flex'
                      }
                    }}
                  />
                ) : null}
                <div
                  className="openai-article-thumb-fallback"
                  style={{ display: thumb ? 'none' : 'flex' }}
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
                    alt=""
                    className="openai-fallback-favicon"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  <span className="openai-fallback-host">{host}</span>
                </div>
              </div>

              <div className="openai-article-body">
                <div className="openai-article-site-row">
                  <span className="openai-article-favicon-wrap">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                      alt=""
                      className="openai-article-favicon"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  </span>
                  <span className="openai-article-sitename">{host}</span>
                </div>
                <h4 className="openai-article-title">{label}</h4>
                {dateStr && (
                  <div className="openai-article-date">{dateStr}</div>
                )}
              </div>
            </a>
          )
        })}
      </div>

      {canScrollRight && (
        <button
          type="button"
          className="openai-carousel-nav openai-carousel-nav--right"
          onClick={() => handleScroll(1)}
          aria-label="Next articles"
        >
          <Icon name="caret-right" size={16} />
        </button>
      )}
    </div>
  )
}

function inline(nodes, keyBase = 'i') {
  return nodes.map((node, n) => {
    const key = `${keyBase}${n}`
    switch (node.type) {
      case 'text': return node.value
      case 'br': return <br key={key} />
      case 'code': return <code key={key} className="md-code">{node.value}</code>
      case 'strong': return <strong key={key}>{inline(node.children, `${key}-`)}</strong>
      case 'em': return <em key={key}>{inline(node.children, `${key}-`)}</em>
      case 'del': return <s key={key}>{inline(node.children, `${key}-`)}</s>
      case 'image': return <ImageRef key={key} alt={node.alt} href={node.href} />
      case 'link':
        // An unsupported scheme keeps its text and loses its link: `javascript:`
        // and `data:` are the two that matter, and neither should be one click
        // from a transcript the user did not write.
        if (!SAFE_PROTOCOL.test(node.href || '')) return <span key={key}>{inline(node.children, `${key}-`)}</span>
        // External http(s) links render as source pills with favicons.
        if (/^https?:\/\//i.test(node.href)) {
          return <SourcePill key={key} href={node.href}>{inline(node.children, `${key}-`)}</SourcePill>
        }
        return (
          <a key={key} href={node.href} target="_blank" rel="noreferrer noopener nofollow" className="md-link">
            {inline(node.children, `${key}-`)}
          </a>
        )
      default: return null
    }
  })
}

const text = (src) => inline(parseInline(src))

/* The tail of a path, for a header that is one line tall.
 *
 * The first attempt did this with `direction: rtl` and `text-overflow`, which
 * elides from the correct end and then silently reorders the string: a slash
 * is a neutral character, so `/home/wayne/app.py` rendered as
 * `home/wayne/app.py/`. Absolute paths are exactly what a model writes when it
 * is showing you a file. Trimming the segments is unambiguous, and the whole
 * path stays in the tooltip. */
function shortPath(path, keep = 2) {
  const parts = String(path).split('/').filter(Boolean)
  if (parts.length <= keep) return path
  return `…/${parts.slice(-keep).join('/')}`
}

/* ------------------------------------------------------------ code blocks */

/* hast -> React. `refractor` hands back element and text nodes only, with
   nothing on them but a class list, so this is the whole mapping. */
function spans(nodes, keyBase = 't') {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.value
    const cls = node.properties?.className
    return (
      <span key={`${keyBase}${i}`} className={Array.isArray(cls) ? cls.join(' ') : cls}>
        {spans(node.children || [], `${keyBase}${i}-`)}
      </span>
    )
  })
}

/* A fenced block, with the two controls a reader of model output reaches for.
 *
 * Highlighting waits for the closing fence. Re-tokenising a growing buffer on
 * every streamed delta is work thrown away sixty times a second, and a token
 * that is half-written highlights as the wrong thing and then changes colour
 * when the rest of it arrives — which reads worse than plain text for the
 * second it takes. */
function CodeBlock({ lang, file, text: code, open }) {
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [tokens, setTokens] = useState(null)
  const grammar = grammarFor(lang || file)

  /* The `current` flag is the whole cancellation story, and deliberately so.
     There was a second `alive` ref here guarding against a resolve after
     unmount, and under StrictMode — which mounts, cleans up, and mounts again
     — its cleanup set it false on the first pass and nothing ever set it back.
     Every code block in the application stayed unhighlighted, in development
     and in any future remount. This effect's own cleanup already runs on
     unmount, so the ref was guarding something that was covered. */
  useEffect(() => {
    if (open || !grammar) { setTokens(null); return undefined }
    let current = true
    loadGrammar(grammar).then((refractor) => {
      if (current) setTokens(tokenize(refractor, code, grammar))
    })
    return () => { current = false }
  }, [grammar, code, open])

  const copy = useCallback(async () => {
    setCopied(await copyText(code) ? 'copied' : 'blocked')
    setTimeout(() => setCopied(false), 1600)
  }, [code])

  return (
    <div className="md-pre-wrap">
      <div className="md-pre-head">
        {/* The filename when the model gave one, the language otherwise, and
            nothing at all when it gave neither — rather than the word "text",
            which was a label for the absence of a label. */}
        {file && <span className="md-pre-file" title={file}>{shortPath(file)}</span>}
        {(lang || file) && <span className="md-pre-lang">{lang || 'text'}</span>}
        {open && (
          <span className="md-pre-live">
            writing<span className="ellipsis"><i /><i /><i /></span>
          </span>
        )}
        <div className="md-pre-actions">
          {/* Long lines scroll by default, because a shell command broken over
              three lines is no longer the command. Wrapping is offered because
              sometimes you want all of it at once. */}
          <button
            type="button"
            className={`md-pre-btn${wrap ? ' is-on' : ''}`}
            onClick={() => setWrap((w) => !w)}
            title={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
            aria-pressed={wrap}
            aria-label="Wrap long lines"
          >
            <Icon name="wrap" size={13} />
          </button>
          <button
            type="button"
            className="md-pre-btn"
            onClick={copy}
            title="Copy this block"
            aria-label={copied === 'copied' ? 'Copied' : 'Copy this block'}
          >
            <Icon
              name={copied === 'copied' ? 'check' : copied === 'blocked' ? 'x' : 'copy'}
              size={13}
            />
          </button>
        </div>
      </div>
      <pre className={`md-pre${wrap ? ' md-pre--wrap' : ''}`}>
        <code>{tokens ? spans(tokens) : code}</code>
      </pre>
    </div>
  )
}

/* ---------------------------------------------------------------- blocks */

/* Which mark and which of the three semantic colours each admonition takes.
   `caution` and `warning` are the same shape of thing and share the mark; the
   labels differ because the model chose between them. */
const CALLOUTS = {
  note: { icon: 'info', label: 'Note' },
  tip: { icon: 'spark', label: 'Tip' },
  important: { icon: 'info', label: 'Important' },
  warning: { icon: 'alert', label: 'Warning' },
  caution: { icon: 'alert', label: 'Caution' },
}

function List({ block, keyBase }) {
  const Tag = block.type === 'ol' ? 'ol' : 'ul'
  return (
    <Tag className={`md-list${block.tasks ? ' md-list--tasks' : ''}`}>
      {block.items.map((item, n) => {
        const key = `${keyBase}-${n}`
        const task = item.done !== undefined
        return (
          <li key={key} className={task ? `md-task${item.done ? ' is-done' : ''}` : undefined}>
            {/* A real mark rather than the two characters the model typed.
                Not a checkbox input: nothing in a transcript is settable, and
                a control that looks operable and is not is worse than a
                picture of one. */}
            {task && (
              <span className="md-task-box" aria-hidden="true">
                {item.done && <Icon name="check" size={11} weight="bold" />}
              </span>
            )}
            <span className={task ? 'md-task-text' : undefined}>
              {text(item.text)}
              {item.children.map((child, c) => (
                <List key={`${key}-${c}`} block={child} keyBase={`${key}-${c}`} />
              ))}
            </span>
          </li>
        )
      })}
    </Tag>
  )
}

function getStatusKind(val) {
  const str = String(val || '').trim().toLowerCase()
  if (/^(confirmed|official|verified|active|done)/i.test(str)) return 'confirmed'
  if (/^(reported|corroborated|in review|planned)/i.test(str)) return 'reported'
  if (/^(unconfirmed|pending|rumor|speculation|tba|tbd)/i.test(str)) return 'pending'
  return null
}

function block(node, key, extra = {}) {
  switch (node.type) {
    case 'code':
      return <CodeBlock key={key} lang={node.lang} file={node.file} text={node.text} open={node.open} />

    case 'h': {
      // Shifted down two levels: the page already owns its `h1`, and a reply
      // that opens with `#` must not become a second one.
      const Tag = `h${Math.min(node.level + 2, 6)}`
      return <Tag key={key} className="md-h">{text(node.text)}</Tag>
    }

    case 'hr':
      return <hr key={key} className="md-hr" />

    case 'callout': {
      const kind = CALLOUTS[node.kind]
      return (
        <div key={key} className={`md-callout md-callout--${node.kind}`}>
          <p className="md-callout-head">
            <Icon name={kind.icon} size={14} weight="fill" />
            {kind.label}
          </p>
          <div className="md-callout-body">{text(node.text)}</div>
        </div>
      )
    }

    case 'quote':
      return <blockquote key={key} className="md-quote">{text(node.text)}</blockquote>

    case 'ul':
    case 'ol':
      return <List key={key} block={node} keyBase={key} />

    case 'gallery':
      return <ImageGallery key={key} items={node.items} />

    case 'article_carousel':
      return <ArticleCarousel key={key} items={node.items} galleryImages={extra.galleryImages || []} />

    case 'table': {
      const colCount = node.head.length
      return (
        <div key={key} className="md-table-wrap" tabIndex={0} role="region" aria-label="Table">
          <table className="md-table">
            <thead>
              <tr>{node.head.map((c, x) => <th key={x} scope="col">{text(c)}</th>)}</tr>
            </thead>
            <tbody>
              {node.rows.map((rawRow, y) => {
                const row = Array.isArray(rawRow) ? rawRow : []
                return (
                  <tr key={y}>
                    {row.map((c, x) => {
                      const isLast = x === colCount - 1
                      const isFirst = x === 0
                      const statusKind = isLast ? getStatusKind(c) : null
                      return (
                        <td key={x} className={isFirst ? 'md-table-cell--first' : isLast ? 'md-table-cell--last' : undefined}>
                          {statusKind ? (
                            <span className={`md-status-pill md-status-pill--${statusKind}`}>{text(c)}</span>
                          ) : (
                            text(c)
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    }

    default:
      return <p key={key} className="md-p">{text(node.text)}</p>
  }
}

function Markdown({ text: src }) {
  const blocks = parseBlocks(src)
  const galleryImages = []
  for (const b of blocks) {
    if (b.type === 'gallery' && Array.isArray(b.items)) {
      galleryImages.push(...b.items)
    }
  }

  return (
    <div className="md">
      {blocks.map((node, n) => block(node, `b${n}`, { galleryImages }))}
    </div>
  )
}

export default memo(Markdown)
