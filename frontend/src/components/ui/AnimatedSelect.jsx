import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../Icon.jsx'

export default function AnimatedSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select option…',
  leadingIcon,
  renderIcon,
  searchable = false,
  searchPlaceholder = 'Search…',
  allowCustom = false,
  style,
  minWidth = 140,
  align = 'right',
  ariaLabel = 'Select option',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [coords, setCoords] = useState({ top: 0, bottom: 0, left: 0, right: 0, width: 0, showAbove: false })
  const ref = useRef(null)
  const popoverRef = useRef(null)
  const searchInputRef = useRef(null)

  const updatePosition = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const showAbove = spaceBelow < 240 && rect.top > 240
    setCoords({
      top: rect.bottom + 6,
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
      right: window.innerWidth - rect.right,
      width: rect.width,
      showAbove,
    })
  }

  const handleToggle = () => {
    if (!open) {
      updatePosition()
      setSearch('')
    }
    setOpen((prev) => !prev)
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    if (searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
    const handleScrollOrResize = () => updatePosition()
    window.addEventListener('resize', handleScrollOrResize)
    window.addEventListener('scroll', handleScrollOrResize, true)
    return () => {
      window.removeEventListener('resize', handleScrollOrResize)
      window.removeEventListener('scroll', handleScrollOrResize, true)
    }
  }, [open, searchable])

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        ref.current && !ref.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const selectedOpt = options.find((o) => String(o.value) === String(value))

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options
    const q = search.trim().toLowerCase()
    return options.filter(
      (o) =>
        String(o.label || '').toLowerCase().includes(q) ||
        String(o.value || '').toLowerCase().includes(q) ||
        (o.hint && String(o.hint).toLowerCase().includes(q))
    )
  }, [options, search])

  const canShowCustom =
    allowCustom &&
    search.trim().length > 0 &&
    !options.some((o) => String(o.value).toLowerCase() === search.trim().toLowerCase())

  return (
    <div className="anim-select-root" ref={ref} style={style}>
      <button
        type="button"
        className={`anim-select-trigger${open ? ' is-open' : ''}`}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' }}>
          {renderIcon && selectedOpt ? (
            renderIcon(selectedOpt)
          ) : selectedOpt?.icon ? (
            <Icon name={selectedOpt.icon} size={13} style={{ color: 'var(--accent)' }} />
          ) : leadingIcon ? (
            <Icon name={leadingIcon} size={13} style={{ color: 'var(--text-dim)' }} />
          ) : null}
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedOpt ? selectedOpt.label : value ? value : placeholder}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            transition: 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            color: 'var(--text-dim)',
            flexShrink: 0,
            marginLeft: 6,
          }}
        >
          <Icon name="chevron-down" size={11} />
        </div>
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popoverRef}
                className="anim-select-popover"
                style={{
                  position: 'fixed',
                  top: coords.showAbove ? 'auto' : coords.top,
                  bottom: coords.showAbove ? coords.bottom : 'auto',
                  left: align === 'left' ? coords.left : 'auto',
                  right: align === 'right' ? coords.right : 'auto',
                  minWidth: Math.max(minWidth, coords.width),
                  maxHeight: 320,
                  display: 'flex',
                  flexDirection: 'column',
                  zIndex: 99999,
                  overflow: 'hidden',
                }}
                initial={{ opacity: 0, scale: 0.96, y: coords.showAbove ? 4 : -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: coords.showAbove ? 4 : -4 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                role="listbox"
              >
                {searchable && (
                  <div
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--hairline)',
                      background: 'var(--surface-2)',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'var(--raised)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        border: '1px solid var(--hairline)',
                      }}
                    >
                      <Icon name="search" size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={searchPlaceholder}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          outline: 'none',
                          color: 'var(--text)',
                          fontSize: '12px',
                          width: '100%',
                          padding: 0,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSearch('')
                            searchInputRef.current?.focus()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            color: 'var(--text-dim)',
                            display: 'flex',
                          }}
                        >
                          <Icon name="x" size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ overflowY: 'auto', flex: 1, padding: '4px' }}>
                  {canShowCustom && (
                    <button
                      type="button"
                      className="anim-select-item"
                      onClick={() => {
                        onChange(search.trim())
                        setOpen(false)
                        setSearch('')
                      }}
                      style={{ borderBottom: '1px solid var(--hairline)', marginBottom: 2 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="plus" size={13} style={{ color: 'var(--accent)' }} />
                        <span style={{ fontSize: '12px' }}>
                          Use custom: &ldquo;<strong>{search.trim()}</strong>&rdquo;
                        </span>
                      </div>
                    </button>
                  )}

                  {filteredOptions.length === 0 && !canShowCustom ? (
                    <div style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center' }}>
                      No matching results
                    </div>
                  ) : (
                    filteredOptions.map((opt) => {
                      const isSelected = String(opt.value) === String(value)
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={`anim-select-item${isSelected ? ' is-selected' : ''}`}
                          onClick={() => {
                            onChange(opt.value)
                            setOpen(false)
                            setSearch('')
                          }}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                            {renderIcon ? (
                              renderIcon(opt)
                            ) : opt.icon ? (
                              <Icon name={opt.icon} size={13} />
                            ) : null}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {opt.label}
                            </span>
                            {opt.hint && (
                              <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: 'auto', paddingRight: 4 }}>
                                {opt.hint}
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <Icon name="check" size={12} style={{ color: 'var(--accent)', marginLeft: 8, flexShrink: 0 }} />
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  )
}
