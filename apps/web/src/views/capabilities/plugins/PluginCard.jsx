import { Loader2, ChevronRight } from 'lucide-react'
import ServiceIcon from './ServiceIcon.jsx'

export default function PluginCard({
  card,
  status,
  onOpenDetail,
  onConnect,
  onDisconnect,
  onChat,
  busy = false,
}) {
  const isConnected = Boolean(status?.connected || status?.accounts?.length)
  const isPending = Boolean(status?.pending)

  return (
    <div
      className={`plugin-card-row ${isConnected ? 'is-connected' : ''}`}
      onClick={() => onOpenDetail?.(card)}
      role="button"
      tabIndex={0}
      aria-label={`${card.label || card.name} (${isConnected ? 'Connected' : 'Available'})`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail?.(card)
        }
      }}
    >
      <div className="plugin-card-main-col">
        <div className="plugin-card-icon-wrap">
          <ServiceIcon card={card} />
        </div>
        <div className="plugin-card-text-block">
          <div className="plugin-card-title-row">
            <span className="plugin-card-title">{card.label || card.name}</span>
          </div>
          <p className="plugin-card-blurb">{card.blurb || card.description}</p>
        </div>
      </div>

      <div className="plugin-card-action-col">
        {isPending || busy ? (
          <div className="plugin-card-loading-indicator" title="Connecting…">
            <Loader2 size={15} className="animate-spin text-accent" />
          </div>
        ) : (
          <ChevronRight size={15} className="plugin-card-chevron" />
        )}
      </div>
    </div>
  )
}
