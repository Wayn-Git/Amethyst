
function extractImagesFromBlock(block) {
  if (block.type !== "p") return null
  const inlines = parseInline(block.text)
  const nonTrivial = inlines.filter(n => {
    if (n.type === "br") return false
    if (n.type === "text" && !n.value.trim()) return false
    return true
  })
  if (nonTrivial.length > 0 && nonTrivial.every(n => n.type === "image")) {
    return nonTrivial.map(n => ({ alt: n.alt, href: n.href }))
  }
  return null
}

/* Markdown, as data.
 *
 * Deliberately free of React, so it can be run by `node` and asserted against
 * — see `tests/markdown.mjs`. Two of the worst bugs this application has had
 * were in here and were invisible to every kind of testing the frontend had:
 * a fence whose info string named a file was not recognised as a fence at all,
 * so the block's contents were parsed as prose and its closing fence opened a
 * second block that swallowed the rest of the answer; and `_` emphasis matched
 * inside words, so `test_runtime_and_agent.py` rendered with `runtime` in
 * italics. Both are one-line regexes, and both survived because nothing could
 * ask this file a question without a browser.
 *
 * It also has to survive a half-finished document. Text arrives token by
 * token, so an unterminated fence, a table with one row written, and a link
 * whose closing bracket has not arrived are normal intermediate states rather
 * than errors. Every reader closes itself at end of input.
 *
 * Nothing here emits HTML. The renderer builds elements from these tokens, so
 * a model that writes `<script>` produces the text `<script>`.
 */

/* ------------------------------------------------------------------ inline */

export const SAFE_PROTOCOL = /^(https?:|mailto:)/i

/* Emphasis follows CommonMark's flanking rule rather than "any pair of
   asterisks": an opener may not be followed by whitespace, and a closer may
   not be preceded by it. Without that, `2 ** n * 250` in a sentence set `n` in
   italics, which every model that writes arithmetic in prose walked into.

   `_` carries the extra intra-word restriction — the `word: false` flag — and
   that is the one that mattered most here. Snake case is most of what this
   application's own output is about. */
const INLINE = [
  { type: 'code', re: /^`([^`]+)`/, raw: true },
  { type: 'strong', re: /^\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/ },
  { type: 'strong', re: /^__([^_\s](?:[^_]*[^_\s])?)__(?!\w)/, word: false },
  { type: 'del', re: /^~~([^~]+)~~/ },
  { type: 'em', re: /^\*([^*\s](?:[^*\n]*[^*\s])?)\*/ },
  { type: 'em', re: /^_([^_\s](?:[^_\n]*[^_\s])?)_(?!\w)/, word: false },
  { type: 'image', re: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, href: 2 },
  { type: 'link', re: /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, href: 2 },
  { type: 'autolink', re: /^<(https?:\/\/[^>\s]+)>/ },
  { type: 'autolink', re: /^(https?:\/\/[^\s<>()[\]]+)/ },
]

/**
 * A run of inline markup, as a flat-ish tree.
 *
 * Nodes: `{type:'text', value}`, `{type:'br'}`, `{type:'code', value}`,
 * `{type:'strong'|'em'|'del', children}`, `{type:'link', href, children}`,
 * `{type:'image', href, alt}`.
 */
export function parseInline(src) {
  const out = []
  let buf = ''
  let rest = src ?? ''
  // The character to the left of the cursor, which is what decides whether an
  // underscore is opening emphasis or sitting inside an identifier.
  let prev = ''

  const flush = () => {
    if (buf) { out.push({ type: 'text', value: buf }); buf = '' }
  }

  while (rest) {
    let hit = null
    for (const rule of INLINE) {
      if (rule.word === false && /\w/.test(prev)) continue
      const m = rule.re.exec(rest)
      if (m) { hit = { rule, m }; break }
    }

    if (hit) {
      flush()
      const { rule, m } = hit
      if (rule.type === 'code') out.push({ type: 'code', value: m[1] })
      else if (rule.type === 'autolink') out.push({ type: 'link', href: m[1], children: [{ type: 'text', value: m[1] }] })
      else if (rule.type === 'image') out.push({ type: 'image', href: m[2], alt: m[1] })
      else if (rule.type === 'link') out.push({ type: 'link', href: m[2], children: parseInline(m[1]) })
      else out.push({ type: rule.type, children: parseInline(m[1]) })
      rest = rest.slice(m[0].length)
      prev = m[0].slice(-1)
      continue
    }

    if (rest[0] === '\n') {
      flush()
      out.push({ type: 'br' })
      rest = rest.slice(1)
      prev = '\n'
      continue
    }

    buf += rest[0]
    prev = rest[0]
    rest = rest.slice(1)
  }

  flush()
  return out
}

/* ------------------------------------------------------------------ blocks */

const BULLET = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TASK = /^\[([ xX])\]\s+([\s\S]*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/

/* A fence line, split into its marker and its info string.
 *
 * The info string used to be `[\w+-]*` anchored to end of line, so
 * ```` ```python backend/runtime/http.py ```` was not a fence. It is the rest
 * of the line now, as CommonMark has it. */
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/

export function readFence(line) {
  const m = FENCE.exec(line)
  if (!m) return null
  const [, marker, info] = m
  // CommonMark: a backtick fence's info string may not contain a backtick, or
  // a line beginning with an inline code span would open one.
  if (marker[0] === '`' && info.includes('`')) return null
  return { marker, info }
}

/** `python`, `python app.py`, `js:src/api.js`, `{python}`, `app.py` — every
 *  shape a model writes when it wants to name the file it is showing. */
export function readInfo(info) {
  const clean = String(info || '').replace(/^\{\.?/, '').replace(/\}$/, '').trim()
  if (!clean) return { lang: '', file: '' }
  const [first, ...rest] = clean.split(/\s+/)
  if (first.includes(':')) {
    const [lang, ...path] = first.split(':')
    return { lang, file: [path.join(':'), ...rest].filter(Boolean).join(' ') }
  }
  // A lone first word with an extension is a filename, not a language.
  if (rest.length === 0 && /\.\w+$/.test(first)) return { lang: '', file: first }
  return { lang: first, file: rest.join(' ') }
}

/* GitHub's admonitions, which every model has been trained on and which this
   renderer used to show as the literal text `[!WARNING]` above the sentence. */
export const CALLOUTS = new Set(['note', 'tip', 'important', 'warning', 'caution'])
const CALLOUT_HEAD = /^\s*\[!(\w+)\]\s*$/

const cells = (row) =>
  row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

/** One indentation level of list items, consumed recursively. */
function readList(lines, start, indent) {
  const items = []
  const ordered = /\d/.test(BULLET.exec(lines[start])[2])
  let i = start
  while (i < lines.length) {
    const m = BULLET.exec(lines[i])
    if (!m || m[1].length < indent) break
    if (m[1].length > indent) {
      const [nested, next] = readList(lines, i, m[1].length)
      if (items.length) items[items.length - 1].children.push(nested)
      i = next
      continue
    }
    if (/\d/.test(m[2]) !== ordered) break
    const item = { text: m[3], children: [] }
    i += 1
    // A wrapped line belongs to the item it follows.
    while (
      i < lines.length && lines[i].trim()
      && !BULLET.test(lines[i]) && !HEADING.test(lines[i]) && !readFence(lines[i]) && !QUOTE.test(lines[i])
    ) {
      item.text += `\n${lines[i].trim()}`
      i += 1
    }
    // `- [x] done` is a checklist, and a model asked to track its own work
    // writes one every time. It used to render as the characters `[x]`.
    const task = TASK.exec(item.text)
    if (task) {
      item.done = task[1].toLowerCase() === 'x'
      item.text = task[2]
    }
    items.push(item)
  }
  return [
    { type: ordered ? 'ol' : 'ul', items, tasks: items.some((it) => it.done !== undefined) },
    i,
  ]
}

export function normalizeRow(row, expectedLength) {
  if (!row) return Array(expectedLength).fill('')
  if (row.length === expectedLength) return row
  if (row.length > expectedLength) {
    const headPart = row.slice(0, expectedLength - 1)
    const tailPart = row.slice(expectedLength - 1).join(' ')
    return [...headPart, tailPart]
  }
  const padded = [...row]
  while (padded.length < expectedLength) padded.push('')
  return padded
}

export function parseArticleItems(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    const raw = typeof item === 'string' ? item : item.text || ''
    // Check if image is embedded in item: ![alt](url)
    let imageUrl = ''
    const imgMatch = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/.exec(raw)
    if (imgMatch) imageUrl = imgMatch[2]

    // Find main link: [Title](url)
    const cleanRaw = raw.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    const linkMatch = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/.exec(cleanRaw)
    if (!linkMatch) {
      return { title: raw, url: '', domain: '', snippet: '', date: '', image: imageUrl }
    }

    const title = linkMatch[1].trim()
    const url = linkMatch[2].trim()
    let host = ''
    try { host = new URL(url).hostname.replace(/^www\./, '') } catch {}

    const after = cleanRaw.slice(cleanRaw.indexOf(linkMatch[0]) + linkMatch[0].length).trim()

    // Check domain: *Domain* or _Domain_
    let domain = host
    const domainMatch = /(?:\*|_)([^*_]+)(?:\*|_)/.exec(after)
    if (domainMatch) {
      domain = domainMatch[1].trim()
    }

    // Check date: (Date) or snippet
    let date = ''
    const dateMatch = /\(([^)]*(?:today|yesterday|ago|\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^)]*)\)/i.exec(after)
    if (dateMatch) {
      date = dateMatch[1].trim()
    }

    // Remaining text as snippet
    let snippet = after
      .replace(/(?:\*|_)[^*_]+(?:\*|_)/g, '')
      .replace(/\([^)]+\)/g, '')
      .replace(/^[\s—\-–:]+/, '')
      .trim()

    if (!date) {
      const dateInSnippet = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s+\d{4})?/i.exec(snippet)
      if (dateInSnippet) {
        date = dateInSnippet[0]
      }
    }

    return {
      title,
      url,
      domain: domain || host,
      date,
      snippet,
      image: imageUrl,
    }
  })
}

function isSourcesHeading(text) {
  return /^(?:📚\s*)?(?:(?:key|verified|primary|latest)\s+)?(?:sources|coverage|articles|references)\b/i.test(String(text || '').trim())
}

function isSourcesList(block) {
  if (!block || (block.type !== 'ul' && block.type !== 'ol')) return false
  if (!block.items || block.items.length === 0) return false
  const linkCount = block.items.filter((it) => /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/.test(it.text || '')).length
  return linkCount >= Math.min(block.items.length, 2)
}

/**
 * Blocks, in document order.
 *
 * Types: `p`, `h` (level, text), `code` (lang, file, text, open), `hr`,
 * `quote` (text), `callout` (kind, text), `ul`/`ol` (items, tasks),
 * `table` (head, rows), `article_carousel` (title, items).
 */
export function parseBlocks(src) {
  const lines = String(src ?? '').split('\n')
  const blocks = []
  let i = 0
  let para = []

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', text: para.join('\n') })
      para = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    const fence = readFence(line)
    if (fence) {
      flushPara()
      const body = []
      i += 1
      let closed = false
      while (i < lines.length) {
        const end = readFence(lines[i])
        // A closing fence is the same character, at least as long, and carries
        // no info string of its own.
        if (end && end.marker[0] === fence.marker[0]
          && end.marker.length >= fence.marker.length && !end.info) {
          closed = true
          i += 1
          break
        }
        body.push(lines[i])
        i += 1
      }
      blocks.push({ type: 'code', ...readInfo(fence.info), text: body.join('\n'), open: !closed })
      continue
    }

    if (!line.trim()) { flushPara(); i += 1; continue }

    const heading = HEADING.exec(line)
    if (heading) {
      flushPara()
      blocks.push({ type: 'h', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    if (RULE.test(line)) { flushPara(); blocks.push({ type: 'hr' }); i += 1; continue }

    if (QUOTE.test(line)) {
      flushPara()
      const body = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])[1])
        i += 1
      }
      const head = CALLOUT_HEAD.exec(body[0] || '')
      const kind = head && head[1].toLowerCase()
      if (kind && CALLOUTS.has(kind)) {
        blocks.push({ type: 'callout', kind, text: body.slice(1).join('\n').trim() })
      } else {
        blocks.push({ type: 'quote', text: body.join('\n') })
      }
      continue
    }

    if (BULLET.test(line)) {
      flushPara()
      const [list, next] = readList(lines, i, BULLET.exec(line)[1].length)
      blocks.push(list)
      i = next
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara()
      const head = cells(line)
      const rows = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(normalizeRow(cells(lines[i]), head.length))
        i += 1
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    para.push(line)
    i += 1
  }

  flushPara()

  // Consolidate consecutive pure-image paragraphs into unified galleries
  const withGalleries = []
  let pendingGallery = []

  const flushGallery = () => {
    if (pendingGallery.length > 0) {
      withGalleries.push({ type: "gallery", items: pendingGallery })
      pendingGallery = []
    }
  }

  for (const b of blocks) {
    const images = extractImagesFromBlock(b)
    if (images) {
      pendingGallery.push(...images)
    } else {
      flushGallery()
      withGalleries.push(b)
    }
  }
  flushGallery()

  // Consolidate terminal or designated sources/coverage sections into article carousel
  const consolidated = []
  for (let j = 0; j < withGalleries.length; j++) {
    const curr = withGalleries[j]
    const next = withGalleries[j + 1]
    if (curr.type === 'h' && isSourcesHeading(curr.text) && next && isSourcesList(next)) {
      const allItems = [...next.items]
      let offset = 1
      while (j + offset + 1 < withGalleries.length && isSourcesList(withGalleries[j + offset + 1])) {
        allItems.push(...withGalleries[j + offset + 1].items)
        offset += 1
      }
      consolidated.push({
        type: 'article_carousel',
        title: curr.text,
        items: parseArticleItems(allItems),
      })
      j += offset
      continue
    }
    consolidated.push(curr)
  }

  return consolidated
}

/**
 * Replace a segment of selected text in raw Markdown.
 *
 * When a user selects text in the rendered HTML view, markdown formatting
 * tokens (such as `### `, `**`, `*`, `_`, `~~`, list markers) are stripped by
 * the browser's DOM text extraction. Direct substring replacement fails on any
 * formatted or block-level passage. This finds the corresponding span in the
 * markdown source and replaces it while preserving untouched structure.
 */
export function replaceSelectedInMarkdown(markdown, selectedText, replacement) {
  if (!markdown || !selectedText) return markdown
  if (markdown.includes(selectedText)) {
    return markdown.replace(selectedText, replacement)
  }

  const words = selectedText.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return markdown

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedWords = words.map(escapeRegExp)

  // Allow markdown formatting markers, links, tags, and whitespace between words
  const sep = '[\\s*_#`>~\\-\\[\\]():]*'
  try {
    const regex = new RegExp(escapedWords.join(sep), 'i')
    const match = regex.exec(markdown)
    if (match) {
      let start = match.index
      let end = start + match[0].length

      // Expand to include leading heading hashes on the same line if selected from near line start
      const lineStart = markdown.lastIndexOf('\n', start) + 1
      const prefix = markdown.slice(lineStart, start)
      if (/^\s*#{1,6}\s*$/.test(prefix)) {
        start = lineStart
      }

      // Expand to include trailing markdown emphasis markers on the same line
      const nextNewline = markdown.indexOf('\n', end)
      const lineEnd = nextNewline === -1 ? markdown.length : nextNewline
      const suffix = markdown.slice(end, lineEnd)
      if (/^\s*[*_~]+\s*$/.test(suffix)) {
        end = lineEnd
      }

      return markdown.slice(0, start) + replacement + markdown.slice(end)
    }
  } catch {
    // Fall back to direct replacement
  }
  return markdown.replace(selectedText, replacement)
}
