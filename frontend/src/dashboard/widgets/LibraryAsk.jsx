import { StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'

export default function LibraryAsk({ data, refresh, widgetId }) {
  const [query, setQuery] = useState(data?.query || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function search(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { query }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <><form onSubmit={search}><label>Ask your notes<input maxLength={500} value={query} onChange={event => setQuery(event.target.value)} /></label><button disabled={busy}>Ask</button></form>{error && <StateView role="alert">{error}</StateView>}<StateView role="status">{busy ? 'Generating…' : data?.answer}</StateView><ul>{(data?.items || []).map(item => <li key={item.id}><a href={`/today?source=library&item=${item.id}`}>{item.title}</a><blockquote>{item.excerpt}</blockquote></li>)}</ul></>
}
