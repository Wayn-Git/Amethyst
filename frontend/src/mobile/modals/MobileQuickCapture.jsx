import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
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
        // Direct task creation if connected
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
        // Save to durable mobile capture queue
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
        className="m-shell"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 150,
          background: '#2C2A27',
          display: 'flex',
          flexDirection: 'column',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Top Header & Graphic Area (Concentric rings) */}
        <div style={{ flex: 1, padding: '20px 20px 10px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              type="button"
              className="m-ib"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
              aria-label="Close"
              onClick={onClose}
            >
              <Icon name="x" size={20} />
            </button>
          </div>
          <div
            style={{
              width: '100%',
              flex: 1,
              maxHeight: 260,
              borderRadius: 28,
              background: '#111113',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 100 100" width="85%" height="85%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <circle cx="50" cy="50" r="12" fill="none" stroke="#D6F23E" strokeWidth="2" />
              <circle cx="50" cy="50" r="24" fill="none" stroke="#D6F23E" strokeWidth="2" />
              <circle cx="50" cy="50" r="36" fill="none" stroke="#D6F23E" strokeWidth="2" />
              <circle cx="50" cy="50" r="48" fill="none" stroke="#D6F23E" strokeWidth="2" />
            </svg>
          </div>
        </div>

        {/* Bottom Sheet */}
        <motion.div
          style={{
            background: '#F6F4F1',
            borderRadius: '32px 32px 0 0',
            padding: '22px 20px 36px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
          initial={{ y: 80 }}
          animate={{ y: 0 }}
          exit={{ y: 80 }}
        >
          {/* Header */}
          <div className="m-r m-sp">
            <h1 className="m-h" style={{ fontSize: 24 }}>
              Send to Amethyst
            </h1>
            <button
              type="button"
              className="m-m"
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 14 }}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>

          {/* Input Card */}
          <div
            className="m-col"
            style={{
              background: '#ECEAE6',
              borderRadius: 20,
              padding: 12,
              gap: 8,
            }}
          >
            <div className="m-r" style={{ gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: '#D6F23E',
                  overflow: 'hidden',
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={target === 'task' ? 'check-circle' : target === 'agent' ? 'chat' : 'book'} size={22} />
              </div>
              <input
                className="m-in"
                style={{ fontWeight: 600, fontSize: 15 }}
                placeholder="Title or headline…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            <input
              className="m-in"
              style={{ fontSize: 13, minHeight: 36, padding: '0 8px' }}
              placeholder="URL link (optional)…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />

            <textarea
              className="m-in"
              style={{
                fontSize: 13,
                minHeight: 50,
                padding: '4px 8px',
                resize: 'none',
              }}
              placeholder="Notes or excerpt (optional)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Destination Selector Chips */}
          <div className="m-r" style={{ gap: 8 }}>
            {[
              ['library', 'Library'],
              ['task', 'Task'],
              ['agent', 'Ask agent'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`m-ch ${target === id ? 'on' : ''}`}
                onClick={() => setTarget(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Online/Offline status line */}
          <div className="m-r" style={{ gap: 12 }}>
            <span className={`m-d ${isOnline ? '' : 'w'}`} />
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>
                {isOnline ? 'Desktop is connected' : 'PC is offline'}
              </div>
              <div className="m-m">
                {isOnline ? 'Will sync instantly with your PC.' : 'It will be sent when your PC is back.'}
              </div>
            </div>
          </div>

          {notice && (
            <div style={{ fontSize: 12, color: '#ef4444' }}>
              {notice}
            </div>
          )}

          {/* Send Button */}
          <button
            type="button"
            disabled={sending || (!title.trim() && !url.trim() && !notes.trim())}
            className="m-bt l"
            style={{
              justifyContent: 'space-between',
              width: '100%',
              minHeight: 52,
              fontSize: 15,
            }}
            onClick={handleSend}
          >
            <span>{sending ? 'Sending…' : 'Send'}</span>
            <Icon name="arrow-right" size={20} />
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
