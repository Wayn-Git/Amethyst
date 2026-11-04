import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import { Button as HouseButton } from '../../components/ui/bento/index.jsx'

export default function LibraryCloudStorage() {
  const { toast } = useApp()
  const [config, setConfig] = useState(null)
  const [migration, setMigration] = useState(null)
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveAccount, setDriveAccount] = useState('')
  const [rootInput, setRootInput] = useState('')
  const [savingRoot, setSavingRoot] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const pollTimerRef = useRef(null)

  const loadData = useCallback(async () => {
    try {
      const [cfg, mig, conns] = await Promise.all([
        api.storageConfig().catch(() => null),
        api.migrationStatus().catch(() => null),
        api.connectedConnectors ? api.connectedConnectors().catch(() => ({})) : Promise.resolve({}),
      ])

      if (cfg) {
        setConfig(cfg)
        setRootInput(cfg.gdrive_root_name || 'Amethyst/Library')
      }
      if (mig) {
        setMigration(mig)
      }

      const gdrive = conns?.googledrive || conns?.google_drive
      if (gdrive && (gdrive.status === 'ACTIVE' || gdrive.id)) {
        setDriveConnected(true)
        setDriveAccount(gdrive.email || gdrive.account_identifier || 'Connected')
      } else {
        setDriveConnected(false)
      }
    } catch (err) {
      // Keep silent on load error
    }
  }, [])

  useEffect(() => {
    loadData()
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [loadData])

  // Polling while migration is running
  useEffect(() => {
    if (migrating || (migration && migration.in_progress > 0)) {
      pollTimerRef.current = setInterval(async () => {
        try {
          const mig = await api.migrationStatus()
          if (mig) {
            setMigration(mig)
            if (mig.pending === 0 && mig.in_progress === 0) {
              setMigrating(false)
              clearInterval(pollTimerRef.current)
            }
          }
        } catch {
          /* ignore */
        }
      }, 2500)
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [migrating, migration])

  const handleSaveRoot = async () => {
    if (!rootInput.trim()) return
    setSavingRoot(true)
    try {
      const updated = await api.updateStorageConfig({ gdrive_root_name: rootInput.trim() })
      setConfig(updated)
      toast('Saved Library root folder', 'ok')
    } catch (err) {
      toast(`Failed to save root: ${err.message}`, 'bad')
    } finally {
      setSavingRoot(false)
    }
  }

  const handleToggleProvider = async () => {
    const next = config?.active_provider === 'google_drive' ? 'local' : 'google_drive'
    try {
      const updated = await api.updateStorageConfig({ active_provider: next })
      setConfig(updated)
      toast(`Switched active storage provider to ${next === 'google_drive' ? 'Google Drive' : 'Local'}`, 'ok')
    } catch (err) {
      toast(`Could not update provider: ${err.message}`, 'bad')
    }
  }

  const handleStartMigration = async () => {
    setMigrating(true)
    try {
      const res = await api.startMigration()
      toast(`Migration started: ${res.queued || 0} items queued`, 'ok')
      loadData()
    } catch (err) {
      setMigrating(false)
      toast(`Failed to start migration: ${err.message}`, 'bad')
    }
  }

  const handleRetryFailed = async () => {
    try {
      const res = await api.retryMigration()
      toast(`Reset ${res.retried || 0} failed items to pending`, 'ok')
      loadData()
    } catch (err) {
      toast(`Retry failed: ${err.message}`, 'bad')
    }
  }

  const total = migration?.total || 0
  const completed = migration?.completed || 0
  const pending = migration?.pending || 0
  const failed = migration?.failed || 0
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="codex-card" style={{ marginTop: 16 }}>
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'var(--surface-3, #27272a)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent, #6366f1)',
            }}>
              <Icon name="cloud" size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                Cloud-Backed Knowledge Repository
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '2px 0 0' }}>
                Google Drive cloud file storage via Composio with local caching and offline search
              </p>
            </div>
          </div>

          <HouseButton
            type="button"
            className="set-btn-sm"
            onClick={handleToggleProvider}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 500,
              background: config?.active_provider === 'google_drive' ? 'var(--accent, #6366f1)' : 'var(--surface-3)',
              color: config?.active_provider === 'google_drive' ? '#fff' : 'var(--text)',
            }}
          >
            {config?.active_provider === 'google_drive' ? 'Active: Google Drive' : 'Active: Local Storage'}
          </HouseButton>
        </div>

        {/* Connection & Root Folder Row */}
        <div style={{
          background: 'var(--surface-2, rgba(255,255,255,0.03))',
          border: '1px solid var(--hairline)',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: driveConnected ? '#22c55e' : '#eab308',
              }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                {driveConnected ? `Google Drive Connected (${driveAccount})` : 'Google Drive Disconnected (Local Fallback)'}
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Managed by Composio OAuth
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 110 }}>Library Root:</span>
            <input
              type="text"
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              placeholder="Amethyst/Library"
              style={{
                flex: 1,
                padding: '6px 12px',
                fontSize: 13,
                background: 'var(--surface-3, #18181b)',
                border: '1px solid var(--hairline)',
                borderRadius: 6,
                color: 'var(--text)',
              }}
            />
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleSaveRoot}
              disabled={savingRoot || rootInput === config?.gdrive_root_name}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              {savingRoot ? 'Saving…' : 'Save Root'}
            </HouseButton>
          </div>
        </div>

        {/* Migration Overview & Progress */}
        <div style={{
          border: '1px solid var(--hairline)',
          borderRadius: 10,
          padding: '16px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                Library Cloud Migration
              </span>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '2px 0 0' }}>
                Resumable, verified batch transfer. Local original files remain untouched.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {failed > 0 && (
                <HouseButton
                  type="button"
                  className="set-btn-sm"
                  onClick={handleRetryFailed}
                  style={{ padding: '6px 12px', fontSize: 12, color: 'var(--bad, #ef4444)' }}
                >
                  Retry Failed ({failed})
                </HouseButton>
              )}
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={handleStartMigration}
                disabled={migrating || (total > 0 && pending === 0 && failed === 0)}
                style={{
                  padding: '6px 16px',
                  fontSize: 12,
                  background: 'var(--surface-3)',
                  color: 'var(--text)',
                }}
              >
                {migrating ? 'Migrating…' : total === 0 ? 'Scan & Start Migration' : pending > 0 ? 'Resume Migration' : 'Migration Up to Date'}
              </HouseButton>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            width: '100%',
            height: 8,
            background: 'var(--surface-3, #27272a)',
            borderRadius: 4,
            overflow: 'hidden',
            margin: '12px 0 10px',
          }}>
            <div style={{
              width: `${percent}%`,
              height: '100%',
              background: 'var(--accent, #6366f1)',
              transition: 'width 0.3s ease',
            }} />
          </div>

          {/* Metrics badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--text-dim)' }}>
            <span>Total: <strong style={{ color: 'var(--text)' }}>{total}</strong></span>
            <span>Migrated: <strong style={{ color: '#22c55e' }}>{completed}</strong></span>
            <span>Pending: <strong style={{ color: '#eab308' }}>{pending}</strong></span>
            {failed > 0 && <span>Failed: <strong style={{ color: '#ef4444' }}>{failed}</strong></span>}
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--text)' }}>{percent}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
