import { useState } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { getBase } from '../api.js'
import { request } from '../dashboard/api.js'
import { identity } from '../lib/sync/client.js'
import { newerUpdate } from './updates.js'

const AppUpdates = registerPlugin('AppUpdates')
export default function Updates() {
  const [status, setStatus] = useState('Check your desktop for a newer Android build.')
  const [update, setUpdate] = useState(null)
  const [busy, setBusy] = useState(false)
  if (Capacitor.getPlatform() !== 'android') return null
  async function check() {
    setBusy(true); setUpdate(null)
    try {
      const installed = await App.getInfo()
      const latest = await request('/mobile/update')
      if (newerUpdate(latest, installed.build)) {
        setUpdate(latest); setStatus(`Version ${latest.version} is available. Installed: ${installed.version}.`)
      } else setStatus(`Version ${installed.version} is current for this desktop.`)
    } catch (error) { setStatus(error.message) }
    finally { setBusy(false) }
  }
  async function install() {
    setBusy(true); setStatus('Downloading and verifying update…')
    try {
      const result = await AppUpdates.install({ url: `${getBase()}/mobile/update/apk`, token: identity()?.token, sha256: update.sha256 })
      setStatus(result.permissionRequired
        ? 'Allow Amethyst to install updates, return here, then tap Install update again.'
        : 'Approve Update in Android. Your pairing and saved data will stay in place.')
    } catch (error) { setStatus(error.message) }
    finally { setBusy(false) }
  }
  return <section className="companion-card" aria-label="App updates">
    <h2>App updates</h2><p role="status">{status}</p>
    <button type="button" disabled={busy} onClick={check}>Check for updates</button>
    {update && <button type="button" disabled={busy} onClick={install}>Install update</button>}
    <p>Updates come from your paired desktop. Android asks for approval; no uninstall is needed.</p>
  </section>
}
