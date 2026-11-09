import { useEffect, useState } from 'react'
import { request } from './api.js'

export default function SourceItem() {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source'), id = params.get('item')
  const key = `${source}:${id}`
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (!source || !id) return
    let active = true
    request(['tasks', 'library'].includes(source) ? `/dashboard/search/${source}/${encodeURIComponent(id)}` : `/widgets/${encodeURIComponent(source)}/items/${encodeURIComponent(id)}`).then(item => { if (active) setResult({ key, item }) }).catch(err => { if (active) setResult({ key, error: err.message }) })
    return () => { active = false }
  }, [source, id, key])
  if (!source || !id) return null
  const current = result?.key === key ? result : null
  return <section className="today-source-item ui-tile" aria-label="Source item"><h2>{current?.item?.title || 'Source item'}</h2>{!current && <p role="status">Loading item…</p>}<p>{current?.item?.widget_id}</p><p className="source-item-detail">{current?.item?.detail}</p>{current?.error && <p role="alert">{current.error}</p>}<a href="/today">Back to Home</a></section>
}
