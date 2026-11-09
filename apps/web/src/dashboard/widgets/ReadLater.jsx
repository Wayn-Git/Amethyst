import { Button, Input } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function ReadLater({ data, refresh, widgetId }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(approved) {
    setBusy(true); setError('')
    try {
      if (approved === undefined) setDraft(await request(`/widgets/${widgetId}/actions/add`, 'POST', { title, url }))
      else {
        const result = await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
        setDraft(null); if (approved && result.state !== 'applied') throw new Error('Permission denied. No changes were applied.'); await refresh()
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <>{error && <StateView role="alert">{error}</StateView>}{draft ? <section aria-label="Review URL"><p>{draft.item.title}</p><p>{draft.item.url}</p><Button variant="primary" type="submit" disabled={busy} onClick={() => save(true)}>Approve save</Button><Button type="submit" disabled={busy} onClick={() => save(false)}>Reject save</Button></section> : <details className="widget-form-disclosure" open={!data?.items?.length}><summary>Save an article</summary><form onSubmit={event => { event.preventDefault(); save() }}><label>Article title<Input required maxLength={400} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Article URL<Input required type="url" maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} /></label><Button type="submit" disabled={busy}>Review URL</Button></form></details>}<ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><p>{item.summary || item.error || 'Summary unavailable. Refresh to retry.'}</p></WidgetRow>)}</ul></>
}
