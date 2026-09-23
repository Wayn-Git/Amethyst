import { useState } from 'react'
import { request } from '../api'

export default function Director({ data, widgetId, refresh }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(path, body = {}) {
    setBusy(true); setError('')
    try { await request(path, 'POST', body); await refresh() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <>{error && <p role="alert">{error}</p>}<ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}>
    <div><strong>{item.title}</strong><p>{item.detail}</p>
      {widgetId === 'need.decisions' && <form onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        act(`/questions/${encodeURIComponent(item.id)}`, { answers: item.questions.map((_, index) => form.get(`answer-${index}`)) })
      }}>
        {item.questions.map((question, index) => <label key={index}>
          {question.question}
          {question.options?.length > 0 && <p>{question.options.map(option => `${option.label}${option.description ? `: ${option.description}` : ''}`).join(' · ')}</p>}
          <input name={`answer-${index}`} aria-label={question.question} required disabled={busy} />
        </label>)}
        <button disabled={busy} type="submit">Answer</button>
        <button disabled={busy} type="button" onClick={() => act(`/questions/${encodeURIComponent(item.id)}/reject`)}>Dismiss</button>
      </form>}
      {item.arguments && <pre>{item.arguments}</pre>}
      {widgetId === 'need.approvals' && <div>
        <button disabled={busy} onClick={() => act(`/confirmations/${encodeURIComponent(item.id)}`, { allow: true })}>Approve</button>
        <button disabled={busy} onClick={() => act(`/confirmations/${encodeURIComponent(item.id)}`, { allow: false })}>Deny</button>
      </div>}
      {widgetId === 'agent.running' && <button disabled={busy} onClick={() => act(`/conversations/${encodeURIComponent(item.conversation_id)}/turn/stop`)}>Stop</button>}
    </div>
  </li>)}</ul></>
}
