import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from '../../components/Icon.jsx'
import AnimatedSelect from '../../components/ui/AnimatedSelect.jsx'
import Switch from '../../components/ui/Switch.jsx'
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
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [folderInfo, setFolderInfo] = useState(null)
  const pollTimerRef = useRef(null)

  const loadData = useCallback(async () => {
    try {
      const [cfg, mig, conns, syncSt] = await Promise.all([
        api.storageConfig().catch(() => null),
        api.migrationStatus().catch(() => null),
        api.connectorsConnected().catch(() => null),
        api.librarySyncStatus().catch(() => null),
      ])

      if (cfg) {
        setConfig(cfg)
        setRootInput(cfg.gdrive_root_name || 'Amethyst/library')
      }
      if (mig) {
        setMigration(mig)
        if (!mig.is_running && (!mig.in_progress || mig.in_progress === 0)) {
          setMigrating(false)
        }
      }
      if (syncSt) {
        setSyncStatus(syncSt)
        if (syncSt.is_running) {
          setSyncing(true)
        } else {
          setSyncing(false)
        }
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

  // Polling while migration or sync is running
  useEffect(() => {
    const isRunning = Boolean(
      migrating ||
      syncing ||
      syncStatus?.is_running ||
      migration?.is_running ||
      (migration && migration.in_progress > 0)
    )
    if (isRunning) {
      pollTimerRef.current = setInterval(async () => {
        try {
          const [mig, syncSt] = await Promise.all([
            api.migrationStatus().catch(() => null),
            api.librarySyncStatus().catch(() => null),
          ])
          if (mig) {
            setMigration(mig)
            if (!mig.is_running && (!mig.in_progress || mig.in_progress === 0)) {
              setMigrating(false)
            }
          }
          if (syncSt) {
            setSyncStatus(syncSt)
            if (!syncSt.is_running) {
              setSyncing(false)
              if (syncSt.stage === 'complete') {
                loadData()
              }
            }
          }
        } catch {
          setMigrating(false)
          setSyncing(false)
        }
      }, 1500)
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [migrating, syncing, syncStatus?.is_running, migration?.is_running, migration?.in_progress, loadData])

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
      if (driveConnected) {
        try {
          const detect = await api.librarySyncDetect({ mode: 'custom', custom_path: rootInput.trim() })
          setFolderInfo(detect)
          if (detect.verified) {
            toast(`Saved. Verified Google Drive folder (${detect.file_count || 0} files found)`, 'ok')
          } else {
            toast(detect.warning || 'Saved folder path (marker will be placed upon sync)', 'ok')
          }
        } catch {
          toast('Saved Library root folder', 'ok')
        }
      } else {
        toast('Saved Library root folder', 'ok')
      }
    } catch (err) {
      toast(`Failed to save root: ${err.message}`, 'bad')
    } finally {
      setSavingRoot(false)
    }
  }

  const handleStartSync = async () => {
    if (!driveConnected) {
      toast('Connect Google Drive before starting synchronization', 'bad')
      return
    }
    setSyncing(true)
    try {
      const res = await api.librarySyncStart({ root_path: rootInput.trim() })
      toast('Two-way synchronization started', 'ok')
      setSyncStatus(res)
    } catch (err) {
      setSyncing(false)
      toast(`Sync failed: ${err.message}`, 'bad')
    }
  }

  const handleToggleAutoUpload = async (next) => {
    try {
      const updated = await api.updateStorageConfig({ auto_upload_new: next ? 1 : 0 })
      setConfig(updated)
      toast(`Auto-sync to Google Drive ${next ? 'enabled' : 'disabled'}`, 'ok')
    } catch (err) {
      toast(`Failed to update auto-sync: ${err.message}`, 'bad')
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
      setMigrating(false)
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
  const isActivelyMigrating = Boolean(migrating || migration?.is_running || (migration && migration.in_progress > 0))

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
      <div className="codex-row" style={{ padding: '16px 20px', flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div className="codex-row-info">
            <span className="codex-row-title">Google Drive root folder</span>
            <span className="codex-row-desc">
              Files and folders are strictly scoped inside this directory in your Google Drive
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
            <input
              type="text"
              className="set-input"
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              placeholder="Amethyst/library"
              style={{ flex: '1 1 auto', minWidth: 200 }}
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
        {folderInfo?.verified && (
          <div style={{ fontSize: '12px', color: 'var(--ok, #22c55e)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={13} />
            <span>Folder verified: {folderInfo.file_count || 0} files found in Google Drive</span>
          </div>
        )}
        {folderInfo?.warning && (
          <div style={{ fontSize: '12px', color: 'var(--amber, #f59e0b)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert-triangle" size={13} />
            <span>{folderInfo.warning}</span>
          </div>
        )}
      </div>

      {/* Row 4: Auto-sync newly added content */}
      <div className="codex-row" style={{ padding: '16px 20px' }}>
        <div className="codex-row-info">
          <span className="codex-row-title">Auto-sync new content</span>
          <span className="codex-row-desc">
            Automatically upload newly added articles, books, and media files to Google Drive
          </span>
        </div>
        <Switch
          on={Boolean(config?.auto_upload_new === 1)}
          onChange={handleToggleAutoUpload}
          label="Auto-sync new content"
          disabled={!driveConnected}
        />
      </div>

      {/* Row 5: Two-Way Library Sync & Inbound Import */}
      <div className="codex-row" style={{ padding: '16px 20px', flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div className="codex-row-info">
            <span className="codex-row-title">Two-way library synchronization</span>
            <span className="codex-row-desc">
              Scans Google Drive to import existing items into your Library, and uploads local files to Drive.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {failed > 0 && (
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={handleRetryFailed}
                disabled={retrying || isActivelyMigrating || !driveConnected}
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
              onClick={handleStartSync}
              disabled={syncing || isActivelyMigrating || !driveConnected}
              style={{
                padding: '5px 16px',
                fontSize: '13px',
                backgroundColor: 'var(--accent, #6366f1)',
                color: '#fff',
              }}
              title={!driveConnected ? 'Connect Google Drive first' : undefined}
            >
              <Icon name="refresh" size={13} className={syncing ? 'animate-spin' : ''} style={{ marginRight: 6 }} />
              {syncing
                ? `Syncing (${syncStatus?.stage || 'running'})…`
                : 'Sync Library Now'}
            </HouseButton>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleStartMigration}
              disabled={isActivelyMigrating || syncing || !driveConnected || (total > 0 && pending === 0 && failed === 0)}
              style={{ padding: '5px 16px', fontSize: '13px' }}
              title={!driveConnected ? 'Connect Google Drive first' : undefined}
            >
              {isActivelyMigrating
                ? 'Uploading…'
                : total === 0
                ? 'Outbound Upload'
                : pending > 0
                ? 'Resume Upload'
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
              width: `${syncing ? 100 : percent}%`,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span>
              Drive items found: <strong style={{ color: 'var(--text)' }}>{syncStatus?.found_drive_items ?? '—'}</strong>
            </span>
            <span>
              Inbound imported: <strong style={{ color: 'var(--ok, #22c55e)' }}>{syncStatus?.inbound_imported ?? 0}</strong>
            </span>
            <span>
              Outbound uploaded: <strong style={{ color: 'var(--text)' }}>{completed}</strong>
            </span>
            {syncStatus?.skipped_duplicates > 0 && (
              <span>
                Duplicates skipped: <strong style={{ color: 'var(--text-dim)' }}>{syncStatus.skipped_duplicates}</strong>
              </span>
            )}
            {failed > 0 && (
              <span>
                Failed: <strong style={{ color: 'var(--bad, #ef4444)' }}>{failed}</strong>
              </span>
            )}
          </div>
          {syncStatus?.stage && (
            <span style={{ fontWeight: 600, color: syncStatus.stage === 'failed' ? 'var(--bad, #ef4444)' : 'var(--accent, #6366f1)' }}>
              Status: {syncStatus.stage}
            </span>
          )}
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
