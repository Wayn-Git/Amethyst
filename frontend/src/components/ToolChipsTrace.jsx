import { useState, useMemo } from 'react'
import Icon from './Icon.jsx'
import { prettyJSON } from '../api.js'
import { CodeBlock } from './arc/code-block/code-block'

function safeArgs(raw) {
  if (typeof raw === 'object' && raw !== null) return raw
  try { return JSON.parse(raw) } catch { return { arguments: raw } }
}

function tail(path) {
  const parts = String(path || '').split('/').filter(Boolean)
  return parts[parts.length - 1] || String(path || '')
}

function formatToolLabel(name) {
  let clean = String(name || '').split('__mcp__')[0]
  clean = clean.replace(/^composio_/, '')
  clean = clean.replace(/_/g, ' ')
  return clean.replace(/\b\w/g, (c) => c.toUpperCase())
}

function extractToolMeta(name, args = {}) {
  const n = String(name || '').toLowerCase()
  if (n === 'tool_call' && args?.calls && Array.isArray(args.calls) && args.calls.length > 0) {
    if (args.calls.length === 1) {
      const first = args.calls[0]
      return extractToolMeta(first?.name || 'tool', safeArgs(first?.arguments))
    }
    const names = args.calls.map((c) => formatToolLabel(c?.name || 'tool')).join(', ')
    return { icon: 'spark', label: 'Batch Tools', chip: names.slice(0, 35), mono: false, type: 'other' }
  }

  if (n.includes('bash') || n.includes('shell') || n.includes('command')) {
    const cmd = args.command || args.CommandLine || args.cmd || ''
    return { icon: 'term', label: 'Run', chip: cmd || 'command', mono: true, type: 'bash' }
  }
  if (n.includes('write') || n.includes('create_file') || n.includes('replace_file') || n.includes('edit')) {
    const file = args.TargetFile || args.path || args.file_path || ''
    return { icon: 'edit', label: 'Write', chip: tail(file) || 'file', mono: true, type: 'edit', fullPath: file }
  }
  if (n.includes('read') || n.includes('view') || n.includes('list')) {
    const file = args.AbsolutePath || args.DirectoryPath || args.path || args.file_path || ''
    return { icon: 'page', label: 'Read', chip: tail(file) || 'file', mono: true, type: 'read', fullPath: file }
  }
  if (n.includes('search') || n.includes('grep') || n.includes('find')) {
    const q = args.query || args.Query || args.pattern || ''
    return { icon: 'search', label: 'Search', chip: q ? `"${q}"` : 'query', mono: false, type: 'search' }
  }
  if (n.includes('browser') || n.includes('playwright') || n.includes('devtools') || n.includes('click') || n.includes('scrape') || n.includes('navigate') || n.includes('fetch')) {
    const target = args.url || args.selector || args.text || args.action || args.key || ''
    return { icon: 'globe', label: formatToolLabel(name), chip: target ? String(target).slice(0, 30) : '', mono: false, type: 'browser' }
  }

  // Format chip safely: never produce "[object Object]"
  let chipStr = ''
  const firstVal = Object.values(args)[0]
  if (typeof firstVal === 'string') {
    chipStr = firstVal
  } else if (typeof firstVal === 'number' || typeof firstVal === 'boolean') {
    chipStr = String(firstVal)
  } else if (Array.isArray(firstVal)) {
    chipStr = firstVal.map((v) => (typeof v === 'object' ? (v?.name || 'item') : String(v))).join(', ')
  } else if (typeof firstVal === 'object' && firstVal !== null) {
    chipStr = Object.keys(firstVal).join(', ')
  }

  return { icon: 'spark', label: formatToolLabel(name), chip: chipStr.slice(0, 30), mono: false, type: 'other' }
}

function parseDiffSummary(item) {
  const args = safeArgs(item.arguments)
  const content = item.content || ''
  const file = tail(args.TargetFile || args.path || args.file_path || '')
  if (!file) return null

  let add = 0
  let del = 0
  if (typeof content === 'string') {
    const lines = content.split('\n')
    for (const l of lines) {
      if (l.startsWith('+') && !l.startsWith('+++')) add++
      if (l.startsWith('-') && !l.startsWith('---')) del++
    }
  }
  if (add === 0 && del === 0) {
    if (args.ReplacementContent || args.ReplacementChunks) {
      add = 1
    }
  }
  return { file, add: Math.max(add, 1), del }
}

export default function ToolChipsTrace({
  events = [],
  live,
  reasoning,
  running,
  ms,
  onOpenArtifact,
}) {
  const [open, setOpen] = useState(true)
  const [openRows, setOpenRows] = useState(new Set())

  // Normalize steps
  const steps = useMemo(() => {
    const list = []
    if (reasoning) {
      list.push({
        id: 'reasoning',
        icon: 'brain',
        label: 'Thinking',
        chip: String(reasoning).trim().slice(0, 45) + (reasoning.length > 45 ? '…' : ''),
        detailText: reasoning,
        mono: false,
      })
    }

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (ev.type === 'thought') {
        list.push({
          id: `thought-${i}`,
          icon: 'brain',
          label: 'Thinking',
          chip: String(ev.text || '').trim().slice(0, 45) + '…',
          detailText: ev.text,
          mono: false,
        })
        continue
      }

      const call = ev.call || ev
      if (!call || (!call.name && !ev.name)) continue
      const name = call.name || ev.name
      const args = safeArgs(call.arguments || ev.arguments)
      const isError = call.status === 'error' || call.isError || ev.isError

      if (name === 'tool_call' && args?.calls && Array.isArray(args.calls) && args.calls.length > 0) {
        let results = []
        try {
          if (typeof call.content === 'string') {
            results = JSON.parse(call.content)
          } else if (Array.isArray(call.content)) {
            results = call.content
          }
        } catch {
          results = []
        }

        args.calls.forEach((subCall, subIdx) => {
          const subName = subCall?.name || 'tool'
          const subArgs = safeArgs(subCall?.arguments)
          const subMeta = extractToolMeta(subName, subArgs)
          const matchingResult = Array.isArray(results)
            ? results.find((r) => r?.name === subName) || results[subIdx]
            : null
          const subContent = matchingResult?.result?.content ?? matchingResult?.content ?? (subIdx === 0 ? call.content : undefined)
          const subIsError = matchingResult?.result?.is_error ?? matchingResult?.is_error ?? isError

          list.push({
            id: `tool-${i}-${subIdx}`,
            name: subName,
            icon: subMeta.icon,
            label: subMeta.label,
            chip: subMeta.chip,
            mono: subMeta.mono,
            arguments: subArgs,
            content: subContent,
            isError: subIsError,
            durationMs: call.durationMs ?? call.duration_ms ?? call.elapsed_ms,
            fullPath: subMeta.fullPath,
          })
        })
        continue
      }

      const meta = extractToolMeta(name, args)

      list.push({
        id: `tool-${i}`,
        name,
        icon: meta.icon,
        label: meta.label,
        chip: meta.chip,
        mono: meta.mono,
        arguments: args,
        content: call.content ?? ev.content,
        isError,
        durationMs: call.durationMs ?? call.duration_ms ?? call.elapsed_ms,
        fullPath: meta.fullPath,
      })
    }

    if (live) {
      const args = safeArgs(live.arguments)
      if (live.name === 'tool_call' && args?.calls && Array.isArray(args.calls) && args.calls.length > 0) {
        args.calls.forEach((subCall, subIdx) => {
          const subName = subCall?.name || 'tool'
          const subArgs = safeArgs(subCall?.arguments)
          const subMeta = extractToolMeta(subName, subArgs)
          list.push({
            id: `live-${subIdx}`,
            name: subName,
            icon: subMeta.icon,
            label: subMeta.label,
            chip: subMeta.chip,
            mono: subMeta.mono,
            arguments: subArgs,
            isLive: true,
          })
        })
      } else {
        const meta = extractToolMeta(live.name, args)
        list.push({
          id: 'live',
          name: live.name,
          icon: meta.icon,
          label: meta.label,
          chip: meta.chip,
          mono: meta.mono,
          arguments: args,
          isLive: true,
        })
      }
    }

    return list
  }, [events, live, reasoning])

  // Extract file diffs
  const diffs = useMemo(() => {
    const res = []
    const seen = new Set()
    for (const s of steps) {
      if (s.name && (s.name.includes('write') || s.name.includes('edit') || s.name.includes('replace'))) {
        const diff = parseDiffSummary(s)
        if (diff && !seen.has(diff.file)) {
          seen.add(diff.file)
          res.push(diff)
        }
      }
    }
    return res
  }, [steps])

  const toggleRow = (id) => {
    setOpenRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toolCount = steps.filter((s) => s.id !== 'reasoning' && !s.id.startsWith('thought')).length
  const durationSec = ms && ms > 0 ? (ms / 1000).toFixed(1) : null

  let headerText = 'Thinking & tools'
  if (running) {
    headerText = live ? `Running ${live.name.replace(/_/g, ' ')}…` : 'Thinking…'
  } else if (toolCount > 0) {
    headerText = `${toolCount} tool ${toolCount === 1 ? 'call' : 'calls'}${durationSec ? ` · ${durationSec}s` : ''}`
  } else if (durationSec) {
    headerText = `Thought for ${durationSec}s`
  }

  if (steps.length === 0 && !running) return null

  return (
    <div className="tool-chips-container">
      {/* Header Pill */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="tool-chips-header"
      >
        <span className={`tool-chips-chevron${open ? ' is-open' : ''}`}>
          <Icon name="chevron" size={12} />
        </span>
        <span className={`tool-chips-summary${running ? ' is-shimmering' : ''}`}>
          {headerText}
        </span>
      </button>

      {/* Expandable Trace Rows */}
      {open && (
        <div className="tool-chips-body">
          <div className="tool-chips-list">
            {steps.map((row) => {
              const rowOpen = openRows.has(row.id)
              return (
                <div key={row.id} className={`tool-chip-row-wrap${row.isError ? ' is-error' : ''}${row.isLive ? ' is-live' : ''}`}>
                  <button
                    type="button"
                    aria-expanded={rowOpen}
                    onClick={() => toggleRow(row.id)}
                    className="tool-chip-row-btn"
                  >
                    <span className="tool-chip-icon">
                      <Icon name={row.isError ? 'alert' : row.icon} size={13} />
                    </span>
                    <span className="tool-chip-label">{row.label}</span>
                    {row.chip && (
                      <span className={`tool-chip-pill${row.mono ? ' font-mono' : ''}`} title={row.chip}>
                        {row.chip}
                      </span>
                    )}
                    {row.isLive && (
                      <span className="ellipsis tool-chip-live"><i /><i /><i /></span>
                    )}
                    <span className="tool-chip-expand-caret">
                      <Icon
                        name="chevron"
                        size={11}
                        style={{ transform: rowOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}
                      />
                    </span>
                  </button>

                  {/* Expanded payload */}
                  {rowOpen && (
                    <div className="tool-chip-detail-fold">
                      {row.detailText ? (
                        <div className="tool-chip-text-detail">{row.detailText}</div>
                      ) : (
                        <div className="tool-chip-payload">
                          {row.arguments && Object.keys(row.arguments).length > 0 && (
                            <div className="tool-chip-section">
                              <span className="tool-chip-section-tag">input</span>
                              <pre className="tool-chip-code">{prettyJSON(row.arguments)}</pre>
                            </div>
                          )}
                          {row.content !== undefined && (
                            <div className="tool-chip-section">
                              <span className="tool-chip-section-tag">output</span>
                              {typeof row.content === 'string' ? (
                                <CodeBlock code={row.content} language="text" maxLines={10} />
                              ) : (
                                <pre className="tool-chip-code">{prettyJSON(row.content)}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* File Diff Chips */}
          {diffs.length > 0 && (
            <div className="tool-chips-diff-bar">
              {diffs.map((d) => (
                <span key={d.file} className="tool-diff-chip font-mono">
                  <Icon name="edit" size={11} />
                  <span className="tool-diff-name">{d.file}</span>
                  <span className="tool-diff-add tabular-nums">+{d.add}</span>
                  {d.del > 0 && <span className="tool-diff-del tabular-nums">−{d.del}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
