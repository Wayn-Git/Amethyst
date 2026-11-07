import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
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
  const [agentStatus, setAgentStatus] = useState(null) // 'thinking' | 'tool' | 'awaiting_confirmation' | 'interrupted' | 'completed'
  const [currentToolCall, setCurrentToolCall] = useState(null)
  const [activeConfirmation, setActiveConfirmation] = useState(null)
  const [errorBanner, setErrorBanner] = useState(null)

  // Model Picker State
  const [availableModels, setAvailableModels] = useState([])
  const [selectedModelId, setSelectedModelId] = useState(null)
  const [bundleData, setBundleData] = useState(null)

  const abortControllerRef = useRef(null)
  const messagesEndRef = useRef(null)

  const sessionTitle = session?.title || 'Agent Chat'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Load bundle and models
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

  // Load conversation messages from local store
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

  // Handle user send
  const handleSend = async (textToSend) => {
    const text = (textToSend || input).trim()
    if (!text || sending) return

    setInput('')
    setSending(true)
    setStreamingText('')
    setErrorBanner(null)
    setAgentStatus('thinking')
    setCurrentToolCall(null)
    setActiveConfirmation(null)

    const controller = new AbortController()
    abortControllerRef.current = controller

    // Add user message to UI immediately for instant responsiveness
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
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setSending(false)
      setAgentStatus('interrupted')
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
              maxWidth: 180,
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
              if (conversationId) loadLocalMessages(conversationId)
            }}
          >
            <Icon name="arrow-clockwise" size={18} />
          </button>
        </div>

        {/* Model Picker Bar */}
        {availableModels.length > 0 && (
          <div
            className="m-r"
            style={{
              background: '#F6F4F1',
              borderRadius: 12,
              padding: '6px 10px',
              gap: 8,
              alignItems: 'center',
              boxShadow: '0 1px 2px rgba(30,25,20,0.04)',
            }}
          >
            <span style={{ color: '#8F8B85', display: 'flex' }}>
              <Icon name="sparkle" size={16} />
            </span>
            <select
              aria-label="Model selection"
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                fontSize: 13,
                fontWeight: 500,
                color: '#111113',
                outline: 'none',
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
            className="m-c"
            style={{
              padding: '10px 14px',
              background: '#FEE2E2',
              borderColor: '#FCA5A5',
              borderRadius: 12,
              color: '#991B1B',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <div className="m-r" style={{ gap: 8 }}>
              <Icon name="shield-alert" size={16} />
              <div style={{ flex: 1 }}>{errorBanner}</div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B' }}
                onClick={() => setErrorBanner(null)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
        )}

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
                Directly search your Drive, manage files, and ask questions.
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user'
            if (msg.role === 'tool') return null // rendered as tool badges below assistant call

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
                    {msg.tool_calls && Array.isArray(msg.tool_calls) && (
                      <div
                        style={{
                          marginBottom: 8,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          fontSize: 12,
                        }}
                      >
                        {msg.tool_calls.map((tc, tcIdx) => (
                          <div
                            key={tcIdx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              background: '#F0ECE1',
                              padding: '4px 8px',
                              borderRadius: 8,
                              color: '#44403C',
                            }}
                          >
                            <Icon name="terminal" size={13} />
                            <span style={{ fontWeight: 600 }}>{tc.name}</span>
                            <span
                              style={{
                                color: '#78716C',
                                fontSize: 11,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              ({JSON.stringify(tc.arguments || {})})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div>{msg.content}</div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Active Tool Call in Progress */}
          {currentToolCall && (
            <div
              className="m-c"
              style={{
                maxWidth: '90%',
                padding: '10px 14px',
                borderRadius: 14,
                background: '#FAF8F5',
                borderColor: '#E7E5E4',
              }}
            >
              <div className="m-r" style={{ gap: 8, fontSize: 12 }}>
                <span className="m-spn" style={{ width: 14, height: 14 }} />
                <span style={{ fontWeight: 600, color: '#1C1917' }}>Running tool:</span>
                <span className="mono" style={{ color: '#0369A1' }}>
                  {currentToolCall.tool}
                </span>
              </div>
              {currentToolCall.arguments && (
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: '#78716C',
                    marginTop: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {JSON.stringify(currentToolCall.arguments)}
                </div>
              )}
            </div>
          )}

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

          {/* Write Confirmation Prompt */}
          {activeConfirmation && (
            <div
              className="m-blk m-col"
              style={{
                gap: 12,
                marginTop: 8,
                background: '#18181B',
                color: '#fff',
                padding: 16,
                borderRadius: 16,
              }}
            >
              <div className="m-r" style={{ gap: 8, alignItems: 'center' }}>
                <span className="m-d w" />
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  Action Confirmation Required
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#D4D4D8', lineHeight: 1.4 }}>
                {activeConfirmation.reason || 'The agent requested an external write or destructive action.'}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  background: '#27272A',
                  padding: '10px 12px',
                  borderRadius: 10,
                  wordBreak: 'break-all',
                  color: '#A1A1AA',
                }}
              >
                <div style={{ color: '#E4E4E7', fontWeight: 600, marginBottom: 2 }}>
                  Tool: {activeConfirmation.tool}
                </div>
                <div>Args: {JSON.stringify(activeConfirmation.args, null, 2)}</div>
              </div>

              <div className="m-r" style={{ gap: 10 }}>
                <button
                  type="button"
                  className="bt l"
                  style={{
                    flex: 1,
                    background: '#D6F23E',
                    color: '#000',
                    fontWeight: 600,
                    borderRadius: 10,
                  }}
                  onClick={() => handleConfirmDecision(true)}
                >
                  Allow Action
                </button>
                <button
                  type="button"
                  className="bt"
                  style={{
                    flex: 1,
                    background: '#3F3F46',
                    color: '#fff',
                    borderRadius: 10,
                  }}
                  onClick={() => handleConfirmDecision(false)}
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

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
            placeholder={sending ? 'Agent is working…' : 'Message Amethyst…'}
            value={input}
            disabled={sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend()
            }}
          />
          {sending ? (
            <button
              type="button"
              className="m-ib"
              style={{ background: '#E11D48', color: '#fff' }}
              aria-label="Stop"
              onClick={handleStop}
            >
              <Icon name="x" size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="m-ib k"
              aria-label="Send"
              disabled={!input.trim()}
              onClick={() => handleSend()}
            >
              <Icon name="arrow-up" size={20} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
