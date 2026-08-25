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
        await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
        setDraft(null); await refresh()
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <>{error && <StateView role="alert">{error}</StateView>}{draft ? <section aria-label="Review URL"><p>{draft.item.title}</p><p>{draft.item.url}</p><button disabled={busy} onClick={() => save(true)}>Approve save</button><button disabled={busy} onClick={() => save(false)}>Reject save</button></section> : <form onSubmit={event => { event.preventDefault(); save() }}><label>Article title<input required maxLength={400} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Article URL<input required type="url" maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} /></label><button disabled={busy}>Review URL</button></form>}<ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><p>{item.summary || item.error || 'Summary unavailable. Refresh to retry.'}</p></WidgetRow>)}</ul></>
}
