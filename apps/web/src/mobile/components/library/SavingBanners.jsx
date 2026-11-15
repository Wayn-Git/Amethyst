import { useState, useEffect } from 'react'
import { BLUE, MUTED, INK } from './tokens.js'
import { getShareJobs, processQueue } from '../../shareQueue.js'

export default function SavingBanners({ onRefresh }) {
  const [activeJobs, setActiveJobs] = useState([])
  const [failedJobs, setFailedJobs] = useState([])

  useEffect(() => {
    const update = () => {
      const all = getShareJobs()
      setActiveJobs(all.filter((j) => j.state === 'queued' || j.state === 'processing'))
      setFailedJobs(all.filter((j) => j.state === 'failed'))
    }
    update()
    const timer = setInterval(update, 2000)
    return () => clearInterval(timer)
  }, [])

  if (activeJobs.length === 0 && failedJobs.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      {/* Active Saving Banner */}
      {activeJobs.map((job) => (
        <div
          key={job.id}
          style={{
            padding: 14,
            borderRadius: 20,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Saving now
            </span>
            <span style={{ width: 18, height: 18, borderRadius: 9, border: '2px solid #E4EDFC', borderTopColor: BLUE, animation: 'spin 1s linear infinite' }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 650, color: INK }}>Reading link…</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.url || job.rawText}
          </div>
          <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: '#ECECF0', overflow: 'hidden' }}>
            <div style={{ width: '50%', height: '100%', background: BLUE }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: MUTED }}>
            {job.progress || 'Step 2 of 4 · Finding title and creator'}
          </div>
        </div>
      ))}

      {/* Needs Attention / Failed Banner */}
      {failedJobs.map((job) => (
        <div
          key={job.id}
          style={{
            padding: 14,
            borderRadius: 20,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)',
            borderLeft: '4px solid #B3261E',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: '#B3261E', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Needs attention
          </div>
          <div style={{ fontSize: 16, fontWeight: 650, color: INK }}>Couldn’t read this link</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.error || 'The site blocked access'} · {job.url || job.rawText}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              onClick={() => {
                processQueue()
                onRefresh?.()
              }}
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 10,
                border: 0,
                background: BLUE,
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => {
                // Keep as plain link / dismiss
                onRefresh?.()
              }}
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 10,
                border: 0,
                background: 'rgba(118,118,128,.12)',
                color: INK,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Save as plain link
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

