import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import { getBundle } from '../bundle.js'
import { getAvailableModels } from '../llmClient.js'
import { runAgentTurn } from '../agent/agentLoop.js'
import { getConversation } from '../agent/conversationStore.js'
import Markdown from '../../components/markdown/Markdown.jsx'
import MobileActivity from '../components/MobileActivity.jsx'

function extractThoughtFromContent(content) {
  if (!content || typeof content !== 'string') return { thought: '', text: content || '' }
  const match = content.match(/<thought>([\s\S]*?)<\/thought>/i)
  if (match) {
    const thought = match[1].trim()
    const text = content.replace(/<thought>[\s\S]*?<\/thought>/i, '').trim()
    return { thought, text }
  }
  return { thought: '', text: content }
}

function groupMessagesIntoTurns(messages = []) {
  const turns = []
  let currentAssistantTurn = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentAssistantTurn) {
        turns.push(currentAssistantTurn)
        currentAssistantTurn = null
      }
      turns.push({ kind: 'user', id: msg.id, content: msg.content, timestamp: msg.timestamp })
      continue
    }

    if (msg.role === 'assistant' || msg.role === 'tool') {
      if (!currentAssistantTurn) {
        currentAssistantTurn = {
          kind: 'assistant',
          id: msg.id || `turn_a_${Date.now()}`,
          content: '',
          tools: [],
          reasoning: '',
          durationMs: msg.durationMs || 0,
          artifact: msg.artifact || null,
        }
      }

      if (msg.role === 'assistant') {
        if (msg.content) {
          const { thought, text } = extractThoughtFromContent(msg.content)
          if (thought) {
            currentAssistantTurn.reasoning = currentAssistantTurn.reasoning
              ? `${currentAssistantTurn.reasoning}\n\n${thought}`
              : thought
          }
          if (text) {
            currentAssistantTurn.content = currentAssistantTurn.content
              ? `${currentAssistantTurn.content}\n\n${text}`
              : text
          }
        }
        if (msg.artifact) {
          currentAssistantTurn.artifact = msg.artifact
        }
        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            currentAssistantTurn.tools.push({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              status: 'done',
            })
          }
        }
      } else if (msg.role === 'tool') {
        const matched = currentAssistantTurn.tools.find((t) => t.id === msg.tool_call_id)
        if (matched) {
          matched.result = msg.content
          matched.is_error = Boolean(msg.is_error)
        } else {
          currentAssistantTurn.tools.push({
            id: msg.tool_call_id,
            name: msg.name,
            result: msg.content,
            is_error: Boolean(msg.is_error),
            status: 'done',
          })
        }
      }
    }
  }

  if (currentAssistantTurn) {
    turns.push(currentAssistantTurn)
  }

  return turns
}

export default function MobileAgentChat({ session, onBack }) {
  const [conversationId, setConversationId] = useState(
    session?.id && !session.id.startsWith('temp-') ? session.id : null
  )
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [agentStatus, setAgentStatus] = useState(null)
  const [liveTools, setLiveTools] = useState([])
  const [liveReasoning, setLiveReasoning] = useState('')
  const [liveStartTime, setLiveStartTime] = useState(0)
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
  }, [messages, streamingText, liveTools, agentStatus, activeConfirmation])

  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages])

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
    setLiveTools([])
    setLiveReasoning('')
    setLiveStartTime(Date.now())
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
            const raw = ev.fullText || ''
            const { thought, text: cleanText } = extractThoughtFromContent(raw)
            if (thought) {
              setLiveReasoning(thought)
            }
            setStreamingText(cleanText)
          } else if (ev.type === 'thought') {
            setLiveReasoning((prev) => (prev ? `${prev}\n\n${ev.text}` : ev.text))
          } else if (ev.type === 'status') {
            setAgentStatus(ev.status)
          } else if (ev.type === 'tool_call') {
            setAgentStatus('tool')
            setLiveTools((prev) => [
              ...prev,
              {
                id: ev.id,
                name: ev.tool,
                arguments: ev.arguments,
                status: 'running',
                startTime: Date.now(),
              },
            ])
          } else if (ev.type === 'tool_result') {
            setLiveTools((prev) =>
              prev.map((t) =>
                t.id === ev.id
                  ? {
                      ...t,
                      status: ev.status,
                      result: ev.result,
                      durationMs: Date.now() - (t.startTime || Date.now()),
                    }
                  : t
              )
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
            setLiveTools([])
            setLiveReasoning('')
            setLiveStartTime(0)
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
          <HouseButton
            type="button"
            className="ib"
            aria-label="Sessions"
            onClick={onBack}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </HouseButton>
          <div className="ttl" style={{ fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {sessionTitle}
          </div>
          <HouseButton
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
          </HouseButton>
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
            {/* oxlint-disable-next-line amethyst-ui/no-raw-controls */}
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
              <HouseButton
                type="button"
                style={{ background: 'none', border: 0, cursor: 'pointer', color: '#991B1B' }}
                onClick={() => setErrorBanner(null)}
              >
                ✕
              </HouseButton>
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

          {turns.map((turn, idx) => {
            if (turn.kind === 'user') {
              return (
                <div
                  key={turn.id || idx}
                  style={{
                    alignSelf: 'flex-end',
                    background: '#111113',
                    color: '#fff',
                    borderRadius: '22px 22px 6px 22px',
                    padding: '12px 16px',
                    maxWidth: 290,
                    marginTop: 4,
                    lineHeight: 1.45,
                    wordBreak: 'break-word',
                    fontSize: 15,
                  }}
                >
                  {turn.content}
                </div>
              )
            }

            return (
              <div
                key={turn.id || idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxWidth: '100%',
                  width: '100%',
                  marginTop: 2,
                }}
              >
                {/* Historical Activity Drawer */}
                {(turn.tools?.length > 0 || turn.reasoning) && (
                  <MobileActivity
                    tools={turn.tools}
                    reasoning={turn.reasoning}
                    running={false}
                    durationMs={turn.durationMs}
                  />
                )}

                {/* Structured Markdown Message Body */}
                {turn.content && (
                  <div
                    className="m-shell selectable-text"
                    style={{
                      maxWidth: '100%',
                      width: '100%',
                      background: '#FFFFFF',
                      padding: '12px 16px',
                      borderRadius: '20px 20px 20px 6px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                      border: '1px solid rgba(0,0,0,0.04)',
                    }}
                  >
                    <Markdown text={turn.content} />
                  </div>
                )}

                {/* Artifact note card if artifact present */}
                {turn.artifact && (
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
                      <div className="ttl">{turn.artifact.title || 'Hybrid retrieval, in short'}</div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Active Live Running Turn */}
          {sending && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxWidth: '100%',
                width: '100%',
                marginTop: 2,
              }}
            >
              <MobileActivity
                running={true}
                status={agentStatus}
                tools={liveTools}
                reasoning={liveReasoning}
                startTime={liveStartTime}
                defaultOpen={liveTools.length > 0}
              />

              {streamingText && (
                <div
                  className="m-shell selectable-text"
                  style={{
                    maxWidth: '100%',
                    width: '100%',
                    background: '#FFFFFF',
                    padding: '12px 16px',
                    borderRadius: '20px 20px 20px 6px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                    border: '1px solid rgba(0,0,0,0.04)',
                  }}
                >
                  <Markdown text={streamingText} />
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
                </div>
              )}
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
                <HouseButton
                  type="button"
                  className="bt"
                  style={{ flex: 1, background: '#fff', color: '#1D1D1F' }}
                  onClick={() => handleConfirmDecision(true)}
                >
                  Allow
                </HouseButton>
                <HouseButton
                  type="button"
                  className="bt"
                  style={{ flex: 1, background: '#2C2C2E', color: '#fff' }}
                  onClick={() => handleConfirmDecision(false)}
                >
                  Deny
                </HouseButton>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggestion Chips Row */}
        <div className="r" style={{ marginTop: 'auto', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <HouseButton
            type="button"
            className="ch"
            onClick={() => handleSend('Summarise today')}
          >
            Summarise today
          </HouseButton>
          <HouseButton
            type="button"
            className="ch"
            onClick={() => handleSend('Triage inbox')}
          >
            Triage inbox
          </HouseButton>
          <HouseButton
            type="button"
            className="ch"
            onClick={() => handleSend('What changed?')}
          >
            What changed?
          </HouseButton>
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
          <HouseButton
            type="button"
            className="ib"
            aria-label="Attach"
            style={{ width: 38, height: 38, minWidth: 38, flexShrink: 0, background: '#F2F2F7', boxShadow: 'none' }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
          </HouseButton>

          {/* oxlint-disable-next-line amethyst-ui/no-raw-controls */}
          <input
            className="in"
            style={{ minWidth: 0, flex: 1, padding: '0 4px', fontSize: 15 }}
            aria-label="Message Amethyst"
            placeholder={isOnline ? "Message Amethyst" : "Offline — AI generation unavailable"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          <HouseButton
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
          </HouseButton>

          <HouseButton
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
          </HouseButton>
        </form>
      </div>
    </motion.div>
  )
}
