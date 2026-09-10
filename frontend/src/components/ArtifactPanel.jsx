import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import Icon from './Icon.jsx'
import Markdown from './markdown/Markdown.jsx'
import { FadeScrollArea } from './ui/skiper/index.js'

/* What the agent wrote, while it is writing it.

   The backend has streamed artifacts since `create_artifact` shipped --
   `artifact_open` before the write, `artifact_delta` with the content,
   `artifact_done` once the file is on disk -- and the frontend dropped all
   three into `console.warn` as unhandled frames. This is the other end of that
   stream.

   Two readings of one document. `Preview` is the artifact as the thing it
   claims to be: Markdown rendered, HTML in a sandboxed frame, an image shown.
   `Code` is the bytes, numbered. Anything with no meaningful preview -- a CSV,
   a patch, a shell script -- opens on Code and does not offer the tab, because
   a Preview tab that shows the same monospace text as Code is a lie about
   having two views. */

/* Reveal a document as it is written, even when it does not arrive that way.

   The stream's shape is already the streaming shape -- `artifact_open`, deltas,
   `artifact_done` -- but today the server knows the whole document before it
   dispatches the tool, so all of it comes in a single delta and the panel would
   otherwise blink from empty to finished. This paces the reveal instead: the
   text is real from the first frame, and what changes is how much of it has
   been uncovered.

   Paced by time, not by character, so a 200-byte note and a 12kB file both
   finish in about the same beat rather than the long one taking a minute.

   Triggered by text arriving rather than by the streaming flag: the flag is set
   and cleared inside a single tool dispatch, so by the time the content is on
   screen it is already false. What this actually watches for is the same
   document getting longer than it was a frame ago. Switching to a different
   artifact shows it whole -- opening a file that already exists should not
   perform it being typed. */
/* How long the reveal takes, scaled by how much there is to reveal.

   Whether a document arrives in pieces is the provider's decision, not ours.
   The adapter emits every fragment it is given, and the panel renders each one
   -- but groq and nvidia both send a tool call's arguments in a single SSE
   frame, so on those the whole file lands at once and there is nothing to
   watch. This is what makes it look like writing anyway.

   A flat duration made a two-line note crawl and a long document flash past at
   the same speed. Scaling by length keeps the *rate* roughly steady instead,
   with a floor so something short still registers and a ceiling so something
   long does not outstay its welcome. */
const REVEAL_MIN_MS = 450
const REVEAL_MAX_MS = 2600
const REVEAL_CHARS_PER_MS = 2.2

function revealDuration(length) {
  return Math.min(REVEAL_MAX_MS, Math.max(REVEAL_MIN_MS, length / REVEAL_CHARS_PER_MS))
}

function useTypedReveal(text, id, fresh) {
  const reduced = useReducedMotion()
  // A document that is already new on the very first paint starts from nothing;
  // one being browsed starts whole.
  const [shown, setShown] = useState(fresh && !reduced ? 0 : text.length)
  const seen = useRef({ id, length: fresh && !reduced ? 0 : text.length })
  const frame = useRef(0)

  useEffect(() => {
    const prev = seen.current

    /* A different document is not a document being written -- switching to one
       already on disk should show it, not perform it. */
    if (prev.id !== id) {
      const from = fresh && !reduced ? 0 : text.length
      seen.current = { id, length: from }
      setShown(from)
      if (from === text.length) return undefined
      prev.length = from
      prev.id = id
    }

    // Same document, no more text than last time: nothing arrived.
    if (text.length <= prev.length || reduced) {
      seen.current = { id, length: text.length }
      setShown(text.length)
      return undefined
    }

    const from = prev.length
    const to = text.length
    seen.current = { id, length: to }

    const startedAt = performance.now()
    const span = revealDuration(to - from)
    const tick = () => {
      const ratio = Math.min(1, (performance.now() - startedAt) / span)
      // Ease out, so it slows into place rather than stopping dead.
      const eased = 1 - (1 - ratio) ** 2
      setShown(Math.round(from + (to - from) * eased))
      if (ratio < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [text, id, fresh, reduced])

  return text.slice(0, Math.min(shown, text.length))
}

/* What kind of document this is, in two or three letters. The language the
   server decided, or the extension, or the media type's subtype -- in that
   order, because each is a better answer than the next. */
export function fileKind(artifact) {
  const language = (artifact?.language || '').trim()
  if (language) return language.toUpperCase()
  const ext = String(artifact?.path || '').split('.').pop()
  if (ext && ext.length <= 4 && !ext.includes('/')) return ext.toUpperCase()
  const sub = String(artifact?.media_type || '').split('/').pop()
  return (sub || 'file').toUpperCase()
}

/* Save the document to disk.

   A Blob and an object URL, because the bytes are already here -- asking the
   server to serve back a file the panel is currently displaying would be a
   round trip for nothing. The URL is revoked on the next frame; leaving it
   alive holds the whole document in memory for the life of the tab. */
export function download(artifact, text) {
  const name = String(artifact?.path || artifact?.title || 'document').split('/').pop() || 'document'
  const blob = new Blob([text], { type: `${artifact?.media_type || 'text/plain'};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

/* Keep the end of a path, not the start. `/home/wayne/Documents/GitHub/pkos/`
   is the same on every row and the filename is the part being read, so the
   head is what gets dropped. Doing this in CSS with `direction: rtl` looked
   right until a path came back reading `home/…/pricing.md/` -- the bidi
   algorithm moves the leading slash to the other end. */
function tailPath(path, keep = 3) {
  const parts = String(path).split('/').filter(Boolean)
  if (parts.length <= keep) return path
  return `…/${parts.slice(-keep).join('/')}`
}

// What kind of preview, if any, this artifact supports. Media type first: it is
// what the server decided, and the extension is only a fallback for rows that
// predate it.
export function previewKind(artifact) {
  const media = artifact?.media_type || ''
  const language = (artifact?.language || '').toLowerCase()
  if (media.startsWith('image/')) return 'image'
  if (media === 'text/html' || language === 'html') return 'html'
  if (media === 'text/markdown' || language === 'markdown' || language === 'md') return 'markdown'
  return null
}

function LineNumbers({ text, writing }) {
  // One span per line rather than a counter on `pre`: the gutter has to line up
  // with wrapped content, and a CSS counter cannot see a soft wrap.
  const lines = useMemo(() => text.split('\n'), [text])
  return (
    <div className="artifact-code" role="region" tabIndex={0} aria-label="Artifact source">
      <pre className="artifact-code-gutter" aria-hidden="true">
        {lines.map((_, i) => `${i + 1}\n`).join('')}
      </pre>
      <pre className="artifact-code-text">
        {text}
        {/* The caret is the whole effect. A document arriving with a cursor at
            the end of it reads as being written; the same text arriving without
            one reads as having been pasted. */}
        {writing && <span className="artifact-caret" aria-hidden="true" />}
      </pre>
    </div>
  )
}

function Preview({ artifact, text }) {
  const kind = previewKind(artifact)

  if (kind === 'image') {
    return (
      <div className="artifact-preview artifact-preview--image">
        {/* The bytes never came through the stream for an image, so this is the
            path on disk and only resolves when the API can serve it. */}
        <p className="artifact-note">
          <Icon name="image" size={13} />
          <span className="mono">{artifact.path}</span>
        </p>
      </div>
    )
  }

  if (kind === 'html') {
    return (
      /* Sandboxed with nothing granted. The agent wrote this file; it is not
         the agent's page, and it does not get script, forms, or same-origin
         access to the app it is being previewed inside. */
      <iframe
        className="artifact-preview artifact-preview--frame"
        title={artifact.title || 'Artifact preview'}
        sandbox=""
        srcDoc={text}
      />
    )
  }

  return (
    <div className="artifact-preview artifact-preview--doc">
      <Markdown text={text} />
    </div>
  )
}

export default function ArtifactPanel({
  artifacts, activeId, onSelect, streamingId, freshId, expanded, onToggleExpand,
}) {
  const active = artifacts.find((a) => a.id === activeId) || artifacts[0] || null
  const kind = previewKind(active)
  const [tab, setTab] = useState(() => (kind ? 'preview' : 'code'))
  // Whether the reader has picked a view for this document themselves. Until
  // they have, the panel is free to choose one for them.
  const [touched, setTouched] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  // Which action just fired, so its icon can confirm it for a moment. Copying
  // is otherwise completely silent -- you press it and nothing happens.
  const [flashed, setFlashed] = useState(null)
  const bodyRef = useRef(null)

  const flash = useCallback((what) => {
    setFlashed(what)
    setTimeout(() => setFlashed((f) => (f === what ? null : f)), 1100)
  }, [])

  // A different artifact is a different document, so the tab resets to what
  // that one can show rather than carrying the last one's choice.
  useEffect(() => {
    setTab(previewKind(active) ? 'preview' : 'code')
    setTouched(false)
    setListOpen(false)
  }, [active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Follow the write. While the deltas are arriving the useful view is the end
     of the file, the same way a log tails -- but only while it is streaming,
     because yanking the scroll on a document someone is reading is the bug
     this exists to avoid. */
  const streaming = Boolean(active && active.id === streamingId)
  const full = active?.text ?? ''

  /* Before the early return: how many hooks a component runs cannot depend on
     whether it has anything to show. */
  const text = useTypedReveal(full, active?.id, active?.id === freshId)

  /* Actual bytes, not characters. The server counts `len(content)`, which in
     Python is characters, and a document full of curly quotes is measurably
     longer on disk than on screen -- 2,638 characters came to 2,654 bytes. The
     label says B, so it should mean it. */
  const bytes = useMemo(() => new TextEncoder().encode(full).length, [full])

  useEffect(() => {
    const el = bodyRef.current
    if (!streaming || !el) return
    el.scrollTop = el.scrollHeight
  }, [text, streaming])

  if (!active) {
    return (
      <p className="wb-panel-empty">
        Nothing written yet. Documents the agent creates open here as it writes them,
        with the source alongside.
      </p>
    )
  }

  // Still uncovering counts as still being written, so the caret stays.
  const writing = streaming || text.length < full.length
  /* Watching a document be typed only works on the source. A half-written
     Markdown table rendered as a table is a picture of a document that does not
     exist yet, and it reflows on every frame. So the source is what is shown
     while it is being written, and the preview is what it settles into --
     unless the reader has already said which they want. */
  const showing = writing && !touched ? 'code' : tab

  return (
    <div className="artifact">
      {/* One toolbar, in the order the eye reads it: which view, which
          document, what you can do with it. The two views are icons rather than
          words because they are a switch you flip, not a label you read -- and
          it leaves the row wide enough for the filename to be the thing that
          gets the space. */}
      <div className="artifact-head">
        <div className="artifact-views" role="tablist" aria-label="How to show this document">
          {(kind ? ['preview', 'code'] : ['code']).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={showing === name}
              className={`artifact-view-btn${showing === name ? ' is-active' : ''}`}
              onClick={() => { setTab(name); setTouched(true) }}
              title={name === 'preview' ? 'Rendered' : 'Source'}
              aria-label={name === 'preview' ? 'Show it rendered' : 'Show the source'}
            >
              {showing === name && (
                <motion.span
                  layoutId="artifact-view-pill"
                  className="artifact-view-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                />
              )}
              <Icon name={name === 'preview' ? 'eye' : 'code'} size={14} className="artifact-view-icon" />
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`artifact-switch${listOpen ? ' is-open' : ''}`}
          onClick={() => artifacts.length > 1 && setListOpen((o) => !o)}
          disabled={artifacts.length < 2}
          aria-expanded={artifacts.length > 1 ? listOpen : undefined}
          title={active.path}
        >
          <span className="artifact-title">{active.title || tailPath(active.path, 1)}</span>
          <span className="artifact-kind">{fileKind(active)}</span>
          {active.version > 1 && <span className="artifact-version">v{active.version}</span>}
          {artifacts.length > 1 && <Icon name="chevron" size={11} className="artifact-switch-caret" />}
        </button>

        <div className="artifact-actions">
          <button
            type="button"
            className="artifact-act"
            onClick={() => { navigator.clipboard?.writeText(full); flash('copy') }}
            title="Copy the source"
            aria-label="Copy the source"
          >
            <Icon name={flashed === 'copy' ? 'check' : 'copy'} size={14} />
          </button>
          <button
            type="button"
            className="artifact-act"
            onClick={() => download(active, full)}
            title={`Download ${active.title || 'this document'}`}
            aria-label="Download this document"
          >
            <Icon name="download" size={14} />
          </button>
          <button
            type="button"
            className={`artifact-act${expanded ? ' is-on' : ''}`}
            onClick={onToggleExpand}
            title={expanded ? 'Back to the panel' : 'Fill the window'}
            aria-label={expanded ? 'Back to the panel' : 'Fill the window'}
            aria-pressed={expanded}
          >
            <Icon name={expanded ? 'collapse' : 'expand'} size={14} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {listOpen && (
        <motion.div
          className="artifact-list"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`artifact-list-row${a.id === active.id ? ' is-active' : ''}`}
              onClick={() => { onSelect(a.id); setListOpen(false) }}
              title={a.path}
            >
              <Icon name="page" size={13} />
              <span className="artifact-list-name">{a.title || a.path}</span>
              {a.version > 1 && <span className="artifact-version">v{a.version}</span>}
            </button>
          ))}
        </motion.div>
        )}
      </AnimatePresence>

      {active.error && (
        <p className="artifact-note artifact-note--bad">
          <Icon name="alert" size={13} />
          <span>{active.error}</span>
        </p>
      )}
      {active.missing && (
        <p className="artifact-note artifact-note--bad">
          <Icon name="alert" size={13} />
          <span>{active.missing}</span>
        </p>
      )}

      <FadeScrollArea
        className={`artifact-body${writing ? ' is-writing' : ''}`}
        scrollRef={bodyRef}
        fadeHeight={22}
      >
        {/* Crossfade between the two readings of the document. `mode="wait"`
            so the outgoing view is gone before the incoming one measures --
            two documents in the same box at once would fight over the scroll. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${active.id}:${showing}`}
            className="artifact-view"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {showing === 'preview' && kind
              ? <Preview artifact={active} text={text} />
              : <LineNumbers text={text} writing={writing} />}
          </motion.div>
        </AnimatePresence>
      </FadeScrollArea>

      <div className="artifact-foot">
        <span className="mono artifact-path" title={active.path}>{tailPath(active.path)}</span>
        <span className="mono artifact-bytes">
          {writing
            ? <span className="artifact-writing">writing<span className="ellipsis"><i /><i /><i /></span></span>
            : `${bytes.toLocaleString()} B`}
        </span>
      </div>
    </div>
  )
}
