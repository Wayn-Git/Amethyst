import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { saveCapture, flushCaptures } from '../captures.js'
import { api } from '../../api.js'

export default function MobileQuickCapture({ open, onClose, isOnline, onSaved }) {
  const [target, setTarget] = useState('library') // 'library' | 'task' | 'agent'
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')

  if (!open) return null

  const handleSend = async (e) => {
    e.preventDefault()
    if (!title.trim() && !url.trim() && !notes.trim()) return

    setSending(true)
    setNotice('')

    try {
      const payload = {
        title: title.trim() || 'Untitled capture',
        url: url.trim(),
        text: notes.trim(),
        destination: target,
      }

      if (target === 'task') {
        try {
          await api.createTask({
            title: payload.title,
            notes: `${payload.url ? payload.url + '\n' : ''}${payload.text}`,
            status: 'todo',
            context: 'Quick capture',
          })
        } catch {
          await saveCapture(payload)
        }
      } else {
        await saveCapture(payload)
        await flushCaptures().catch(() => {})
      }

      if (onSaved) onSaved()
      onClose()
    } catch (err) {
      setNotice(`Failed to save: ${err.message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="s"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 150,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          maxWidth: 480,
          margin: '0 auto',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        {/* Bottom Sheet */}
        <motion.div
          style={{
            background: '#FFFFFF',
            borderRadius: '32px 32px 0 0',
            padding: '24px 20px 40px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="r sp">
            <div className="ttl" style={{ fontSize: 18 }}>
              Send to Amethyst
            </div>
            <button
              type="button"
              className="ib"
              style={{ width: 36, height: 36, background: '#F2F2F7', boxShadow: 'none' }}
              aria-label="Close"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          {/* Destination Segmented Control */}
          <div className="seg">
            <span
              className={target === 'library' ? 'on' : ''}
              onClick={() => setTarget('library')}
            >
              Save to Library
            </span>
            <span
              className={target === 'task' ? 'on' : ''}
              onClick={() => setTarget('task')}
            >
              New Task
            </span>
            <span
              className={target === 'agent' ? 'on' : ''}
              onClick={() => setTarget('agent')}
            >
              Ask Agent
            </span>
          </div>

          {/* Inputs Form */}
          <form onSubmit={handleSend} className="col" style={{ gap: 10 }}>
            <input
              className="in"
              style={{
                background: '#F2F2F7',
                borderRadius: 14,
                padding: '0 16px',
                fontSize: 15,
                fontWeight: 500,
              }}
              placeholder={target === 'task' ? 'Task title…' : 'Title / Topic…'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />

            {target !== 'task' && (
              <input
                className="in"
                style={{
                  background: '#F2F2F7',
                  borderRadius: 14,
                  padding: '0 16px',
                  fontSize: 14,
                }}
                placeholder="URL (optional, https://…)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}

            <textarea
              placeholder={
                target === 'task'
                  ? 'Task notes or context…'
                  : target === 'agent'
                    ? 'What would you like the agent to do with this?'
                    : 'Notes or private summary…'
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                background: '#F2F2F7',
                border: 0,
                borderRadius: 14,
                padding: '12px 16px',
                fontFamily: 'inherit',
                fontSize: 14,
                outline: 0,
                resize: 'none',
                minHeight: 80,
                color: '#1D1D1F',
              }}
            />

            {notice && (
              <div className="m" style={{ color: '#DC2626' }}>
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={sending || (!title.trim() && !url.trim() && !notes.trim())}
              className="bt l"
              style={{ width: '100%', marginTop: 6 }}
            >
              {sending ? 'Saving…' : 'Send'}
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
