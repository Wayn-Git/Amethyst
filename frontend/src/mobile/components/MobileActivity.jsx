import { useState, useMemo, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight,
  Brain,
  Terminal,
  Search,
  FileCode,
  FileText,
  Globe,
  Folder,
  Check,
  AlertCircle,
} from 'lucide-react'
import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import BrandMark from '../../components/BrandMark.jsx'

function safeArgs(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}

function tail(path) {
  if (!path || typeof path !== 'string') return ''
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

function getToolCategory(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('search') || n.includes('grep') || n.includes('find')) {
    return {
      type: 'search',
      label: 'Search',
      bg: 'rgba(0, 113, 227, 0.1)',
      color: '#0071E3',
      Icon: Search,
    }
  }
  if (n.includes('shell') || n.includes('bash') || n.includes('term') || n.includes('command') || n.includes('exec')) {
    return {
      type: 'bash',
      label: 'Bash',
      bg: 'rgba(135, 63, 255, 0.1)',
      color: '#873FFF',
      Icon: Terminal,
    }
  }
  if (n.includes('edit') || n.includes('write') || n.includes('patch') || n.includes('replace') || n.includes('create')) {
    return {
      type: 'edit',
      label: 'Write',
      bg: 'rgba(52, 199, 89, 0.1)',
      color: '#34C759',
      Icon: FileCode,
    }
  }
  if (n.includes('read') || n.includes('view') || n.includes('cat') || n.includes('file') || n.includes('get')) {
    return {
      type: 'read',
      label: 'Read',
      bg: 'rgba(255, 149, 0, 0.1)',
      color: '#FF9500',
      Icon: FileText,
    }
  }
  if (n.includes('browser') || n.includes('fetch') || n.includes('url') || n.includes('web') || n.includes('crawl')) {
    return {
      type: 'search',
      label: 'Fetch',
      bg: 'rgba(0, 113, 227, 0.1)',
      color: '#0071E3',
      Icon: Globe,
    }
  }
  if (n.includes('list') || n.includes('folder') || n.includes('dir')) {
    return {
      type: 'read',
      label: 'List',
      bg: 'rgba(142, 142, 147, 0.12)',
      color: '#8E8E93',
      Icon: Folder,
    }
  }
  return {
    type: 'other',
    label: 'Tool',
    bg: 'rgba(135, 63, 255, 0.1)',
    color: '#873FFF',
    Icon: Terminal,
  }
}

function getToolTarget(name, args = {}) {
  const parsed = safeArgs(args)
  const n = String(name || '').toLowerCase()
  if (n.includes('search') || n.includes('grep')) {
    const q = parsed.query || parsed.Query || parsed.pattern || parsed.q || ''
    return q ? `"${q}"` : ''
  }
  if (n.includes('bash') || n.includes('shell') || n.includes('command')) {
    return parsed.command || parsed.CommandLine || parsed.cmd || ''
  }
  const filePath = parsed.path || parsed.file_path || parsed.file_name || parsed.AbsolutePath || parsed.TargetFile || parsed.DirectoryPath || ''
  if (filePath) return tail(filePath)
  if (parsed.url) return parsed.url
  return ''
}

function ToolRow({ item }) {
  const [open, setOpen] = useState(false)
  const args = safeArgs(item.arguments)
  const cat = getToolCategory(item.name || item.tool)
  const target = getToolTarget(item.name || item.tool, args)
  const isErr = item.status === 'error' || item.is_error || item.isError
  const isRunning = item.status === 'running'

  const hasPayload = Boolean(item.result || item.content || (args && Object.keys(args).length > 0))

  const durationStr = useMemo(() => {
    if (item.durationMs) {
      return item.durationMs >= 1000
        ? `${(item.durationMs / 1000).toFixed(1)}s`
        : `${Math.round(item.durationMs)}ms`
    }
    return null
  }, [item.durationMs])

  return (
    <div
      style={{
        borderRadius: 14,
        background: '#FFFFFF',
        border: '1px solid rgba(0, 0, 0, 0.05)',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <HouseButton
        type="button"
        disabled={!hasPayload}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: hasPayload ? 'pointer' : 'default',
          textAlign: 'left',
          gap: 8,
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 8,
              background: cat.bg,
              color: cat.color,
              flexShrink: 0,
            }}
          >
            <cat.Icon size={13} />
          </span>
          <span style={{ fontWeight: 600, color: '#1D1D1F', flexShrink: 0 }}>
            {cat.label}
          </span>
          {target && (
            <span
              style={{
                fontFamily: 'SF Mono, Menlo, monospace',
                fontSize: 11.5,
                color: '#6E6E73',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {target}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {durationStr && (
            <span style={{ fontSize: 11, color: '#8E8E93', fontWeight: 500 }}>
              {durationStr}
            </span>
          )}
          {isRunning ? (
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                border: '2px solid #873FFF',
                borderTopColor: 'transparent',
                display: 'inline-block',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          ) : isErr ? (
            <AlertCircle size={14} color="#FF3B30" />
          ) : (
            <Check size={14} color="#34C759" strokeWidth={2.5} />
          )}
          {hasPayload && (
            <ChevronRight
              size={13}
              color="#8E8E93"
              style={{
                transform: open ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.18s ease',
              }}
            />
          )}
        </div>
      </HouseButton>

      {open && hasPayload && (
        <div
          style={{
            borderTop: '1px solid #F2F2F7',
            padding: '10px 12px',
            background: '#FAFAFA',
            fontSize: 12,
            fontFamily: 'SF Mono, Menlo, monospace',
            color: '#3A3A3C',
            maxHeight: 180,
            overflowY: 'auto',
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
          }}
        >
          {item.result || item.content
            ? typeof (item.result || item.content) === 'string'
              ? (item.result || item.content).replace(/<untrusted_tool_result[^>]*>/, '').replace(/<\/untrusted_tool_result>/, '').trim()
              : JSON.stringify(item.result || item.content, null, 2)
            : JSON.stringify(args, null, 2)}
        </div>
      )}
    </div>
  )
}

export const MobileActivity = memo(function MobileActivity({
  running = false,
  status = null,
  tools = [],
  reasoning = '',
  startTime = 0,
  durationMs = 0,
  defaultOpen = false,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!running || !startTime) {
      setElapsed(0)
      return
    }
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startTime))
    }, 250)
    return () => clearInterval(timer)
  }, [running, startTime])

  // Label derivation
  const label = useMemo(() => {
    if (running) {
      if (status === 'searching') return 'Searching Library & Drive…'
      if (status === 'tool' || status === 'calling') {
        const lastTool = tools[tools.length - 1]
        const toolName = lastTool?.name || lastTool?.tool || 'tool'
        return `Running ${toolName}…`
      }
      return 'Thinking…'
    }

    const toolCount = tools.length
    const effDuration = durationMs || elapsed
    const durSec = effDuration > 0 ? `${(effDuration / 1000).toFixed(1)}s` : ''

    if (toolCount > 0 && reasoning) {
      return durSec
        ? `Thought for ${durSec} · ${toolCount} tool${toolCount === 1 ? '' : 's'}`
        : `${toolCount} tool${toolCount === 1 ? '' : 's'} executed`
    }
    if (toolCount > 0) {
      return durSec
        ? `Ran ${toolCount} tool${toolCount === 1 ? '' : 's'} · ${durSec}`
        : `Ran ${toolCount} tool${toolCount === 1 ? '' : 's'}`
    }
    if (durSec) {
      return `Thought for ${durSec}`
    }
    return 'Thought for a moment'
  }, [running, status, tools, reasoning, durationMs, elapsed])

  // Don't render if inactive and empty
  if (!running && tools.length === 0 && !reasoning) {
    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'flex-start',
        width: '100%',
        maxWidth: 380,
        margin: '4px 0 8px 0',
      }}
    >
      {/* Trigger Button */}
      <HouseButton
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 20,
          background: running
            ? 'rgba(255, 255, 255, 0.9)'
            : 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.85)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
          cursor: 'pointer',
          textAlign: 'left',
          width: 'fit-content',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {running ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'pulse 1.8s infinite ease-in-out',
            }}
          >
            <BrandMark size={14} glow />
          </div>
        ) : (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: 'rgba(52, 199, 89, 0.15)',
              color: '#34C759',
            }}
          >
            <Check size={9} strokeWidth={3} />
          </span>
        )}

        <span
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: '#1D1D1F',
            letterSpacing: '-0.01em',
          }}
        >
          {label}
        </span>

        <ChevronRight
          size={12}
          color="#8E8E93"
          style={{
            transform: isOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.18s ease',
            marginLeft: 2,
          }}
        />
      </HouseButton>

      {/* Accordion Content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{
              overflow: 'hidden',
              marginTop: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 18,
              background: 'rgba(255, 255, 255, 0.65)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.8)',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.04)',
            }}
          >
            {/* Reasoning Block */}
            {reasoning && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: '#FF9500',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <Brain size={12} />
                  <span>Thinking process</span>
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: '#48484A',
                    padding: '6px 8px',
                    borderRadius: 10,
                    background: 'rgba(0, 0, 0, 0.03)',
                  }}
                >
                  {reasoning}
                </div>
              </div>
            )}

            {/* Tools Block */}
            {tools.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: '#873FFF',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <Terminal size={12} />
                  <span>Tools executed ({tools.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tools.map((t, idx) => (
                    <ToolRow key={t.id || `tr_${idx}`} item={t} />
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default MobileActivity
