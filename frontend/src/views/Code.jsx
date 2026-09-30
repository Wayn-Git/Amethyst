import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Markdown from '../components/markdown/Markdown.jsx'
import opencode from '../lib/opencode.js'
import { useApp } from '../store.jsx'
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

function formatSessionTitle(title) {
  if (!title) return 'New Session'
  if (title.startsWith('New session - 20')) {
    return 'New Session'
  }
  return title
}

const AGENT_CONFIGS = {
  build: {
    name: 'Build',
    icon: 'gear',
    desc: 'Full development agent. Executes tools, edits code, runs commands.',
  },
  plan: {
    name: 'Plan',
    icon: 'target',
    desc: 'Architect & planning mode. Read-only codebase analysis without edits.',
  },
  explore: {
    name: 'Explore',
    icon: 'search',
    desc: 'Fast codebase search and directory navigation agent.',
  },
  general: {
    name: 'General',
    icon: 'chat',
    desc: 'Multi-turn reasoning and general technical research.',
  },
}

function getAgentMeta(id) {
  const norm = (id || 'build').toLowerCase()
  if (AGENT_CONFIGS[norm]) return AGENT_CONFIGS[norm]
  return {
    name: id.charAt(0).toUpperCase() + id.slice(1),
    icon: 'sparkle',
    desc: 'Custom OpenCode agent.',
  }
}

export default function Code() {
  const { setView } = useApp()

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
  const [sessionSearch, setSessionSearch] = useState('')
  const [editingSessionId, setEditingSessionId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')

  const [agents, setAgents] = useState([])
  const [models, setModels] = useState([])
  const [currentAgent, setCurrentAgent] = useState('build')
  const [currentModel, setCurrentModel] = useState(() => {
    return localStorage.getItem('amethyst_code_model') || 'opencode/mimo-v2.6-flash-free'
  })

  // OpenCode Settings & Providers Config
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsTab, setSettingsTab] = useState('providers') // 'providers' | 'models' | 'agents' | 'config'
  const [syncingAmethyst, setSyncingAmethyst] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState(null)
  const [openCodeConfig, setOpenCodeConfig] = useState(null)
  const [openCodeProviders, setOpenCodeProviders] = useState({ all: [], connected: [], default: {} })
  const [newProviderId, setNewProviderId] = useState('anthropic')
  const [newProviderKey, setNewProviderKey] = useState('')
  const [configJsonText, setConfigJsonText] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)

  // Modal / Dropdown states
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [modelTab, setModelTab] = useState('amethyst') // 'amethyst' | 'free' | 'connected'
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)

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
  const modelSearchInputRef = useRef(null)
  const modelSelectorRef = useRef(null)
  const agentDropdownRef = useRef(null)
  const sessionsListRef = useRef(null)
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

  const refreshOpenCodeConfig = useCallback(async () => {
    try {
      const [cfg, provs] = await Promise.all([
        opencode.getConfig().catch(() => null),
        opencode.listProviders().catch(() => ({ all: [], connected: [] })),
      ])
      if (cfg) {
        setOpenCodeConfig(cfg)
        setConfigJsonText(JSON.stringify(cfg, null, 2))
      }
      if (provs) {
        setOpenCodeProviders(provs)
      }
    } catch (err) {
      console.warn('Failed to refresh OpenCode config:', err)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Initial Data Loading
  // -------------------------------------------------------------------------
  const loadInitialData = useCallback(async () => {
    try {
      const [agentsList, modelsList, sessionsList, cfg, provs] = await Promise.all([
        opencode.listAgents().catch(() => []),
        opencode.listModels().catch(() => []),
        opencode.listSessions().catch(() => []),
        opencode.getConfig().catch(() => null),
        opencode.listProviders().catch(() => ({ all: [], connected: [] })),
      ])

      // Filter internal helper agents
      const visibleAgents = agentsList.filter(
        (a) => !['compaction', 'summary', 'title'].includes(a.name || a.id)
      )

      // Sort models: Amethyst providers first, then free models, then other connected
      const sortedModels = [...modelsList].sort((a, b) => {
        const aAmethyst = a.isAmethyst ? 1 : 0
        const bAmethyst = b.isAmethyst ? 1 : 0
        if (aAmethyst !== bAmethyst) return bAmethyst - aAmethyst
        const aFree = a.isFree ? 1 : 0
        const bFree = b.isFree ? 1 : 0
        if (aFree !== bFree) return bFree - aFree
        const aConn = a.connected ? 1 : 0
        const bConn = b.connected ? 1 : 0
        return bConn - aConn
      })

      setAgents(visibleAgents)
      setModels(sortedModels)
      setSessions(sessionsList)
      if (cfg) {
        setOpenCodeConfig(cfg)
        setConfigJsonText(JSON.stringify(cfg, null, 2))
      }
      if (provs) {
        setOpenCodeProviders(provs)
      }

      // Ensure model exists in available models or pick default model
      if (sortedModels.length > 0) {
        const saved = localStorage.getItem('amethyst_code_model')
        const match = sortedModels.find((m) => `${m.providerID || 'opencode'}/${m.id}` === saved)
        if (match) {
          setCurrentModel(saved)
        } else {
          const preferred =
            sortedModels.find((m) => m.isAmethyst && m.id.includes('space-bunny')) ||
            sortedModels.find((m) => m.isAmethyst && m.id.includes('ministral')) ||
            sortedModels.find((m) => m.id === 'mimo-v2.6-flash-free') ||
            sortedModels.find((m) => m.isAmethyst) ||
            sortedModels.find((m) => m.isFree) ||
            sortedModels[0]
          const val = `${preferred.providerID || 'opencode'}/${preferred.id}`
          setCurrentModel(val)
          localStorage.setItem('amethyst_code_model', val)
        }
      }

      if (sessionsList.length > 0 && !activeSessionRef.current) {
        setActiveSessionId(sessionsList[0].id)
      }
    } catch (err) {
      console.error('Failed to load initial OpenCode data:', err)
    }
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
        const [messagesRes, sessionRes, permRes] = await Promise.all([
          opencode.getMessages(activeSessionId).catch(() => []),
          opencode.getSession(activeSessionId).catch(() => null),
          opencode.listPermissions().catch(() => []),
        ])

        if (!isSubscribed) return

        const rawMsgs = Array.isArray(messagesRes) ? messagesRes : messagesRes?.data || []
        const parsedMsgs = rawMsgs.map((m) => {
          const info = m.info || m
          const parts = m.parts || []
          const role = info.role || 'assistant'
          const textParts = parts.filter((p) => p.type === 'text')
          const reasoningParts = parts.filter((p) => p.type === 'reasoning')
          const toolParts = parts.filter((p) => p.type === 'tool')

          const text = textParts.map((p) => p.text).join('')
          const reasoning = reasoningParts.map((p) => p.text).join('')
          const tools = toolParts.map((p) => ({
            callID: p.callID || p.id,
            name: p.tool || p.name,
            input: p.state?.input || p.input,
            output: p.state?.output || p.output,
            error: p.state?.error || p.error,
            status: p.state?.status || (p.state?.error ? 'failed' : p.state?.output ? 'success' : 'running'),
          }))

          return {
            id: info.id,
            role,
            agent: info.agent,
            model: info.modelID || (info.model ? `${info.model.providerID}/${info.model.modelID || info.model.id}` : ''),
            text: text || info.text || '',
            reasoning,
            tools,
            error: info.error?.data?.message || info.error?.message,
            status: info.time?.completed ? 'complete' : info.error ? 'failed' : 'complete',
            timestamp: info.time?.created || Date.now(),
          }
        })

        setMessages(parsedMsgs)

        if (sessionRes?.tokens) {
          setTokenUsage({
            input: sessionRes.tokens.input || 0,
            output: sessionRes.tokens.output || 0,
            reasoning: sessionRes.tokens.reasoning || 0,
            cost: sessionRes.cost || 0,
          })
        }

        const perms = Array.isArray(permRes) ? permRes : permRes?.data || []
        setPendingPermissions(perms.filter((p) => !p.sessionID || p.sessionID === activeSessionId))
      } catch (err) {
        console.error('Failed to load session history:', err)
      }
    }

    loadSession()
    return () => {
      isSubscribed = false
    }
  }, [activeSessionId])

  // -------------------------------------------------------------------------
  // Event Routing (SSE)
  // -------------------------------------------------------------------------
  const handleEvent = useCallback(
    (ev) => {
      const type = ev.type
      const props = ev.properties || ev.data || {}
      const targetSid = props.sessionID || props.info?.sessionID || props.part?.sessionID

      // Permission events
      if (type === 'permission.asked' || type === 'permission.v2.asked') {
        if (!targetSid || targetSid === activeSessionRef.current) {
          setPendingPermissions((prev) => {
            const exists = prev.some((p) => p.id === props.id)
            return exists ? prev : [...prev, props]
          })
        }
        return
      }

      if (type === 'permission.replied' || type === 'permission.v2.replied') {
        setPendingPermissions((prev) => prev.filter((p) => p.id !== props.id && p.id !== props.requestID))
        return
      }

      // Filter events by active session
      if (targetSid && targetSid !== activeSessionRef.current) {
        return
      }

      // Session context & status updates
      if (type === 'session.updated' && props.info?.tokens) {
        setTokenUsage({
          input: props.info.tokens.input || 0,
          output: props.info.tokens.output || 0,
          reasoning: props.info.tokens.reasoning || 0,
          cost: props.info.cost || 0,
        })
      }

      if (type === 'session.idle') {
        setStreaming(false)
        return
      }

      if (type === 'session.error') {
        setStreaming(false)
        const errObj = props.error?.data?.message || props.error?.message || 'OpenCode execution error'
        setMessages((prev) => {
          const next = [...prev]
          if (next.length > 0 && next[next.length - 1].role === 'assistant') {
            next[next.length - 1] = {
              ...next[next.length - 1],
              status: 'failed',
              error: errObj,
            }
          }
          return next
        })
        return
      }

      // Live message updates
      if (type === 'message.updated') {
        const info = props.info
        if (!info) return
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === info.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = {
              ...next[idx],
              error: info.error?.data?.message || info.error?.message,
              status: info.time?.completed ? 'complete' : info.error ? 'failed' : next[idx].status,
            }
            return next
          }

          // User message reconciliation to avoid duplicates
          if (info.role === 'user') {
            const optIdx = prev.findIndex((m) => m.isOptimistic)
            if (optIdx >= 0) {
              const next = [...prev]
              next[optIdx] = {
                ...next[optIdx],
                id: info.id,
                isOptimistic: false,
              }
              return next
            }
          }

          // New message
          return [
            ...prev,
            {
              id: info.id,
              role: info.role,
              agent: info.agent,
              model: info.modelID || (info.model ? `${info.model.providerID}/${info.model.modelID || info.model.id}` : ''),
              text: '',
              reasoning: '',
              tools: [],
              status: info.role === 'assistant' ? 'streaming' : 'complete',
              timestamp: info.time?.created || Date.now(),
            },
          ]
        })
      }

      if (type === 'message.part.updated') {
        const part = props.part
        if (!part) return
        setMessages((prev) => {
          const next = [...prev]
          let asstIdx = next.findIndex((m) => m.id === part.messageID)
          if (asstIdx === -1) {
            next.push({
              id: part.messageID,
              role: 'assistant',
              text: '',
              reasoning: '',
              tools: [],
              status: 'streaming',
              timestamp: Date.now(),
            })
            asstIdx = next.length - 1
          }

          const target = { ...next[asstIdx] }

          if (part.type === 'text') {
            target.text = part.text || (target.text + (props.delta || ''))
          } else if (part.type === 'reasoning') {
            target.reasoning = part.text || (target.reasoning + (props.delta || ''))
          } else if (part.type === 'tool') {
            const tools = [...(target.tools || [])]
            const tIdx = tools.findIndex((t) => t.callID === (part.callID || part.id))
            const toolItem = {
              callID: part.callID || part.id,
              name: part.tool || part.name,
              input: part.state?.input || part.input,
              output: part.state?.output || part.output,
              error: part.state?.error || part.error,
              status: part.state?.status || (part.state?.error ? 'failed' : part.state?.output ? 'success' : 'running'),
            }
            if (tIdx >= 0) {
              tools[tIdx] = toolItem
            } else {
              tools.push(toolItem)
            }
            target.tools = tools
          }

          next[asstIdx] = target
          return next
        })
      }
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

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+N / Cmd+N -> New Session
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleCreateSession()
      }
      // Escape closes modals and dropdowns
      if (e.key === 'Escape') {
        setShowModelPicker(false)
        setShowAgentDropdown(false)
        setEditingSessionId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentAgent, currentModel])

  // Click outside to close agent dropdown and model popover
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target)) {
        setShowAgentDropdown(false)
      }
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target)) {
        setShowModelPicker(false)
      }
    }
    if (showAgentDropdown || showModelPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAgentDropdown, showModelPicker])

  // Auto-scroll on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streaming])

  // -------------------------------------------------------------------------
  // User Actions: Sessions
  // -------------------------------------------------------------------------
  const handleCreateSession = async () => {
    try {
      let modelPayload = undefined
      if (currentModel) {
        if (currentModel.includes('/')) {
          const [pId, ...rest] = currentModel.split('/')
          modelPayload = { providerID: pId, id: rest.join('/') }
        } else {
          modelPayload = { providerID: 'opencode', id: currentModel }
        }
      }
      let newSession
      try {
        newSession = await opencode.createSession({
          agent: currentAgent || 'build',
          model: modelPayload,
        })
      } catch (err) {
        console.warn('Creating session with model payload failed, falling back to default:', err)
        newSession = await opencode.createSession({
          agent: currentAgent || 'build',
        })
      }
      if (newSession && newSession.id) {
        setSessions((prev) => [newSession, ...prev.filter((s) => s.id !== newSession.id)])
        setActiveSessionId(newSession.id)
        setMessages([])
        setPromptText('')
        setSessionSearch('')
        sessionsListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        setTimeout(() => textareaRef.current?.focus(), 80)
      }
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  const handleStartRename = (e, s) => {
    e.stopPropagation()
    setEditingSessionId(s.id)
    setEditingTitle(s.title || '')
  }

  const handleSaveRename = async (e, sid) => {
    e?.stopPropagation()
    const trimmed = editingTitle.trim()
    if (!trimmed) {
      setEditingSessionId(null)
      return
    }
    try {
      await opencode.updateSession(sid, { title: trimmed })
      setSessions((prev) =>
        prev.map((s) => (s.id === sid ? { ...s, title: trimmed } : s))
      )
    } catch (err) {
      console.error('Failed to rename session:', err)
    } finally {
      setEditingSessionId(null)
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

  // -------------------------------------------------------------------------
  // OpenCode Config & Amethyst Sync Actions
  // -------------------------------------------------------------------------
  const handleSyncAmethyst = async () => {
    setSyncingAmethyst(true)
    setSyncFeedback(null)
    try {
      const res = await opencode.syncAmethyst()
      const synced = res.synced || []
      const failed = res.failed || []
      if (synced.length > 0) {
        setSyncFeedback(`✓ Synced ${synced.length} providers from Amethyst: ${synced.join(', ')}`)
      } else if (failed.length > 0) {
        setSyncFeedback(`Sync had issues: ${failed.join(', ')}`)
      } else {
        setSyncFeedback('Amethyst configuration is up to date.')
      }
      await loadInitialData()
      await refreshOpenCodeConfig()
    } catch (err) {
      console.error('Failed to sync Amethyst:', err)
      setSyncFeedback(`Sync failed: ${err.message || String(err)}`)
    } finally {
      setSyncingAmethyst(false)
      setTimeout(() => setSyncFeedback(null), 6000)
    }
  }

  const handleConnectProvider = async () => {
    if (!newProviderId || !newProviderKey.trim()) return
    try {
      await opencode.setAuth(newProviderId, newProviderKey.trim())
      setNewProviderKey('')
      await loadInitialData()
      await refreshOpenCodeConfig()
      setSyncFeedback(`✓ Connected provider ${newProviderId} successfully.`)
      setTimeout(() => setSyncFeedback(null), 4000)
    } catch (err) {
      console.error('Failed to connect provider:', err)
      alert(`Failed to connect provider: ${err.message}`)
    }
  }

  const handleDisconnectProvider = async (providerID) => {
    try {
      await opencode.removeAuth(providerID)
      await loadInitialData()
      await refreshOpenCodeConfig()
    } catch (err) {
      console.error('Failed to disconnect provider:', err)
    }
  }

  const handleSaveDefaultModels = async (defaultModel, defaultSmallModel) => {
    try {
      await opencode.updateConfig({
        ...(defaultModel ? { model: defaultModel } : {}),
        ...(defaultSmallModel ? { small_model: defaultSmallModel } : {}),
      })
      await refreshOpenCodeConfig()
      setSyncFeedback('Default models updated in OpenCode configuration.')
      setTimeout(() => setSyncFeedback(null), 4000)
    } catch (err) {
      console.error('Failed to update default models:', err)
    }
  }

  const handleSaveRawConfig = async () => {
    setSavingConfig(true)
    try {
      const parsed = JSON.parse(configJsonText)
      await opencode.updateConfig(parsed)
      await refreshOpenCodeConfig()
      await loadInitialData()
      setSyncFeedback('OpenCode configuration updated successfully.')
      setTimeout(() => setSyncFeedback(null), 4000)
    } catch (err) {
      console.error('Failed to save raw config:', err)
      alert(`Invalid JSON or update error: ${err.message}`)
    } finally {
      setSavingConfig(false)
    }
  }

  // -------------------------------------------------------------------------
  // User Actions: Prompts & Interactions
  // -------------------------------------------------------------------------
  const handleSendPrompt = async (textToSend) => {
    const text = (textToSend ?? promptText).trim()
    if (!text || streaming) return

    let sid = activeSessionId
    if (!sid) {
      try {
        let modelPayload = undefined
        if (currentModel) {
          if (currentModel.includes('/')) {
            const [pId, ...rest] = currentModel.split('/')
            modelPayload = { providerID: pId, id: rest.join('/') }
          } else {
            modelPayload = { providerID: 'opencode', id: currentModel }
          }
        }
        let created
        try {
          created = await opencode.createSession({
            agent: currentAgent || 'build',
            model: modelPayload,
          })
        } catch {
          created = await opencode.createSession({
            agent: currentAgent || 'build',
          })
        }
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

    // Append optimistic user message tagged for deduplication
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text,
        isOptimistic: true,
        timestamp: Date.now(),
      },
    ])

    try {
      let modelPayload = undefined
      if (currentModel) {
        if (currentModel.includes('/')) {
          const [pId, ...rest] = currentModel.split('/')
          modelPayload = { providerID: pId, modelID: rest.join('/') }
        } else {
          modelPayload = { providerID: 'opencode', modelID: currentModel }
        }
      }
      await opencode.prompt(sid, text, {
        model: modelPayload,
        agent: currentAgent,
      })
    } catch (err) {
      console.error('Prompt error:', err)
      setStreaming(false)
    }
  }


  const selectedModelObj = useMemo(() => {
    if (!currentModel) return null
    return models.find((m) => `${m.providerID || 'opencode'}/${m.id}` === currentModel) || null
  }, [models, currentModel])

  const agentMeta = getAgentMeta(currentAgent)

  return (
    <div className="code-view">
      {/* Top Header with Mode Toggle & Subprocess Health */}
      <header className="code-header">
        <div className="code-header-left">
          {/* Top Mode Switcher (Work | Code) */}
          <div className="wb-mode-switcher">
            <button
              type="button"
              className="wb-mode-btn"
              onClick={() => setView?.('chat')}
              title="Work Mode (Conversations & General Assistant)"
            >
              <Icon name="chat" size={14} />
              <span>Work</span>
            </button>
            <button
              type="button"
              className="wb-mode-btn is-active"
              title="Code Mode (OpenCode Engine)"
            >
              <Icon name="code" size={14} />
              <span>Code</span>
            </button>
          </div>

          <div className="code-brand">
            <Icon name="code" size={17} />
            <span>OpenCode Engine</span>
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
                ? 'Connected'
                : 'Stopped'}
            </span>
            {serverStatus.port && <span className="code-port-pill">:{serverStatus.port}</span>}
          </div>
        </div>

        <div className="code-header-right">
          <button
            type="button"
            className="code-btn"
            onClick={() => {
              setShowSettingsModal(true)
              refreshOpenCodeConfig()
            }}
            title="OpenCode Configuration, Providers & API Keys"
          >
            <Icon name="gear" size={14} />
            <span>OpenCode Config</span>
          </button>
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
            <div className="code-sidebar-header-title">
              <span>Sessions</span>
              <span className="code-sidebar-count">{sessions.length}</span>
            </div>
            <button
              type="button"
              className="code-new-session-btn"
              onClick={handleCreateSession}
              title="Create new session (Ctrl+N / Cmd+N)"
            >
              <Icon name="plus" size={14} />
              <span>New Session</span>
            </button>
          </div>

          {/* Session Search */}
          <div className="code-sidebar-search-box">
            <Icon name="search" size={13} className="code-sidebar-search-icon" />
            <input
              type="text"
              className="code-sidebar-search-input"
              placeholder="Filter sessions..."
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
            />
            {sessionSearch && (
              <button
                type="button"
                className="code-sidebar-search-clear"
                onClick={() => setSessionSearch('')}
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </div>

          {/* Sessions List */}
          <div className="code-sessions-list" ref={sessionsListRef}>
            {filteredSessions.map((s) => {
              const isActive = s.id === activeSessionId
              const isEditing = s.id === editingSessionId

              return (
                <div
                  key={s.id}
                  className={`code-session-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveSessionId(s.id)}
                >
                  <div className="code-session-info">
                    {isEditing ? (
                      <input
                        type="text"
                        className="code-session-edit-input"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(e, s.id)
                          if (e.key === 'Escape') setEditingSessionId(null)
                        }}
                        onBlur={(e) => handleSaveRename(e, s.id)}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="code-session-title">{formatSessionTitle(s.title || s.id)}</span>
                    )}
                    <span className="code-session-meta">
                      {timeAgo(s.time?.updated || s.time?.created)}
                    </span>
                  </div>

                  <div className="code-session-actions">
                    <button
                      type="button"
                      className="code-session-action-btn"
                      onClick={(e) => handleStartRename(e, s)}
                      title="Rename session"
                    >
                      <Icon name="edit" size={12} />
                    </button>
                    <button
                      type="button"
                      className="code-session-action-btn delete"
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      title="Delete session"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              )
            })}

            {filteredSessions.length === 0 && (
              <div className="code-sidebar-empty">
                {sessionSearch ? 'No matching sessions.' : 'No sessions yet.'}
              </div>
            )}
          </div>
        </aside>

        {/* Workspace Canvas */}
        <main className="code-main">
          {/* Sub-toolbar: Rich Pickers & Token Stats */}
          <div className="code-toolbar">
            <div className="code-selectors">
              {/* Agent Picker Dropdown */}
              <div className="code-dropdown-wrap" ref={agentDropdownRef}>
                <button
                  type="button"
                  className={`code-picker-btn ${showAgentDropdown ? 'active' : ''}`}
                  onClick={() => setShowAgentDropdown((v) => !v)}
                  disabled={!serverStatus.running}
                  title="Select OpenCode Agent"
                >
                  <span className="code-picker-icon">
                    <Icon name={agentMeta.icon} size={14} />
                  </span>
                  <span className="code-picker-text">
                    <span className="code-picker-val">{agentMeta.name}</span>
                  </span>
                  <Icon name="caret-down" size={12} className="code-picker-chevron" />
                </button>

                {showAgentDropdown && (
                  <div className="code-agent-menu">
                    <div className="code-popover-title">Agents ({agents.length})</div>
                    <div className="code-agent-menu-list">
                      {agents.map((ag) => {
                        const meta = getAgentMeta(ag.name || ag.id)
                        const isSel = (ag.name || ag.id) === currentAgent
                        const isSubagent =
                          (ag.name || ag.id).toLowerCase().includes('cavecrew') ||
                          (ag.name || ag.id).toLowerCase().includes('sub')
                        return (
                          <button
                            key={ag.id}
                            type="button"
                            className={`code-agent-menu-item ${isSel ? 'active' : ''}`}
                            onClick={() => {
                              setCurrentAgent(ag.name || ag.id)
                              setShowAgentDropdown(false)
                            }}
                          >
                            <div className="code-agent-item-icon">
                              <Icon name={meta.icon} size={15} />
                            </div>
                            <div className="code-agent-item-info">
                              <div className="code-agent-item-header">
                                <span className="code-agent-item-title">{meta.name}</span>
                                {isSubagent ? (
                                  <span className="code-badge code-badge-sub">SUB</span>
                                ) : (
                                  <span className="code-badge code-badge-primary">MAIN</span>
                                )}
                              </div>
                              <div className="code-agent-item-desc">{ag.description || meta.desc}</div>
                            </div>
                            {isSel && <Icon name="check" size={14} className="code-agent-check" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Model Picker Popover (OpenCode Style) */}
              <div className="code-dropdown-wrap" ref={modelSelectorRef}>
                <button
                  type="button"
                  className={`code-picker-btn ${showModelPicker ? 'active' : ''}`}
                  onClick={() => setShowModelPicker((v) => !v)}
                  disabled={!serverStatus.running}
                  title="Select AI Model"
                >
                  <span className="code-picker-icon">
                    <Icon name="sparkle" size={14} />
                  </span>
                  <span className="code-picker-text">
                    <span className="code-picker-val">
                      {selectedModelObj?.name || (currentModel ? currentModel.split('/')[1] : 'Select Model')}
                    </span>
                    <span className="code-picker-sub">
                      {selectedModelObj?.providerName || (currentModel ? currentModel.split('/')[0] : '')}
                    </span>
                  </span>
                  {selectedModelObj?.isAmethyst && (
                    <span className="code-chip-amethyst" title="Synced from Amethyst">SYNCED</span>
                  )}
                  {selectedModelObj?.isFree && <span className="code-chip-free">FREE</span>}
                  <Icon name="caret-down" size={12} className="code-picker-chevron" />
                </button>

                {showModelPicker && (
                  <div className="code-model-popover">
                    <div className="code-popover-header">
                      <div className="code-popover-search">
                        <Icon name="search" size={14} className="code-popover-search-icon" />
                        <input
                          ref={modelSearchInputRef}
                          type="text"
                          className="code-popover-search-input"
                          placeholder="Search models..."
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          autoFocus
                        />
                        {modelSearch && (
                          <button
                            type="button"
                            className="code-popover-search-clear"
                            onClick={() => setModelSearch('')}
                          >
                            <Icon name="x" size={11} />
                          </button>
                        )}
                      </div>

                      <div className="code-popover-tabs">
                        <button
                          type="button"
                          className={`code-popover-tab ${modelTab === 'amethyst' ? 'active' : ''}`}
                          onClick={() => setModelTab('amethyst')}
                        >
                          <span className="code-tab-dot-amethyst" />
                          Amethyst ({amethystCount})
                        </button>
                        <button
                          type="button"
                          className={`code-popover-tab ${modelTab === 'free' ? 'active' : ''}`}
                          onClick={() => setModelTab('free')}
                        >
                          <span className="code-tab-badge-free">⚡ FREE</span>
                          Free ({freeCount})
                        </button>
                        <button
                          type="button"
                          className={`code-popover-tab ${modelTab === 'connected' ? 'active' : ''}`}
                          onClick={() => setModelTab('connected')}
                        >
                          Connected ({connectedCount})
                        </button>
                      </div>
                    </div>

                    <div className="code-popover-list">
                      {groupedModels.length === 0 ? (
                        <div className="code-popover-empty">
                          <Icon name="search" size={20} />
                          <span>No models match "{modelSearch}"</span>
                        </div>
                      ) : (
                        groupedModels.map((group) => (
                          <div key={group.title} className="code-model-group">
                            <div className="code-model-group-title">
                              <span>{group.title}</span>
                              <span className="code-model-group-count">{group.items.length}</span>
                            </div>
                            {group.items.map((m) => {
                              const val = `${m.providerID || 'opencode'}/${m.id}`
                              const isSelected = val === currentModel
                              return (
                                <div
                                  key={val}
                                  className={`code-model-row ${isSelected ? 'selected' : ''}`}
                                  onClick={() => {
                                    setCurrentModel(val)
                                    localStorage.setItem('amethyst_code_model', val)
                                    setShowModelPicker(false)
                                  }}
                                >
                                  <div className="code-model-main">
                                    <div className="code-model-title-row">
                                      <span className="code-model-name">{m.name}</span>
                                      {m.isAmethyst && (
                                        <span className="code-badge code-badge-amethyst">SYNCED</span>
                                      )}
                                      {m.isFree && <span className="code-badge code-badge-free">FREE</span>}
                                      {m.isReasoning && (
                                        <span className="code-badge code-badge-reason">THINKING</span>
                                      )}
                                      {m.isVision && (
                                        <span className="code-badge code-badge-vision">VISION</span>
                                      )}
                                    </div>
                                    <span className="code-model-id-sub">{m.id}</span>
                                  </div>
                                  {isSelected && (
                                    <div className="code-model-selected-check">
                                      <Icon name="check" size={14} />
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="code-popover-footer">
                      <button
                        type="button"
                        className="code-popover-footer-btn"
                        onClick={handleSyncAmethyst}
                        disabled={syncingAmethyst}
                        title="Sync API keys and providers from Amethyst"
                      >
                        <Icon
                          name="arrow-clockwise"
                          size={13}
                          className={syncingAmethyst ? 'code-spin' : ''}
                        />
                        <span>{syncingAmethyst ? 'Syncing...' : 'Sync Amethyst'}</span>
                      </button>
                      <button
                        type="button"
                        className="code-popover-footer-btn primary"
                        onClick={() => {
                          setShowModelPicker(false)
                          setShowSettingsModal(true)
                          refreshOpenCodeConfig()
                        }}
                      >
                        <Icon name="gear" size={13} />
                        <span>Settings & Providers...</span>
                      </button>
                    </div>
                  </div>
                )}
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
                  <Icon name="code" size={32} />
                </div>
                <h3 className="code-empty-title">OpenCode Runtime Engine</h3>
                <p className="code-empty-desc">
                  Native Amethyst client running full OpenCode subprocess parity:
                  streaming tokens, autonomous tool execution, and permission controls.
                </p>

                <div className="code-prompt-suggestions">
                  <button
                    type="button"
                    className="code-suggestion-chip"
                    onClick={() => handleSendPrompt('Analyze this repository structure and give me an overview')}
                  >
                    Analyze this repository structure and give me an overview
                  </button>
                  <button
                    type="button"
                    className="code-suggestion-chip"
                    onClick={() => handleSendPrompt('List git branches and recent changes')}
                  >
                    List git branches and recent changes
                  </button>
                  <button
                    type="button"
                    className="code-suggestion-chip"
                    onClick={() => handleSendPrompt('Find where all MCP servers and tools are defined in amethyst')}
                  >
                    Find where all MCP servers and tools are defined in amethyst
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
              const hasContent = Boolean(msg.text || msg.reasoning || (msg.tools && msg.tools.length > 0))
              const isStreamingThis = msg.status === 'streaming' || (streaming && msg === messages[messages.length - 1])

              return (
                <div key={msg.id} className="code-msg-assistant">
                  <div className="code-msg-meta">
                    <span className="code-agent-tag">
                      <Icon name={getAgentMeta(msg.agent || currentAgent).icon} size={12} />
                      {getAgentMeta(msg.agent || currentAgent).name}
                    </span>
                    {msg.model && <span>{msg.model}</span>}
                    <span>{timeAgo(msg.timestamp)}</span>
                  </div>

                  <div className="code-msg-body">
                    {/* Shimmer Thinking Indicator while empty */}
                    {!hasContent && isStreamingThis && (
                      <div className="code-thinking-shimmer">
                        <Icon name="circle-notch" size={14} className="spin" />
                        <span>OpenCode is thinking...</span>
                      </div>
                    )}

                    {/* Error display */}
                    {msg.error && (
                      <div className="code-msg-error">
                        <Icon name="warning-circle" size={15} />
                        <span>{msg.error}</span>
                      </div>
                    )}

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
                                    <strong>Input: </strong>
                                    <code>{typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}</code>
                                  </div>
                                )}
                                {tool.output && (
                                  <pre className="code-tool-output">
                                    {typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2)}
                                  </pre>
                                )}
                                {tool.error && (
                                  <div className="code-tool-error">
                                    {String(tool.error)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )
            })}

            {/* Pending Permissions Banner */}
            {pendingPermissions.length > 0 && (
              <div className="code-permission-banner">
                <div className="code-perm-head">
                  <div className="code-perm-icon">
                    <Icon name="shield" size={16} />
                  </div>
                  <div className="code-perm-title">
                    Tool Execution Permission Required ({pendingPermissions.length})
                  </div>
                </div>

                {pendingPermissions.map((perm) => (
                  <div key={perm.id} className="code-perm-item">
                    <div className="code-perm-details">
                      <strong>Tool:</strong> {perm.tool || perm.name || 'Unknown'} <br />
                      {perm.pattern && (
                        <>
                          <strong>Pattern:</strong> {perm.pattern} <br />
                        </>
                      )}
                    </div>
                    <div className="code-perm-actions">
                      <button
                        type="button"
                        className="code-btn code-btn-danger"
                        onClick={() => handleReplyPermission(perm.id, 'reject')}
                      >
                        Deny
                      </button>
                      <button
                        type="button"
                        className="code-btn code-btn-primary"
                        onClick={() => handleReplyPermission(perm.id, 'once')}
                      >
                        Allow Once
                      </button>
                      <button
                        type="button"
                        className="code-btn code-btn-primary"
                        onClick={() => handleReplyPermission(perm.id, 'always')}
                      >
                        Always Allow
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Composer */}
          <div className="code-composer-wrap">
            <div className="code-composer-box">
              <textarea
                ref={textareaRef}
                className="code-textarea"
                rows={2}
                placeholder="Ask OpenCode to code, debug, refactor, or run commands... (Enter to send, Shift+Enter for newline)"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendPrompt()
                  }
                }}
                disabled={!serverStatus.running}
              />

              <div className="code-composer-bottom">
                <span className="code-composer-hint">Shift + Enter for new line • Ctrl+N new session</span>
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
                      disabled={!promptText.trim() || !serverStatus.running}
                      title="Send prompt"
                    >
                      <Icon name="paper-plane-right" size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* OpenCode Settings & Configuration Dialog */}
      {showSettingsModal && (
        <div className="code-modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="code-settings-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="code-settings-sidebar">
              <div className="code-settings-brand">
                <Icon name="code" size={18} />
                <div className="code-settings-brand-info">
                  <span className="code-settings-title">OpenCode Runtime</span>
                  <span className="code-settings-version">Engine Config</span>
                </div>
              </div>

              <div className="code-settings-tabs">
                <button
                  type="button"
                  className={`code-settings-tab-btn ${settingsTab === 'providers' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('providers')}
                >
                  <Icon name="plug" size={15} />
                  <span>Providers & Keys</span>
                </button>
                <button
                  type="button"
                  className={`code-settings-tab-btn ${settingsTab === 'models' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('models')}
                >
                  <Icon name="sparkle" size={15} />
                  <span>Models & Defaults</span>
                </button>
                <button
                  type="button"
                  className={`code-settings-tab-btn ${settingsTab === 'agents' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('agents')}
                >
                  <Icon name="gear" size={15} />
                  <span>Agents ({agents.length})</span>
                </button>
                <button
                  type="button"
                  className={`code-settings-tab-btn ${settingsTab === 'config' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('config')}
                >
                  <Icon name="terminal" size={15} />
                  <span>Raw Config JSON</span>
                </button>
              </div>

              <div className="code-settings-sidebar-footer">
                <span className="code-settings-status-pill">
                  <span className={`code-status-dot ${serverStatus.running ? 'running' : 'stopped'}`} />
                  {serverStatus.running ? `Port :${serverStatus.port}` : 'Inactive'}
                </span>
              </div>
            </div>

            <div className="code-settings-body">
              <div className="code-settings-body-header">
                <h3 className="code-settings-body-title">
                  {settingsTab === 'providers' && 'Model Providers & API Keys'}
                  {settingsTab === 'models' && 'Model Configuration & Defaults'}
                  {settingsTab === 'agents' && 'Registered OpenCode Agents'}
                  {settingsTab === 'config' && 'OpenCode Engine Configuration (/config)'}
                </h3>
                <button
                  type="button"
                  className="code-modal-close"
                  onClick={() => setShowSettingsModal(false)}
                  title="Close"
                >
                  <Icon name="x" size={16} />
                </button>
              </div>

              {syncFeedback && (
                <div className="code-feedback-banner">
                  <Icon name="check-circle" size={15} />
                  <span>{syncFeedback}</span>
                </div>
              )}

              <div className="code-settings-scroll">
                {/* Providers Tab */}
                {settingsTab === 'providers' && (
                  <div className="code-tab-pane">
                    {/* Amethyst Sync Banner */}
                    <div className="code-sync-banner">
                      <div className="code-sync-banner-text">
                        <div className="code-sync-banner-title">
                          <Icon name="sparkle" size={16} />
                          <span>Amethyst Provider Sync</span>
                        </div>
                        <p className="code-sync-banner-desc">
                          Automatically synchronizes providers and API keys from <code>~/.amethyst/config/providers.yaml</code> directly to OpenCode runtime.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="code-btn code-btn-primary"
                        onClick={handleSyncAmethyst}
                        disabled={syncingAmethyst}
                      >
                        <Icon name="arrow-clockwise" size={14} className={syncingAmethyst ? 'code-spin' : ''} />
                        <span>{syncingAmethyst ? 'Syncing...' : 'Sync from Amethyst'}</span>
                      </button>
                    </div>

                    {/* Connected Providers */}
                    <div className="code-settings-section">
                      <h4 className="code-section-heading">Connected Providers</h4>
                      <div className="code-provider-cards">
                        {(openCodeProviders?.connected || []).map((pId) => {
                          const isAmethyst = ['opencode', 'opencode-zen', 'mistral', 'groq', 'nvidia', 'google', 'kilocode', 'kilo'].includes(pId)
                          const pObj = (openCodeProviders?.all || []).find((p) => p.id === pId)
                          const modelCount = Object.keys(pObj?.models || {}).length
                          return (
                            <div key={pId} className="code-provider-card">
                              <div className="code-provider-card-left">
                                <div className="code-provider-icon">
                                  <Icon name={pId === 'google' ? 'google' : 'cpu'} size={18} />
                                </div>
                                <div className="code-provider-info">
                                  <div className="code-provider-title-row">
                                    <span className="code-provider-name">{pObj?.name || pId}</span>
                                    <span className="code-provider-id-tag">{pId}</span>
                                    {isAmethyst && (
                                      <span className="code-badge code-badge-amethyst">AMETHYST SYNCED</span>
                                    )}
                                  </div>
                                  <span className="code-provider-meta">
                                    {modelCount > 0 ? `${modelCount} models registered` : 'Active credentials'}
                                  </span>
                                </div>
                              </div>
                              <div className="code-provider-card-right">
                                <button
                                  type="button"
                                  className="code-btn code-btn-danger"
                                  onClick={() => handleDisconnectProvider(pId)}
                                  title={`Disconnect ${pId}`}
                                >
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Connect Provider Form */}
                    <div className="code-settings-section">
                      <h4 className="code-section-heading">Connect Additional Provider</h4>
                      <div className="code-connect-form">
                        <div className="code-form-row">
                          <label className="code-form-label">Provider</label>
                          <select
                            className="code-form-select"
                            value={newProviderId}
                            onChange={(e) => setNewProviderId(e.target.value)}
                          >
                            <option value="anthropic">Anthropic (Claude)</option>
                            <option value="openai">OpenAI (GPT-4o, o3-mini)</option>
                            <option value="google">Google Gemini</option>
                            <option value="groq">Groq (Llama, Mixtral)</option>
                            <option value="mistral">Mistral AI</option>
                            <option value="nvidia">NVIDIA NIM</option>
                            <option value="openrouter">OpenRouter</option>
                            <option value="xpl">Experiential Labs (xpl)</option>
                            <option value="github-copilot">GitHub Copilot</option>
                          </select>
                        </div>
                        <div className="code-form-row">
                          <label className="code-form-label">API Key</label>
                          <input
                            type="password"
                            className="code-form-input"
                            placeholder="Enter API key or credential..."
                            value={newProviderKey}
                            onChange={(e) => setNewProviderKey(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className="code-btn code-btn-primary"
                          onClick={handleConnectProvider}
                          disabled={!newProviderKey.trim()}
                        >
                          <Icon name="plug" size={14} />
                          <span>Connect Provider</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Models Tab */}
                {settingsTab === 'models' && (
                  <div className="code-tab-pane">
                    <div className="code-settings-section">
                      <h4 className="code-section-heading">OpenCode Engine Defaults</h4>
                      <p className="code-section-desc">
                        Configure the default primary model for development sessions and the lightweight small model for fast reasoning and helper tasks.
                      </p>
                      <div className="code-form-row">
                        <label className="code-form-label">Primary Model (model)</label>
                        <select
                          className="code-form-select"
                          value={typeof openCodeConfig?.model === 'string' ? openCodeConfig.model : openCodeConfig?.model?.id || currentModel}
                          onChange={(e) => handleSaveDefaultModels(e.target.value, undefined)}
                        >
                          {models.map((m) => (
                            <option key={`${m.providerID}/${m.id}`} value={`${m.providerID}/${m.id}`}>
                              {m.name} ({m.providerName || m.providerID}) {m.isFree ? '[FREE]' : ''} {m.isAmethyst ? '[AMETHYST]' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="code-form-row">
                        <label className="code-form-label">Fast / Small Model (small_model)</label>
                        <select
                          className="code-form-select"
                          value={typeof openCodeConfig?.small_model === 'string' ? openCodeConfig.small_model : openCodeConfig?.small_model?.id || ''}
                          onChange={(e) => handleSaveDefaultModels(undefined, e.target.value)}
                        >
                          <option value="">(Inherit / Default)</option>
                          {models.map((m) => (
                            <option key={`${m.providerID}/${m.id}`} value={`${m.providerID}/${m.id}`}>
                              {m.name} ({m.providerName || m.providerID})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="code-settings-section">
                      <h4 className="code-section-heading">Available Models Catalog ({models.length})</h4>
                      <div className="code-catalog-list">
                        {models.map((m) => (
                          <div key={`${m.providerID}/${m.id}`} className="code-catalog-row">
                            <div className="code-catalog-info">
                              <span className="code-catalog-name">{m.name}</span>
                              <span className="code-catalog-id">{m.providerID}/{m.id}</span>
                            </div>
                            <div className="code-catalog-tags">
                              {m.isAmethyst && <span className="code-badge code-badge-amethyst">AMETHYST</span>}
                              {m.isFree && <span className="code-badge code-badge-free">FREE</span>}
                              {m.isReasoning && <span className="code-badge code-badge-reason">THINKING</span>}
                              {m.isVision && <span className="code-badge code-badge-vision">VISION</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Agents Tab */}
                {settingsTab === 'agents' && (
                  <div className="code-tab-pane">
                    <div className="code-settings-section">
                      <h4 className="code-section-heading">OpenCode Runtime Agents ({agents.length})</h4>
                      <p className="code-section-desc">
                        OpenCode ships with specialized primary agents and cavecrew subagents with distinct permissions and tool access.
                      </p>
                      <div className="code-agents-grid">
                        {agents.map((ag) => {
                          const meta = getAgentMeta(ag.name || ag.id)
                          const isSubagent = (ag.name || ag.id).toLowerCase().includes('cavecrew') || (ag.name || ag.id).toLowerCase().includes('sub')
                          return (
                            <div key={ag.id} className="code-agent-card">
                              <div className="code-agent-card-header">
                                <div className="code-agent-card-title-row">
                                  <Icon name={meta.icon} size={18} />
                                  <span className="code-agent-card-title">{meta.name}</span>
                                </div>
                                <span className={`code-badge ${isSubagent ? 'code-badge-sub' : 'code-badge-primary'}`}>
                                  {isSubagent ? 'SUBAGENT' : 'PRIMARY'}
                                </span>
                              </div>
                              <p className="code-agent-card-desc">{ag.description || meta.desc}</p>
                              <div className="code-agent-card-footer">
                                <span className="code-agent-card-id">ID: {ag.name || ag.id}</span>
                                {ag.name === currentAgent && (
                                  <span className="code-badge code-badge-free">CURRENT ACTIVE</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Raw Config Tab */}
                {settingsTab === 'config' && (
                  <div className="code-tab-pane">
                    <div className="code-settings-section">
                      <div className="code-config-header-row">
                        <div>
                          <h4 className="code-section-heading">Server Configuration</h4>
                          <p className="code-section-desc">
                            Direct read/write access to OpenCode server's <code>GET /config</code> and <code>PATCH /config</code>.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="code-btn code-btn-primary"
                          onClick={handleSaveRawConfig}
                          disabled={savingConfig}
                        >
                          <Icon name="check" size={14} />
                          <span>{savingConfig ? 'Saving...' : 'Save Configuration'}</span>
                        </button>
                      </div>
                      <textarea
                        className="code-config-textarea"
                        value={configJsonText}
                        onChange={(e) => setConfigJsonText(e.target.value)}
                        rows={18}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
