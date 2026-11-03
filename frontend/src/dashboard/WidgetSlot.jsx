import { memo, useId, useState } from 'react'
import Button from '../components/ui/AppButton.jsx'
import { Segmented } from '../components/ui/bento/index.jsx'
import Icon from '../components/Icon.jsx'
import { ADOPTED_WIDGETS, widgetTone } from './layout.js'

export default memo(function WidgetSlot({ id, title, size, displaySize = size, sizes, lane, editing, dragging, dropTarget, move, resize, grip, placement, remove, children }) {
  const bodyId = useId()
  const [collapsed, setCollapsed] = useState(false)
  const adopted = ADOPTED_WIDGETS.has(id)
  return <section className={`today-widget-slot home-slot ui-tile${adopted ? ' widget-slot-adopted' : ''}${dragging ? ' is-drag-target' : ''}${editing ? ' is-editing' : ''}`} style={placement && { position: 'absolute', left: placement.left, top: placement.top, width: placement.width, height: placement.height }} data-drop-target={dropTarget || undefined} data-tone={widgetTone(id)} data-slot-id={id} data-lane={lane} data-size={displaySize} data-collapsed={collapsed || undefined} aria-label={`${title} slot`}>
    <div className={`today-slot-toolbar${editing ? ' is-editing' : ''}`}>
      {editing && <>
        <Button className="today-drag" size="small" variant="ghost" {...grip('move', id)} aria-label={`Move ${title}`} title="Drag or use arrow keys"><Icon name="dots-six" size={16} /><span>{title}</span></Button>
        <span className="today-mobile-move"><Button size="small" variant="ghost" onClick={() => move(id, 'ArrowUp')} aria-label={`Move ${title} up`}><Icon name="arrow-up" size={14} /></Button><Button size="small" variant="ghost" onClick={() => move(id, 'ArrowDown')} aria-label={`Move ${title} down`}><Icon name="arrow-down" size={14} /></Button></span>
        <Segmented className="today-slot-sizes" aria-label={`Size ${title}`} value={size} onValueChange={value => resize(id, { size: value })} options={sizes.map(value => ({ value, label: value.toUpperCase() }))} />
        <Button className="today-remove-widget" size="small" variant="ghost" onClick={() => remove?.(id)} aria-label={`Remove ${title}`} title={`Remove ${title}`}><Icon name="trash" size={15} /></Button>
      </>}
      <Button className="today-collapse" size="small" variant="ghost" aria-controls={bodyId} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} onClick={() => setCollapsed(value => !value)} title={collapsed ? 'Expand' : 'Collapse'}><Icon name={collapsed ? 'chevron-down' : 'caret-up'} size={14} />{collapsed && !editing && <span>{title}</span>}</Button>
    </div>
    {dragging && <span className="today-drop-placeholder" aria-hidden="true">Drop here</span>}
    <div id={bodyId} className="today-slot-body" hidden={collapsed}>{children}</div>
    {editing && !collapsed && <Button className="today-resize" size="small" variant="ghost" {...grip('resize', id)} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); const index = sizes.indexOf(size); resize(id, { size: sizes[Math.max(0, Math.min(sizes.length - 1, index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1)))] }) } }} aria-label={`Resize ${title}`} title="Drag or use arrow keys"><Icon name="expand" size={14} /></Button>}
  </section>
})
