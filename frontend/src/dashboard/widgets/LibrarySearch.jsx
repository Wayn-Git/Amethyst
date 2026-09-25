import { StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'
import Library from './Library.jsx'

export default function LibrarySearch({ data, refresh }) {
  const [query, setQuery] = useState(data?.query || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function search(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await request('/widgets/lib.search/settings', 'PUT', { query }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <><form onSubmit={search}><label>Search Library<input maxLength={500} value={query} onChange={event => setQuery(event.target.value)} /></label><button disabled={busy}>Search</button></form>{error && <StateView role="alert">{error}</StateView>}<Library data={data} /></>
}
