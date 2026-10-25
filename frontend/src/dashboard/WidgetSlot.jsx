import { memo, useState } from 'react'
import Button from '../components/ui/AppButton.jsx'
import Select from '../components/ui/NativeSelect.jsx'
import Icon from '../components/Icon.jsx'

export default memo(function WidgetSlot({ id, title, size, sizes, lane, editing, dragging, move, resize, grip, children }) {
  const [collapsed, setCollapsed] = useState(false)
  return <section className={`today-widget-slot home-slot${dragging ? ' is-drag-target' : ''}`} data-slot-id={id} data-lane={lane} data-size={size} data-collapsed={collapsed || undefined} aria-label={`${title} slot`}>
    <div className={`today-slot-toolbar${editing ? ' is-editing' : ''}`}>
      {editing && <>
        <Button className="today-drag" size="small" variant="ghost" {...grip('move', id)} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); move(id, ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) } }} aria-label={`Move ${title}`} title="Drag or use arrow keys"><Icon name="drag-handle" size={16} /><span>{title}</span></Button>
        <span className="today-mobile-move"><Button size="small" variant="ghost" onClick={() => move(id, -1)} aria-label={`Move ${title} up`}><Icon name="arrow-up" size={14} /></Button><Button size="small" variant="ghost" onClick={() => move(id, 1)} aria-label={`Move ${title} down`}><Icon name="arrow-down" size={14} /></Button></span>
        <Select aria-label={`Size ${title}`} value={size} onChange={event => resize(id, { size: event.target.value })}>{sizes.map(value => <option key={value} value={value}>{({ s: 'Small', m: 'Medium', l: 'Large' })[value]}</option>)}</Select>
      </>}
      <Button className="today-collapse" size="small" variant="ghost" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} onClick={() => setCollapsed(value => !value)} title={collapsed ? 'Expand' : 'Collapse'}><Icon name={collapsed ? 'chevron-down' : 'caret-up'} size={14} />{collapsed && !editing && <span>{title}</span>}</Button>
    </div>
    <div className="today-slot-body" hidden={collapsed}>{children}</div>
    {editing && !collapsed && <Button className="today-resize" size="small" variant="ghost" {...grip('resize', id)} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); const index = sizes.indexOf(size); resize(id, { size: sizes[Math.max(0, Math.min(sizes.length - 1, index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1)))] }) } }} aria-label={`Resize ${title}`} title="Drag or use arrow keys"><Icon name="expand" size={14} /></Button>}
  </section>
})
