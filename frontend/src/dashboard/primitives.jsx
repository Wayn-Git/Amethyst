import Icon from '../components/Icon.jsx'
import { freshness } from './layout.js'

export function WidgetCard({ as: Tag = 'article', className = '', ...props }) { return <Tag className={`widget-card ${className}`} {...props} /> }
export function CardHeader(props) { return <header {...props} /> }
export function WidgetRow({ className = 'widget-row', ...props }) { return <li className={className} {...props} /> }
export function Tile({ className = '', ...props }) { return <div className={`widget-tile ${className}`} {...props} /> }
export function WidgetChip({ className = 'widget-chip', ...props }) { return <span className={className} {...props} /> }
export function StateView({ className = 'widget-state', ...props }) { return <p className={className} {...props} /> }

export function Skeleton() {
  return <div className="widget-skeleton" role="status" aria-label="Loading widget…"><span /><span /><span /></div>
}

export function WidgetState({ data, empty, editable, disconnected, children }) {
  if (data.state === 'loading') return <Skeleton />
  if (data.state === 'not-connected') return <><StateView role="status">Not connected. Required source or setting is unavailable.</StateView>{disconnected && children}</>
  if (data.state === 'error') return <StateView role="alert">{data.error || 'This widget could not refresh.'}</StateView>
  // Keep the content in the same slot when refresh changes an empty list to populated or back.
  return <>{data.state === 'empty' && <StateView role="status">{empty}</StateView>}{(data.state !== 'empty' || editable) && children}</>
}

export function WidgetHeader({ title, count, source, data, now, icon, children }) {
  const synced = data.synced_at ? `Last synced ${new Date(data.synced_at).toLocaleString()}` : 'Not synced yet'
  return <CardHeader className="widget-header"><div className="widget-title">{icon && <span className="widget-heading-icon"><Icon name={icon} size={20} /></span>}<h2>{title}</h2>{count > 0 && <WidgetChip className="widget-chip">{count}</WidgetChip>}{source && <WidgetChip className="widget-source">{source}</WidgetChip>}</div><div className="widget-actions"><span className="widget-freshness" title={synced} aria-label={synced}>{freshness(data.synced_at, now)}</span>{['stale', 'error'].includes(data.state) && <WidgetChip className={`widget-chip state-${data.state}`} title={data.error || ''}>{data.state === 'stale' ? 'Stale data.' : 'Error'}</WidgetChip>}{children}</div></CardHeader>
}
