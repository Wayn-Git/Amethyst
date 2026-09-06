import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import SidePanel from '../components/SidePanel.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api } from '../api.js'
import { MOD_LABEL } from '../keys.js'
import { SkeletonRows } from '../components/Skeleton.jsx'

/* Mail, as a place rather than as fifteen tools.

   The data does not come through the `google-gmail` connector. That connector
   answers in prose written for a model to read -- "📧 MESSAGES:", "Message ID:"
   -- and a screen built on it would be a regular expression over somebody
   else's help text. PSOK talks to Gmail directly using the account the
   connector signed in; see backend/mail/gmail.py.

   Bodies arrive as text. HTML mail is reduced to text on the server rather than
   rendered, because an inbox is the most hostile input this system has and a
   view that executes what arrives in it is a different feature with a different
   threat model. The page says when a message was reduced, so a mangled layout
   reads as a choice rather than as a bug. */

const BOXES = [
  { id: 'in:inbox', label: 'Inbox', icon: 'mail', blurb: 'What has arrived and not been filed.' },
  { id: 'is:unread', label: 'Unread', icon: 'mail-open', blurb: 'Everything still unopened.' },
  { id: 'is:starred', label: 'Starred', icon: 'star', blurb: 'Flagged, wherever it lives.' },
  { id: 'in:sent', label: 'Sent', icon: 'send', blurb: 'What you have sent.' },
  { id: 'in:anywhere', label: 'All mail', icon: 'archive', blurb: 'Including archived.' },
]

/* A From header is "Name <address>" often enough to be worth splitting, and
   "address" bare often enough that this must not lose it. */
function sender(from) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from || '')
  if (!match) return { name: (from || '').trim() || 'Unknown', address: '' }
  return { name: match[1].trim() || match[2].trim(), address: match[2].trim() }
}

function when(value) {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  const now = new Date()
  const sameDay = at.toDateString() === now.toDateString()
  return sameDay
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/* The reply box. Deliberately plain text: the send path composes a plain-text
   message, and offering formatting the wire does not carry would be a lie. */
function Reply({ threadId, onSent }) {
  const { toast } = useApp()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      await api.mailReply(threadId, body)
      setBody('')
      toast('Reply sent', 'ok')
      onSent()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mail-reply">
      <textarea
        value={body}
        rows={4}
        placeholder="Reply…"
        aria-label="Reply"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send() }
        }}
      />
      <div className="mail-reply-actions">
        <span className="empty-note"><kbd className="kbd">{MOD_LABEL}</kbd><kbd className="kbd">Enter</kbd> to send</span>
        <button
          type="button"
          className="btn btn--primary btn--small"
          disabled={busy || !body.trim()}
          onClick={send}
        >
          <Icon name="send" size={14} /> {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

/* The panel's second half: library items that point at this thread.

   A mail body carries links, and the library may already hold them -- captured
   from the phone, saved from the browser. Searching the library for each link
   is a query per panel, not per message: only the thread's first URL matters
   (the rest are usually the same page in different clothes), and one search
   answering nothing is the common case this must be cheap enough not to
   matter. */
function ThreadLibrary({ thread }) {
  const [items, setItems] = useState(null)

  const link = useMemo(() => {
    const body = (thread?.messages || []).map((m) => m.body || '').join('\n')
    return /https?:\/\/[^\s>)]+/.exec(body)?.[0] || null
  }, [thread])

  useEffect(() => {
    let cancelled = false
    setItems(null)
    if (!link) return undefined
    api.library({ q: link, limit: 5 })
      .then((data) => { if (!cancelled) setItems(data.items || []) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [link])

  if (!link) return null
  if (!items) return <p className="wb-panel-empty">Looking in the library for this link…</p>
  if (items.length === 0) return null
  return (
    <div className="mail-panel-lib">
      <div className="mail-panel-sub">In your library</div>
      {items.map((item) => (
        <div key={item.id} className="mail-panel-lib-item">
          <Icon name="link" size={13} />
          <span>{item.title}</span>
        </div>
      ))}
    </div>
  )
}

/* The Mail side of the shell's panel slot. Everything it shows is state the
   page already holds -- `rows`, `thread`, `account` -- so it is prop-driven
   rather than SSE-bound, and adding a view that wants the panel needs no new
   stream plumbing, only a consumer for SidePanel. */
function MailPanel({ thread, rows, account, compact }) {
  if (!thread || compact) return null

  const last = thread.messages?.[thread.messages.length - 1]
  if (!last) return null
  const who = sender(last.from)
  const history = rows.filter(
    (row) => row.thread_id !== thread.id && sender(row.from).address === who.address,
  )

  return (
    <SidePanel title="Thread" eyebrow="Mail" count={thread.messages?.length || 0} closeLabel="Hide the thread panel">
      <div className="mail-panel-who">
        <div className="mail-panel-sub">{who.name}</div>
        {who.address && <div className="mail-panel-address">{who.address}</div>}
        <div className="mail-panel-meta">
          {thread.messages?.length ?? 0} message{(thread.messages?.length ?? 0) === 1 ? '' : 's'}
          {account?.address ? ` · ${account.address}` : ''}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mail-panel-history">
          <div className="mail-panel-sub">Recent from this sender</div>
          {history.slice(0, 5).map((row) => (
            <div key={row.id} className="mail-panel-lib-item">
              <Icon name="mail" size={13} />
              <span>{row.subject}</span>
              <span className="mail-when">{when(row.date)}</span>
            </div>
          ))}
        </div>
      )}

      <ThreadLibrary thread={thread} />
    </SidePanel>
  )
}

export default function Mail() {
  const rootRef = useRef(null)
  const { toast, setView, compact } = useApp()
  const [box, setBox] = useState(BOXES[0].id)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [account, setAccount] = useState(null)
  const [labels, setLabels] = useState([])
  const [open, setOpen] = useState(null)
  const [thread, setThread] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  useViewEntrance(rootRef)

  const query = search.trim() || box

  // Which request is the current one. Typing in the search box fires a new
  // `load()` on every keystroke (below, debounced) and clicking through
  // mailboxes fires one per click -- an older response landing after a newer
  // one used to overwrite the rows for the box now showing with whatever the
  // previous query returned.
  const loadToken = useRef(0)

  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const [list, who, labels] = await Promise.all([
        api.mailThreads({ q: query, limit: 30 }),
        api.mailAccount(),
        // Unread for the rail badge. Independent of the box showing, so it
        // rides the same load rather than a timer of its own; a 409 here is
        // covered by the same "nobody is signed in" as the other two.
        api.mailLabels().catch(() => []),
      ])
      if (loadToken.current !== token) return
      setRows(list)
      setAccount(who)
      setLabels(labels)
      setError(null)
    } catch (err) {
      if (loadToken.current !== token) return
      // A 409 here is the ordinary "nobody is signed in" case and carries the
      // sentence the server wants shown, so it is the page's content rather
      // than a toast that disappears before it is read.
      setError(err.message)
      setRows([])
    } finally {
      if (loadToken.current === token) setLoaded(true)
    }
  }, [query])

  // Every keystroke firing a request is what makes the race above worth
  // hitting in practice; the debounce is what makes it rare, not the fix.
  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  // Mail never refreshed itself: one load on mount, one per click, and a
  // message that arrived while the page was open sat invisible until someone
  // pressed Refresh. The same visibility-gated poll the connectors page uses,
  // at a slower beat -- the connectors poll drives a 3s status screen; this
  // one only needs to be sooner than "the user looks and wonders".
  useEffect(() => {
    let cancelled = false
    const tick = () => { if (!cancelled) load() }
    let timer = null
    const start = () => { if (timer === null) timer = setInterval(tick, 15000) }
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null } }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
      else start()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  useEffect(() => {
    if (!open) { setThread(null); return undefined }
    let cancelled = false
    setThread(null)
    api.mailThread(open)
      .then((data) => { if (!cancelled) setThread(data) })
      .catch((err) => { if (!cancelled) toast(err.message, 'bad') })
    return () => { cancelled = true }
  }, [open, toast])

  const act = useCallback(async (message, patch, note) => {
    setBusyId(message.id)
    try {
      await api.mailModifyLabels(message.id, patch)
      if (note) toast(note, 'ok')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusyId(null)
    }
  }, [load, toast])

  const active = useMemo(
    () => BOXES.find((b) => b.id === box) || BOXES[0],
    [box],
  )

  return (
    <div className="view" ref={rootRef}>
      <div className="view-inner view-inner--wide">
        <header className="vheader" data-enter>
          <div>
            <h1>Mail</h1>
            <div className="vheader-sub">
              {account?.address
                ? `Reading ${account.address} straight from Gmail.${
                  account.others?.length
                    ? ` ${account.others.length} other account signed in — the agent's connector may pick it instead.`
                    : ''}`
                : 'Sign in to Gmail from Connectors and your mail appears here.'}
            </div>
          </div>
          <div className="vheader-actions">
            <button type="button" className="btn btn--ghost" onClick={load}>
              <Icon name="refresh" size={15} /> Refresh
            </button>
          </div>
        </header>

        <div className="task-layout" data-enter>
          <nav className="task-rail" aria-label="Mailboxes">
            <div className="task-rail-head"><span>Mailboxes</span></div>
            {BOXES.map((entry) => {
              // The unread badge, from the label counts Gmail itself states.
              // `is:unread` and the boxes like it have no label, so the badge
              // is shown only where one genuinely exists -- Inbox, not a
              // count of a search.
              const unread = entry.id === 'in:inbox'
                ? (labels.find((l) => l.id === 'INBOX')?.unread ?? 0)
                : 0
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`task-rail-row${!search && box === entry.id ? ' is-on' : ''}`}
                  aria-current={!search && box === entry.id}
                  onClick={() => { setSearch(''); setBox(entry.id); setOpen(null) }}
                >
                  <Icon name={entry.icon} size={15} />
                  <span className="task-rail-label">{entry.label}</span>
                  {unread > 0 && <span className="mail-unread-badge">{unread}</span>}
                </button>
              )
            })}
          </nav>

          <section className="task-pane">
            <div className="card card-pad">
              <div className="card-title">
                {search ? `Search: ${search}` : active.label} · {loaded ? rows.length : '—'}
              </div>
              <div className="task-pane-blurb">
                {search
                  ? 'Gmail search syntax — from:, subject:, has:attachment, older_than:7d.'
                  : active.blurb}
              </div>

              {/* The same search control the log uses. It was a bare `<input>`
                  with a width and a margin and no other styling, so it rendered
                  as the browser's default box in the middle of a designed page
                  — and had no way to clear itself. */}
              <div className="inline-search mail-search">
                <Icon name="search" size={13} />
                <input
                  value={search}
                  placeholder="Search mail — from:someone, subject:invoice"
                  aria-label="Search mail"
                  onChange={(e) => { setSearch(e.target.value); setOpen(null) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && search) { e.stopPropagation(); setSearch(''); setOpen(null) }
                  }}
                />
                {search && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Clear the search"
                    onClick={() => { setSearch(''); setOpen(null) }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>

              {!loaded && <SkeletonRows rows={6} controls={2} />}

              {loaded && error && (
                <div className="empty-state" style={{ padding: 18 }}>
                  <Icon name="alert" size={20} />
                  <div>
                    <div>{error}</div>
                    <div className="empty-actions">
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setView('capabilities')}
                      >
                        Open Connectors
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {loaded && !error && rows.length === 0 && (
                <div className="empty-state" style={{ padding: 18 }}>
                  <Icon name="check" size={20} />
                  {search ? 'Nothing matches that search.' : 'Nothing here.'}
                </div>
              )}

              {rows.map((row) => {
                const who = sender(row.from)
                const isOpen = open === row.thread_id
                return (
                  <div key={row.id} className={`server-row mail-row${row.unread ? ' mail-row--unread' : ''}`}>
                    <button
                      type="button"
                      className="mail-open"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : row.thread_id)}
                    >
                      <div className="mail-line">
                        <span className="mail-from">{who.name}</span>
                        <span className="mail-when">{when(row.date)}</span>
                      </div>
                      <div className="server-name mail-subject">{row.subject}</div>
                      <div className="server-target mail-snippet">{row.snippet}</div>
                    </button>

                    {/* Star/read/archive all call the same Gmail modify
                        scope Reply's send check guards two lines below --
                        gated the same way, on the account this sign-in
                        actually granted rather than assumed. */}
                    {account?.can_modify !== false && (
                      <div className="task-actions">
                        <button
                          type="button"
                          className={`icon-btn task-star${row.starred ? ' is-on' : ''}`}
                          disabled={busyId === row.id}
                          title={row.starred ? 'Unstar' : 'Star'}
                          aria-pressed={row.starred}
                          aria-label={`Star ${row.subject}`}
                          onClick={() => act(
                            row,
                            row.starred ? { remove: ['STARRED'] } : { add: ['STARRED'] },
                            row.starred ? 'Unstarred' : 'Starred',
                          )}
                        >
                          <Icon name="star" size={14} />
                        </button>
                        {row.unread && (
                          <button
                            type="button"
                            className="icon-btn"
                            disabled={busyId === row.id}
                            title="Mark read"
                            aria-label={`Mark ${row.subject} read`}
                            onClick={() => act(row, { remove: ['UNREAD'] }, 'Marked read')}
                          >
                            <Icon name="check" size={14} />
                          </button>
                        )}
                        {row.labels?.includes('INBOX') && (
                          <button
                            type="button"
                            className="icon-btn"
                            disabled={busyId === row.id}
                            title="Archive"
                            aria-label={`Archive ${row.subject}`}
                            onClick={() => act(row, { remove: ['INBOX'] }, 'Archived')}
                          >
                            <Icon name="archive" size={14} />
                          </button>
                        )}
                      </div>
                    )}

                    {isOpen && (
                      <div className="mail-thread">
                        {!thread && <SkeletonRows rows={2} controls={0} />}
                        {thread?.messages?.map((message) => (
                          <article key={message.id} className="mail-message">
                            <div className="mail-line">
                              <span className="mail-from">{sender(message.from).name}</span>
                              <span className="mail-when">{when(message.date)}</span>
                            </div>
                            <pre className="mail-body">{message.body || '(no text)'}</pre>
                            {message.body_from_html && (
                              <div className="empty-note">
                                This message was HTML; shown as text.
                              </div>
                            )}
                          </article>
                        ))}
                        {thread && account?.can_send && (
                          <Reply threadId={thread.id} onSent={load} />
                        )}
                        {thread && account && !account.can_send && (
                          <div className="empty-note">
                            This sign-in cannot send — add the send scope in the Google
                            console and sign in again.
                          </div>
                        )}
                       </div>
                     )}
                   </div>
                 )
               })}
             </div>
           </section>
         </div>
       </div>

      {/* The panel fills the shell's slot only when a thread is open and
          there is room for a fourth column. On a phone (`compact`) there is
          no slot, and the thread already renders inline above -- a lost panel
          would mean a lost thread, so the fallback is "not rendered at all"
          rather than a hidden duplicate. */}
      <MailPanel thread={thread} rows={rows} account={account} compact={compact} />
    </div>
  )
}
