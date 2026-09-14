import { useState, useEffect, useRef, Component } from 'react'
import Icon from './Icon.jsx'

class ParallelJobErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ParallelJobCard error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="trace-row">
          <div className="trace-line">
            <Icon name="alert" size={13} className="trace-icon" />
            <span className="trace-label">Parallel job display error</span>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function ParallelJobCard({ call, running }) {
  const [open, setOpen] = useState(false)
  const [animatedNodes, setAnimatedNodes] = useState([])
  const canvasRef = useRef(null)

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
  const nodes = args.jobs || result.nodes || []
  const summary = result.summary || {}

  // Animate nodes appearing one by one
  useEffect(() => {
    if (running && nodes.length > 0) {
      setAnimatedNodes([])
      nodes.forEach((node, i) => {
        setTimeout(() => {
          setAnimatedNodes(prev => [...prev, node])
        }, i * 100)
      })
    } else if (!running) {
      setAnimatedNodes(nodes)
    }
  }, [running, nodes.length])

  // Canvas particle animation - subtle purple particles
  useEffect(() => {
    if (!running || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const particles = []
    let animationId

    const createParticle = () => ({
      x: Math.random() * canvas.width,
      y: canvas.height + 5,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -Math.random() * 2 - 0.5,
      size: Math.random() * 2 + 0.5,
      life: 1,
    })

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (Math.random() > 0.6) {
        particles.push(createParticle())
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        p.life -= 0.015

        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(113, 50, 245, ${p.life * 0.3})`
        ctx.fill()
      }

      animationId = requestAnimationFrame(animate)
    }

    animate()
    return () => cancelAnimationFrame(animationId)
  }, [running])

  const completedCount = nodes.filter(n => n.status === 'ok').length
  const failedCount = nodes.filter(n => n.status === 'failed').length
  const isAllDone = !running && nodes.length > 0
  const progressPercent = nodes.length > 0 ? (completedCount / nodes.length) * 100 : 0

  return (
    <div className={`parallel-job-card${running ? ' is-running' : ''}${isAllDone ? ' is-done' : ''}`}>
      {running && <canvas ref={canvasRef} className="parallel-particles" width={300} height={40} />}

      <button type="button" className="tool-card-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <div className="parallel-icon-wrapper">
          <Icon name="term" size={14} />
          {running && <div className="parallel-pulse" />}
        </div>

        <span className="tool-name">
          {running ? 'Executing parallel jobs' : isAllDone ? 'Parallel jobs completed' : 'Dispatched parallel jobs'}
        </span>

        {running ? (
          <span className="badge badge--amber">
            <span className="parallel-progress">
              <span className="parallel-progress-bar" style={{ width: `${progressPercent}%` }} />
            </span>
            {completedCount}/{nodes.length}
            <span className="ellipsis"><i /><i /><i /></span>
          </span>
        ) : isAllDone ? (
          <span className="badge badge--ok">
            {failedCount > 0 ? `${failedCount} failed` : 'all done'}
          </span>
        ) : (
          <span className="badge badge--neutral">{nodes.length} jobs</span>
        )}

        <Icon name="chevron" size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }} />
      </button>

      <div className={`tool-body${open ? ' open' : ''}`}>
        <div>
          <div className="tool-block">
            <span className="tool-block-label">jobs</span>
            <div className="parallel-nodes">
              {(running ? animatedNodes : nodes).map((node, i) => (
                <div key={node.id || i} className={`parallel-node ${node.status || 'pending'}`}>
                  <div className="parallel-node-indicator">
                    {node.status === 'ok' && <Icon name="check" size={11} />}
                    {node.status === 'failed' && <Icon name="alert" size={11} />}
                    {node.status !== 'ok' && node.status !== 'failed' && <div className="parallel-node-spinner" />}
                  </div>
                  <span className="parallel-node-id">{node.id}</span>
                  <span className="parallel-node-task">{node.task}</span>
                  {node.seconds != null && <span className="parallel-node-time">{node.seconds.toFixed(1)}s</span>}
                </div>
              ))}
            </div>

            {result.summary && (
              <>
                <span className="tool-block-label">summary</span>
                <div className="parallel-summary">
                  <div className="parallel-summary-stat">
                    <span className="parallel-summary-value">{result.summary.completed || 0}</span>
                    <span className="parallel-summary-label">done</span>
                  </div>
                  <div className="parallel-summary-stat">
                    <span className="parallel-summary-value">{result.summary.failed || 0}</span>
                    <span className="parallel-summary-label">failed</span>
                  </div>
                  <div className="parallel-summary-stat">
                    <span className="parallel-summary-value">{result.summary.total_seconds?.toFixed(1) || '0.0'}s</span>
                    <span className="parallel-summary-label">time</span>
                  </div>
                </div>
              </>
            )}

            {result.result && (
              <>
                <span className="tool-block-label">result</span>
                <pre className="tool-json">{typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ParallelJobCardWithErrorBoundary(props) {
  return (
    <ParallelJobErrorBoundary>
      <ParallelJobCard {...props} />
    </ParallelJobErrorBoundary>
  )
}
