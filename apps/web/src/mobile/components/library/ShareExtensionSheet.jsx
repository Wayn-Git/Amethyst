import { useState, useEffect } from 'react'
import { BottomSheet } from '../libraryUi.jsx'
import { api } from '../../../api.js'
import { BLUE, BLUE_SOFT, CANVAS, INK, MUTED, KIND_COLORS } from './tokens.js'

export default function ShareExtensionSheet({
  open,
  shareData,
  onClose,
  onOpenItem,
  onUndo,
  showToast,
}) {
  const [phase, setPhase] = useState('save') // 'save' | 'saved' | 'duplicate' | 'failed'
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('video')
  const [collection, setCollection] = useState('Gaming')
  const [tags, setTags] = useState(['#gaming', '#capcom', '#travel'])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedItem, setSavedItem] = useState(null)
  const [jobStatus, setJobStatus] = useState(null)

  useEffect(() => {
    if (open && shareData) {
      const incomingUrl = shareData.text || shareData.url || ''
      setUrl(incomingUrl)
      setTitle(shareData.title || incomingUrl)
      setPhase('save')
      setSavedItem(null)

      if (incomingUrl) {
        api.libraryDetect(incomingUrl)
          .then((det) => {
            if (det.title) setTitle(det.title)
            if (det.detected_kind) setKind(det.detected_kind)
            if (det.suggested_collection) setCollection(det.suggested_collection)
            if (det.tags?.length) setTags(det.tags)
            if (det.exists) {
              setPhase('duplicate')
            }
          })
          .catch(() => {
            // Keep defaults
          })
      }
    } else {
      setPhase('save')
      setSavedItem(null)
      setJobStatus(null)
    }
  }, [open, shareData])

  // Poll job status when in 'saved' phase
  useEffect(() => {
    if (phase !== 'saved' || !savedItem?.id) return
    let active = true
    const poll = async () => {
      try {
        const res = await api.libraryJobStatus(savedItem.id)
        if (active) setJobStatus(res)
      } catch {
        // Fallback progress steps
        if (active) {
          setJobStatus({
            steps: [
              { title: 'Saved and sorted', desc: `${kind} · ${collection}`, done: true },
              { title: 'Cover and details found', done: true },
              { title: 'Writing a summary and tags', desc: 'Takes a few seconds', done: false, active: true },
            ]
          })
        }
      }
    }
    poll()
    const timer = setInterval(poll, 2500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [phase, savedItem?.id, kind, collection])

  const handleSave = async (forceDuplicate = false) => {
    if (saving) return
    setSaving(true)
    try {
      const payload = {
        url,
        title,
        kind,
        collection,
        tags,
        notes: note,
        force: forceDuplicate,
      }
      const res = await api.createLibraryItem(payload)
      setSavedItem(res)
      setPhase('saved')
    } catch (err) {
      if (err.status === 409 || err.message?.includes('duplicate')) {
        setPhase('duplicate')
      } else {
        setPhase('failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleUndo = async () => {
    if (savedItem?.id) {
      try {
        await api.deleteLibraryItem(savedItem.id, true)
        showToast?.('Save undone')
        onUndo?.(savedItem.id)
      } catch {
        // Ignored
      }
    }
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} height="auto">
      <div style={{ padding: '8px 16px 28px', color: INK }}>
        {/* PHASE: SAVE (share_sheet_save.html) */}
        {phase === 'save' && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, background: BLUE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 6c-2-1.5-5-2-8-2v13c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v13" />
                  </svg>
                </span>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>
                  Save to Amethyst
                </h1>
              </div>
              <button
                onClick={onClose}
                style={{ height: 44, padding: '0 4px', border: 0, background: 'transparent', color: '#0A55C4', fontSize: 17, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>

            {/* Preview */}
            <div style={{ display: 'flex', gap: 12, marginTop: 8, padding: 10, borderRadius: 14, background: '#fff', boxShadow: '0 0 0 1px #E3E3E8' }}>
              <div style={{ position: 'relative', flex: 'none', width: 76, height: 76, borderRadius: 10, background: KIND_COLORS[kind] || '#2B3040', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{kind}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
                <div style={{ fontSize: 16, lineHeight: '21px', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {title}
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>{url || 'Web link'}</div>
              </div>
            </div>

            {/* Saving as */}
            <div style={{ fontSize: 13, fontWeight: 600, color: MUTED, margin: '14px 2px 6px' }}>Saving as</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 14px', borderRadius: 14, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
              <span style={{ width: 28, height: 28, borderRadius: 9, background: BLUE_SOFT, color: '#0A55C4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M10 9.5l5 2.5-5 2.5z" />
                </svg>
              </span>
              <span style={{ flex: 1, fontWeight: 650 }}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</span>
              <span style={{ fontSize: 13, color: MUTED }}>Detected</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 10l5 5 5-5" />
              </svg>
            </div>

            {/* Collection */}
            <div style={{ fontSize: 13, fontWeight: 600, color: MUTED, margin: '14px 2px 6px' }}>Collection</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 14px', borderRadius: 14, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3A3A3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              <span style={{ flex: 1, fontWeight: 650 }}>{collection}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 10l5 5 5-5" />
              </svg>
            </div>

            {/* Tags */}
            <div style={{ fontSize: 13, fontWeight: 600, color: MUTED, margin: '14px 2px 6px' }}>Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tags.map((t) => (
                <button
                  key={t}
                  style={{
                    height: 32,
                    padding: '0 12px',
                    borderRadius: 16,
                    border: 0,
                    background: BLUE_SOFT,
                    color: '#0A55C4',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {t.startsWith('#') ? t : `#${t}`}
                </button>
              ))}
            </div>

            {/* Note */}
            <div style={{ fontSize: 13, fontWeight: 600, color: MUTED, margin: '14px 2px 6px' }}>Note</div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (optional)"
              style={{
                width: '100%',
                height: 52,
                padding: '0 14px',
                borderRadius: 14,
                border: 0,
                background: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,.05)',
                boxSizing: 'border-box',
                fontSize: 15,
                color: INK,
                outline: 'none',
              }}
            />

            {/* Save Button */}
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              style={{
                marginTop: 18,
                width: '100%',
                height: 52,
                borderRadius: 14,
                border: 0,
                background: BLUE,
                color: '#fff',
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}

        {/* PHASE: SAVED (sharesaved.html) */}
        {phase === 'saved' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ flex: 'none', width: 52, height: 52, borderRadius: 26, background: '#E4F5EA', color: '#14703A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em' }}>Saved to Library</h1>
                <div style={{ marginTop: 2, fontSize: 15, color: MUTED }}>Your agent is getting it ready</div>
              </div>
            </div>

            {/* Item preview card */}
            <div style={{ marginTop: 22, display: 'flex', gap: 14, padding: 14, borderRadius: 20, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)' }}>
              <div style={{ flex: 'none', width: 76, height: 76, borderRadius: 14, background: KIND_COLORS[kind] || '#2B3040', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{kind}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
                <div style={{ fontSize: 16, lineHeight: '22px', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {title}
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>{kind.charAt(0).toUpperCase() + kind.slice(1)} · {collection}</div>
              </div>
            </div>

            {/* Agent progress checklist */}
            <div style={{ fontSize: 13, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '28px 2px 6px' }}>
              Agent is working on
            </div>
            <div style={{ background: '#fff', borderRadius: 20, padding: '6px 16px', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
              {(jobStatus?.steps || [
                { title: 'Saved and sorted', desc: `${kind.charAt(0).toUpperCase() + kind.slice(1)} · ${collection}`, done: true },
                { title: 'Cover and details found', done: true },
                { title: 'Writing a summary and tags', desc: 'Takes a few seconds', done: false, active: true },
              ]).map((step, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 52, borderTop: idx > 0 ? '1px solid #ECECF0' : 'none' }}>
                  {step.done ? (
                    <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 14, background: BLUE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                  ) : step.active ? (
                    <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 14, boxSizing: 'border-box', border: '2.5px solid #D8D8DE', borderTopColor: BLUE, animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 14, background: '#ECECF0' }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{step.title}</div>
                    {step.desc && <div style={{ fontSize: 13, color: MUTED }}>{step.desc}</div>}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={handleUndo}
                style={{ flex: 1, height: 56, borderRadius: 16, border: 0, background: 'rgba(118,118,128,.16)', color: INK, fontSize: 17, fontWeight: 650, cursor: 'pointer' }}
              >
                Undo
              </button>
              <button
                onClick={() => {
                  if (savedItem) onOpenItem?.(savedItem)
                  onClose()
                }}
                style={{ flex: 2, height: 56, borderRadius: 16, border: 0, background: BLUE, color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}
              >
                Open in Amethyst
              </button>
            </div>
            <button
              onClick={onClose}
              style={{ margin: '6px auto 0', display: 'block', height: 48, padding: '0 12px', border: 0, background: 'transparent', color: '#0A55C4', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
            >
              Done
            </button>
          </div>
        )}

        {/* PHASE: DUPLICATE (shareduplicate.html) */}
        {phase === 'duplicate' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ flex: 'none', width: 52, height: 52, borderRadius: 26, background: BLUE_SOFT, color: '#0A55C4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 8h11v11H8zM5 15V5h10" />
                </svg>
              </span>
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em' }}>Already in your Library</h1>
                <div style={{ marginTop: 2, fontSize: 15, color: MUTED }}>Saved recently in {collection}</div>
              </div>
            </div>

            <div style={{ marginTop: 22, display: 'flex', gap: 14, padding: 14, borderRadius: 20, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
              <div style={{ flex: 'none', width: 76, height: 76, borderRadius: 14, background: KIND_COLORS[kind] || '#2B3040', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{kind}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
                <div style={{ fontSize: 16, lineHeight: '22px', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {title}
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>{kind.charAt(0).toUpperCase() + kind.slice(1)} · {collection}</div>
              </div>
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => handleSave(true)}
                style={{ flex: 1, height: 56, borderRadius: 16, border: 0, background: 'rgba(118,118,128,.16)', color: INK, fontSize: 17, fontWeight: 650, cursor: 'pointer' }}
              >
                Save again
              </button>
              <button
                onClick={() => {
                  if (savedItem) onOpenItem?.(savedItem)
                  onClose()
                }}
                style={{ flex: 2, height: 56, borderRadius: 16, border: 0, background: BLUE, color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}
              >
                Open existing
              </button>
            </div>
            <button
              onClick={onClose}
              style={{ margin: '6px auto 0', display: 'block', height: 48, padding: '0 12px', border: 0, background: 'transparent', color: '#0A55C4', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* PHASE: FAILED (sharefailed.html) */}
        {phase === 'failed' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ flex: 'none', width: 52, height: 52, borderRadius: 26, background: '#FDECEA', color: '#B3261E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v5M12 16.5v.01M10.3 4.2L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z" />
                </svg>
              </span>
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em' }}>Couldn't read that link</h1>
                <div style={{ marginTop: 2, fontSize: 15, lineHeight: '21px', color: MUTED }}>
                  It's saved as a plain link. Your agent will retry.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 22, display: 'flex', gap: 14, padding: 14, borderRadius: 20, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
              <div style={{ flex: 'none', width: 76, height: 76, borderRadius: 14, background: '#2B3040', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>LINK</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
                <div style={{ fontSize: 16, lineHeight: '22px', fontWeight: 650 }}>{title}</div>
                <div style={{ fontSize: 13, color: MUTED }}>Link · {url}</div>
              </div>
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={onClose}
                style={{ flex: 1, height: 56, borderRadius: 16, border: 0, background: 'rgba(118,118,128,.16)', color: INK, fontSize: 17, fontWeight: 650, cursor: 'pointer' }}
              >
                Keep as link
              </button>
              <button
                onClick={() => handleSave(true)}
                style={{ flex: 2, height: 56, borderRadius: 16, border: 0, background: BLUE, color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}

