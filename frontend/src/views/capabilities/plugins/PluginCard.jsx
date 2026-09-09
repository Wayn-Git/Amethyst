import { useState, useRef, useEffect } from 'react'
import {
  Plus,
  MoreHorizontal,
  MessageSquare,
  Settings,
  Trash2,
  Loader2,
  Check,
} from 'lucide-react'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const isConnected = Boolean(status?.connected || status?.accounts?.length)
  const isPending = Boolean(status?.pending)
  const isIncluded = Boolean(card?.noAuth)

  // Close context menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  return (
    <div
      className={`plugin-card-row ${isConnected ? 'is-connected' : ''}`}
      onClick={() => onOpenDetail?.(card)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail?.(card)
        }
      }}
    >
      <div className="plugin-card-main-col">
        <ServiceIcon card={card} />
        <div className="plugin-card-text-block">
          <div className="plugin-card-title-row">
            <span className="plugin-card-title">{card.label || card.name}</span>
          </div>
          <p className="plugin-card-blurb">{card.blurb || card.description}</p>
        </div>
      </div>

      <div
        className="plugin-card-action-col"
        onClick={(e) => e.stopPropagation()}
      >
        {isPending || busy ? (
          <div className="plugin-action-icon-btn is-loading" title="Connecting...">
            <Loader2 size={16} className="animate-spin text-accent" />
          </div>
        ) : isConnected ? (
          <div className="plugin-menu-anchor" ref={menuRef}>
            <button
              type="button"
              className={`plugin-action-icon-btn is-more ${menuOpen ? 'is-active' : ''}`}
              title="More options"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={17} />
            </button>

            {menuOpen && (
              <div className="plugin-context-popover" role="menu">
                <button
                  type="button"
                  className="plugin-popover-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onChat?.(card)
                  }}
                >
                  <MessageSquare size={14} className="text-dim" />
                  <span>Chat</span>
                </button>
                <button
                  type="button"
                  className="plugin-popover-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenDetail?.(card)
                  }}
                >
                  <Settings size={14} className="text-dim" />
                  <span>Manage</span>
                </button>
                <div className="plugin-popover-divider" />
                <button
                  type="button"
                  className="plugin-popover-item is-danger"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    if (
                      window.confirm(
                        `Disconnect ${card.label || card.name} from Amethyst?`
                      )
                    ) {
                      onDisconnect?.(card.slug)
                    }
                  }}
                >
                  <Trash2 size={14} />
                  <span>Uninstall</span>
                </button>
              </div>
            )}
          </div>
        ) : isIncluded ? (
          <div className="plugin-menu-anchor" ref={menuRef}>
            <button
              type="button"
              className={`plugin-action-icon-btn is-more ${menuOpen ? 'is-active' : ''}`}
              title="More options"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <MoreHorizontal size={17} />
            </button>

            {menuOpen && (
              <div className="plugin-context-popover" role="menu">
                <button
                  type="button"
                  className="plugin-popover-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onChat?.(card)
                  }}
                >
                  <MessageSquare size={14} className="text-dim" />
                  <span>Chat</span>
                </button>
                <button
                  type="button"
                  className="plugin-popover-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenDetail?.(card)
                  }}
                >
                  <Settings size={14} className="text-dim" />
                  <span>Details</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="plugin-action-icon-btn is-add"
            title={`Connect ${card.label || card.name}`}
            onClick={() => onConnect?.(card.slug)}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
