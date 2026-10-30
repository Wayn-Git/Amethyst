import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'

export default function AnimatedSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select option…',
  leadingIcon,
  renderIcon,
  renderOption,
  searchable = false,
  searchPlaceholder = 'Search…',
  allowCustom = false,
  style,
  minWidth = 140,
  align = 'right',
  ariaLabel = 'Select option',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [search, setSearch] = useState('')
  const [coords, setCoords] = useState({ top: 0, bottom: 0, left: 0, right: 0, width: 0, showAbove: false })
  const ref = useRef(null)
  const popoverRef = useRef(null)
  const searchInputRef = useRef(null)
  const closeTimerRef = useRef(null)

  const updatePosition = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const showAbove = spaceBelow < 260 && rect.top > 260
    setCoords({
      top: rect.bottom + 6,
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
      right: window.innerWidth - rect.right,
      width: rect.width,
      showAbove,
    })
  }

  const handleOpen = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    updatePosition()
    setSearch('')
    setIsClosing(false)
    setIsOpen(true)
  }

  const handleClose = () => {
    if (!isOpen || isClosing) return
    setIsClosing(true)
    const closeMs = 150
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
    }, closeMs)
  }

  const handleToggle = () => {
    if (isOpen) {
      handleClose()
    } else {
      handleOpen()
    }
  }

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
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
  }, [isOpen, searchable])

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        ref.current && !ref.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) {
        handleClose()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') handleClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const selectedOpt = options.find((o) => String(o.value) === String(value))

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options
    const q = search.trim().toLowerCase()
    return options.filter(
      (o) =>
        String(o.label || '').toLowerCase().includes(q) ||
        String(o.value || '').toLowerCase().includes(q) ||
        (o.hint && String(o.hint).toLowerCase().includes(q)) ||
        (o.description && String(o.description).toLowerCase().includes(q))
    )
  }, [options, search])

  const canShowCustom =
    allowCustom &&
    search.trim().length > 0 &&
    !options.some((o) => String(o.value).toLowerCase() === search.trim().toLowerCase())

  const originClass = coords.showAbove
    ? (align === 'right' ? 'bottom-right' : 'bottom-left')
    : (align === 'right' ? 'top-right' : 'top-left')

  return (
    <div className="anim-select-root" ref={ref} style={style}>
      <button
        type="button"
        className={`anim-select-trigger${isOpen ? ' is-open' : ''}`}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
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
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            color: 'var(--text-dim)',
            flexShrink: 0,
            marginLeft: 6,
          }}
        >
          <Icon name="chevron-down" size={11} />
        </div>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className={`anim-select-popover t-dropdown${!isClosing ? ' is-open' : ' is-closing'}`}
          data-origin={originClass}
          style={{
            position: 'fixed',
            top: coords.showAbove ? 'auto' : coords.top,
            bottom: coords.showAbove ? coords.bottom : 'auto',
            left: align === 'left' ? coords.left : 'auto',
            right: align === 'right' ? coords.right : 'auto',
            minWidth: Math.max(minWidth, coords.width || 160),
            maxWidth: 360,
            maxHeight: 280,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 999999,
          }}
          role="listbox"
        >
          {searchable && (
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--hairline)',
                background: 'var(--surface-2, rgba(255,255,255,0.03))',
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
                  handleClose()
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
                      handleClose()
                      setSearch('')
                    }}
                    role="option"
                    aria-selected={isSelected}
                  >
                    {renderOption ? (
                      renderOption(opt, isSelected)
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          {renderIcon ? (
                            renderIcon(opt)
                          ) : opt.icon ? (
                            <Icon name={opt.icon} size={13} />
                          ) : null}
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {opt.label}
                            </span>
                            {opt.description && (
                              <span style={{ fontSize: '10.5px', color: 'var(--text-dim)', marginTop: 1, fontWeight: 400 }}>
                                {opt.description}
                              </span>
                            )}
                          </div>
                          {opt.hint && (
                            <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: 'auto', paddingRight: 4 }}>
                              {opt.hint}
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <Icon name="check" size={12} style={{ color: 'var(--accent)', marginLeft: 8, flexShrink: 0 }} />
                        )}
                      </>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

