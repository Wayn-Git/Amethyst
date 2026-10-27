import { Button, Input } from '../../components/ui/bento/index.jsx'
import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'

export default function Feeds({ data, refresh }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function propose(action, body) {
    setBusy(true); setError('')
    try { setDraft(await request(`/widgets/feed.rss/actions/${action}`, 'POST', body)) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/feed.rss/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (result.state === 'applied') { setEditing(null); window.dispatchEvent(new Event('dashboard-items-changed')); await refresh() }
      else if (approved) setError('Permission denied. No feed changed.')
    } catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <div>{error && <StateView role="alert">{error}</StateView>}{draft ? <section aria-label="Review feed change"><p>{draft.action}: {draft.item.url || data?.feeds?.find(f => f.id === draft.item.id)?.url}</p><p>Tags: {draft.item.tags?.join(', ') || 'None'}</p><Button variant="primary" type="submit" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => decide(false)}>Reject change</Button></section> : <>
    {editing ? <form onSubmit={e => { e.preventDefault(); propose(editing.id ? 'edit' : 'add', { id: editing.id || null, url: editing.url, tags: editing.tags.split(',').map(t => t.trim()).filter(Boolean) }) }}><label>Feed URL<Input required type="url" maxLength={2048} value={editing.url} onChange={e => setEditing({ ...editing, url: e.target.value })} /></label><label>Tags (comma separated)<Input value={editing.tags} onChange={e => setEditing({ ...editing, tags: e.target.value })} /></label><Button type="submit" disabled={busy}>Review change</Button><Button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></form> : <Button type="submit" disabled={busy} onClick={() => setEditing({ url: '', tags: '' })}>Add feed</Button>}
    <p>Up to 20 feeds; up to 20 items per feed. RSS 2.0 and Atom supported.</p><ul className="widget-list">{data?.feeds?.map(feed => <WidgetRow key={feed.id}><div>{feed.url}<p>{feed.tags.join(', ')}</p><Button type="submit" disabled={busy} aria-label={`Edit ${feed.url}`} onClick={() => setEditing({ ...feed, tags: feed.tags.join(', ') })}>Edit tags or URL</Button><Button type="submit" disabled={busy} aria-label={`Remove ${feed.url}`} onClick={() => propose('delete', { id: feed.id })}>Remove</Button></div></WidgetRow>)}</ul>
    {data?.errors?.map(e => <StateView role="status" key={e.feed_id}>{data.feeds.find(f => f.id === e.feed_id)?.url}: {e.error}</StateView>)}<ul className="widget-list">{data?.items?.map((item, i) => <WidgetRow key={`${item.url}-${i}`}><div><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><p>{item.tags.join(', ')} · {item.published_at}</p></div></WidgetRow>)}</ul>
  </>}</div>
}
