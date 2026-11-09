import { WidgetRow } from '../primitives.jsx'
import { Chip, IconBadge } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'
export default function NeedsItems({ data }) {
  return <ul className="widget-list adoption-people">{(data?.items || []).map(item => <WidgetRow key={`${item.source}:${item.id}`}>
    <IconBadge><Icon name={item.until ? 'clock' : 'warning'} /></IconBadge><div><strong>{item.title}</strong><div className="adoption-meta"><Chip>{item.until ? (item.return_state === 'ready' ? 'Ready now' : 'Returns today') : 'Overdue'}</Chip><span>{item.source}</span></div><time className="adoption-label" dateTime={item.until || item.due_at}>{new Date(item.until || item.due_at).toLocaleString()}</time></div>
  </WidgetRow>)}</ul>
}
