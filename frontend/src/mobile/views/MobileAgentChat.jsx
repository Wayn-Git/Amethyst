import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function MobileAgentChat({ session, onBack }) {
  const [currentSessionId, setCurrentSessionId] = useState(
    session?.id && !session.id.startsWith('temp-') && session.id !== 'approval-session'
      ? session.id
      : null
  )
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [activeConfirmation, setActiveConfirmation] = useState(session?.confirmation || null)
  const [confirmationDecided, setConfirmationDecided] = useState(null) // 'allowed' | 'denied'
  const messagesEndRef = useRef(null)

  const sessionTitle = session?.title || 'Agent Chat'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const loadMessages = useCallback(async (id) => {
    const sId = id || currentSessionId
    if (!sId) return
    try {
      const res = await api.messages(sId)
      if (res?.messages) {
        setMessages(res.messages)
      }
    } catch (err) {
      console.warn('[MobileAgentChat] Load failed:', err.message)
    }
  }, [currentSessionId])

  // Load pending confirmation if not passed
  const loadConfirmations = useCallback(async () => {
    if (session?.confirmation) {
      setActiveConfirmation(session.confirmation)
      return
    }
    try {
      const confs = await api.confirmations()
      if (Array.isArray(confs) && confs.length > 0) {
        const matching = currentSessionId
          ? confs.find((c) => c.conversation_id === currentSessionId)
          : confs[0]
        if (matching) setActiveConfirmation(matching)
      }
    } catch {}
  }, [session?.confirmation, currentSessionId])

  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId)
    }
    loadConfirmations()
  }, [currentSessionId, loadMessages, loadConfirmations])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText])

  const handleSend = async (textToSend) => {
    const text = (textToSend || input).trim()
    if (!text || sending) return

    setInput('')
    setSending(true)
    setStreamingText('')

    // Append user message to UI immediately
    const userMsg = {
      role: 'user',
      content: text,
      id: `temp-${Date.now()}`,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    try {
      let targetId = currentSessionId
      if (!targetId) {
        // Create real conversation session
        const newConv = await api.createConversation({
          title: text.slice(0, 36),
        })
        if (newConv?.id) {
          targetId = newConv.id
          setCurrentSessionId(newConv.id)
        }
      }

      if (targetId) {
        let accumulated = ''
        await api.streamTurn(
          targetId,
          { text },
          (chunk) => {
            if (chunk?.content || chunk?.delta) {
              accumulated += chunk.content || chunk.delta || ''
              setStreamingText(accumulated)
            }
          },
          () => {
            setSending(false)
            setStreamingText('')
            loadMessages(targetId)
            loadConfirmations()
          }
        )
      } else {
        setSending(false)
      }
    } catch (err) {
      console.error('[MobileAgentChat] Send failed:', err.message)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message}`,
          id: `err-${Date.now()}`,
        },
      ])
      setSending(false)
      setStreamingText('')
    }
  }

  const handleDecision = async (allow) => {
    if (!activeConfirmation?.id) return
    setConfirmationDecided(allow ? 'allowed' : 'denied')
    try {
      await api.decideConfirmation(activeConfirmation.id, {
        allow,
        remember: false,
        scope: 'turn',
      })
      setTimeout(() => {
        setActiveConfirmation(null)
        setConfirmationDecided(null)
        if (currentSessionId) loadMessages(currentSessionId)
      }, 1200)
    } catch (err) {
      console.error('[MobileAgentChat] Decision error:', err.message)
    }
  }

  return (
    <motion.div
      className="m-shell"
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#ECEAE6' }}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.2 }}
    >
      <div className="m-body" style={{ paddingBottom: 20, gap: 12 }}>
        {/* Header */}
        <div className="m-r m-sp">
          <button
            type="button"
            className="m-ib"
            aria-label="Back to sessions"
            onClick={onBack}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <div
            className="m-ttl"
            style={{
              fontSize: 17,
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sessionTitle}
          </div>
          <button
            type="button"
            className="m-ib"
            aria-label="Refresh"
            onClick={() => {
              if (currentSessionId) loadMessages(currentSessionId)
              loadConfirmations()
            }}
          >
            <Icon name="arrow-clockwise" size={18} />
          </button>
        </div>

        {/* Message Stream */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {messages.length === 0 && !streamingText && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                textAlign: 'center',
                color: '#6E6A64',
                padding: '40px 16px',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: '#F6F4F1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#141414',
                }}
              >
                <Icon name="sparkle" size={24} />
              </div>
              <div className="m-dsp" style={{ fontSize: 20, fontWeight: 600, color: '#141414' }}>
                Chat with Amethyst
              </div>
              <div style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.5 }}>
                Direct tasks, ask questions, or run automated actions on your PC.
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user'
            return (
              <div
                key={msg.id || idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  gap: 6,
                }}
              >
                {isUser ? (
                  <div
                    style={{
                      background: '#111113',
                      color: '#fff',
                      borderRadius: '22px 22px 6px 22px',
                      padding: '12px 16px',
                      maxWidth: '82%',
                      wordBreak: 'break-word',
                      lineHeight: 1.4,
                    }}
                  >
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className="m-c"
                    style={{
                      maxWidth: '90%',
                      padding: '14px 16px',
                      borderRadius: '22px 22px 22px 6px',
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.tool_calls && (
                      <div
                        className="m-r"
                        style={{
                          marginBottom: 8,
                          gap: 6,
                          fontSize: 12,
                          color: '#6E6A64',
                        }}
                      >
                        <Icon name="terminal" size={14} />
                        <span>Ran tool: {msg.tool_calls[0]?.function?.name || 'execution'}</span>
                      </div>
                    )}
                    <div>{msg.content}</div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Streaming response */}
          {streamingText && (
            <div
              className="m-c"
              style={{
                maxWidth: '90%',
                padding: '14px 16px',
                borderRadius: '22px 22px 22px 6px',
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}
            >
              <div>{streamingText}</div>
              <span className="m-spn" style={{ width: 12, height: 12, marginTop: 8 }} />
            </div>
          )}

          {/* Real Pending Confirmation Box */}
          {activeConfirmation && (
            <div className="m-blk m-col" style={{ gap: 12, marginTop: 8 }}>
              <div className="m-r">
                <span className="m-d w" />
                <span className="m-st">Wants to run on your PC</span>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  background: '#222225',
                  padding: '10px 12px',
                  borderRadius: 12,
                  wordBreak: 'break-all',
                }}
              >
                {activeConfirmation.description ||
                  activeConfirmation.command ||
                  activeConfirmation.operation_key ||
                  'Protected system action'}
              </div>

              {confirmationDecided ? (
                <div style={{ fontSize: 13, color: '#D6F23E', textAlign: 'center' }}>
                  {confirmationDecided === 'allowed' ? 'Action Approved' : 'Action Denied'}
                </div>
              ) : (
                <div className="m-r">
                  <button
                    type="button"
                    className="bt l"
                    style={{ flex: 1 }}
                    onClick={() => handleDecision(true)}
                  >
                    Allow
                  </button>
                  <button
                    type="button"
                    className="bt"
                    style={{ flex: 1, background: '#2B2B2E' }}
                    onClick={() => handleDecision(false)}
                  >
                    Deny
                  </button>
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Prompt Chips */}
        {messages.length === 0 && (
          <div className="m-r" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {['Summarise today', 'Triage inbox', 'What changed?'].map((txt, i) => (
              <button
                key={i}
                type="button"
                className="m-ch"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => handleSend(txt)}
              >
                {txt}
              </button>
            ))}
          </div>
        )}

        {/* Bottom Input Bar */}
        <div
          className="m-r"
          style={{
            background: '#F9F8F6',
            borderRadius: 999,
            padding: 6,
            boxShadow: '0 8px 24px rgba(30,25,20,.1)',
          }}
        >
          <input
            className="m-in"
            style={{ paddingLeft: 14 }}
            placeholder="Message Amethyst…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend()
            }}
          />
          <button
            type="button"
            className="m-ib k"
            aria-label="Send"
            disabled={!input.trim() || sending}
            onClick={() => handleSend()}
          >
            <Icon name="arrow-up" size={20} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
