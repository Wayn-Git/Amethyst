import { Button as HouseButton } from '../ui/bento/index.jsx'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { copyText } from '../../api.js'
import { parseBlocks, parseInline, SAFE_PROTOCOL } from './parse.js'
import { grammarFor, loadGrammar, tokenize } from './highlight.js'
import { CodeBlock as AgentCodeBlock } from '../agents/code-block.tsx'
import { TreeView } from '../arc/tree-view/tree-view'
import { JsonViewer } from '../arc/json-viewer/json-viewer'
import { isAsciiTree, parseAsciiTree } from '../arc/tree-view/tree-parser'
import ImageGalleryWidget from '../widgets/ImageGallery.jsx'
import WidgetRenderer from '../widgets/WidgetRenderer.jsx'

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

export function resolveMediaUrl(href) {
  if (!href) return ''
  if (/^https?:\/\//i.test(href) || href.startsWith('data:image/')) {
    return href
  }
  let clean = href.trim()
  if (clean.startsWith('file://')) {
    clean = clean.slice(7)
  }
  return `/api/media/local?path=${encodeURIComponent(clean)}`
}

function isAllowedImageHref(href) {
  if (!href) return false
  if (SAFE_PROTOCOL.test(href)) return true
  if (href.startsWith('data:image/')) return true
  if (href.startsWith('/') || href.startsWith('file://') || href.startsWith('./') || href.startsWith('~/')) return true
  return false
}




function ImageRef({ alt, href }) {
  if (!isAllowedImageHref(href || '')) {
    return <span className="md-image-fallback" title={href}>{alt || 'Visual context'}</span>
  }
  return <ImageGalleryWidget items={[{ href, alt }]} />
}

function SourcePill({ href, children }) {
  const host = domain(href)
  const linkText = children
  const textStr = (Array.isArray(linkText) ? linkText.filter((c) => typeof c === 'string').join('') : String(linkText || '')).trim()
  const isUrl = /^https?:\/\//i.test(textStr) || textStr === host || textStr === `www.${host}`

  // Check for badge counter e.g. "Rockstar Games +2" or "OLX +1" (Image 4 & 5)
  const badgeMatch = textStr.match(/\+(\d+)$/)
  const badgeCount = badgeMatch ? parseInt(badgeMatch[1], 10) : 0
  const displayLabel = isUrl ? host : (badgeMatch ? textStr.replace(/\s*\+\d+$/, '').trim() : textStr)
  const initial = (host.charAt(0) || 'S').toUpperCase()

  const [isOpen, setIsOpen] = useState(false)
  const [sourceIndex, setSourceIndex] = useState(0)
  const closeTimerRef = useRef(null)

  const isDescriptiveLink = !badgeCount && !isUrl && (textStr.length > 20 || /\b(page|guide|read|download|click|here|view|full|report|cover story|article|gallery|album|newswire)\b/i.test(textStr))

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false)
    }, 220)
  }

  const handleClick = (e) => {
    if (e.metaKey || e.ctrlKey) return
    window.dispatchEvent(new CustomEvent('amethyst-open-sources', {
      detail: { url: href, host, title: displayLabel },
    }))
  }

  const totalSources = 1 + badgeCount
  const previewTitle = isDescriptiveLink ? textStr : (displayLabel && displayLabel !== host ? `${displayLabel} — ${host}` : host)

  if (isDescriptiveLink) {
    return (
      <span className="md-text-link-wrap" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener nofollow"
          className="md-text-link"
          title={href}
          onClick={handleClick}
        >
          <span className="md-text-link-label">{textStr}</span>
          <span className="md-link-arrow">↗</span>
        </a>
        {isOpen && (
          <div className="citation-popover" role="tooltip" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <div className="citation-popover-site">
              <img
                src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                alt=""
                className="citation-popover-favicon"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
              <span className="citation-popover-host">{host}</span>
            </div>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="citation-popover-title"
              onClick={handleClick}
            >
              {textStr}
            </a>
          </div>
        )}
      </span>
    )
  }

  return (
    <span
      className="md-citation-pill-wrap"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener nofollow"
        className={`md-citation-badge${isOpen ? ' is-active' : ''}`}
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
        {badgeCount > 0 && (
          <span className="citation-badge-counter">+{badgeCount}</span>
        )}
      </a>

      {isOpen && (
        <div
          className="citation-popover"
          role="tooltip"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="citation-popover-header">
            <div className="citation-popover-nav">
              <HouseButton
                type="button"
                className="citation-nav-btn"
                disabled={totalSources <= 1 || sourceIndex === 0}
                onClick={(e) => {
                  e.stopPropagation()
                  setSourceIndex((i) => Math.max(0, i - 1))
                }}
                aria-label="Previous source"
              >
                <Icon name="caret-left" size={11} />
              </HouseButton>
              <HouseButton
                type="button"
                className="citation-nav-btn"
                disabled={totalSources <= 1 || sourceIndex >= totalSources - 1}
                onClick={(e) => {
                  e.stopPropagation()
                  setSourceIndex((i) => Math.min(totalSources - 1, i + 1))
                }}
                aria-label="Next source"
              >
                <Icon name="caret-right" size={11} />
              </HouseButton>
              <span className="citation-nav-counter">
                {sourceIndex + 1}/{totalSources}
              </span>
            </div>
          </div>

          <div className="citation-popover-site">
            <img
              src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
              alt=""
              className="citation-popover-favicon"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <span className="citation-popover-host">{displayLabel || host}</span>
          </div>

          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener nofollow"
            className="citation-popover-title"
            onClick={handleClick}
          >
            {previewTitle}
          </a>
        </div>
      )}
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
        <HouseButton
          type="button"
          className="openai-carousel-nav openai-carousel-nav--left"
          onClick={() => handleScroll(-1)}
          aria-label="Previous articles"
        >
          <Icon name="caret-left" size={16} />
        </HouseButton>
      )}

      <div className="openai-carousel-track" ref={scrollRef}>
        {items.map((art, idx) => {
          const host = art.domain || domain(art.url)
          const thumb = art.image || null
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
        <HouseButton
          type="button"
          className="openai-carousel-nav openai-carousel-nav--right"
          onClick={() => handleScroll(1)}
          aria-label="Next articles"
        >
          <Icon name="caret-right" size={16} />
        </HouseButton>
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

/* A fenced block with Arc CodeBlock, interactive TreeView for ASCII trees, and JsonViewer */
function CodeBlock({ lang, file, text: code, open }) {
  const [viewMode, setViewMode] = useState('rich') // 'rich' | 'code'

  const isWidgetEnvelope = useMemo(() => {
    const l = (lang || '').toLowerCase()
    return l === 'amethyst:widget' || l === 'widget'
  }, [lang])

  const parsedWidget = useMemo(() => {
    if (!isWidgetEnvelope || !code) return null
    try {
      const parsed = JSON.parse(code.trim())
      if (parsed && typeof parsed === 'object' && parsed.type && parsed.data) {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }, [isWidgetEnvelope, code])

  const asciiTree = useMemo(() => {
    if (isAsciiTree(code)) {
      try {
        const nodes = parseAsciiTree(code)
        if (nodes && nodes.length > 0) return nodes
      } catch {
        return null
      }
    }
    return null
  }, [code])

  const parsedJson = useMemo(() => {
    const l = (lang || '').toLowerCase()
    if ((l === 'json' || l === 'jsonc' || l === 'json5' || !lang) && code && (code.trim().startsWith('{') || code.trim().startsWith('['))) {
      try {
        return JSON.parse(code)
      } catch {
        return null
      }
    }
    return null
  }, [code, lang])

  if (parsedWidget) {
    return (
      <div className="md-inline-widget" style={{ margin: '18px 0' }}>
        <WidgetRenderer widget={parsedWidget} />
      </div>
    )
  }

  // If it's an ASCII tree (e.g. project structure)
  if (asciiTree && viewMode === 'rich') {
    return (
      <div className="md-tree-container">
        <div className="md-tree-header">
          <div className="md-tree-title">
            <Icon name="folder" size={14} />
            <span>{file || 'Project structure'}</span>
          </div>
          <div className="md-tree-actions">
            <HouseButton
              type="button"
              className="md-tree-toggle-btn"
              onClick={() => setViewMode('code')}
              title="View raw ASCII tree"
            >
              <Icon name="code" size={12} />
              <span>Raw</span>
            </HouseButton>
          </div>
        </div>
        <TreeView nodes={asciiTree} defaultExpandedIds={[asciiTree[0]?.id]} />
      </div>
    )
  }

  // If it's multi-line JSON, offer interactive JsonViewer
  if (parsedJson && viewMode === 'rich' && code.split('\n').length > 4) {
    return (
      <div className="md-json-container">
        <div className="md-tree-header">
          <div className="md-tree-title">
            <Icon name="code" size={14} />
            <span>{file || 'JSON Data'}</span>
          </div>
          <div className="md-tree-actions">
            <HouseButton
              type="button"
              className="md-tree-toggle-btn"
              onClick={() => setViewMode('code')}
              title="View formatted text"
            >
              <Icon name="code" size={12} />
              <span>Raw</span>
            </HouseButton>
          </div>
        </div>
        <JsonViewer data={parsedJson} rootName={file || 'root'} defaultExpandDepth={2} maxHeight={360} />
      </div>
    )
  }

  return (
    <div className="md-arc-code-wrap">
      {(asciiTree || (parsedJson && code.split('\n').length > 4)) && (
        <div className="md-tree-switch-bar">
          <HouseButton
            type="button"
            className="md-tree-toggle-btn is-active"
            onClick={() => setViewMode('rich')}
          >
            <Icon name="spark" size={12} />
            <span>Interactive {asciiTree ? 'Tree' : 'JSON'}</span>
          </HouseButton>
        </div>
      )}
      <AgentCodeBlock
        code={code}
        filename={file}
        language={lang || 'text'}
        showLineNumbers={true}
      />
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

function TableBlock({ head, rows }) {
  const [copied, setCopied] = useState(false)
  const colCount = head.length
  const rowCount = rows.length

  const handleCopy = useCallback(async () => {
    const headerLine = `| ${head.join(' | ')} |`
    const sepLine = `| ${head.map(() => '---').join(' | ')} |`
    const rowLines = rows.map((r) => `| ${(Array.isArray(r) ? r : []).join(' | ')} |`)
    const tableMd = [headerLine, sepLine, ...rowLines].join('\n')
    const ok = await copyText(tableMd)
    setCopied(ok ? 'copied' : 'failed')
    setTimeout(() => setCopied(false), 1500)
  }, [head, rows])

  return (
    <div className="md-table-wrap" tabIndex={0} role="region" aria-label="Table">
      <div className="md-table-topbar">
        <div className="md-table-meta">
          <span className="md-table-count">{rowCount} {rowCount === 1 ? 'row' : 'rows'}</span>
        </div>
        <HouseButton
          type="button"
          className={`md-table-copy-btn${copied === 'copied' ? ' is-copied' : ''}`}
          onClick={handleCopy}
          title={copied === 'copied' ? 'Copied markdown table' : 'Copy markdown table'}
          aria-label="Copy table"
        >
          <Icon name={copied === 'copied' ? 'check' : 'copy'} size={12} />
          <span>{copied === 'copied' ? 'Copied' : 'Copy'}</span>
        </HouseButton>
      </div>
      <div className="md-table-scroll">
        <table className="md-table">
          <thead>
            <tr>
              {head.map((c, x) => (
                <th key={x} scope="col">
                  {text(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((rawRow, y) => {
              const row = Array.isArray(rawRow) ? rawRow : []
              return (
                <tr key={y}>
                  {row.map((c, x) => {
                    const isFirst = x === 0
                    const isLast = x === colCount - 1
                    return (
                      <td
                        key={x}
                        className={isFirst ? 'md-table-cell--first' : isLast ? 'md-table-cell--last' : undefined}
                      >
                        {text(c)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function block(node, key, extra = {}) {
  switch (node.type) {
    case 'code':
      return <CodeBlock key={key} lang={node.lang} file={node.file} text={node.text} open={node.open} />

    case 'h': {
      // Shifted down one level: the page owns its h1, while responses start at h2 for high-contrast section hierarchy
      const Tag = `h${Math.min(node.level + 1, 6)}`
      return <Tag key={key} className={`md-h md-h${node.level}`}>{text(node.text)}</Tag>
    }

    case 'hr':
      return <hr key={key} className="md-hr" />

    case 'callout': {
      const kind = CALLOUTS[node.kind] || CALLOUTS.note
      return (
        <div key={key} className={`md-callout md-callout--${node.kind}`}>
          <div className="md-callout-head">
            <span className="md-callout-badge">
              <Icon name={kind.icon} size={13} weight="fill" />
              <span>{kind.label}</span>
            </span>
          </div>
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
      return <ImageGalleryWidget key={key} items={node.items} />

    case 'article_carousel':
      return <ArticleCarousel key={key} items={node.items} galleryImages={extra.galleryImages || []} />

    case 'table':
      return <TableBlock key={key} head={node.head} rows={node.rows} />

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
