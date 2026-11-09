import { Button, Input, Select } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { WidgetRow, WidgetChip, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Collections({ data, refresh, widgetId }) {
  const [tag, setTag] = useState('')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(action, approved) {
    setBusy(true); setError('')
    try {
      if (approved === undefined) setDraft(await request(`/widgets/${widgetId}/actions/${action}`, 'POST', { tag, ...(action === 'tag' ? { id: Number(note) } : {}) }))
      else {
        const result = await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
        setDraft(null); if (approved && result.state !== 'applied') throw new Error('Permission denied. No changes were applied.'); await refresh()
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function filter(tag) {
    setBusy(true); setError('')
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { tag }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <>{error && <StateView role="alert">{error}</StateView>}{draft ? <section aria-label="Review collection change"><p>{draft.action === 'tag' ? `Tag note ${draft.item.id}` : 'Create collection'}: {draft.item.tag}</p><Button variant="primary" type="submit" disabled={busy} onClick={() => save(draft.action, true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => save(draft.action, false)}>Reject change</Button></section> : <details className="widget-form-disclosure" open={!data?.items?.length}><summary>Manage collections</summary><form onSubmit={event => { event.preventDefault(); save('add') }}><label>Collection tag<Input required maxLength={80} value={tag} onChange={e => setTag(e.target.value)} /></label><Button type="submit" disabled={busy}>Review collection</Button><label>Note to tag<Select aria-label="Note to tag" value={note} onChange={e => setNote(e.target.value)}><option value="">Choose a note</option>{(data?.notes || []).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></label><Button type="button" disabled={busy || !note || !tag.trim()} onClick={() => save('tag')}>Review tag</Button></form></details>}<label>Filter by tag<Select aria-label="Filter by tag" disabled={busy} value={data?.tag || ''} onChange={e => filter(e.target.value)}><option value="">All notes</option>{(data?.tags || []).map(tag => <option key={tag} value={tag}>{tag}</option>)}</Select></label><ul aria-label="Collections">{(data?.collections || []).map(tag => <WidgetRow key={tag}><Button type="submit" disabled={busy} onClick={() => filter(tag)}>{tag}</Button></WidgetRow>)}</ul><ul aria-label="Notes">{(data?.items || []).map(item => <WidgetRow key={item.id}><a href={`/today?source=library&item=${item.id}`}>{item.title}</a>{(item.tags || []).map(tag => <WidgetChip key={tag}>{tag}</WidgetChip>)}</WidgetRow>)}</ul></>
}
