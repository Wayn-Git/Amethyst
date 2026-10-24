import { useEffect, useState } from 'react'
import { request } from './api.js'

export default function SourceItem() {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source'), id = params.get('item')
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!source || !id) return
    let active = true
    request(['tasks', 'library'].includes(source) ? `/dashboard/search/${source}/${encodeURIComponent(id)}` : `/widgets/${encodeURIComponent(source)}/items/${encodeURIComponent(id)}`).then(value => { if (active) setItem(value) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [source, id])
  if (!source || !id) return null
  return <section aria-label="Source item"><h2>{item?.title || 'Source item'}</h2><p>{item?.widget_id}</p><p>{item?.detail}</p>{error && <p role="alert">{error}</p>}<a href="/today">Back to Home</a></section>
}
