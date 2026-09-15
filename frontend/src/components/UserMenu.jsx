import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import Icon from './Icon'
import { ThemeToggleButton } from './ui/skiper/index.js'
import { useApp } from '../store'
import { api } from '../api'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const MOD_PREFIX = IS_MAC ? '⌘' : 'Ctrl+'

export default function UserMenu({ children, align = 'start', side = 'bottom', sideOffset = 8 }) {
  const { userProfile, setUserProfile, theme, setTheme, setView, setOverlay, toast } = useApp()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [open, setOpen] = useState(false)

  const handleStartEditing = (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    setNameDraft(userProfile?.name || '')
    setEditingName(true)
  }

  const handleSaveName = async (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === userProfile?.name) {
      setEditingName(false)
      return
    }
    try {
      await api.updateProfile({ name: trimmed })
      setUserProfile((prev) => ({ ...(prev || {}), name: trimmed }))
      toast('Username updated', 'ok')
      setEditingName(false)
    } catch (err) {
      toast(err.message || 'Failed to update username', 'bad')
    }
  }

  const initial = (userProfile?.name || 'U').charAt(0).toUpperCase()
  const displayName = userProfile?.full_name || userProfile?.name || 'User'
  const displayEmail = userProfile?.email || 'user@amethyst.local'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={children} />
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="user-menu-popover-content sb-user-popover"
      >
        {/* User Card Header */}
        <div className="sb-user-popover-header">
          <div className="sb-user-popover-avatar">
            {initial}
          </div>
          <div className="sb-user-popover-details">
            <span className="sb-user-popover-name" title={displayName}>
              {displayName}
            </span>
            <span className="sb-user-popover-email" title={displayEmail}>
              {displayEmail}
            </span>
          </div>
        </div>

        <div className="sb-user-popover-divider" />

        {editingName ? (
          <div className="sb-user-name-editor" onClick={(e) => e.stopPropagation()}>
            <div className="sb-user-editor-label">Display Name</div>
            <div className="sb-user-editor-row" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                className="user-menu-name-input"
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  outline: 'none',
                }}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName(e)
                  if (e.key === 'Escape') setEditingName(false)
                }}
                autoFocus
                placeholder="Enter username"
              />
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={handleSaveName}
                disabled={!nameDraft.trim() || nameDraft.trim() === userProfile?.name}
                style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '5px' }}
              >
                Save
              </button>
              <button
                type="button"
                className="sb-icon-btn"
                onClick={() => setEditingName(false)}
                title="Cancel"
                style={{ width: '24px', height: '24px', padding: 0 }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem
            closeOnClick={false}
            className="sb-user-popover-item"
            onClick={handleStartEditing}
          >
            <Icon name="edit" size={14} />
            <span>Change username</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          className="sb-user-popover-item"
          onClick={() => {
            setOpen(false)
            setView('settings')
          }}
        >
          <Icon name="sliders" size={14} />
          <span>Settings</span>
          <span className="sb-user-popover-kbd">{MOD_PREFIX},</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="sb-user-popover-item"
          onClick={() => {
            setOpen(false)
            setOverlay('palette')
          }}
        >
          <Icon name="search" size={14} />
          <span>Command Palette</span>
          <span className="sb-user-popover-kbd">{MOD_PREFIX}K</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="sb-user-popover-item"
          onClick={() => {
            setOpen(false)
            setOverlay('shortcuts')
          }}
        >
          <Icon name="keyboard" size={14} />
          <span>Shortcuts</span>
          <span className="sb-user-popover-kbd">?</span>
        </DropdownMenuItem>

        <div className="sb-user-popover-divider" />

        <div className="sb-user-popover-theme-row">
          <span className="sb-user-popover-theme-label">Theme</span>
          <ThemeToggleButton
            theme={theme}
            setTheme={setTheme}
            className="sb-theme-toggle"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
