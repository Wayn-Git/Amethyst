import { Button, Input, Textarea } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Jobs({ data, widgetId, refresh }) {
  const delegated = widgetId !== 'agent.jobs'
  const [trace, setTrace] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function propose(action, body) {
    setBusy(true); setError('')
    try { setDraft(await request(`/widgets/${widgetId}/actions/${action}`, 'POST', body)) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null); await refresh()
    } catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  if (data?.available === false) return <StateView>not available</StateView>
  return <>
    <p>Runs while Amethyst is open. Missed runs are skipped. Writes require approval.</p>
    {error && <StateView role="alert">{error}</StateView>}
    {draft ? <section aria-label="Review job"><pre>{JSON.stringify(draft.item, null, 2)}</pre><Button variant="primary" type="submit" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => decide(false)}>Reject change</Button></section> : <details className="widget-form-disclosure" open={!data?.items?.length}><summary>New job</summary><form onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget)
      propose('add', { title: f.get('title'), prompt: f.get('prompt'), ...(delegated ? {} : { run_at: new Date(f.get('at')).toISOString(), interval_s: f.get('interval') ? Number(f.get('interval')) * 60 : null }) })
    }}>
      <label>Title<Input name="title" required maxLength={500} /></label>
      <label>Prompt<Textarea name="prompt" required maxLength={10000} /></label>
      {!delegated && <><label>Run at<Input name="at" type="datetime-local" required /></label>
      <label>Repeat every minutes (blank for once)<Input name="interval" type="number" min="15" max="43200" /></label></>}
      <Button type="submit" disabled={busy}>Review job</Button>
    </form></details>}
    <ul className="widget-list widget-timeline">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.status} {item.detail}</p>{item.note_id && <a href={`/library?q=${encodeURIComponent(item.title)}&kind=note`}>Open research note</a>}{item.trace_id && <Button type="submit" disabled={busy} onClick={async () => { try { setTrace(await request(`/widgets/agent.delegated/runs/${item.run_id}/trace`)) } catch (e) { setError(e.message) } }}>View trace {item.trace_id}</Button>}{!delegated && <Button type="submit" disabled={busy} onClick={() => propose('delete', { id: item.id })}>Delete</Button>}</div></WidgetRow>)}</ul>
    {trace && <pre aria-label="Director trace">{JSON.stringify(trace, null, 2)}</pre>}
    <ul>{(data?.runs || []).map(run => <WidgetRow key={run.id}><div>Run {run.id}: {run.status} {run.error}</div></WidgetRow>)}</ul>
  </>
}
