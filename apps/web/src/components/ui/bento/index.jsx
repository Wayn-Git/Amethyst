import { Children } from 'react'
import Button from '../AppButton.jsx'
export { default as Button } from '../AppButton.jsx'
export { default as Select } from '../NativeSelect.jsx'
export { default as Kbd } from '../Kbd.jsx'
import { Input as BaseInput } from '../input'
import { Checkbox as BaseCheckbox } from '../checkbox'
import BaseSwitch from '../Switch.jsx'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../dropdown-menu'
import { Tooltip as BaseTooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../tooltip'
import './system.css'

export function BentoGrid({ children, className = '', ...props }) { return <div className={`bento-container ${className}`} {...props}><div className="bento-grid">{children}</div></div> }
export function Tile({ tone = 'light', size = 'm', children, className = '', ...props }) { return <article className={`ui-tile ${className}`} data-tone={tone} data-size={size} {...props}>{children}</article> }
export function TileHeader({ title, children }) { return <header className="ui-tile-header"><h2>{title}</h2>{children}</header> }
export function Stat({ value, label, unit }) { return <div className="ui-stat"><div>{value}<small>{unit}</small></div><span>{label}</span></div> }
export function Chip({ children }) { return <span className="ui-chip">{children}</span> }
export function Row({ children, trailing }) { return <div className="ui-row"><div>{children}</div>{trailing}</div> }
export function IconBadge({ children, label }) { return <span className="ui-icon-badge" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>{children}</span> }
export function Initials({ name }) { return <span className="ui-icon-badge" role="img" aria-label={name}>{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span> }
export function SplitTile({ children, ...props }) { return <Tile {...props}><div className="ui-split">{Children.map(children, child => <div>{child}</div>)}</div></Tile> }
export function Skeleton({ label = 'Loading' }) { return <div className="ui-skeleton" role="status" aria-label={label}><span/><span/><span/></div> }
export function EmptyState({ message = 'No items.', action }) { return <div className="ui-state"><p>{message}</p>{action}</div> }
export function ConnectTile({ source, onConnect, ...props }) { return <Tile {...props}><EmptyState message={`Connect ${source}`} action={<Button onClick={onConnect}>Connect</Button>}/></Tile> }
export function ErrorState({ message, onRetry }) { return <div role="alert"><EmptyState message={message} action={<Button onClick={onRetry}>Retry</Button>}/></div> }
export function Toast({ children, action }) { return <div role="status" className="ui-toast">{children}{action}</div> }

function ratio(value, max) { return Number.isFinite(value) && Number.isFinite(max) && max > 0 ? Math.min(1, Math.max(0, value / max)) : null }
export function Ring({ value, max = 100, label }) {
  const fraction = ratio(value, max)
  if (fraction === null) return <EmptyState message="No measurement."/>
  return <svg className="ui-ring" viewBox="0 0 100 100" role="img" aria-label={`${label}: ${value} / ${max}`}><circle className="ui-track" cx="50" cy="50" r="42"/><circle cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${fraction * 100} 100`} transform="rotate(-90 50 50)"/><text x="50" y="54" textAnchor="middle">{value}</text></svg>
}
export function Gauge({ value, max = 100, label }) {
  const fraction = ratio(value, max)
  if (fraction === null) return <EmptyState message="No measurement."/>
  return <svg className="ui-gauge" viewBox="0 0 100 65" role="img" aria-label={`${label}: ${value} / ${max}`}><path className="ui-track" d="M8 50 A42 42 0 0 1 92 50"/><path d="M8 50 A42 42 0 0 1 92 50" pathLength="100" strokeDasharray={`${fraction * 100} 100`}/><text x="50" y="55" textAnchor="middle">{value}</text></svg>
}
export function Sparkline({ values, label }) {
  if (!values?.length || !values.every(Number.isFinite)) return <EmptyState message="No measurements."/>
  const min = Math.min(...values), range = Math.max(...values) - min
  const points = values.map((value, index) => `${values.length === 1 ? 50 : index * 96 / (values.length - 1) + 2},${range ? 38 - (value - min) * 36 / range : 20}`).join(' ')
  return <svg className="ui-sparkline" viewBox="0 0 100 40" role="img" aria-label={`${label}: ${values.join(', ')}`}><polyline points={points}/>{values.length === 1 && <circle cx="50" cy="20" r="1"/>}</svg>
}
export function SegmentedBar({ value, max = 100, label, segments = 10 }) {
  const fraction = ratio(value, max)
  if (fraction === null) return <EmptyState message="No measurement."/>
  const count = Number.isInteger(segments) ? Math.min(50, Math.max(1, segments)) : 10
  return <div className="ui-segmented-bar" role="meter" aria-label={label} aria-valuenow={Math.min(max, Math.max(0, value))} aria-valuemin={0} aria-valuemax={max}>{Array.from({ length: count }, (_, index) => <span key={index} data-filled={index < Math.round(fraction * count)}/>)}</div>
}
export function IconButton({ label, ...props }) { return <Button size="icon" aria-label={label} {...props}/> }
export function Input({ loading, disabled, ...props }) { return <BaseInput disabled={disabled || loading} aria-busy={loading || undefined} {...props}/> }
export function Checkbox({ loading, disabled, ...props }) { return <BaseCheckbox disabled={disabled || loading} aria-busy={loading || undefined} {...props}/> }
export function Switch({ loading, disabled, ...props }) { return <span aria-busy={loading || undefined}><BaseSwitch disabled={disabled || loading} {...props}/></span> }
export function Segmented({ options, loading, disabled, ...props }) { return <RadioGroup className="ui-segmented" disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{options.map(option => <Radio.Root key={option.value} value={option.value}>{option.label}</Radio.Root>)}</RadioGroup> }
export function Menu({ label = 'Options', items, loading, disabled }) { return <DropdownMenu><DropdownMenuTrigger render={<Button disabled={disabled || loading} loading={loading}/>}>{label}</DropdownMenuTrigger><DropdownMenuContent>{items.map(item => <DropdownMenuItem key={item.label} disabled={item.disabled} onClick={item.onClick}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu> }
export function Tooltip({ children, label }) { return <TooltipProvider><BaseTooltip><TooltipTrigger render={children}/><TooltipContent>{label}</TooltipContent></BaseTooltip></TooltipProvider> }

export function Textarea({ loading, disabled, className = '', ...props }) {
  return <textarea className={`ui-textarea ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props} />
}
