import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

function parseSender(from) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from || '')
  if (!match) return { name: (from || '').trim() || 'Unknown', address: '' }
  return { name: match[1].trim() || match[2].trim(), address: match[2].trim() }
}

function formatWhen(value) {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  const now = new Date()
  const sameDay = at.toDateString() === now.toDateString()
  return sameDay
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/**
 * Recent Mails Card:
 * - Shows user's recent emails per reference image layout
 * - Clicking a mail opens it within the card (in-card reader, not separate page)
 * - Each mail entry has a remove/dismiss action
 * - Fixed permanent size, internal scroll
 * - Empty state: "No mails yet."
 */
export default function TodayMailsCard({ toast }) {
  const [mails, setMails] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMail, setSelectedMail] = useState(null)
  const [threadDetail, setThreadDetail] = useState(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [dismissedIds, setDismissedIds] = useState(new Set())

  const loadMails = useCallback(async () => {
    setLoading(true)
    try {
      const threads = await api.mailThreads({ q: 'in:inbox', limit: 20 })
      setMails(Array.isArray(threads) ? threads : [])
    } catch {
      // Degraded or not signed in
      setMails([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMails()
  }, [loadMails])

  const handleOpenMail = async (mail) => {
    setSelectedMail(mail)
    setLoadingThread(true)
    try {
      const thread = await api.mailThread(mail.id)
      setThreadDetail(thread)
    } catch {
      setThreadDetail(null)
    } finally {
      setLoadingThread(false)
    }
  }

  const handleDismiss = async (e, mail) => {
    e?.stopPropagation()
    setDismissedIds((prev) => new Set(prev).add(mail.id))
    try {
      // Attempt backend archive if supported
      await api.mailModifyLabels(mail.id, { remove: ['INBOX'] }).catch(() => {})
      toast?.('Mail dismissed', 'ok')
    } catch {
      toast?.('Mail dismissed', 'ok')
    }
    if (selectedMail?.id === mail.id) {
      setSelectedMail(null)
      setThreadDetail(null)
    }
  }

  const activeMails = mails.filter((m) => !dismissedIds.has(m.id))

  return (
    <section className="today-card">
      {/* Header */}
      <div className="today-card-head">
        <div className="today-card-title-group">
          <div className="today-card-icon-pill">
            <Icon name="mail" size={16} />
          </div>
          <h3 className="today-card-title">Recent Mails</h3>
          <span className="today-card-badge">
            {activeMails.length} {activeMails.length === 1 ? 'mail' : 'mails'}
          </span>
        </div>

        <div className="today-card-actions">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            style={{ borderRadius: 9999, padding: '4px 10px', fontSize: 12 }}
            onClick={loadMails}
            title="Refresh inbox"
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </div>

      {/* Internal Content Area */}
      <div className="today-card-scroll">
        <AnimatePresence mode="wait">
          {selectedMail ? (
            /* In-Card Mail Reader */
            <motion.div
              key="reader"
              className="today-mail-reader"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="today-mail-reader-nav">
                <button
                  type="button"
                  className="today-mail-reader-back"
                  onClick={() => {
                    setSelectedMail(null)
                    setThreadDetail(null)
                  }}
                >
                  <Icon name="arrow-left" size={14} /> Back to Mails
                </button>

                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6 }}
                  onClick={(e) => handleDismiss(e, selectedMail)}
                >
                  <Icon name="trash" size={13} /> Dismiss
                </button>
              </div>

              <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--hairline)' }}>
                <h4 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px 0' }}>
                  {selectedMail.subject || '(No subject)'}
                </h4>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{parseSender(selectedMail.from).name}</span>
                  <span style={{ color: 'var(--text-faint)' }}>{formatWhen(selectedMail.date)}</span>
                </div>
              </div>

              <div className="today-mail-reader-body">
                {loadingThread ? (
                  <p style={{ color: 'var(--text-faint)' }}>Loading mail content…</p>
                ) : (
                  threadDetail?.messages?.[0]?.body || selectedMail.snippet || 'No message content available.'
                )}
              </div>
            </motion.div>
          ) : activeMails.length === 0 ? (
            /* Empty State */
            <motion.div
              key="empty"
              className="today-card-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="today-empty-icon-wrap">
                <Icon name="mail" size={24} />
              </div>
              <div className="today-empty-title">No mails yet.</div>
              <div className="today-empty-desc">
                {loading ? 'Checking inbox…' : 'Your recent inbox messages will appear here when connected.'}
              </div>
            </motion.div>
          ) : (
            /* Mail List View */
            <motion.div
              key="list"
              className="today-mail-list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {activeMails.map((mail) => {
                const s = parseSender(mail.from)
                const initial = (s.name || 'M').charAt(0).toUpperCase()

                return (
                  <div
                    key={mail.id}
                    className="today-mail-row"
                    onClick={() => handleOpenMail(mail)}
                  >
                    {/* Avatar circle */}
                    <div className="today-mail-avatar">{initial}</div>

                    {/* Mail preview info */}
                    <div className="today-mail-main">
                      <div className="today-mail-top">
                        <span className="today-mail-sender">{s.name}</span>
                        <span className="today-mail-date">{formatWhen(mail.date)}</span>
                      </div>
                      <div className="today-mail-subject">
                        {mail.subject || '(No subject)'}
                      </div>
                      <div className="today-mail-snippet">
                        {mail.snippet}
                      </div>
                    </div>

                    {/* Dismiss Button */}
                    <button
                      type="button"
                      className="today-mail-dismiss-btn"
                      title="Dismiss mail"
                      aria-label="Dismiss mail"
                      onClick={(e) => handleDismiss(e, mail)}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
