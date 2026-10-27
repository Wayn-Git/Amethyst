import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api'
import { Button, Input } from '../../components/ui/bento/index.jsx'

export default function Director({ data, widgetId, refresh }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(path, body = {}) {
    setBusy(true); setError('')
    try { await request(path, 'POST', body); await refresh() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <>{error && <StateView role="alert">{error}</StateView>}<ul className={`widget-list${widgetId.startsWith('agent.') ? ' widget-timeline' : ''}`}>{(data?.items || []).map(item => <WidgetRow key={item.id} className={widgetId.startsWith('agent.') ? 'timeline-row' : undefined}>
    <div><strong>{item.title}</strong><p className={widgetId.startsWith('agent.') ? 'timeline-detail' : undefined}>{item.detail}</p>
      {widgetId === 'need.decisions' && <form onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        act(`/questions/${encodeURIComponent(item.id)}`, { answers: item.questions.map((_, index) => form.get(`answer-${index}`)) })
      }}>
        {item.questions.map((question, index) => <label key={index}>
          {question.question}
          {question.options?.length > 0 && <p>{question.options.map(option => `${option.label}${option.description ? `: ${option.description}` : ''}`).join(' · ')}</p>}
          <Input name={`answer-${index}`} aria-label={question.question} required disabled={busy} />
        </label>)}
        <div className="widget-buttons"><Button variant="primary" loading={busy} type="submit">Answer</Button>
        <Button disabled={busy} onClick={() => act(`/questions/${encodeURIComponent(item.id)}/reject`)}>Dismiss</Button></div>
      </form>}
      {item.arguments && <pre>{item.arguments}</pre>}
      {widgetId === 'need.approvals' && <div className="widget-buttons">
        <Button variant="primary" loading={busy} onClick={() => act(`/confirmations/${encodeURIComponent(item.id)}`, { allow: true })}>Approve</Button>
        <Button disabled={busy} onClick={() => act(`/confirmations/${encodeURIComponent(item.id)}`, { allow: false })}>Deny</Button>
      </div>}
      {widgetId === 'agent.running' && <Button type="submit" disabled={busy} onClick={() => act(`/conversations/${encodeURIComponent(item.conversation_id)}/turn/stop`)}>Stop</Button>}
    </div>
  </WidgetRow>)}</ul>{data?.history?.length > 0 && <><h3>Approval history</h3><ul className="widget-list">{data.history.map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p></div></WidgetRow>)}</ul></>}</>
}
