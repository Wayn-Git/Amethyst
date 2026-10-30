import { Button as HouseButton, Input as HouseInput, Select as HouseSelect } from '../../components/ui/bento/index.jsx'
import { useState, useRef, useMemo } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'

export default function MergeListsModal({
  open,
  onClose,
  tagCounts = {},
  categoryCounts = {},
  onMerged,
  toast,
}) {
  const panelRef = useRef(null)
  useModalDismiss(open, onClose)

  const [listType, setListType] = useState('tag') // 'tag' | 'category'
  const [sourceList, setSourceList] = useState('')
  const [destList, setDestList] = useState('')
  const [customDest, setCustomDest] = useState('')
  const [isCustomDest, setIsCustomDest] = useState(false)
  const [busy, setBusy] = useState(false)

  const availableOptions = useMemo(() => {
    const counts = listType === 'tag' ? tagCounts : categoryCounts
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [listType, tagCounts, categoryCounts])

  const destinationOptions = useMemo(() => {
    return availableOptions.filter((opt) => opt.name !== sourceList)
  }, [availableOptions, sourceList])

  const effectiveDest = isCustomDest ? customDest.trim() : destList

  const handleMerge = async (e) => {
    e?.preventDefault()
    if (!sourceList) {
      toast?.('Please select a source list to merge', 'bad')
      return
    }
    if (!effectiveDest) {
      toast?.('Please specify a destination list', 'bad')
      return
    }
    if (sourceList.toLowerCase() === effectiveDest.toLowerCase()) {
      toast?.('Source and destination list must be different', 'bad')
      return
    }

    setBusy(true)
    try {
      const res = await api.mergeLibraryLists(sourceList, effectiveDest, listType)
      toast?.(`Merged ${res.merged} items into ${listType === 'tag' ? '#' : ''}${effectiveDest}`, 'ok')
      onMerged?.()
      onClose?.()
    } catch (err) {
      toast?.(err.message || 'Failed to merge lists', 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <AnimatePresence>
      <div
        className="lib-modal-overlay"
        onMouseDown={(e) => onOverlayMouseDown(e, panelRef, onClose)}
      >
        <motion.div
          ref={panelRef}
          className="lib-modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Merge lists"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={{ maxWidth: 480 }}
        >
          {/* Header */}
          <div className="lib-modal-header">
            <h2 className="lib-modal-title">
              <Icon name="link" size={16} />
              <span>Merge Lists</span>
            </h2>
            <HouseButton
              type="button"
              className="lib-modal-close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <Icon name="x" size={14} />
            </HouseButton>
          </div>

          <form onSubmit={handleMerge}>
            <div className="lib-modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Type selector: Tags vs Categories */}
              <div className="lib-form-group">
                <span className="lib-form-label">List Type</span>
                <div className="lib-modal-tabs" style={{ marginTop: 6 }}>
                  <HouseButton
                    type="button"
                    className={`lib-modal-tab ${listType === 'tag' ? 'lib-modal-tab--active' : ''}`}
                    onClick={() => {
                      setListType('tag')
                      setSourceList('')
                      setDestList('')
                    }}
                  >
                    <span>Tags & Topics</span>
                  </HouseButton>
                  <HouseButton
                    type="button"
                    className={`lib-modal-tab ${listType === 'category' ? 'lib-modal-tab--active' : ''}`}
                    onClick={() => {
                      setListType('category')
                      setSourceList('')
                      setDestList('')
                    }}
                  >
                    <span>Categories</span>
                  </HouseButton>
                </div>
              </div>

              {/* Source list */}
              <div className="lib-form-group">
                <label className="lib-form-label" htmlFor="lib-merge-source">
                  Source List (to merge from)
                </label>
                <div className="lib-select-wrap" style={{ marginTop: 6 }}>
                  <HouseSelect
                    id="lib-merge-source"
                    value={sourceList}
                    onChange={(e) => setSourceList(e.target.value)}
                    className="lib-form-input w-full"
                    style={{ minHeight: 44 }}
                  >
                    <option value="">Select a list…</option>
                    {availableOptions.map((opt) => (
                      <option key={opt.name} value={opt.name}>
                        {listType === 'tag' ? `#${opt.name}` : opt.name} ({opt.count} {opt.count === 1 ? 'item' : 'items'})
                      </option>
                    ))}
                  </HouseSelect>
                </div>
              </div>

              {/* Destination list */}
              <div className="lib-form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="lib-form-label" htmlFor="lib-merge-dest">
                    Destination List (to merge into)
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsCustomDest(!isCustomDest)}
                    className="text-xs text-accent underline cursor-pointer"
                    style={{ background: 'none', border: 'none', padding: 0 }}
                  >
                    {isCustomDest ? 'Choose existing' : '+ Create new name'}
                  </button>
                </div>

                <div style={{ marginTop: 6 }}>
                  {isCustomDest ? (
                    <HouseInput
                      id="lib-merge-dest-custom"
                      type="text"
                      placeholder={listType === 'tag' ? 'e.g. machine-learning' : 'e.g. research'}
                      value={customDest}
                      onChange={(e) => setCustomDest(e.target.value)}
                      className="lib-form-input w-full"
                      style={{ minHeight: 44 }}
                    />
                  ) : (
                    <div className="lib-select-wrap">
                      <HouseSelect
                        id="lib-merge-dest"
                        value={destList}
                        onChange={(e) => setDestList(e.target.value)}
                        className="lib-form-input w-full"
                        style={{ minHeight: 44 }}
                      >
                        <option value="">Select destination…</option>
                        {destinationOptions.map((opt) => (
                          <option key={opt.name} value={opt.name}>
                            {listType === 'tag' ? `#${opt.name}` : opt.name} ({opt.count} {opt.count === 1 ? 'item' : 'items'})
                          </option>
                        ))}
                      </HouseSelect>
                    </div>
                  )}
                </div>
              </div>

              {/* Explanation callout */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: 'var(--text)',
                }}
              >
                {sourceList && effectiveDest ? (
                  <span>
                    All saves in <strong>{listType === 'tag' ? `#${sourceList}` : sourceList}</strong> will be combined into <strong>{listType === 'tag' ? `#${effectiveDest}` : effectiveDest}</strong>. The original list will be cleared.
                  </span>
                ) : (
                  <span>
                    Combine two lists into one. Saves from the source list are retagged into the destination list.
                  </span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="lib-modal-footer">
              <HouseButton
                type="button"
                className="btn btn--ghost"
                onClick={onClose}
                disabled={busy}
                style={{ minHeight: 44 }}
              >
                Cancel
              </HouseButton>
              <HouseButton
                type="submit"
                className="btn btn--primary"
                disabled={busy || !sourceList || !effectiveDest}
                style={{ minHeight: 44 }}
              >
                {busy ? 'Merging…' : 'Merge Lists'}
              </HouseButton>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
