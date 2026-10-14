import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function Library({ data }) {
  return <>{data?.degraded && <p role="status">Keyword results only; semantic search unavailable.</p>}<ul className="widget-list home-library-list">{(data?.items || []).map(item => <li key={item.id}><div className="home-library-cover" aria-hidden="true"><span>{item.kind || 'Saved'}</span><Icon name={item.kind === 'video' ? 'play' : 'bookmark'} size={30} /><img key={item.id} loading="lazy" src={api.thumbnailUrl(item.id)} alt="" onError={event => { event.currentTarget.hidden = true }} /></div><div className="home-library-copy"><strong>{item.title}</strong><p>{item.kind}</p>{item.updated_at && <p>Edited {item.updated_at}</p>}{item.reason && <p>{item.reason}</p>}{item.excerpt && <p>{item.excerpt}</p>}</div></li>)}</ul></>
}
