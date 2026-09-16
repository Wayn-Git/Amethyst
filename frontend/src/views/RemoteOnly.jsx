/* The whole app, on a device that is not the machine.
 *
 * `Remote` renders inside the workbench on a desktop -- one page among the
 * rail's others. On a phone there is no workbench: no sidebar of conversations
 * to switch between, no artifact panel, no terminal drawer, and nothing to
 * navigate *to*, because every other page in this app opens by fetching from a
 * backend this device cannot reach.
 *
 * So this is the frame for that case: the remote view, full bleed, and a way
 * back out to pairing. It is a separate component rather than a flag on the
 * workbench because the two share no chrome, and threading "is this a phone"
 * through the four-column layout would be a condition in every one of them.
 */

import { useState } from 'react'

import ErrorBoundary from '../components/ErrorBoundary.jsx'
import Pair from './Pair.jsx'
import Remote from './Remote.jsx'
import { forget } from '../lib/sync/client.js'

export default function RemoteOnly() {
  const [repairing, setRepairing] = useState(false)

  if (repairing) return <Pair onPaired={() => setRepairing(false)} />

  return (
    <div className="remote-only">
      <ErrorBoundary>
        <Remote onUnpair={() => { forget(); setRepairing(true) }} />
      </ErrorBoundary>
    </div>
  )
}
