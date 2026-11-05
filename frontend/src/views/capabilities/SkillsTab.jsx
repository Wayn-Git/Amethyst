import { Button as HouseButton, Input as HouseInput, Textarea as HouseTextarea } from '../../components/ui/bento/index.jsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import ServiceIcon from '../../components/ServiceIcon.jsx'
import { useApp } from '../../store.jsx'
import { api } from '../../api.js'
import { SkeletonGrid } from '../../components/Skeleton.jsx'

/* Skills: the ones on this machine and the ones that could be, in one list.

   Installed and installable used to be two surfaces — a view for what you had,
   an overlay for what you could get — and a skill that existed in both showed
   up twice with different controls. One row per skill now, whatever its origin,
   carrying whichever actions actually apply to it. */

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'available', label: 'Not installed' },
  { id: 'archived', label: 'Archived' },
]

const STATE_LABEL = { active: null, stale: 'stale', archived: 'archived' }

/* A skill is a name, a description and an instruction. Writing one used to mean
   composing YAML frontmatter by hand into a file whose path had to match the
   name inside it; these are the three fields that are actually the skill, and
   the backend writes the file. */
function Composer({ onDone, onCancel }) {
  const { toast } = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
  const ready = slug && description.trim() && instruction.trim()

  const create = async (overwrite = false) => {
    if (!ready) return
    setBusy(true)
    try {
      const skill = await api.createSkill({ name, description, instruction, overwrite })
      toast(`Wrote /${skill.name}`, 'ok')
      onDone()
    } catch (err) {
      if (/already installed/.test(err.message)) toast(`${err.message} — Replace overwrites it`, 'amber')
      else toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cap-composer" data-enter>
      <div className="cap-composer-head">
        <span>New skill</span>
        <HouseButton type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel">
          <Icon name="x" size={15} />
        </HouseButton>
      </div>
      <div className="field">
        <label htmlFor="skill-name">Name</label>
        <HouseInput
          id="skill-name"
          autoFocus
          value={name}
          placeholder="release notes"
          onChange={(e) => setName(e.target.value)}
        />
        {slug && slug !== name.trim() && (
          <span className="field-note">saved as <span className="mono">/{slug}</span></span>
        )}
      </div>
      <div className="field">
        <label htmlFor="skill-desc">Description</label>
        <HouseInput
          id="skill-desc"
          value={description}
          placeholder="When to reach for this — the agent reads this to decide"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="skill-body">Instruction</label>
        <HouseTextarea
          id="skill-body"
          rows={7}
          value={instruction}
          placeholder={'What to do, in the order to do it.\n\nMarkdown. This is the whole body of the SKILL.md.'}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <div className="cap-composer-foot">
        <HouseButton type="button" className="btn btn--primary btn--small" disabled={!ready || busy} onClick={() => create(false)}>
          {busy ? 'Writing…' : 'Create'}
        </HouseButton>
        <HouseButton
          type="button"
          className="btn btn--ghost btn--small"
          disabled={!ready || busy}
          title="Overwrite an installed skill of the same name"
          onClick={() => create(true)}
        >
          Replace
        </HouseButton>
      </div>
    </div>
  )
}

function Gear({ name, capability, onToggle, onRemove, onPin, onLock, onRestore, skill, busy }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    const away = () => setOpen(false)
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [open])

  const archived = skill?.state === 'archived'

  return (
    <span className="dcard-gear-wrap">
      <HouseButton
        type="button"
        className="dcard-act"
        title="Manage this skill"
        aria-label={`Manage ${name}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        <Icon name="sliders" size={15} />
      </HouseButton>
      {open && (
        <div className="dcard-menu" onClick={(e) => e.stopPropagation()}>
          {archived ? (
            <HouseButton
              type="button"
              className="menu-row"
              disabled={busy}
              onClick={() => { onRestore(); setOpen(false) }}
            >
              <span className="menu-gutter" />
              <span className="menu-label">Restore</span>
            </HouseButton>
          ) : (
            <HouseButton
              type="button"
              className="menu-row"
              disabled={busy || !capability}
              onClick={() => { onToggle(); setOpen(false) }}
            >
              <span className="menu-gutter" />
              <span className="menu-label">{capability?.enabled ? 'Stand down' : 'Engage'}</span>
            </HouseButton>
          )}
          <HouseButton
            type="button"
            className="menu-row"
            disabled={busy || archived}
            title="Pinned skills are never moved to stale or archived by the curator"
            onClick={() => { onPin(!skill?.pinned); setOpen(false) }}
          >
            <span className="menu-gutter" />
            <span className="menu-label">{skill?.pinned ? 'Unpin' : 'Pin'}</span>
          </HouseButton>
          <HouseButton
            type="button"
            className="menu-row"
            disabled={busy}
            title="Locked skills stay readable, but neither you nor the agent can edit them"
            onClick={() => { onLock(!skill?.locked); setOpen(false) }}
          >
            <span className="menu-gutter" />
            <span className="menu-label">{skill?.locked ? 'Unlock' : 'Lock'}</span>
          </HouseButton>
          {!archived && (
            <HouseButton
              type="button"
              className="menu-row danger"
              disabled={busy}
              title="Moves the skill to skills/.archive — reversible"
              onClick={() => { onRemove(); setOpen(false) }}
            >
              <span className="menu-gutter" />
              <span className="menu-label">Archive</span>
            </HouseButton>
          )}
        </div>
      )}
    </span>
  )
}

export default function SkillsTab({ query, newOpen, setNewOpen }) {
  const { toast, caps, refreshCaps, setCapEnabled, busyCap } = useApp()
  const [installed, setInstalled] = useState([])
  const [errors, setErrors] = useState([])
  const [catalogue, setCatalogue] = useState({ skills: [], error: null })
  const [archived, setArchived] = useState([])
  const [curator, setCurator] = useState(null)
  const [learning, setLearning] = useState({ settings: { enabled: false }, proposals: [], counts: {} })
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState('')
  const [importing, setImporting] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback((refresh = false) => {
    const fail = (err) => toast(err.message, 'bad')
    setLoading(true)
    api.skills()
      .then((d) => { setInstalled(d.skills || []); setErrors(d.errors || []) })
      .catch(fail)
    api.skillCatalogue(refresh)
      .then(setCatalogue)
      .catch((err) => setCatalogue({ skills: [], error: err.message }))
      .finally(() => setLoading(false))
    api.skillArchived()
      .then((d) => setArchived(d.archived || []))
      .catch(() => setArchived([]))
    api.skillCurator()
      .then(setCurator)
      .catch(() => setCurator(null))
    api.learning()
      .then(setLearning)
      .catch(() => setLearning({ settings: { enabled: false }, proposals: [], counts: {} }))
    refreshCaps()
  }, [refreshCaps, toast])

  useEffect(() => { load() }, [load])

  const install = useCallback(async (target, { overwrite = false } = {}) => {
    setBusy(target)
    try {
      const skill = await api.installSkill(target, overwrite)
      toast(`Installed /${skill.name}`, 'ok')
      setUrl('')
      load()
    } catch (err) {
      if (/already installed/.test(err.message)) toast(`${err.message} — Replace updates it`, 'amber')
      else toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [load, toast])

  // Archive, never uninstall. The backend moves the directory under
  // skills/.archive and the card gets a Restore action, which is the difference
  // between a misclick and losing a procedure somebody wrote.
  const archive = useCallback(async (name) => {
    setBusy(name)
    try {
      await api.setSkillState(name, 'archived')
      toast(`Archived /${name}`, 'ok')
      load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [load, toast])

  const restore = useCallback(async (name) => {
    setBusy(name)
    try {
      await api.restoreSkill(name)
      toast(`Restored /${name}`, 'ok')
      load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [load, toast])

  const setFlag = useCallback(async (name, flags) => {
    setBusy(name)
    try {
      await api.setSkillFlags(name, flags)
      load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [load, toast])

  const curate = useCallback(async () => {
    setBusy('curator')
    try {
      const report = await api.runSkillCurator()
      const moved = (report.archived || []).length
      const marked = (report.stale || []).length
      toast(`Curated: ${marked} stale, ${moved} archived`, 'ok')
      load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [load, toast])

  const decideProposal = useCallback(async (proposal, approve) => {
    setBusy(`proposal:${proposal.id}`)
    try {
      if (approve) {
        await api.approveLearning(proposal.id)
        toast(proposal.kind === 'skill' ? `Saved /${proposal.name}` : 'Saved to memory', 'ok')
      } else {
        await api.rejectLearning(proposal.id)
      }
      load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [load, toast])

  // One row per skill, whether it came from disk, the catalogue, or both.
  const rows = useMemo(() => {
    const all = new Map()
    for (const entry of catalogue.skills) {
      all.set(entry.name, {
        name: entry.name,
        description: entry.description,
        publisher: entry.publisher,
        url: entry.url,
        installed: entry.installed,
      })
    }
    for (const skill of installed) {
      const existing = all.get(skill.name)
      all.set(skill.name, {
        name: skill.name,
        description: skill.description || existing?.description || '',
        publisher: existing?.publisher || 'On this machine',
        url: existing?.url,
        installed: true,
        version: skill.version,
        state: skill.state,
        pinned: skill.pinned,
        locked: skill.locked,
        builtin: skill.builtin,
        createdBy: skill.created_by,
        useCount: skill.use_count,
        lastActivity: skill.last_activity_at,
      })
    }
    // Archived skills are not in `scan()`, so they can only come from the
    // archive listing. Keyed by name, and an archive record never overwrites a
    // live skill of the same name.
    for (const entry of archived) {
      const existing = all.get(entry.name)
      all.set(entry.name, {
        name: entry.name,
        description: existing?.description || '',
        publisher: existing?.publisher || 'Archived',
        url: existing?.url,
        installed: false,
        archived: true,
        state: 'archived',
        archivedAt: entry.archived_at,
        archiveReason: entry.reason,
      })
    }
    return [...all.values()]
  }, [catalogue, installed, archived])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = rows.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q),
    )
    if (filter === 'installed') list = list.filter((r) => r.installed)
    if (filter === 'available') list = list.filter((r) => !r.installed && !r.archived)
    if (filter === 'archived') list = list.filter((r) => r.archived)
    // Installed first: what you have is what you are most often here to change.
    return [...list].sort(
      (a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name),
    )
  }, [rows, query, filter])

  const engaged = (caps.skills ?? []).filter((c) => c.enabled).length
  const curatorLatest = curator?.latest

  return (
    <>
      <div className="cap-actions" data-enter>
        <HouseButton
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => { setImporting((i) => !i); setNewOpen(false) }}
          aria-expanded={importing}
        >
          <Icon name="link" size={14} /> Import a link
        </HouseButton>
        <HouseButton type="button" className="btn btn--ghost btn--small" onClick={() => load(true)}>
          <Icon name="refresh" size={14} /> Rescan
        </HouseButton>
        <div className="cap-filter">
          {FILTERS.map((f) => (
            <HouseButton
              key={f.id}
              type="button"
              className={`conn-tab${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </HouseButton>
          ))}
        </div>
        <span className="cap-count">{installed.length} installed · {engaged} engaged</span>
      </div>

      <div className="msg-note" data-enter style={{ marginBottom: 12, alignItems: 'center' }}>
        <Icon name="info" size={14} />
        <span style={{ flex: 1 }}>
          {curator
            ? `Curator keeps agent-written skills small: stale after ${curator.thresholds.stale_after_days} days unused, archived after ${curator.thresholds.archive_after_days}. Pinned, locked, shipped and automation-used skills are never touched.`
            : 'Curator keeps agent-written skills small. Pinned, locked, shipped and automation-used skills are never touched.'}
          {curatorLatest?.started_at && (
            <span style={{ color: 'var(--text-dim)' }}>
              {' '}Last pass {curatorLatest.started_at}: {curatorLatest.stale?.length || 0} stale, {curatorLatest.archived?.length || 0} archived.
            </span>
          )}
        </span>
        <HouseButton
          type="button"
          className="btn btn--ghost btn--small"
          disabled={busy === 'curator'}
          onClick={curate}
        >
          {busy === 'curator' ? 'Curating…' : 'Run now'}
        </HouseButton>
      </div>

      {newOpen && <Composer onDone={() => { setNewOpen(false); load() }} onCancel={() => setNewOpen(false)} />}

      {importing && (
        <div className="dir-install" data-enter>
          <Icon name="link" size={15} />
          <HouseInput
            autoFocus
            value={url}
            placeholder="A link to any SKILL.md"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) install(url.trim()) }}
            aria-label="Skill URL"
          />
          <HouseButton
            type="button"
            className="btn btn--primary btn--small"
            disabled={busy === url.trim() || !url.trim()}
            onClick={() => install(url.trim())}
          >
            Install
          </HouseButton>
          <HouseButton
            type="button"
            className="btn btn--ghost btn--small"
            disabled={busy === url.trim() || !url.trim()}
            onClick={() => install(url.trim(), { overwrite: true })}
            title="Replace an installed skill of the same name"
          >
            Replace
          </HouseButton>
        </div>
      )}

      {catalogue.error && (
        <div className="msg-note msg-note--warning" style={{ marginBottom: 12 }} data-enter>
          <Icon name="info" size={14} />
          <span>
            The skill sources could not be read ({catalogue.error}). Installed skills are still
            listed, a direct link still installs, and New skill still writes one.
          </span>
        </div>
      )}

      {loading && shown.length === 0 && (
        <SkeletonGrid cards={6} />
      )}
      {loading && shown.length > 0 && <div className="dir-empty dir-empty--quiet">Refreshing…</div>}

      {(learning.proposals?.length > 0 || learning.settings?.enabled) && (
        <section data-enter style={{ marginBottom: 16 }}>
          <div className="cap-section-head">
            <span>Learning proposals</span>
            <span>{learning.counts?.pending || 0} pending</span>
          </div>
          {!learning.settings?.enabled && (
            <div className="msg-note" style={{ marginBottom: 8 }}>
              <Icon name="info" size={14} />
              <span>
                The post-turn review is off. Switch it on in Settings → Models to let the agent
                propose skills and memories from finished work. Nothing is saved without approval.
              </span>
            </div>
          )}
          <div className="card card-pad" style={{ display: 'grid', gap: 10 }}>
            {(learning.proposals || []).map((proposal) => (
              <div key={proposal.id} className="msg-note" style={{ alignItems: 'flex-start' }}>
                <Icon name={proposal.kind === 'skill' ? 'sliders' : 'brain'} size={14} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {proposal.kind === 'skill' ? `/${proposal.name}` : 'Memory'}
                    <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                      {' '}· {proposal.kind}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 2 }}>
                    {proposal.title}
                  </div>
                  {proposal.body && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12 }}>Instruction</summary>
                      <pre
                        className="mono"
                        style={{ whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 6, maxHeight: 220, overflow: 'auto' }}
                      >
                        {proposal.body}
                      </pre>
                    </details>
                  )}
                  {proposal.error && (
                    <div className="msg-note msg-note--error" style={{ marginTop: 6 }}>
                      {proposal.error}
                    </div>
                  )}
                </div>
                <HouseButton
                  type="button"
                  className="btn btn--primary btn--small"
                  disabled={busy === `proposal:${proposal.id}`}
                  onClick={() => decideProposal(proposal, true)}
                >
                  Approve
                </HouseButton>
                <HouseButton
                  type="button"
                  className="btn btn--ghost btn--small"
                  disabled={busy === `proposal:${proposal.id}`}
                  onClick={() => decideProposal(proposal, false)}
                >
                  Reject
                </HouseButton>
              </div>
            ))}
            {(learning.proposals || []).length === 0 && (
              <div className="dir-empty dir-empty--quiet" style={{ padding: '8px 0' }}>
                Nothing waiting. The review proposes only when a turn produced a reusable procedure.
              </div>
            )}
          </div>
          {(learning.counts?.approved > 0 || learning.counts?.rejected > 0 || learning.counts?.failed > 0) && (
            <div className="conn-foot" style={{ marginTop: 6 }}>
              {learning.counts.approved || 0} approved · {learning.counts.rejected || 0} rejected
              {learning.counts.failed ? ` · ${learning.counts.failed} failed` : ''}
            </div>
          )}
        </section>
      )}

      <div className="dir-grid" data-enter>
        {shown.map((row) => {
          const capability = (caps.skills ?? []).find((c) => c.name === row.name)
          const state = STATE_LABEL[row.state]
          return (
            <div className="dcard" key={row.name}>
              <div className="dcard-top">
                <ServiceIcon name={row.name} kind="skill" size={34} />
                <div className="dcard-heading">
                  <span className="dcard-title">/{row.name}</span>
                  <span className="dcard-sub">{row.publisher}{row.version ? ` · v${row.version}` : ''}</span>
                </div>
                {row.installed || row.archived ? (
                  <Gear
                    name={row.name}
                    capability={capability}
                    skill={row}
                    busy={busy === row.name || busyCap === `skill:${row.name}`}
                    onToggle={() => capability && setCapEnabled(capability, !capability.enabled)}
                    onRemove={() => archive(row.name)}
                    onRestore={() => restore(row.name)}
                    onPin={(value) => setFlag(row.name, { pinned: value })}
                    onLock={(value) => setFlag(row.name, { locked: value })}
                  />
                ) : (
                  <HouseButton
                    type="button"
                    className="dcard-act"
                    title={`Install /${row.name}`}
                    aria-label={`Install ${row.name}`}
                    disabled={busy === row.url}
                    onClick={() => install(row.url)}
                  >
                    <Icon name={busy === row.url ? 'refresh' : 'plus'} size={15} />
                  </HouseButton>
                )}
              </div>
              <p className="dcard-desc">{row.description}</p>
              {(row.installed || row.archived) && (
                <div className="dcard-badges">
                  <span className={`badge${capability?.enabled && row.installed ? ' badge--ok' : ''}`}>
                    {row.archived ? 'archived' : capability?.enabled ? 'engaged' : 'installed'}
                  </span>
                  {state && <span className="badge badge--amber">{state}</span>}
                  {row.pinned && <span className="badge">pinned</span>}
                  {row.locked && <span className="badge">locked</span>}
                  {row.builtin && <span className="badge">builtin</span>}
                  {row.createdBy === 'agent' && <span className="badge">agent</span>}
                  {row.useCount > 0 && (
                    <span className="badge" title="Times invoked with /skill or read by the agent">
                      {row.useCount} use{row.useCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!loading && shown.length === 0 && <div className="dir-empty">Nothing matches that.</div>}
      </div>

      {errors.length > 0 && (
        <section data-enter style={{ marginTop: 24 }}>
          <div className="cap-section-head"><span>Failed to load</span><span>{errors.length}</span></div>
          <div className="card card-pad" style={{ display: 'grid', gap: 10 }}>
            {errors.map((e, i) => (
              <div key={i} className="msg-note msg-note--error" style={{ padding: '8px 12px' }}>
                <Icon name="x" size={14} />
                <span className="mono" style={{ wordBreak: 'break-all' }}>{e.path}</span>
                <span style={{ marginLeft: 'auto' }}>{e.error}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="conn-foot" data-enter>
        An engaged skill is offered to the agent every turn. Typing <span className="mono">/name</span> engages
        one for a single message, whether or not it is engaged standing.
      </p>
    </>
  )
}
