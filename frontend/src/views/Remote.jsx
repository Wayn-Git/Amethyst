/* Remote control: this machine, from somewhere else.
 *
 * Everything here reads the synced replica rather than the API, because the
 * whole situation this view exists for is one where there is no API to read --
 * a phone, on a network, with the laptop at home. What it shows arrived sealed
 * through the relay and was merged locally; what it sends is queued in an
 * outbox and leaves on the next poll.
 *
 * So there is no loading state and no error state for the transcript. There is
 * only what has arrived, and how long ago the last poll was. That is the honest
 * shape of a remote control: it is never live, it is recently true.
 *
 * Sending is deliberately not a chat composer pretending to be local. Tapping
 * send queues an *intent* -- a request the machine decides about -- and the
 * reply appears as new messages in the transcript once it has run. Nothing here
 * waits for a response, because there is nothing to wait on: the machine may be
 * asleep, and the point is that the message survives until it is not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import * as syncClient from '../lib/sync/client.js'
import * as remote from '../lib/sync/remote.js'

function Composer({ conversationId, onSent }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    const body = text.trim()
    if (!body || !conversationId) return
    setSending(true)
    remote.ask(conversationId, body)
    setText('')
    // Try immediately so a tap with signal feels immediate, but do not depend
    // on it: the outbox holds regardless and the next poll carries it.
    await syncClient.sync().catch(() => {})
    setSending(false)
    onSent?.()
  }

  return (
    <div className="rc-composer">
      <textarea
        className="rc-input"
        rows={2}
        placeholder="Ask your machine…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
        }}
      />
      <button type="button" className="rc-send" onClick={send} disabled={sending || !text.trim()}>
        <Icon name="send" size={16} />
      </button>
    </div>
  )
}

/**
 * One line saying where this device stands.
 *
 * "Offline" with three requests waiting is a different situation from "offline"
 * with none, and a device whose key has gone needs re-pairing rather than
 * patience -- so each of those says which it is instead of all of them saying
 * "not synced".
 */
function describe(status, waiting) {
  const queued = waiting ? `${waiting} waiting to send` : null
  if (!status) return ['Reading what has arrived', queued].filter(Boolean).join(' · ')
  if (status.synced) {
    return [status.applied ? `${status.applied} change(s) arrived` : 'Up to date', queued]
      .filter(Boolean).join(' · ')
  }
  if (status.reason === 'revoked') return 'This device was revoked. Pair it again to continue.'
  if (status.reason === 'no key on this device') {
    return 'This browser has lost its key. Pair it again in Settings → Devices.'
  }
  if (status.reason === 'offline') {
    return queued ? `Offline · ${queued}` : 'Offline · nothing waiting'
  }
  return [`Not synced (${status.reason})`, queued].filter(Boolean).join(' · ')
}

export default function Remote({ onUnpair }) {
  const { setView } = useApp()
  const [paired, setPaired] = useState(() => syncClient.paired())
  const [active, setActive] = useState(null)
  const [tick, setTick] = useState(0)
  const [status, setStatus] = useState(null)

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  // Re-read the replica whenever a poll lands. The poll itself lives in the
  // store, so this only has to notice; it does not own the schedule.
  useEffect(() => {
    const onChange = () => refresh()
    window.addEventListener('amethyst:synced', onChange)
    return () => window.removeEventListener('amethyst:synced', onChange)
  }, [refresh])

  /* `tick` is the dependency on purpose, and the linter is right that it looks
     unnecessary: these read localStorage, which React cannot observe, so the
     counter is what says "read it again". eslint-disable-next-line is not used
     because the rule is worth keeping on for every other hook in this file. */
  const conversations = useMemo(() => (paired ? remote.conversations() : []), [paired, tick])
  const transcript = useMemo(() => (active ? remote.messages(active) : []), [active, tick])
  const phase = useMemo(() => (active ? remote.runPhase(active) : null), [active, tick])
  const pending = useMemo(
    () => (paired ? remote.asked().filter((a) => a.state === 'pending' || a.state === 'accepted') : []),
    [paired, tick],
  )

  useEffect(() => {
    if (!active && conversations.length) setActive(conversations[0].id)
  }, [active, conversations])

  const syncNow = async () => {
    const result = await syncClient.sync()
    setStatus(result)
    if (result.synced) syncClient.projectPreferences()
    refresh()
  }

  if (!paired) {
    return (
      <div className="rc">
        <div className="rc-empty">
          <Icon name="link" size={28} />
          <h2>Not paired yet</h2>
          <p>
            Run <code>amethyst device --pair</code> on your machine, then enter the code in
            Settings → Devices. Everything below arrives sealed; the relay carrying it cannot
            read any of it.
          </p>
          <button type="button" className="rc-send" onClick={() => setView('settings')}>
            Open Settings
          </button>
          <button type="button" onClick={() => setPaired(syncClient.paired())}>
            I have paired
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rc">
      <header className="rc-head">
        <div>
          <h1>Remote</h1>
          <p className="rc-sub">{describe(status, syncClient.queued())}</p>
        </div>
        <div className="rc-actions">
          <button type="button" className="rc-send" onClick={syncNow} aria-label="Sync now">
            <Icon name="refresh" size={15} />
          </button>
          {onUnpair ? (
            <button type="button" className="rc-unpair" onClick={onUnpair}>Unpair</button>
          ) : null}
        </div>
      </header>

      {conversations.length === 0 ? (
        <div className="rc-empty">
          <p>
            Nothing has arrived yet. Your machine publishes its conversations on its next relay
            poll — leave it running and pull down in a few seconds.
          </p>
        </div>
      ) : (
        <>
          <div className="rc-tabs">
            {conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                className={`rc-tab${conversation.id === active ? ' is-active' : ''}`}
                onClick={() => setActive(conversation.id)}
              >
                {conversation.pinned ? <Icon name="pin" size={11} /> : null}
                <span>{conversation.title}</span>
              </button>
            ))}
          </div>

          <div className="rc-thread">
            {transcript.length === 0 ? (
              <p className="rc-sub">
                No messages have been published for this conversation yet.
              </p>
            ) : transcript.map((message) => (
              <div className={`rc-msg rc-msg--${message.role}`} key={message.id}>
                <span className="rc-role">{message.role}</span>
                <div className="rc-body">{message.content}</div>
              </div>
            ))}

            {phase ? (
              <div className="rc-msg rc-msg--phase">
                <span className="rc-role">machine</span>
                <div className="rc-body">{phase}…</div>
              </div>
            ) : null}

            {pending.map((intent) => (
              <div className="rc-msg rc-msg--queued" key={intent.id}>
                <span className="rc-role">queued</span>
                <div className="rc-body">
                  {intent.payload?.text}
                  <em>{intent.state === 'accepted' ? ' · accepted' : ' · waiting to send'}</em>
                </div>
              </div>
            ))}
          </div>

          <Composer conversationId={active} onSent={refresh} />
        </>
      )}
    </div>
  )
}
