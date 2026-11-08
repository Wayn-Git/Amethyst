import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { getBundle } from '../bundle.js'
import { getAvailableModels } from '../llmClient.js'
import { runAgentTurn } from '../agent/agentLoop.js'
import { getConversation } from '../agent/conversationStore.js'

export default function MobileAgentChat({ session, onBack }) {
  const [conversationId, setConversationId] = useState(
    session?.id && !session.id.startsWith('temp-') ? session.id : null
  )
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [agentStatus, setAgentStatus] = useState(null)
  const [currentToolCall, setCurrentToolCall] = useState(null)
  const [activeConfirmation, setActiveConfirmation] = useState(session?.confirmation || null)
  const [errorBanner, setErrorBanner] = useState(null)

  // Model Picker State
  const [availableModels, setAvailableModels] = useState([])
  const [selectedModelId, setSelectedModelId] = useState(null)
  const [bundleData, setBundleData] = useState(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const abortControllerRef = useRef(null)
  const messagesEndRef = useRef(null)

  const sessionTitle = session?.title || 'Hybrid retrieval note'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    async function init() {
      try {
        const b = await getBundle()
        setBundleData(b)
        if (b?.llm) {
          const { models, defaultModelId } = getAvailableModels(b.llm)
          setAvailableModels(models)
          setSelectedModelId(defaultModelId || models[0]?.id || null)
        }
      } catch (err) {
        console.warn('[MobileAgentChat] Failed loading bundle/models:', err.message)
      }
    }
    init()
  }, [])

  const loadLocalMessages = useCallback(async (id) => {
    if (!id) return
    try {
      const conv = await getConversation(id)
      if (conv?.messages) {
        setMessages(conv.messages)
      }
    } catch (err) {
      console.warn('[MobileAgentChat] Failed loading messages:', err.message)
    }
  }, [])

  useEffect(() => {
    if (conversationId) {
      loadLocalMessages(conversationId)
    }
  }, [conversationId, loadLocalMessages])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText, currentToolCall, activeConfirmation])

  const handleSend = async (textToSend) => {
    const text = (textToSend || input).trim()
    if (!text || sending) return

    if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      setErrorBanner('Offline — Connect to the internet to chat with AI.')
      return
    }

    setInput('')
    setSending(true)
    setStreamingText('')
    setErrorBanner(null)
    setAgentStatus('thinking')
    setCurrentToolCall(null)
    setActiveConfirmation(null)

    const controller = new AbortController()
    abortControllerRef.current = controller

    const optimisticMsg = {
      id: `temp_u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])

    try {
      const currentBundle = bundleData || (await getBundle())
      if (!currentBundle) {
        throw new Error('Pair with your PC to start using the mobile agent.')
      }

      await runAgentTurn({
        conversationId,
        userText: text,
        bundle: currentBundle,
        selectedModelId,
        signal: controller.signal,
        onEvent: (ev) => {
          if (ev.type === 'delta') {
            setStreamingText(ev.fullText || '')
          } else if (ev.type === 'status') {
            setAgentStatus(ev.status)
          } else if (ev.type === 'tool_call') {
            setCurrentToolCall({
              id: ev.id,
              tool: ev.tool,
              arguments: ev.arguments,
              status: 'running',
            })
          } else if (ev.type === 'tool_result') {
            setCurrentToolCall((prev) =>
              prev?.id === ev.id
                ? { ...prev, status: ev.status, result: ev.result }
                : prev
            )
          } else if (ev.type === 'confirmation_required') {
            setActiveConfirmation({
              requestId: ev.requestId,
              tool: ev.tool,
              args: ev.args,
              reason: ev.reason,
              resolve: ev.onDecision,
            })
          } else if (ev.type === 'done') {
            if (ev.conversation?.id) {
              setConversationId(ev.conversation.id)
            }
            if (ev.conversation?.messages) {
              setMessages(ev.conversation.messages)
            }
            setStreamingText('')
            setCurrentToolCall(null)
            setActiveConfirmation(null)
          } else if (ev.type === 'error') {
            setErrorBanner(ev.error)
          }
        },
      })
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        setAgentStatus('interrupted')
      } else {
        const errorText = err.authError
          ? (err.source === 'composio' ? 'Reconnect Google Drive on the PC' : 'Re-scan QR on your PC')
          : err.message
        setErrorBanner(errorText)
      }
    } finally {
      setSending(false)
      abortControllerRef.current = null
      if (conversationId) {
        loadLocalMessages(conversationId)
      }
    }
  }

  const handleConfirmDecision = (allowed) => {
    if (activeConfirmation?.resolve) {
      activeConfirmation.resolve(allowed)
      setActiveConfirmation(null)
    }
  }

  return (
    <motion.div
      className="s"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: '#F2F2F7',
        maxWidth: 480,
        margin: '0 auto',
      }}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="b" style={{ paddingBottom: 20, gap: 12 }}>
        {/* Top Header Bar */}
        <div className="r sp">
          <button
            type="button"
            className="ib"
            aria-label="Sessions"
            onClick={onBack}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="ttl" style={{ fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {sessionTitle}
          </div>
          <button
            type="button"
            className="ib"
            aria-label="More"
            onClick={() => {
              if (conversationId) loadLocalMessages(conversationId)
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>
        </div>

        {/* Model Selector Pill */}
        {availableModels.length > 0 && (
          <div
            className="r"
            style={{
              background: '#FFFFFF',
              borderRadius: 999,
              padding: '6px 14px',
              gap: 8,
              boxShadow: '0 1px 2px rgba(0,0,0,.05)',
            }}
          >
            <span style={{ color: '#0071E3', display: 'flex' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              </svg>
            </span>
            <select
              aria-label="Select model"
              style={{
                flex: 1,
                border: 0,
                background: 'transparent',
                fontSize: 13,
                fontWeight: 500,
                color: '#1D1D1F',
                outline: 0,
                cursor: 'pointer',
              }}
              value={selectedModelId || ''}
              onChange={(e) => setSelectedModelId(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Error Alert Banner */}
        {errorBanner && (
          <div
            className="c"
            style={{
              padding: '10px 14px',
              background: '#FEE2E2',
              borderRadius: 14,
              color: '#991B1B',
              fontSize: 13,
            }}
          >
            <div className="r" style={{ gap: 8 }}>
              <div style={{ flex: 1 }}>{errorBanner}</div>
              <button
                type="button"
                style={{ background: 'none', border: 0, cursor: 'pointer', color: '#991B1B' }}
                onClick={() => setErrorBanner(null)}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Messages Stream */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            flex: 1,
            overflowY: 'auto',
            paddingBottom: 8,
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
                color: '#6E6E73',
                padding: '40px 16px',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0071E3',
                  boxShadow: '0 2px 8px rgba(0,0,0,.06)',
                }}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                </svg>
              </div>
              <div className="dsp" style={{ fontSize: 20, fontWeight: 600, color: '#1D1D1F' }}>
                Chat with Amethyst
              </div>
              <div style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.5 }}>
                Ask questions, search your Library, and run tasks on your PC.
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
                      alignSelf: 'flex-end',
                      background: '#111113',
                      color: '#fff',
                      borderRadius: '22px 22px 6px 22px',
                      padding: '12px 16px',
                      maxWidth: 290,
                      marginTop: 6,
                      lineHeight: 1.4,
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.content}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '92%' }}>
                    {msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.map((tc, tcIdx) => (
                      <span key={tcIdx} className="ch" style={{ alignSelf: 'flex-start' }}>
                        <span style={{ display: 'flex', color: '#34C759' }}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </span>
                        {tc.name ? `Executed ${tc.name}` : 'Searched Library, 4 items'}
                      </span>
                    ))}

                    <p style={{ margin: 0, lineHeight: 1.5, color: '#1D1D1F' }}>
                      {msg.content}
                    </p>

                    {/* Artifact note card if artifact present */}
                    {msg.artifact && (
                      <div className="c r" style={{ gap: 12, marginTop: 4 }}>
                        <span className="it">
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                            <path d="M10 9H8" />
                            <path d="M16 13H8" />
                            <path d="M16 17H8" />
                          </svg>
                        </span>
                        <div>
                          <div className="m">Draft note</div>
                          <div className="ttl">{msg.artifact.title || 'Hybrid retrieval, in short'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Animated Agent Status Indicators */}
          {sending && !streamingText && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="r"
              style={{
                alignSelf: 'flex-start',
                gap: 8,
                padding: '10px 16px',
                borderRadius: 20,
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.9)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.05)',
                fontSize: 13,
                fontWeight: 500,
                color: '#1D1D1F',
              }}
            >
              {agentStatus === 'searching' ? (
                <>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#0071E3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ animation: 'r 2s linear infinite' }}>
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <span>Searching Library & Drive…</span>
                </>
              ) : currentToolCall || agentStatus === 'calling' ? (
                <>
                  <span className="spn" style={{ width: 14, height: 14, borderColor: '#D1D1D6', borderTopColor: '#873FFF' }} />
                  <span>Running {currentToolCall?.tool || 'tool'}…</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#873FFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                  </svg>
                  <span>Thinking…</span>
                </>
              )}
            </motion.div>
          )}

          {/* Streaming Assistant Response */}
          {streamingText && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '92%' }}
            >
              <p className="selectable-text" style={{ margin: 0, lineHeight: 1.5, color: '#1D1D1F' }}>
                {streamingText}
                <span
                  style={{
                    display: 'inline-block',
                    width: 2,
                    height: 14,
                    background: '#873FFF',
                    marginLeft: 4,
                    verticalAlign: 'middle',
                    animation: 'p 1s infinite alternate',
                  }}
                />
              </p>
            </motion.div>
          )}

          {/* Confirmation / Approval Card ("Wants to run on your PC") */}
          {activeConfirmation && (
            <div className="blk col" style={{ gap: 12, marginTop: 8 }}>
              <div className="r">
                <span className="d w" />
                <span className="st" style={{ color: '#fff' }}>
                  Wants to run on your PC
                </span>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  background: '#222225',
                  padding: '10px 12px',
                  borderRadius: 12,
                  color: '#A9A6A0',
                }}
              >
                {activeConfirmation.tool || activeConfirmation.command || 'git status'}
              </div>
              <div className="r">
                <button
                  type="button"
                  className="bt"
                  style={{ flex: 1, background: '#fff', color: '#1D1D1F' }}
                  onClick={() => handleConfirmDecision(true)}
                >
                  Allow
                </button>
                <button
                  type="button"
                  className="bt"
                  style={{ flex: 1, background: '#2C2C2E', color: '#fff' }}
                  onClick={() => handleConfirmDecision(false)}
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggestion Chips Row */}
        <div className="r" style={{ marginTop: 'auto', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <button
            type="button"
            className="ch"
            onClick={() => handleSend('Summarise today')}
          >
            Summarise today
          </button>
          <button
            type="button"
            className="ch"
            onClick={() => handleSend('Triage inbox')}
          >
            Triage inbox
          </button>
          <button
            type="button"
            className="ch"
            onClick={() => handleSend('What changed?')}
          >
            What changed?
          </button>
        </div>

        {/* Offline Warning Banner */}
        {!isOnline && (
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 12,
              background: 'rgba(255, 149, 0, 0.12)',
              border: '1px solid rgba(255, 149, 0, 0.25)',
              color: '#D97706',
              fontSize: 12,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 6,
            }}
          >
            <span>⚠️</span>
            <span>Offline — Connect to internet to chat with AI</span>
          </div>
        )}

        {/* Input Pill */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className="r"
          style={{
            background: '#FFFFFF',
            borderRadius: 999,
            padding: '4px 6px',
            boxShadow: '0 8px 24px rgba(0,0,0,.08)',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            className="ib"
            aria-label="Attach"
            style={{ width: 38, height: 38, minWidth: 38, flexShrink: 0, background: '#F2F2F7', boxShadow: 'none' }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
          </button>

          <input
            className="in"
            style={{ minWidth: 0, flex: 1, padding: '0 4px', fontSize: 15 }}
            aria-label="Message Amethyst"
            placeholder={isOnline ? "Message Amethyst" : "Offline — AI generation unavailable"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          <button
            type="button"
            className="ib"
            aria-label="Voice"
            style={{ width: 38, height: 38, minWidth: 38, flexShrink: 0, background: 'transparent', boxShadow: 'none' }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>

          <button
            type="submit"
            disabled={!input.trim() || sending || !isOnline}
            className="ib k"
            aria-label="Send"
            style={{
              width: 38,
              height: 38,
              minWidth: 38,
              flexShrink: 0,
              opacity: !input.trim() || sending || !isOnline ? 0.35 : 1,
              transition: 'opacity 0.2s ease',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 7-7 7 7" />
              <path d="M12 19V5" />
            </svg>
          </button>
        </form>
      </div>
    </motion.div>
  )
}
