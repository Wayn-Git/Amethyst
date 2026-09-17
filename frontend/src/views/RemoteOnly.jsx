/* The whole app, on a device that is not the machine.
 *
 * `Remote` renders inside the workbench on a desktop -- one page among the
 * rail's others. On a phone there is no workbench: no sidebar of conversations
 * to switch between, no artifact panel, no terminal drawer, and nothing to
 * navigate *to*, because every other page in this app is laid out for a screen
 * this device does not have and several of them open by fetching from a backend
 * it may not be able to reach.
 *
 * So this is the frame for that case: the remote view, full bleed, plus the two
 * ways out of it -- back to pairing, and over to the desktop interface for
 * somebody who decided this query got them wrong.
 *
 * It also owns one state `Remote` cannot: being disconnected. A revocation
 * happens on the machine, and this device finds out when the relay stops
 * recognising its token -- a 401, surfaced by `sync()` as `reason: 'revoked'`.
 * That is not a sync that failed and will succeed later, it is the end of this
 * pairing, and showing it as a status line under a transcript that has quietly
 * stopped updating is how somebody concludes the feature is broken.
 */

import { useCallback, useEffect, useState } from 'react'

import ErrorBoundary from '../components/ErrorBoundary.jsx'
import Icon from '../components/Icon.jsx'
import Pair from './Pair.jsx'
import Remote from './Remote.jsx'
import { forget, paired as isPaired } from '../lib/sync/client.js'

export default function RemoteOnly({ onDesktop }) {
  const [repairing, setRepairing] = useState(() => !isPaired())
  const [revoked, setRevoked] = useState(false)

  /* Heard from the poll in the store rather than from a call here, because the
     poll is what runs while nobody is pressing anything -- which is exactly
     when a device gets revoked. */
  useEffect(() => {
    const onSync = (event) => {
      if (event.detail?.reason === 'revoked') setRevoked(true)
    }
    window.addEventListener('amethyst:sync-failed', onSync)
    return () => window.removeEventListener('amethyst:sync-failed', onSync)
  }, [])

  const startOver = useCallback(async () => {
    await forget()
    setRevoked(false)
    setRepairing(true)
  }, [])

  if (repairing) {
    return <Pair onPaired={() => setRepairing(false)} onDesktop={onDesktop} />
  }

  if (revoked) {
    return (
      <div className="pair">
        <div className="pair-card">
          <div className="pair-state pair-state--bad">
            <Icon name="plug" size={30} />
            <h1>Disconnected</h1>
            <p className="pair-sub">
              This device was removed from your computer. Anything it had queued was
              cancelled there, and nothing new will arrive until you pair it again.
            </p>
            <button type="button" className="pair-go" onClick={startOver}>
              Pair again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="remote-only">
      <ErrorBoundary>
        <Remote onUnpair={startOver} onDesktop={onDesktop} />
      </ErrorBoundary>
    </div>
  )
}
