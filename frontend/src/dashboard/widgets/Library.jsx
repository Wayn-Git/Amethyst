import { WidgetRow, StateView } from '../primitives.jsx'
import Icon from '../../components/Icon.jsx'

export default function Library({ data }) {
  return <>{data?.degraded && <StateView role="status">Keyword results only; semantic search unavailable.</StateView>}<ul className="widget-list home-library-list">{(data?.items || []).map(item => <WidgetRow key={item.id}><div className="home-library-cover" aria-hidden="true"><Icon name={item.kind === 'video' ? 'play' : 'bookmark'} size={30} /></div><div className="home-library-copy"><strong>{item.title}</strong><p>{item.kind}</p>{item.updated_at && <p>Edited {item.updated_at}</p>}{item.reason && <p>{item.reason}</p>}{item.excerpt && <p>{item.excerpt}</p>}</div></WidgetRow>)}</ul></>
}
