import { useState, useEffect, useRef, Component } from 'react'
import Icon from './Icon.jsx'

class SubagentErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('SubagentCard error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="trace-row">
          <div className="trace-line">
            <Icon name="alert" size={13} className="trace-icon" />
            <span className="trace-label">Subagent display error</span>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function SubagentCard({ call, running }) {
  const [open, setOpen] = useState(false)
  const [animatedEvents, setAnimatedEvents] = useState([])

  const safeParse = (value, fallback = {}) => {
    if (value === null || value === undefined) return fallback
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return fallback
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }

  const args = safeParse(call.arguments, {})
  const result = safeParse(call.content, {})
  const agent = args.agent || 'general'
  const task = args.task || ''
  const sessionId = result.session_id
  const status = result.status || (running ? 'running' : 'completed')
  const iterations = result.iterations || 0
  const elapsed = result.elapsed_seconds
  const toolCalls = result.tool_calls || []
  const events = result.events || []

  // Animate events appearing one by one
  useEffect(() => {
    if (running && events.length > 0) {
      setAnimatedEvents([])
      events.forEach((ev, i) => {
        setTimeout(() => {
          setAnimatedEvents(prev => [...prev, ev])
        }, i * 80)
      })
    } else if (!running) {
      setAnimatedEvents(events)
    }
  }, [running, events.length])

  const isDone = !running && status !== 'running'
  const isFailed = status === 'failed'
  const isCancelled = status === 'cancelled'

  return (
    <div className={`subagent-card${running ? ' is-running' : ''}${isDone ? ' is-done' : ''}${isFailed ? ' is-failed' : ''}`}>
      <button type="button" className="tool-card-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <div className="subagent-icon-wrapper">
          <Icon name="cpu" size={14} />
          {running && <div className="subagent-pulse" />}
        </div>

        <span className="tool-name">
          {running ? `Running ${agent} subagent` : isFailed ? `${agent} subagent failed` : isCancelled ? `${agent} subagent cancelled` : `${agent} subagent completed`}
        </span>

        {running ? (
          <span className="badge badge--cyan">
            <span className="ellipsis"><i /><i /><i /></span>
            {iterations > 0 && <span className="subagent-iter">{iterations} steps</span>}
          </span>
        ) : isFailed ? (
          <span className="badge badge--error">failed</span>
        ) : isCancelled ? (
          <span className="badge badge--neutral">cancelled</span>
        ) : (
          <span className="badge badge--ok">
            {elapsed != null ? `${elapsed.toFixed(1)}s` : 'done'}
            {iterations > 0 && ` · ${iterations} steps`}
          </span>
        )}

        <Icon name="chevron" size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }} />
      </button>

      <div className={`tool-body${open ? ' open' : ''}`}>
        <div>
          <div className="tool-block">
            <span className="tool-block-label">task</span>
            <div className="subagent-task">{task || '(no task)'}</div>

            {sessionId && (
              <>
                <span className="tool-block-label">session</span>
                <div className="subagent-session-id mono">{sessionId}</div>
              </>
            )}

            {toolCalls.length > 0 && (
              <>
                <span className="tool-block-label">tools used</span>
                <div className="subagent-tools">
                  {toolCalls.map((tc, i) => (
                    <span key={i} className="subagent-tool-chip">
                      <Icon name="term" size={10} />
                      {tc.name || tc}
                    </span>
                  ))}
                </div>
              </>
            )}

            {events.length > 0 && (
              <>
                <span className="tool-block-label">events</span>
                <div className="subagent-events">
                  {(running ? animatedEvents : events).map((ev, i) => (
                    <div key={i} className={`subagent-event subagent-event--${ev.type || 'unknown'}`}>
                      <span className="subagent-event-type">{ev.type || '?'}</span>
                      {ev.text && <span className="subagent-event-text">{ev.text}</span>}
                      {ev.name && <span className="subagent-event-name">{ev.name}</span>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.result && (
              <>
                <span className="tool-block-label">result</span>
                <pre className="tool-json">{typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}</pre>
              </>
            )}

            {isFailed && result.error && (
              <>
                <span className="tool-block-label">error</span>
                <pre className="tool-json tool-json--error">{result.error}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SubagentCardWithErrorBoundary(props) {
  return (
    <SubagentErrorBoundary>
      <SubagentCard {...props} />
    </SubagentErrorBoundary>
  )
}
