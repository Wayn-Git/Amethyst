import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import * as remote from '../../lib/sync/remote.js'
import * as syncClient from '../../lib/sync/client.js'

export default function RemoteAgent() {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [confirmations, setConfirmations] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [tick, setTick] = useState(0)

  const refreshTick = useCallback(() => setTick((n) => n + 1), [])

  // Sync event listener
  useEffect(() => {
    const onChange = () => refreshTick()
    window.addEventListener('amethyst:synced', onChange)
    return () => window.removeEventListener('amethyst:synced', onChange)
  }, [refreshTick])

  // Load conversations from synced replica or API
  useEffect(() => {
    const list = remote.conversations() || []
    setConversations(list)
    if (!activeId && list.length > 0) {
      setActiveId(list[0].id)
    }
  }, [tick, activeId])

  // Poll for pending agent confirmations
  const checkConfirmations = useCallback(async () => {
    try {
      const list = await api.confirmations()
      setConfirmations(Array.isArray(list) ? list : [])
    } catch {}
  }, [])

  useEffect(() => {
    checkConfirmations()
    const int = setInterval(checkConfirmations, 3000)
    return () => clearInterval(int)
  }, [checkConfirmations])

  const transcript = useMemo(() => (activeId ? remote.messages(activeId) : []), [activeId, tick])
  const phase = useMemo(() => (activeId ? remote.runPhase(activeId) : null), [activeId, tick])
  const pendingIntents = useMemo(
    () => (activeId ? remote.asked().filter((a) => (a.state === 'pending' || a.state === 'accepted') && (a.payload?.conversation_id === activeId || a.conversationId === activeId)) : []),
    [activeId, tick],
  )

  const startNewConversation = () => {
    const id = remote.start('Mobile companion')
    if (id) {
      setActiveId(id)
      refreshTick()
      syncClient.sync().catch(() => {})
    }
  }

  const stopTurn = () => {
    if (!activeId) return
    remote.stop(activeId)
    refreshTick()
    syncClient.sync().catch(() => {})
  }

  const sendMessage = async () => {
    const body = text.trim()
    if (!body || !activeId) return
    setSending(true)
    remote.ask(activeId, body)
    setText('')
    refreshTick()
    await syncClient.sync().catch(() => {})
    setSending(false)
  }

  const decideConfirmation = async (id, allow) => {
    try {
      await api.decideConfirmation(id, { allow, remember: false })
      setConfirmations((prev) => prev.filter((c) => c.id !== id))
    } catch {}
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '80vh', padding: '12px 10px' }}>
      {/* 1. Pending Tool Approvals Banner */}
      {confirmations.length > 0 && (
        <div
          style={{
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            borderRadius: 8,
            padding: '12px',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: '#eab308', fontWeight: 700, fontSize: 13 }}>
            <Icon name="alert-triangle" size={16} />
            Agent Tool Approval Requested
          </div>
          {confirmations.map((item) => (
            <div key={item.id} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{item.operation || 'Tool Execution'}</div>
              <div style={{ color: 'var(--text-sub)', margin: '2px 0 8px' }}>
                {item.reason || item.description || JSON.stringify(item.arguments || {})}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="set-btn-sm"
                  onClick={() => decideConfirmation(item.id, false)}
                  style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', padding: '4px 12px' }}
                >
                  Deny
                </button>
                <button
                  type="button"
                  className="pair-go"
                  onClick={() => decideConfirmation(item.id, true)}
                  style={{ padding: '4px 16px', fontSize: 12 }}
                >
                  Allow Tool Call
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2. Conversations Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
        <button
          type="button"
          className="set-btn-sm"
          onClick={startNewConversation}
          style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
        >
          <Icon name="plus" size={14} />
          New Chat
        </button>
        {conversations.map((conv) => (
          <button
            key={conv.id}
            type="button"
            className={`rc-tab${conv.id === activeId ? ' is-active' : ''}`}
            onClick={() => setActiveId(conv.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: conv.id === activeId ? 'var(--accent)' : 'var(--bg-inset)',
              color: conv.id === activeId ? '#fff' : 'var(--text-sub)',
              border: '1px solid var(--hairline-strong)',
              fontSize: 12,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {conv.title || 'Untitled'}
          </button>
        ))}
      </div>

      {/* 3. Messages Thread */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginBottom: 12,
          maxHeight: '52vh',
        }}
      >
        {transcript.length === 0 && pendingIntents.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '32px 16px', fontSize: 13 }}>
            <Icon name="chat" size={32} />
            <div style={{ marginTop: 8 }}>Send a message or instruction to your computer&rsquo;s agent.</div>
          </div>
        ) : (
          transcript.map((msg) => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: 8,
                background: msg.role === 'user' ? 'var(--accent, #6366f1)' : 'rgba(255,255,255,0.06)',
                color: msg.role === 'user' ? '#fff' : 'var(--text)',
                fontSize: 13,
                wordBreak: 'break-word',
              }}
            >
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>{msg.role}</div>
              <div>{msg.content}</div>
            </div>
          ))
        )}

        {/* Machine Running Phase */}
        {phase && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 6,
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid var(--accent)',
              fontSize: 12,
              color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="pair-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
              <span>{phase}…</span>
            </div>
            <button
              type="button"
              className="set-btn-sm"
              onClick={stopTurn}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', padding: '2px 8px', fontSize: 11 }}
            >
              Stop
            </button>
          </div>
        )}

        {/* Queued Intents */}
        {pendingIntents.map((intent) => (
          <div
            key={intent.id}
            style={{
              alignSelf: 'flex-end',
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(99, 102, 241, 0.2)',
              fontSize: 12,
              color: 'var(--text)',
              fontStyle: 'italic',
            }}
          >
            {intent.payload?.text} · {intent.state === 'accepted' ? 'executing on PC' : 'queued'}
          </div>
        ))}
      </div>

      {/* 4. Composer */}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          rows={2}
          className="pair-input"
          placeholder="Instruct Amethyst agent on your PC…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendMessage()
            }
          }}
          style={{ flex: 1, resize: 'none', fontSize: 13, padding: '8px 10px' }}
        />
        <button
          type="button"
          className="pair-go"
          onClick={sendMessage}
          disabled={sending || !text.trim() || !activeId}
          style={{ padding: '0 16px', display: 'grid', placeItems: 'center' }}
        >
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  )
}
