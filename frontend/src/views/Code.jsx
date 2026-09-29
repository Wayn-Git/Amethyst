import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Markdown from '../components/markdown/Markdown.jsx'
import opencode from '../lib/opencode.js'
import './code.css'

function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function Code() {
  // Server state
  const [serverStatus, setServerStatus] = useState({
    running: false,
    port: null,
    healthy: false,
    loading: true,
  })

  // Core OpenCode entities
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [agents, setAgents] = useState([])
  const [models, setModels] = useState([])
  const [currentAgent, setCurrentAgent] = useState('build')
  const [currentModel, setCurrentModel] = useState('')

  // Messages and streaming state
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [pendingPermissions, setPendingPermissions] = useState([])
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0, reasoning: 0, cost: 0 })

  // UI state
  const [promptText, setPromptText] = useState('')
  const [expandedReasoning, setExpandedReasoning] = useState({})
  const [expandedTools, setExpandedTools] = useState({})

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const activeSessionRef = useRef(activeSessionId)
  activeSessionRef.current = activeSessionId

  // -------------------------------------------------------------------------
  // Server status check & start
  // -------------------------------------------------------------------------
  const checkStatus = useCallback(async () => {
    try {
      const res = await opencode.status()
      setServerStatus({
        running: res.running,
        port: res.port,
        healthy: res.healthy,
        loading: false,
      })
      return res
    } catch {
      setServerStatus((prev) => ({ ...prev, running: false, loading: false }))
      return { running: false }
    }
  }, [])

  const startServer = useCallback(async () => {
    setServerStatus((prev) => ({ ...prev, loading: true }))
    try {
      const res = await opencode.start()
      setServerStatus({
        running: res.running,
        port: res.port,
        healthy: true,
        loading: false,
      })
      await loadInitialData()
    } catch (err) {
      console.error('Failed to start OpenCode:', err)
      setServerStatus((prev) => ({ ...prev, loading: false }))
    }
  }, [])

  const stopServer = useCallback(async () => {
    try {
      await opencode.stop()
      setServerStatus({ running: false, port: null, healthy: false, loading: false })
    } catch (err) {
      console.error('Failed to stop OpenCode:', err)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Initial Data Loading
  // -------------------------------------------------------------------------
  const loadInitialData = useCallback(async () => {
    try {
      const [agentsList, modelsList, sessionsList] = await Promise.all([
        opencode.listAgents().catch(() => []),
        opencode.listModels().catch(() => []),
        opencode.listSessions().catch(() => []),
      ])

      setAgents(agentsList)
      setModels(modelsList)
      setSessions(sessionsList)

      if (modelsList.length > 0 && !currentModel) {
        const defaultMod = modelsList[0]
        setCurrentModel(typeof defaultMod === 'string' ? defaultMod : defaultMod.id || defaultMod.name || '')
      }

      if (sessionsList.length > 0 && !activeSessionRef.current) {
        setActiveSessionId(sessionsList[0].id)
      }
    } catch (err) {
      console.error('Error loading initial OpenCode data:', err)
    }
  }, [currentModel])

  // -------------------------------------------------------------------------
  // Session History Reducer
  // -------------------------------------------------------------------------
  const rebuildMessagesFromEvents = useCallback((events) => {
    const msgs = []
    let currentAssistant = null

    for (const ev of events) {
      const type = ev.type
      const data = ev.data || {}

      if (type === 'session.next.prompted') {
        const text = data.prompt?.text || data.text || ''
        msgs.push({
          id: data.messageID || ev.id,
          role: 'user',
          text,
          timestamp: data.timestamp || Date.now(),
        })
        currentAssistant = null
      } else if (type === 'session.next.step.started') {
        const msgId = data.assistantMessageID || `asst_${ev.id}`
        if (!currentAssistant || currentAssistant.id !== msgId) {
          currentAssistant = {
            id: msgId,
            role: 'assistant',
            agent: data.agent,
            model: data.model,
            reasoning: '',
            text: '',
            tools: [],
            status: 'streaming',
            timestamp: data.timestamp || Date.now(),
          }
          msgs.push(currentAssistant)
        }
      } else if (type === 'session.next.reasoning.delta') {
        if (currentAssistant) {
          currentAssistant.reasoning = (currentAssistant.reasoning || '') + (data.delta || '')
        }
      } else if (type === 'session.next.text.delta') {
        if (currentAssistant) {
          currentAssistant.text = (currentAssistant.text || '') + (data.delta || data.text || '')
        }
      } else if (type === 'session.next.tool.called') {
        if (currentAssistant) {
          const exists = currentAssistant.tools.find((t) => t.callID === data.callID)
          if (!exists) {
            currentAssistant.tools.push({
              callID: data.callID,
              name: data.name,
              input: data.input,
              status: 'running',
            })
          }
        }
      } else if (type === 'session.next.tool.progress') {
        if (currentAssistant) {
          const tool = currentAssistant.tools.find((t) => t.callID === data.callID)
          if (tool) tool.progress = data.progress
        }
      } else if (type === 'session.next.tool.success') {
        if (currentAssistant) {
          const tool = currentAssistant.tools.find((t) => t.callID === data.callID)
          if (tool) {
            tool.status = 'success'
            tool.output = data.output
          }
        }
      } else if (type === 'session.next.tool.failed') {
        if (currentAssistant) {
          const tool = currentAssistant.tools.find((t) => t.callID === data.callID)
          if (tool) {
            tool.status = 'failed'
            tool.error = data.error
          }
        }
      } else if (type === 'session.next.step.ended') {
        if (currentAssistant) currentAssistant.status = 'complete'
      } else if (type === 'session.next.step.failed') {
        if (currentAssistant) {
          currentAssistant.status = 'failed'
          currentAssistant.error = data.error?.message || 'Step execution failed'
        }
      }
    }

    return msgs
  }, [])

  // -------------------------------------------------------------------------
  // Load Session details on active session change
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      setPendingPermissions([])
      return
    }

    let isSubscribed = true

    async function loadSession() {
      try {
        const [historyRes, contextRes, permRes] = await Promise.all([
          opencode.getHistory(activeSessionId).catch(() => ({ data: [] })),
          opencode.getContext(activeSessionId).catch(() => null),
          opencode.listPermissions(activeSessionId).catch(() => []),
        ])

        if (!isSubscribed) return

        const rawEvents = Array.isArray(historyRes) ? historyRes : historyRes?.data || []
        const parsedMsgs = rebuildMessagesFromEvents(rawEvents)
        setMessages(parsedMsgs)

        if (contextRes?.tokens) {
          setTokenUsage({
            input: contextRes.tokens.input || 0,
            output: contextRes.tokens.output || 0,
            reasoning: contextRes.tokens.reasoning || 0,
            cost: contextRes.cost || 0,
          })
        }

        const perms = Array.isArray(permRes) ? permRes : permRes?.data || []
        setPendingPermissions(perms.filter((p) => p.sessionID === activeSessionId))
      } catch (err) {
        console.error('Failed to load session history:', err)
      }
    }

    loadSession()
    return () => {
      isSubscribed = false
    }
  }, [activeSessionId, rebuildMessagesFromEvents])

  // -------------------------------------------------------------------------
  // Event Routing (SSE)
  // -------------------------------------------------------------------------
  const handleEvent = useCallback(
    (ev) => {
      const type = ev.type
      const data = ev.data || {}
      const targetSid = data.sessionID || ev.durable?.aggregateID

      // Permission events
      if (type === 'permission.v2.asked') {
        if (!targetSid || targetSid === activeSessionRef.current) {
          setPendingPermissions((prev) => {
            const exists = prev.some((p) => p.id === data.id)
            return exists ? prev : [...prev, data]
          })
        }
        return
      }

      if (type === 'permission.v2.replied') {
        setPendingPermissions((prev) => prev.filter((p) => p.id !== data.id && p.id !== data.requestID))
        return
      }

      // Filter events by active session
      if (targetSid && targetSid !== activeSessionRef.current) {
        return
      }

      // Session context updates
      if (type === 'session.next.context.updated' && data.tokens) {
        setTokenUsage({
          input: data.tokens.input || 0,
          output: data.tokens.output || 0,
          reasoning: data.tokens.reasoning || 0,
          cost: data.cost || 0,
        })
        return
      }

      // Stream status
      if (type === 'session.next.step.started') {
        setStreaming(true)
      } else if (type === 'session.next.step.ended' || type === 'session.next.step.failed') {
        setStreaming(false)
      }

      // Live message updates
      setMessages((prev) => {
        const next = [...prev]
        let lastMsg = next[next.length - 1]

        if (type === 'session.next.prompted') {
          const userMsgId = data.messageID || ev.id
          if (!next.some((m) => m.id === userMsgId)) {
            next.push({
              id: userMsgId,
              role: 'user',
              text: data.prompt?.text || data.text || '',
              timestamp: data.timestamp || Date.now(),
            })
          }
        } else if (type === 'session.next.step.started') {
          const asstId = data.assistantMessageID || `asst_${ev.id}`
          if (!lastMsg || lastMsg.id !== asstId) {
            next.push({
              id: asstId,
              role: 'assistant',
              agent: data.agent,
              model: data.model,
              reasoning: '',
              text: '',
              tools: [],
              status: 'streaming',
              timestamp: data.timestamp || Date.now(),
            })
          }
        } else if (type === 'session.next.reasoning.delta') {
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg = { ...lastMsg, reasoning: (lastMsg.reasoning || '') + (data.delta || '') }
            next[next.length - 1] = lastMsg
          }
        } else if (type === 'session.next.text.delta') {
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg = { ...lastMsg, text: (lastMsg.text || '') + (data.delta || data.text || '') }
            next[next.length - 1] = lastMsg
          }
        } else if (type === 'session.next.tool.called') {
          if (lastMsg && lastMsg.role === 'assistant') {
            const tools = [...(lastMsg.tools || [])]
            if (!tools.some((t) => t.callID === data.callID)) {
              tools.push({
                callID: data.callID,
                name: data.name,
                input: data.input,
                status: 'running',
              })
              next[next.length - 1] = { ...lastMsg, tools }
            }
          }
        } else if (type === 'session.next.tool.progress') {
          if (lastMsg && lastMsg.role === 'assistant') {
            const tools = (lastMsg.tools || []).map((t) =>
              t.callID === data.callID ? { ...t, progress: data.progress } : t
            )
            next[next.length - 1] = { ...lastMsg, tools }
          }
        } else if (type === 'session.next.tool.success') {
          if (lastMsg && lastMsg.role === 'assistant') {
            const tools = (lastMsg.tools || []).map((t) =>
              t.callID === data.callID ? { ...t, status: 'success', output: data.output } : t
            )
            next[next.length - 1] = { ...lastMsg, tools }
          }
        } else if (type === 'session.next.tool.failed') {
          if (lastMsg && lastMsg.role === 'assistant') {
            const tools = (lastMsg.tools || []).map((t) =>
              t.callID === data.callID ? { ...t, status: 'failed', error: data.error } : t
            )
            next[next.length - 1] = { ...lastMsg, tools }
          }
        } else if (type === 'session.next.step.ended') {
          if (lastMsg && lastMsg.role === 'assistant') {
            next[next.length - 1] = { ...lastMsg, status: 'complete' }
          }
        } else if (type === 'session.next.step.failed') {
          if (lastMsg && lastMsg.role === 'assistant') {
            next[next.length - 1] = {
              ...lastMsg,
              status: 'failed',
              error: data.error?.message || 'Execution failed',
            }
          }
        }

        return next
      })
    },
    []
  )

  // -------------------------------------------------------------------------
  // Mount: start check & SSE subscription
  // -------------------------------------------------------------------------
  useEffect(() => {
    let unsubscribe = null

    async function init() {
      const status = await checkStatus()
      if (status.running) {
        await loadInitialData()
      } else {
        // Auto-start OpenCode if stopped
        await startServer()
      }

      unsubscribe = opencode.subscribeEvents(handleEvent, (err) => {
        console.warn('OpenCode SSE error:', err)
      })
    }

    init()

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [checkStatus, handleEvent, loadInitialData, startServer])

  // Auto-scroll on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streaming])

  // -------------------------------------------------------------------------
  // User Actions
  // -------------------------------------------------------------------------
  const handleCreateSession = async () => {
    try {
      const newSession = await opencode.createSession({})
      setSessions((prev) => [newSession, ...prev])
      setActiveSessionId(newSession.id)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  const handleDeleteSession = async (e, sid) => {
    e.stopPropagation()
    try {
      await opencode.deleteSession(sid)
      setSessions((prev) => prev.filter((s) => s.id !== sid))
      if (activeSessionId === sid) {
        const remaining = sessions.filter((s) => s.id !== sid)
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  const handleSendPrompt = async (textToSend) => {
    const text = (textToSend ?? promptText).trim()
    if (!text || streaming) return

    let sid = activeSessionId
    if (!sid) {
      try {
        const created = await opencode.createSession({})
        setSessions((prev) => [created, ...prev])
        setActiveSessionId(created.id)
        sid = created.id
      } catch (err) {
        console.error('Failed to create session for prompt:', err)
        return
      }
    }

    setPromptText('')
    setStreaming(true)

    try {
      await opencode.prompt(sid, text)
    } catch (err) {
      console.error('Prompt error:', err)
      setStreaming(false)
    }
  }

  const handleInterrupt = async () => {
    if (!activeSessionId) return
    try {
      await opencode.interrupt(activeSessionId)
      setStreaming(false)
    } catch (err) {
      console.error('Interrupt failed:', err)
    }
  }

  const handleAgentChange = async (e) => {
    const newAgent = e.target.value
    setCurrentAgent(newAgent)
    if (activeSessionId) {
      try {
        await opencode.switchAgent(activeSessionId, newAgent)
      } catch (err) {
        console.warn('Switch agent error:', err)
      }
    }
  }

  const handleModelChange = async (e) => {
    const newModel = e.target.value
    setCurrentModel(newModel)
    if (activeSessionId) {
      try {
        await opencode.switchModel(activeSessionId, newModel)
      } catch (err) {
        console.warn('Switch model error:', err)
      }
    }
  }

  const handlePermissionReply = async (requestId, reply) => {
    if (!activeSessionId) return
    try {
      await opencode.replyPermission(activeSessionId, requestId, reply)
      setPendingPermissions((prev) => prev.filter((p) => p.id !== requestId))
    } catch (err) {
      console.error('Failed to reply permission:', err)
    }
  }

  const toggleReasoning = (msgId) => {
    setExpandedReasoning((prev) => ({ ...prev, [msgId]: !prev[msgId] }))
  }

  const toggleTool = (callId) => {
    setExpandedTools((prev) => ({ ...prev, [callId]: !prev[callId] }))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendPrompt()
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="code-view">
      {/* Top Header */}
      <header className="code-header">
        <div className="code-header-left">
          <div className="code-brand">
            <Icon name="code" size={18} />
            <span>Code Mode</span>
          </div>

          <div className="code-status-badge">
            <span
              className={`code-status-dot ${
                serverStatus.loading ? 'starting' : serverStatus.running ? 'running' : 'stopped'
              }`}
            />
            <span>
              {serverStatus.loading
                ? 'Connecting...'
                : serverStatus.running
                ? 'OpenCode Connected'
                : 'OpenCode Stopped'}
            </span>
            {serverStatus.port && <span className="code-port-pill">:{serverStatus.port}</span>}
          </div>
        </div>

        <div className="code-header-right">
          {serverStatus.running ? (
            <button
              type="button"
              className="code-btn"
              onClick={stopServer}
              title="Stop local OpenCode process"
            >
              <Icon name="stop" size={14} />
              <span>Stop Server</span>
            </button>
          ) : (
            <button
              type="button"
              className="code-btn code-btn-primary"
              onClick={startServer}
              disabled={serverStatus.loading}
            >
              <Icon name="play" size={14} />
              <span>Start OpenCode</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div className="code-layout">
        {/* Sessions Sidebar */}
        <aside className="code-sidebar">
          <div className="code-sidebar-header">
            <span className="code-sidebar-title">Sessions</span>
            <button
              type="button"
              className="code-btn code-btn-icon"
              onClick={handleCreateSession}
              title="New session"
            >
              <Icon name="plus" size={14} />
            </button>
          </div>

          <div className="code-sessions-list">
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId
              return (
                <div
                  key={s.id}
                  className={`code-session-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveSessionId(s.id)}
                >
                  <div className="code-session-info">
                    <span className="code-session-title">{s.title || s.id}</span>
                    <span className="code-session-meta">
                      {timeAgo(s.time?.updated || s.time?.created)}
                    </span>
                  </div>

                  <div className="code-session-actions">
                    <button
                      type="button"
                      className="code-session-del-btn"
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      title="Delete session"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
              )
            })}

            {sessions.length === 0 && (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '13px' }}>
                No sessions yet.
              </div>
            )}
          </div>
        </aside>

        {/* Workspace Canvas */}
        <main className="code-main">
          {/* Sub-toolbar: Agents, Models, Token Stats */}
          <div className="code-toolbar">
            <div className="code-selectors">
              {/* Agent Selector */}
              <div className="code-select-group">
                <span className="code-select-label">Agent</span>
                <select
                  className="code-select"
                  value={currentAgent}
                  onChange={handleAgentChange}
                  disabled={!serverStatus.running}
                >
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.id} {ag.mode ? `(${ag.mode})` : ''}
                    </option>
                  ))}
                  {agents.length === 0 && <option value="build">build</option>}
                </select>
              </div>

              {/* Model Selector */}
              <div className="code-select-group">
                <span className="code-select-label">Model</span>
                <select
                  className="code-select"
                  value={currentModel}
                  onChange={handleModelChange}
                  disabled={!serverStatus.running}
                >
                  {models.map((m) => {
                    const id = typeof m === 'string' ? m : m.id || m.name
                    const label = typeof m === 'string' ? m : m.name || m.id
                    return (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    )
                  })}
                  {models.length === 0 && <option value="">Default Model</option>}
                </select>
              </div>
            </div>

            {/* Token Stats Chip */}
            <div className="code-tokens-chip" title="Session token consumption">
              <Icon name="cpu" size={13} />
              <span>In: {formatTokens(tokenUsage.input)}</span>
              <span>•</span>
              <span>Out: {formatTokens(tokenUsage.output)}</span>
              {tokenUsage.reasoning > 0 && (
                <>
                  <span>•</span>
                  <span>Think: {formatTokens(tokenUsage.reasoning)}</span>
                </>
              )}
            </div>
          </div>

          {/* Messages stream */}
          <div className="code-canvas">
            {messages.length === 0 && (
              <div className="code-empty-state">
                <div className="code-empty-icon">
                  <Icon name="code" size={28} />
                </div>
                <h3 className="code-empty-title">Complete OpenCode Engine</h3>
                <p className="code-empty-desc">
                  Native Amethyst interface with full OpenCode parity: real subprocess runtime,
                  streaming tokens, autonomous tool execution, and permission controls.
                </p>

                <div className="code-prompt-suggestions">
                  <button
                    type="button"
                    className="code-suggestion-chip"
                    onClick={() => handleSendPrompt('Analyze this repository structure and give me a summary')}
                  >
                    Analyze this repository structure and give me a summary
                  </button>
                  <button
                    type="button"
                    className="code-suggestion-chip"
                    onClick={() => handleSendPrompt('List all git branches and recent commits')}
                  >
                    List all git branches and recent commits
                  </button>
                  <button
                    type="button"
                    className="code-suggestion-chip"
                    onClick={() => handleSendPrompt('Inspect the test suite and run tests')}
                  >
                    Inspect the test suite and run tests
                  </button>
                </div>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="code-msg-user">
                    <div className="code-msg-user-bubble">{msg.text}</div>
                    <span className="code-msg-time">{timeAgo(msg.timestamp)}</span>
                  </div>
                )
              }

              // Assistant message
              const isReasoningOpen = Boolean(expandedReasoning[msg.id])

              return (
                <div key={msg.id} className="code-msg-assistant">
                  <div className="code-msg-meta">
                    <span className="code-agent-tag">
                      <Icon name="sparkle" size={12} />
                      {msg.agent || currentAgent || 'assistant'}
                    </span>
                    {msg.model?.id && <span>{msg.model.id}</span>}
                    <span>{timeAgo(msg.timestamp)}</span>
                  </div>

                  <div className="code-msg-body">
                    {/* Collapsible Reasoning Block */}
                    {msg.reasoning && (
                      <div className="code-reasoning-box">
                        <div
                          className="code-reasoning-header"
                          onClick={() => toggleReasoning(msg.id)}
                        >
                          <div className="code-reasoning-title">
                            <Icon name="brain" size={13} />
                            <span>Thought Process ({msg.reasoning.length} chars)</span>
                          </div>
                          <Icon name={isReasoningOpen ? 'caret-up' : 'caret-down'} size={13} />
                        </div>
                        {isReasoningOpen && (
                          <div className="code-reasoning-content">{msg.reasoning}</div>
                        )}
                      </div>
                    )}

                    {/* Markdown Message Text */}
                    {msg.text && <Markdown text={msg.text} />}

                    {/* Tool Calls */}
                    {msg.tools &&
                      msg.tools.map((tool) => {
                        const isToolOpen = expandedTools[tool.callID] !== false
                        return (
                          <div key={tool.callID} className="code-tool-card">
                            <div
                              className="code-tool-header"
                              onClick={() => toggleTool(tool.callID)}
                            >
                              <div className="code-tool-name">
                                <Icon name="terminal" size={13} />
                                <span>{tool.name}</span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className={`code-tool-badge ${tool.status}`}>
                                  {tool.status === 'running' && (
                                    <>
                                      <Icon name="circle-notch" size={11} className="spin" />
                                      Running...
                                    </>
                                  )}
                                  {tool.status === 'success' && (
                                    <>
                                      <Icon name="check" size={11} />
                                      Completed
                                    </>
                                  )}
                                  {tool.status === 'failed' && (
                                    <>
                                      <Icon name="warning-circle" size={11} />
                                      Failed
                                    </>
                                  )}
                                </span>
                                <Icon name={isToolOpen ? 'caret-up' : 'caret-down'} size={12} />
                              </div>
                            </div>

                            {isToolOpen && (
                              <div className="code-tool-body">
                                {tool.input && (
                                  <div className="code-tool-input">
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                      {typeof tool.input === 'string'
                                        ? tool.input
                                        : JSON.stringify(tool.input, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {tool.output && (
                                  <div className="code-tool-output">
                                    {typeof tool.output === 'string'
                                      ? tool.output
                                      : JSON.stringify(tool.output, null, 2)}
                                  </div>
                                )}
                                {tool.error && (
                                  <div style={{ color: 'var(--stop)', marginTop: '4px' }}>
                                    Error:{' '}
                                    {typeof tool.error === 'string'
                                      ? tool.error
                                      : tool.error.message || JSON.stringify(tool.error)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}

                    {/* Error Banner */}
                    {msg.error && (
                      <div
                        style={{
                          background: 'var(--stop-soft)',
                          border: '1px solid var(--stop-line)',
                          color: 'var(--stop)',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          marginTop: '8px',
                          fontSize: '13px',
                        }}
                      >
                        <strong>Execution Stopped:</strong> {msg.error}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Pending Permission Banners */}
            {pendingPermissions.map((perm) => (
              <div key={perm.id} className="code-permission-banner">
                <div className="code-perm-head">
                  <div className="code-perm-icon">
                    <Icon name="shield" size={16} />
                  </div>
                  <div className="code-perm-title">
                    Approval Required: {perm.action}
                  </div>
                </div>

                <div className="code-perm-details">
                  {perm.resources && perm.resources.length > 0 && (
                    <div>
                      <strong>Target:</strong> {perm.resources.join(', ')}
                    </div>
                  )}
                  {perm.metadata && Object.keys(perm.metadata).length > 0 && (
                    <div style={{ marginTop: '4px' }}>
                      {JSON.stringify(perm.metadata, null, 2)}
                    </div>
                  )}
                </div>

                <div className="code-perm-actions">
                  <button
                    type="button"
                    className="code-btn code-btn-danger"
                    onClick={() => handlePermissionReply(perm.id, 'reject')}
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    className="code-btn"
                    onClick={() => handlePermissionReply(perm.id, 'always')}
                  >
                    Allow Always
                  </button>
                  <button
                    type="button"
                    className="code-btn code-btn-primary"
                    onClick={() => handlePermissionReply(perm.id, 'once')}
                  >
                    Allow Once
                  </button>
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Composer */}
          <div className="code-composer-wrap">
            <div className="code-composer-box">
              <textarea
                ref={textareaRef}
                className="code-textarea"
                rows={2}
                placeholder={
                  serverStatus.running
                    ? 'Ask OpenCode to code, debug, refactor or run commands... (Enter to send)'
                    : 'Start OpenCode server to begin...'
                }
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!serverStatus.running}
              />

              <div className="code-composer-bottom">
                <span className="code-composer-hint">Shift + Enter for new line</span>

                <div className="code-composer-actions">
                  {streaming ? (
                    <button
                      type="button"
                      className="code-interrupt-btn"
                      onClick={handleInterrupt}
                      title="Interrupt turn"
                    >
                      <Icon name="stop" size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="code-send-btn"
                      onClick={() => handleSendPrompt()}
                      disabled={!serverStatus.running || !promptText.trim()}
                      title="Send message"
                    >
                      <Icon name="arrow-up" size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
