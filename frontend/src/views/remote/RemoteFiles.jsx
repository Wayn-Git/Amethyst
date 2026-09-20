import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api, getBase } from '../../api.js'
import * as syncClient from '../../lib/sync/client.js'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function RemoteFiles() {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [clipboardText, setClipboardText] = useState('')
  const [clipboardLoading, setClipboardLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const fileInputRef = useRef(null)

  const token = syncClient.identity()?.token || ''

  const loadFiles = useCallback(async () => {
    try {
      const res = await api.remoteFiles()
      setFiles(res.files || [])
    } catch (err) {
      setNotice(`Failed to load files: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const pullClipboard = useCallback(async () => {
    setClipboardLoading(true)
    try {
      const res = await api.remoteClipboardGet()
      if (res?.text !== undefined) {
        setClipboardText(res.text)
      }
    } catch (err) {
      setNotice(`Failed to read clipboard: ${err.message}`)
    } finally {
      setClipboardLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFiles()
    pullClipboard()
  }, [loadFiles, pullClipboard])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.uploadRemoteFile(file)
      setNotice(`Uploaded "${file.name}" to Amethyst Transfers.`)
      await loadFiles()
    } catch (err) {
      setNotice(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (filename) => {
    if (!window.confirm(`Delete ${filename} from PC?`)) return
    try {
      await api.remoteDeleteFile(filename)
      setFiles((prev) => prev.filter((f) => f.name !== filename))
      setNotice(`Deleted ${filename}`)
    } catch (err) {
      setNotice(`Delete failed: ${err.message}`)
    }
  }

  const pushClipboard = async () => {
    setClipboardLoading(true)
    try {
      await api.remoteClipboardSet(clipboardText)
      setNotice('PC clipboard updated successfully.')
    } catch (err) {
      setNotice(`Failed to update clipboard: ${err.message}`)
    } finally {
      setClipboardLoading(false)
    }
  }

  const copyToPhone = async () => {
    try {
      await navigator.clipboard.writeText(clipboardText)
      setNotice('Copied to phone clipboard.')
    } catch {
      setNotice('Could not write to phone clipboard.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 12px' }}>
      {notice && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'var(--bg-inset)',
            border: '1px solid var(--accent)',
            fontSize: 12,
            color: 'var(--text)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer' }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* 1. File Transfer Area */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 14, color: 'var(--text)' }}>Amethyst Transfers</strong>
            <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>
              Scoped to <code>~/Downloads/Amethyst Transfers</code>
            </div>
          </div>
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUpload}
              style={{ display: 'none' }}
              disabled={uploading}
            />
            <button
              type="button"
              className="pair-go"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="plus" size={14} />
              {uploading ? 'Uploading…' : 'Send File to PC'}
            </button>
          </div>
        </div>

        {/* Files List */}
        {loading ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: 16 }}>
            Loading files…
          </div>
        ) : files.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: 24 }}>
            <Icon name="folder" size={28} />
            <div style={{ marginTop: 8 }}>No files in Amethyst Transfers. Tap &ldquo;Send File to PC&rdquo; to transfer a document.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map((file) => (
              <div
                key={file.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.15)',
                  border: '1px solid var(--hairline-strong)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    {formatBytes(file.size)} {file.modified ? `· ${file.modified}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <a
                    href={`${getBase()}/remote/files/download/${encodeURIComponent(file.name)}${token ? `?token=${encodeURIComponent(token)}` : ''}`}
                    download={file.name}
                    className="set-btn-sm"
                    style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', padding: '6px 10px' }}
                  >
                    <Icon name="download" size={14} />
                  </a>
                  <button
                    type="button"
                    className="set-btn-sm"
                    onClick={() => handleDelete(file.name)}
                    style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', padding: '6px 10px' }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. GTK Clipboard Synchronization */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="copy" size={16} />
            <strong style={{ fontSize: 14, color: 'var(--text)' }}>PC Clipboard Sync</strong>
          </div>
          <button
            type="button"
            className="set-btn-sm"
            onClick={pullClipboard}
            disabled={clipboardLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="refresh" size={12} />
            {clipboardLoading ? 'Reading…' : 'Pull from PC'}
          </button>
        </div>

        <textarea
          rows={3}
          className="pair-input"
          value={clipboardText}
          onChange={(e) => setClipboardText(e.target.value)}
          placeholder="Paste or type text to synchronize with computer clipboard…"
          style={{ width: '100%', resize: 'vertical', fontSize: 13, marginBottom: 10 }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="set-btn-sm"
            onClick={copyToPhone}
            disabled={!clipboardText}
          >
            Copy to Phone
          </button>
          <button
            type="button"
            className="pair-go"
            onClick={pushClipboard}
            disabled={clipboardLoading || !clipboardText}
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            Push to PC Clipboard
          </button>
        </div>
      </div>
    </div>
  )
}
