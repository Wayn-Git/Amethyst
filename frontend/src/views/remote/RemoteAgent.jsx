import { Button as HouseButton, Textarea as HouseTextarea } from '../../components/ui/bento/index.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { AsciiSkeleton } from 'ascii-reveal'
import { api } from '../../api.js'
import * as remote from '../../lib/sync/remote.js'
import * as syncClient from '../../lib/sync/client.js'

export default function RemoteAgent({ onOpenDiagnostics, transportState }) {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [confirmations, setConfirmations] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [tick, setTick] = useState(0)
  const [collapsedThoughts, setCollapsedThoughts] = useState({})
  const messagesEndRef = useRef(null)

  const refreshTick = useCallback(() => setTick((n) => n + 1), [])

  // Sync event listener
  useEffect(() => {
    const onChange = () => refreshTick()
    window.addEventListener('amethyst:synced', onChange)
    return () => window.removeEventListener('amethyst:synced', onChange)
  }, [refreshTick])

  // Load conversations from synced replica
  useEffect(() => {
    const list = remote.conversations() || []
    setConversations(list)
    if (!activeId && list.length > 0) {
      setActiveId(list[0].id)
    }
  }, [tick, activeId])

  // Poll for pending agent confirmations safely
  const checkConfirmations = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    try {
      const list = await api.confirmations()
      setConfirmations(Array.isArray(list) ? list : [])
    } catch {
      // Direct LAN unreachable; ignore quietly
    }
  }, [])

  useEffect(() => {
    checkConfirmations()
    const int = setInterval(checkConfirmations, 6000)
    return () => clearInterval(int)
  }, [checkConfirmations])

  const transcript = useMemo(() => (activeId ? remote.messages(activeId) : []), [activeId, tick])
  const phase = useMemo(() => (activeId ? remote.runPhase(activeId) : null), [activeId, tick])
  const pendingIntents = useMemo(
    () => (activeId ? remote.asked().filter((a) => (a.state === 'pending' || a.state === 'accepted') && (a.payload?.conversation_id === activeId || a.conversationId === activeId)) : []),
    [activeId, tick],
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript.length, phase, pendingIntents.length])

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
    } catch {
      // If direct call fails, emit remote intent
      remote.ask(activeId, allow ? `/approve ${id}` : `/deny ${id}`)
      setConfirmations((prev) => prev.filter((c) => c.id !== id))
      await syncClient.sync().catch(() => {})
    }
  }

  const toggleThought = (msgId) => {
    setCollapsedThoughts((prev) => ({ ...prev, [msgId]: !prev[msgId] }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '80vh', padding: '8px 4px' }}>
      {/* 1. Pending Tool Approvals Cards (Happy Style) */}
      {confirmations.map((item) => (
        <div key={item.id} className="tool-approval-card">
          <div className="tool-approval-header">
            <Icon name="alert-triangle" size={16} />
            <span>Action Requires Your Approval</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
            {item.operation || item.name || 'Tool Execution'}
          </div>
          <div className="tool-approval-args">
            {typeof item.arguments === 'object'
              ? JSON.stringify(item.arguments, null, 2)
              : item.reason || item.description || 'No arguments specified'}
          </div>
          <div className="tool-approval-actions">
            <button
              type="button"
              className="tool-btn-deny"
              onClick={() => decideConfirmation(item.id, false)}
            >
              Deny
            </button>
            <button
              type="button"
              className="tool-btn-approve"
              onClick={() => decideConfirmation(item.id, true)}
            >
              Approve
            </button>
          </div>
        </div>
      ))}

      {/* 2. Conversations Horizontal Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
        <HouseButton
          type="button"
          onClick={startNewConversation}
          style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '4px 10px', fontSize: 12 }}
        >
          <Icon name="plus" size={14} />
          New
        </HouseButton>
        {conversations.map((conv) => (
          <HouseButton
            key={conv.id}
            type="button"
            onClick={() => setActiveId(conv.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              background: conv.id === activeId ? 'var(--accent, #6366f1)' : 'var(--bg-inset)',
              color: conv.id === activeId ? '#fff' : 'var(--text-sub)',
              border: '1px solid var(--hairline-strong)',
              fontSize: 12,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {conv.title || 'Untitled Session'}
          </HouseButton>
        ))}
      </div>

      {/* 3. Messages Feed */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 14,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          marginBottom: 12,
          maxHeight: '54vh',
        }}
      >
        {transcript.length === 0 && pendingIntents.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '40px 16px', fontSize: 13 }}>
            <Icon name="chat" size={32} />
            <div style={{ marginTop: 8 }}>Session ready. Send a prompt to your computer.</div>
          </div>
        ) : (
          transcript.map((msg) => {
            const isUser = msg.role === 'user'
            const hasThoughts = !isUser && typeof msg.content === 'string' && msg.content.includes('<think>')
            const isThinkingCollapsed = collapsedThoughts[msg.id] ?? true

            let displayText = msg.content || ''
            let thoughtText = ''

            if (hasThoughts) {
              const start = displayText.indexOf('<think>')
              const end = displayText.indexOf('</think>')
              if (start !== -1 && end !== -1) {
                thoughtText = displayText.slice(start + 7, end).trim()
                displayText = (displayText.slice(0, start) + displayText.slice(end + 8)).trim()
              }
            }

            return (
              <div
                key={msg.id}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {thoughtText && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-sub)',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--hairline-strong)',
                      borderRadius: 8,
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleThought(msg.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
                      <Icon name={isThinkingCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                      <span>{isThinkingCollapsed ? 'Show internal reasoning' : 'Hide reasoning'}</span>
                    </div>
                    {!isThinkingCollapsed && (
                      <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                        {thoughtText}
                      </div>
                    )}
                  </div>
                )}

                {displayText && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 12,
                      background: isUser ? 'var(--accent, #6366f1)' : 'var(--bg)',
                      color: isUser ? '#fff' : 'var(--text)',
                      border: isUser ? '0' : '1px solid var(--hairline-strong)',
                      fontSize: 13,
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {displayText}
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* Machine Running Phase */}
        {phase && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid var(--accent, #6366f1)',
              fontSize: 12,
              color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AsciiSkeleton variant="dither" width={12} height={12} circle />
              <span>{phase}…</span>
            </div>
            <HouseButton
              type="button"
              onClick={stopTurn}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', padding: '2px 8px', fontSize: 11 }}
            >
              Stop
            </HouseButton>
          </div>
        )}

        {/* Queued Pending Intents */}
        {pendingIntents.map((intent) => (
          <div
            key={intent.id}
            style={{
              alignSelf: 'flex-end',
              padding: '6px 12px',
              borderRadius: 8,
              background: 'rgba(99, 102, 241, 0.15)',
              fontSize: 12,
              color: 'var(--text-sub)',
              fontStyle: 'italic',
            }}
          >
            {intent.payload?.text} · {intent.state === 'accepted' ? 'accepted on host' : 'queued in outbox'}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* 4. Composer Dock */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <HouseTextarea
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
          style={{ flex: 1, resize: 'none', fontSize: 13, padding: '10px 12px', borderRadius: 10 }}
        />
        <HouseButton
          type="button"
          onClick={sendMessage}
          disabled={sending || !text.trim() || !activeId}
          style={{
            minHeight: 44,
            width: 44,
            padding: 0,
            display: 'grid',
            placeItems: 'center',
            background: text.trim() ? 'var(--accent, #6366f1)' : 'var(--bg-inset)',
            color: text.trim() ? '#fff' : 'var(--text-sub)',
            borderRadius: 10,
          }}
          aria-label="Send message"
        >
          <Icon name="send" size={18} />
        </HouseButton>
      </div>
    </div>
  )
}
