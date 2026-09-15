import { useCallback, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import Switch from './ui/Switch.jsx'

/* Voice, values, palette, fonts — and the block the model actually receives.
 *
 * The preview is not decoration. A settings page that stores a "voice" and then
 * does nothing visible with it is indistinguishable from one that quietly
 * dropped it, so the server returns `prompt_block` — the literal text appended
 * to the system prompt — and this renders it verbatim. Empty means empty: no
 * block is injected at all, and the preview says so. */

const LIST_HINT = 'One entry per line'

function ModernField({ label, hint, children }) {
  return (
    <div className="brand-field-modern">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label>{label}</label>
        {hint && <span style={{ fontSize: '11px', color: '#71717a' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function ModernPairs({ label, hint, rows, keys, placeholders, onChange }) {
  const update = (index, key, next) => {
    const copy = rows.map((row) => ({ ...row }))
    copy[index] = { ...copy[index], [key]: next }
    onChange(copy)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="set-row-title">{label}</span>
        {hint && <span style={{ fontSize: '11px', color: '#71717a' }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={row[keys[0]] || ''}
              placeholder={placeholders[0]}
              onChange={(e) => update(i, keys[0], e.target.value)}
              className="set-input"
              style={{ flex: 1 }}
            />
            <input
              value={row[keys[1]] || ''}
              placeholder={placeholders[1]}
              onChange={(e) => update(i, keys[1], e.target.value)}
              className="set-input"
              style={{ flex: 1 }}
            />
            {keys[1] === 'hex' && /^#[0-9a-fA-F]{3,8}$/.test(row.hex || '') ? (
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: row.hex,
                  border: '1px solid rgba(255,255,255,0.2)',
                  flexShrink: 0,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
                aria-hidden="true"
              />
            ) : null}
            <button
              type="button"
              className="icon-btn"
              style={{ flexShrink: 0 }}
              aria-label="Remove item"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => onChange([...rows, { [keys[0]]: '', [keys[1]]: '' }])}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="plus" size={13} />
          <span>Add row</span>
        </button>
      </div>
    </div>
  )
}

export default function BrandKit() {
  const { toast } = useApp()
  const [state, setState] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.brand()
      setState({
        ...data,
        values: (data.values || []).join('\n'),
        do: (data.do || []).join('\n'),
        dont: (data.dont || []).join('\n'),
      })
    } catch (err) {
      toast(err.message, 'bad')
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.saveBrand({
        enabled: state.enabled,
        name: state.name,
        mission: state.mission,
        audience: state.audience,
        voice: state.voice,
        values: state.values,
        do: state.do,
        dont: state.dont,
        palette: (state.palette || []).filter((p) => p.name || p.hex),
        fonts: (state.fonts || []).filter((f) => f.role || f.family),
      })
      setState({
        ...saved,
        values: (saved.values || []).join('\n'),
        do: (saved.do || []).join('\n'),
        dont: (saved.dont || []).join('\n'),
      })
      toast(saved.prompt_block ? 'Brand guidelines saved and injected' : 'Brand saved — nothing injected yet', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#71717a', fontSize: '13px' }}>
        Loading brand guidelines…
      </div>
    )
  }

  const set = (patch) => setState({ ...state, ...patch })

  return (
    <div className="set-panel">
      {/* Category: Writing Persona & State */}
      <div className="set-section-label">Persona & Voice</div>
      <div className="set-shell">
        <div className="set-box">
          <div className="set-box-row">
            <div className="set-row-left">
              <div className="set-row-icon-box">
                <Icon name="spark" size={16} />
              </div>
              <div className="set-row-text">
                <span className="set-row-title">Active Persona Injection</span>
                <span className="set-row-desc">
                  Used when AMETHYST writes copy, documents, emails, or posts for you.
                </span>
              </div>
            </div>
            <Switch
              on={Boolean(state.enabled)}
              onChange={(next) => set({ enabled: next })}
              tone="blue"
            />
          </div>

          <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ModernField label="Brand / Workspace Name">
                <input
                  value={state.name || ''}
                  placeholder="e.g. Ember Studio"
                  onChange={(e) => set({ name: e.target.value })}
                  className="set-input"
                />
              </ModernField>

              <ModernField label="Target Audience">
                <input
                  value={state.audience || ''}
                  placeholder="e.g. software engineers, founders"
                  onChange={(e) => set({ audience: e.target.value })}
                  className="set-input"
                />
              </ModernField>
            </div>

            <ModernField label="Core Mission" hint="One crisp sentence defining purpose">
              <textarea
                rows={2}
                value={state.mission || ''}
                placeholder="What you are actually building and solving for, in one sentence."
                onChange={(e) => set({ mission: e.target.value })}
              />
            </ModernField>

            <ModernField label="Tone & Voice Profile" hint="How you sound, not what you sell">
              <textarea
                rows={3}
                value={state.voice || ''}
                placeholder="Direct, highly specific, technical, dry wit. Short concise sentences. No marketing jargon or hype."
                onChange={(e) => set({ voice: e.target.value })}
              />
            </ModernField>
          </div>
        </div>
      </div>

      {/* Category: Rules & Guidelines */}
      <div className="set-section-label">Rules & Guidelines</div>
      <div className="set-shell">
        <div className="set-box">
          <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
            <ModernField label="Guiding Values" hint={LIST_HINT}>
              <textarea
                rows={3}
                value={state.values || ''}
                placeholder={'Simplicity over complexity\nStandard library first\nHigh craft'}
                onChange={(e) => set({ values: e.target.value })}
              />
            </ModernField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ModernField label="Always (Do)" hint={LIST_HINT}>
                <textarea
                  rows={3}
                  value={state.do || ''}
                  placeholder={'name trade-offs explicitly\nuse active voice'}
                  onChange={(e) => set({ do: e.target.value })}
                />
              </ModernField>

              <ModernField label="Never (Don't)" hint={LIST_HINT}>
                <textarea
                  rows={3}
                  value={state.dont || ''}
                  placeholder={'exclamation marks\nbuzzwords or corporate jargon'}
                  onChange={(e) => set({ dont: e.target.value })}
                />
              </ModernField>
            </div>
          </div>
        </div>
      </div>

      {/* Category: Design Tokens */}
      <div className="set-section-label">Design Tokens</div>
      <div className="set-shell">
        <div className="set-box">
          <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 18 }}>
            <ModernPairs
              label="Palette Tokens"
              hint="Name and hex code for generated interfaces"
              rows={state.palette || []}
              keys={['name', 'hex']}
              placeholders={['ink', '#09090b']}
              onChange={(rows) => set({ palette: rows })}
            />

            <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '4px 0' }} />

            <ModernPairs
              label="Typography Fonts"
              hint="Role and font family name"
              rows={state.fonts || []}
              keys={['role', 'family']}
              placeholders={['mono', 'JetBrains Mono']}
              onChange={(rows) => set({ fonts: rows })}
            />
          </div>

          <div style={{ padding: '14px 18px', background: 'rgba(255,255,255,0.015)', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={saving}
              onClick={save}
              style={{ minWidth: 100 }}
            >
              {saving ? 'Saving…' : 'Save Guidelines'}
            </button>
          </div>
        </div>
      </div>

      {/* Category: Server Rendered Prompt Block */}
      <div className="set-section-label">Prompt Injection Preview</div>
      <div className="set-shell">
        <div className="set-box" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#f4f4f5' }}>
              System Prompt Block
            </span>
            <span style={{ fontSize: '11px', color: '#71717a' }}>
              {state.prompt_block ? `${state.prompt_block.length} characters injected` : 'No block active'}
            </span>
          </div>
          {state.prompt_block ? (
            <pre className="brand-preview-block">{state.prompt_block}</pre>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#71717a', fontSize: '12.5px', background: '#09090b', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
              Nothing injected. Fill in your brand fields above and turn on &ldquo;Active Persona Injection&rdquo;.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
