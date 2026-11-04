import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from '../../components/Icon.jsx'
import AnimatedSelect from '../../components/ui/AnimatedSelect.jsx'
import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'

export default function LibraryCloudStorage() {
  const { toast } = useApp()
  const [config, setConfig] = useState(null)
  const [migration, setMigration] = useState(null)
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveAccount, setDriveAccount] = useState('')
  const [rootInput, setRootInput] = useState('')
  const [savingRoot, setSavingRoot] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const pollTimerRef = useRef(null)

  const loadData = useCallback(async () => {
    try {
      const [cfg, mig, conns] = await Promise.all([
        api.storageConfig().catch(() => null),
        api.migrationStatus().catch(() => null),
        api.connectorsConnected().catch(() => null),
      ])

      if (cfg) {
        setConfig(cfg)
        setRootInput(cfg.gdrive_root_name || 'Amethyst/Library')
      }
      if (mig) {
        setMigration(mig)
      }

      const gd = conns?.services?.googledrive || conns?.services?.google_drive
      if (gd && (gd.connected || gd.status === 'ACTIVE')) {
        setDriveConnected(true)
        const account = gd.accounts?.[0]?.email || gd.accounts?.[0]?.id || 'Connected'
        setDriveAccount(account)
      } else {
        setDriveConnected(false)
        setDriveAccount('')
      }
    } catch {
      /* Keep silent */
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
      }, 2000)
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [migrating, migration])

  const handleSelectProvider = async (next) => {
    try {
      const updated = await api.updateStorageConfig({ active_provider: next })
      setConfig(updated)
      toast(`Switched active storage provider to ${next === 'google_drive' ? 'Google Drive' : 'Local Storage'}`, 'ok')
    } catch (err) {
      toast(`Could not update provider: ${err.message}`, 'bad')
    }
  }

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

  const handleConnectDrive = async () => {
    setConnecting(true)
    try {
      const res = await api.connectorsAuthorize('googledrive')
      if (res?.url) {
        window.open(res.url, '_blank')
        toast('Opened Google Drive authorization in browser', 'ok')

        // Poll for connector auth completion
        let attempts = 0
        const poll = setInterval(async () => {
          attempts += 1
          try {
            const conns = await api.connectorsConnected()
            const gd = conns?.services?.googledrive || conns?.services?.google_drive
            if (gd && (gd.connected || gd.status === 'ACTIVE')) {
              clearInterval(poll)
              setDriveConnected(true)
              setDriveAccount(gd.accounts?.[0]?.email || gd.accounts?.[0]?.id || 'Connected')
              toast('Google Drive connected', 'ok')
              loadData()
            }
          } catch {
            /* ignore */
          }
          if (attempts > 30) clearInterval(poll)
        }, 2000)
      } else {
        toast('No authorization URL returned', 'bad')
      }
    } catch (err) {
      toast(`Connection failed: ${err.message}`, 'bad')
    } finally {
      setConnecting(false)
    }
  }

  const handleStartMigration = async () => {
    if (!driveConnected) {
      toast('Connect Google Drive before starting migration', 'bad')
      return
    }
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
    if (!driveConnected) {
      toast('Connect Google Drive before retrying migration', 'bad')
      return
    }
    setRetrying(true)
    try {
      const res = await api.retryMigration()
      toast(`Reset ${res.retried || 0} failed items to pending`, 'ok')
      setMigrating(true)
      loadData()
    } catch (err) {
      toast(`Retry failed: ${err.message}`, 'bad')
    } finally {
      setRetrying(false)
    }
  }

  const total = migration?.total || 0
  const completed = migration?.completed || 0
  const pending = migration?.pending || 0
  const failed = migration?.failed || 0
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  const lastError = migration?.last_error
  const isConnectivity = migration?.error_category === 'connectivity' || (lastError && /connected|re-auth|token|oauth|credential/i.test(lastError))

  return (
    <div className="codex-card">
      {/* Row 1: Active Storage Provider */}
      <div className="codex-row" style={{ padding: '16px 20px' }}>
        <div className="codex-row-info">
          <span className="codex-row-title">Cloud-backed storage</span>
          <span className="codex-row-desc">
            {config?.active_provider === 'google_drive'
              ? 'Using Google Drive for cloud storage with local caching and offline search'
              : 'Using local computer storage. Switch to Google Drive to enable cloud-backed library.'}
          </span>
        </div>
        <AnimatedSelect
          value={config?.active_provider || 'local'}
          onChange={handleSelectProvider}
          options={[
            { value: 'local', label: 'Local storage' },
            { value: 'google_drive', label: 'Google Drive' },
          ]}
          minWidth={150}
        />
      </div>

      {/* Row 2: Google Drive Account Connection */}
      <div className="codex-row" style={{ padding: '16px 20px' }}>
        <div className="codex-row-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: driveConnected ? 'var(--ok, #22c55e)' : 'var(--bad, #ef4444)',
                flexShrink: 0,
              }}
            />
            <span className="codex-row-title">Google Drive account</span>
          </div>
          <span className="codex-row-desc">
            {driveConnected
              ? `Connected to ${driveAccount}`
              : 'Not connected. Connect Google Drive via Composio to enable cloud storage.'}
          </span>
        </div>
        <HouseButton
          type="button"
          className="set-btn-sm"
          onClick={handleConnectDrive}
          disabled={connecting}
          style={{ padding: '5px 16px', fontSize: '13px' }}
        >
          {connecting ? 'Opening…' : driveConnected ? 'Reconnect' : 'Connect'}
        </HouseButton>
      </div>

      {/* Row 3: Google Drive Root Folder */}
      <div className="codex-row" style={{ padding: '16px 20px' }}>
        <div className="codex-row-info">
          <span className="codex-row-title">Google Drive root folder</span>
          <span className="codex-row-desc">
            Files and folders are strictly scoped inside this directory in your Google Drive
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            className="set-input"
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            placeholder="Amethyst/Library"
            style={{ width: 180 }}
          />
          <HouseButton
            type="button"
            className="set-btn-sm"
            onClick={handleSaveRoot}
            disabled={savingRoot || rootInput === config?.gdrive_root_name}
            style={{ padding: '5px 16px', fontSize: '13px' }}
          >
            {savingRoot ? 'Saving…' : 'Save'}
          </HouseButton>
        </div>
      </div>

      {/* Row 4: Cloud Migration */}
      <div className="codex-row" style={{ padding: '16px 20px', flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div className="codex-row-info">
            <span className="codex-row-title">Library cloud migration</span>
            <span className="codex-row-desc">
              Resumable, verified batch transfer. Local original files remain untouched.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {failed > 0 && (
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={handleRetryFailed}
                disabled={retrying || migrating || !driveConnected}
                style={{
                  padding: '5px 16px',
                  fontSize: '13px',
                  color: 'var(--bad, #ef4444)',
                }}
                title={!driveConnected ? 'Connect Google Drive first' : undefined}
              >
                {retrying ? 'Retrying…' : `Retry Failed (${failed})`}
              </HouseButton>
            )}
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleStartMigration}
              disabled={migrating || !driveConnected || (total > 0 && pending === 0 && failed === 0)}
              style={{ padding: '5px 16px', fontSize: '13px' }}
              title={!driveConnected ? 'Connect Google Drive first' : undefined}
            >
              {migrating
                ? 'Migrating…'
                : total === 0
                ? 'Start Migration'
                : pending > 0
                ? 'Resume'
                : 'Up to Date'}
            </HouseButton>
          </div>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            width: '100%',
            height: 6,
            background: 'var(--surface-3, #27272a)',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              background: failed > 0 && completed === 0 ? 'var(--bad, #ef4444)' : 'var(--accent, #6366f1)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        {/* Metrics Breakdown */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: '12.5px',
            color: 'var(--text-dim)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span>
              Total: <strong style={{ color: 'var(--text)' }}>{total}</strong>
            </span>
            <span>
              Migrated: <strong style={{ color: 'var(--ok, #22c55e)' }}>{completed}</strong>
            </span>
            <span>
              Pending: <strong style={{ color: 'var(--text-dim)' }}>{pending}</strong>
            </span>
            {failed > 0 && (
              <span>
                Failed: <strong style={{ color: 'var(--bad, #ef4444)' }}>{failed}</strong>
              </span>
            )}
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{percent}%</span>
        </div>

        {/* Diagnostic Failure Callout */}
        {failed > 0 && lastError && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--bad, #ef4444) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--bad, #ef4444) 22%, transparent)',
              fontSize: '12.5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Icon
                name="alert-triangle"
                size={15}
                style={{ color: 'var(--bad, #ef4444)', flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: 'var(--bad, #ef4444)', marginRight: 6 }}>
                  {isConnectivity ? 'Connectivity Error:' : 'Migration Error:'}
                </strong>
                <span style={{ color: 'var(--text)' }}>
                  {lastError}
                </span>
              </div>
            </div>
            {!driveConnected && (
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={handleConnectDrive}
                style={{
                  flexShrink: 0,
                  fontSize: '12px',
                  padding: '3px 12px',
                }}
              >
                Connect Now
              </HouseButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
