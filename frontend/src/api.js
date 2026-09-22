/* Where the API is.

   Empty in development and in the single-process build, where the API is served
   from the same origin as this bundle and `/api` is a relative path. Set
   `VITE_API_BASE` at build time to point a separately deployed interface at a
   separately deployed backend -- a Vercel frontend at a Render service, say.
   Trailing slashes are trimmed so `https://host/` and `https://host` mean the
   same thing rather than producing `https://host//api`. */
export const API_ORIGIN = (import.meta.env?.VITE_API_BASE || '').trim().replace(/\/+$/, '')

export function getApiOrigin() {
  if (API_ORIGIN) return API_ORIGIN
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('amethyst.sync.identity.v1') : null
    if (raw) {
      const id = JSON.parse(raw)
      if (id?.hostUrl && typeof window !== 'undefined' && window.location.origin !== id.hostUrl) {
        return id.hostUrl.replace(/\/+$/, '')
      }
    }
  } catch {}
  return ''
}

export function getBase() {
  const origin = getApiOrigin()
  return origin ? `${origin}/api` : `${API_ORIGIN}/api`
}

export function getAuthHeaders() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('amethyst.sync.identity.v1') : null
    if (raw) {
      const id = JSON.parse(raw)
      if (id?.token) {
        return {
          Authorization: `Bearer ${id.token}`,
          'X-Amethyst-Device-Token': id.token,
        }
      }
    }
  } catch {}
  return {}
}

const BASE = `${API_ORIGIN}/api`

/* Waking the backend.

   A free-tier container is stopped when nothing has asked it for anything, and
   the request that wakes it waits out a cold start -- tens of seconds, during
   which every call the interface makes on mount is queued behind the same boot.
   Rendering a blank page for that long reads as a broken deploy.

   So: one request goes out the moment this module is evaluated, which is before
   React has mounted, and the interface draws its own frame around the wait
   instead of waiting for the first answer to arrive. Views read `phase` and
   show a skeleton rather than an empty room.

   Same-origin builds resolve this on the first attempt and never see it. */
const WAKE_ATTEMPT_TIMEOUT = 9000
const WAKE_GAP = 1500
const WAKE_GIVE_UP_AFTER = 90000

// `phase` opens at 'ready' on purpose: a machine running its own server is the
// ordinary case, and showing it a boot frame for the length of one ping would be
// a flash on every load. But optimism is not knowledge, and `verified` is the
// difference -- it says a ping has actually answered.
//
// Without it this was a latch nothing could leave: the startup wake returned
// early because the phase already said 'ready', the recovery path in `j` called
// the same function and it returned early too, so `phase` could never become
// 'waking' or 'down'. The boot screen was unreachable code, and a browser with
// no backend -- every phone -- rendered the whole workbench and let each fetch
// fail on its own. That is the "unresponsive" state, and it had nothing to do
// with the backend being slow.
let state = { phase: 'ready', verified: false, since: Date.now(), attempts: 0, error: null }
const watchers = new Set()

function publish(patch) {
  state = { ...state, ...patch }
  for (const fn of watchers) {
    try { fn(state) } catch { /* a bad watcher must not stop the others */ }
  }
}

/** Subscribe to the backend's reachability. Called immediately with the
 *  current state, and returns the unsubscribe. */
export function onServerState(fn) {
  watchers.add(fn)
  fn(state)
  return () => watchers.delete(fn)
}

export const serverState = () => state

async function ping(timeout) {
  // `/api/ping` on purpose rather than `/api/health`: health surveys every
  // provider, which can itself take seconds and is the wrong thing to make a
  // cold start wait for. Any request wakes the container; the cheapest one
  // should be the one that does it.
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), timeout)
  try {
    const res = await fetch(`${getBase()}/ping`, {
      headers: getAuthHeaders(),
      signal: stop.signal,
      cache: 'no-store',
    })
    if (!res.ok) return false
    // A 200 is not enough, and assuming it was is what made a phone unusable.
    //
    // This bundle is served by a static host with an SPA fallback -- every
    // unmatched path returns index.html with a 200 so that deep links work. That
    // rule catches `/api/ping` as happily as `/tasks`, so the ping "succeeded",
    // the backend was marked reachable and verified, and the interface rendered
    // the full workbench against an API that was answering every call with its
    // own home page.
    //
    // So the check is whether this is the API talking, not whether something
    // answered. `/api/ping` returns JSON; a fallback returns HTML.
    const type = res.headers.get('content-type') || ''
    return type.includes('json')
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

let wakePromise = null

async function doWakeBackend() {
  // Only a *verified* ready short-circuits. An unverified one is a guess, and
  // the whole point of this call is to find out.
  if (state.phase === 'ready' && state.verified) return true

  // One quiet attempt before saying anything. On a healthy machine this answers
  // in a millisecond and nothing on screen ever moves; announcing 'waking'
  // first would put a boot frame in front of every load to no purpose.
  if (await ping(WAKE_ATTEMPT_TIMEOUT)) {
    publish({ phase: 'ready', verified: true, attempts: 1, error: null })
    return true
  }

  publish({ phase: 'waking', verified: false, since: Date.now(), attempts: 1, error: null })
  const deadline = Date.now() + WAKE_GIVE_UP_AFTER
  for (let attempt = 1; ; attempt += 1) {
    if (await ping(WAKE_ATTEMPT_TIMEOUT)) {
      publish({ phase: 'ready', verified: true, attempts: attempt, error: null })
      return true
    }
    if (Date.now() >= deadline) {
      publish({
        phase: 'down',
        verified: false,
        attempts: attempt,
        error: API_ORIGIN
          ? `No answer from ${API_ORIGIN} after ${Math.round(WAKE_GIVE_UP_AFTER / 1000)}s.`
          : 'No answer from the API. Is `amethyst serve` running?',
      })
      return false
    }
    publish({ attempts: attempt })
    await new Promise((done) => setTimeout(done, WAKE_GAP))
  }
}

/** Keep asking until the backend answers, or until it has had long enough. */
export function wakeBackend() {
  if (!wakePromise) {
    wakePromise = doWakeBackend().finally(() => { wakePromise = null })
  }
  return wakePromise
}

/* DNS, TCP and TLS to the API host, started before the first request needs
   them. Only when the API is somewhere else -- a same-origin build is already
   connected to its own origin, and a preconnect to it would be a wasted hint. */
if (API_ORIGIN && typeof document !== 'undefined') {
  const hint = document.createElement('link')
  hint.rel = 'preconnect'
  hint.href = API_ORIGIN
  hint.crossOrigin = ''
  document.head.appendChild(hint)
}

/** Started here rather than from a component, so the container is already
 *  booting while React is still parsing. */
export const backendReady = wakeBackend()

async function j(url, opts) {
  let res
  const base = getBase()
  const auth = getAuthHeaders()
  try {
    res = await fetch(base + url, {
      headers: {
        'Content-Type': 'application/json',
        ...auth,
        ...(opts?.headers || {}),
      },
      ...opts,
    })
  } catch (err) {
    // `fetch` rejects with a bare "Failed to fetch" for a container that has
    // gone back to sleep, a CORS origin that was never allowed, and a laptop
    // with no wifi alike. The interface showed that string verbatim, which
    // named none of them. Say where it was trying to reach, and put the backend
    // back into waking so the boot frame comes up rather than a dead page.
    if (state.phase === 'ready') { publish({ verified: false }); wakeBackend() }
    const where = getApiOrigin() || API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')
    throw new Error(`Could not reach ${where} — ${err.message || 'the request failed'}`)
  }
  if (state.phase !== 'ready' || !state.verified) publish({ phase: 'ready', verified: true, error: null })
  if (!res.ok) {
    // A 405 on a path this interface knows about means the endpoint is not in
    // the running server, which in practice means one thing: `amethyst serve` has
    // been up since before the bundle it is serving was built. "405: Method
    // Not Allowed" sends someone looking for a bug in their own request; this
    // says what to actually do about it.
    if (res.status === 405) {
      throw new Error(
        `This server does not have ${opts?.method || 'that'} ${url} — it is running an older`
        + ' build than the interface it is serving. Restart amethyst serve.',
      )
    }
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || body.error || detail
    } catch { /* keep statusText */ }
    throw new Error(`${res.status}: ${detail}`)
  }
  return res.json()
}

const json = (method, body) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  // Cheap by design: it exists to be the request that wakes a stopped
  // container, so it must not do any work of its own.
  ping: () => j('/ping'),
  health: () => j('/health'),

  // Providers. `addProvider` is the only call that carries a key, and nothing
  // gives one back: the server stores it in the OS keychain and every response
  // reports whether a key exists, never what it is.
  providers: () => j('/providers'),
  addProvider: (body) => j('/providers', json('POST', body)),
  removeProvider: (name) => j(`/providers/${encodeURIComponent(name)}`, json('DELETE')),
  deleteProvider: (name) => j(`/providers/${encodeURIComponent(name)}`, json('DELETE')),
  // A fresh liveness check the user asked for, cache ignored. `pingAll` is the
  // one-button version; both update the picker's badge from what came back.
  pingProvider: (name) => j(`/providers/${encodeURIComponent(name)}/ping`, json('POST')),
  pingAll: () => j('/providers/ping-all', json('POST')),
  // The models this provider's own API lists right now, so the menu offers what
  // the endpoint serves instead of asking the user to retype an id from docs.
  providerModels: (name) => j(`/providers/${encodeURIComponent(name)}/models`),
  // Switch a provider off without losing its entry or its key -- the middle
  // state DELETE cannot express.
  setProviderEnabled: (name, enabled) =>
    j(`/providers/${encodeURIComponent(name)}`, json('PATCH', { enabled })),
  setPrimaryProvider: (name) =>
    j(`/providers/${encodeURIComponent(name)}/primary`, json('POST')),
  reorderProviders: (order) =>
    j('/providers/reorder', json('POST', { order })),
  // Why the router would pick what it picks: each provider's health, how much
  // of its declared minute is left, and the ranked decision with its reasons.
  routing: () => j('/routing'),

  // Tiers: which model does which job. `default` is the go-to model; `fast` is
  // the quick cheap one; `heavy` is the slow careful one.
  settings: () => j('/settings'),
  updateSettings: (patch) => j('/settings', json('PATCH', patch)),

  // The handful of preferences that follow you between devices. The rest of
  // `amethyst.ui.v1` is deliberately per-device: panel width and text size
  // should differ between a laptop and a phone. The server owns the allowlist
  // and refuses anything outside it -- see backend/sync/registry.py.
  preferences: () => j('/preferences'),
  savePreferences: (preferences) => j('/preferences', json('PATCH', { preferences })),

  // Paired devices, approvals, and permissions
  devices: () => j('/devices'),
  pendingDevices: () => j('/devices/pending'),
  approvePending: (requestId, permissions) =>
    j(`/devices/pending/${encodeURIComponent(requestId)}/approve`, json('POST', permissions ? { permissions } : {})),
  rejectPending: (requestId) =>
    j(`/devices/pending/${encodeURIComponent(requestId)}/reject`, json('POST')),
  pairDevice: (name) => j('/devices/pair', json('POST', { name })),
  revokeDevice: (id) => j(`/devices/${id}`, json('DELETE')),
  updateDevicePermissions: (deviceId, permissions) =>
    j(`/devices/${encodeURIComponent(deviceId)}/permissions`, json('PATCH', { permissions })),
  setAppUrl: (appUrl) => j('/devices/app-url', json('PUT', { app_url: appUrl })),
  checkPairingClaim: (requestId) => j(`/pair/claim?request_id=${encodeURIComponent(requestId)}`),

  // Remote PC & System Telemetry
  remoteStatus: () => j('/remote/status'),
  remoteProcesses: () => j('/remote/processes'),
  remoteKillProcess: (pid, sig = 15) => j('/remote/processes/kill', json('POST', { pid, sig })),
  remoteApplications: () => j('/remote/applications'),
  remoteLaunchApp: (target) => j('/remote/applications/launch', json('POST', { target })),
  remoteCommand: (command, root = false) => j('/remote/command', json('POST', { command, root })),

  // Remote Media & Audio
  remoteMedia: (command) => j('/remote/media', json('POST', { command })),
  remoteVolume: (volume) => j('/remote/media/volume', json('POST', { volume })),
  remoteMute: (mute) => j('/remote/media/mute', json('POST', { mute })),
  remoteMediaAction: (action) => j('/remote/media/action', json('POST', { action })),
  remoteSink: (sink) => j('/remote/media/sink', json('POST', { sink })),

  // Remote Power
  remotePower: (action) => j(`/remote/power/${encodeURIComponent(action)}`, json('POST')),
  remoteWake: () => j('/remote/power/wake'),

  // Remote Input (Mouse, Keyboard, Clipboard)
  remoteMouse: (payload) => j('/remote/input/mouse', json('POST', payload)),
  remoteKeyboard: (payload) => j('/remote/input/keyboard', json('POST', payload)),
  remoteClipboardGet: () => j('/remote/clipboard'),
  remoteClipboardSet: (text) => j('/remote/clipboard', json('POST', { text })),

  // Remote Visuals (Screen & Camera)
  remoteScreenshot: () => j('/remote/screenshot'),
  remoteCameraList: () => j('/remote/camera/list'),
  remoteCameraSnapshot: (device = '') => j(`/remote/camera/snapshot${device ? `?device=${encodeURIComponent(device)}` : ''}`),
  remoteCameraStop: () => j('/remote/camera/stop', json('POST')),
  remoteWebcam: () => j('/remote/webcam'),

  // Remote Files
  remoteFiles: () => j('/remote/files'),
  remoteDeleteFile: (filename) => j(`/remote/files/${encodeURIComponent(filename)}`, json('DELETE')),
  uploadRemoteFile: async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    const headers = { ...getAuthHeaders() }
    const res = await fetch(`${getBase()}/remote/files/upload`, {
      method: 'POST',
      headers,
      body: formData,
    })
    if (!res.ok) {
      let detail = res.statusText
      try { detail = (await res.json()).detail || detail } catch {}
      throw new Error(detail || 'Upload failed')
    }
    return res.json()
  },

  activity: (days = 30) => j(`/analytics/activity?days=${days}`),
  usageWindows: () => j('/analytics/usage-windows'),
  confirmationPreferences: () => j('/confirmations/preferences'),
  revokeConfirmationPreference: (opKey) =>
    j('/confirmations/preferences/' + encodeURIComponent(opKey), json('DELETE')),
  clearConfirmationPreferences: () => j('/confirmations/preferences', json('DELETE')),

  tiers: () => j('/tiers'),
  setTier: (tier, provider, model) =>
    j(`/tiers/${encodeURIComponent(tier)}`, json('PUT', { provider, model })),
  clearTier: (tier) => j(`/tiers/${encodeURIComponent(tier)}`, json('DELETE')),

  conversations: () => j('/conversations'),
  createConversation: (provider, model, title) =>
    j('/conversations', json('POST', { provider, model, title })),
  updateConversation: (id, patch) => j(`/conversations/${id}`, json('PATCH', patch)),
  deleteConversation: (id, archive = false) => j(`/conversations/${id}${archive ? '?archive=true' : ''}`, json('DELETE')),
  deleteAllConversations: () => j('/conversations', json('DELETE')),
  messages: (id) => j(`/conversations/${id}/messages`),

  /* Artifacts. The stream announces them as they are written (`artifact_open`,
     `artifact_delta`, `artifact_done`), so these two are for the other case:
     opening a conversation that produced documents in an earlier session. The
     list is metadata only -- the file is the artifact -- and `artifact` reads
     one back off disk, which is why it can answer with `missing` set. */
  artifacts: (conversationId) => j(`/conversations/${conversationId}/artifacts`),
  artifact: (artifactId) => j(`/artifacts/${encodeURIComponent(artifactId)}`),
  messageArtifact: (conversationId, messageId) =>
    j(`/conversations/${conversationId}/messages/${messageId}/artifact`),
  updateMessageArtifact: (conversationId, messageId, content, changeSummary) =>
    j(`/conversations/${conversationId}/messages/${messageId}/artifact`, json("POST", { content, change_summary: changeSummary })),
  revertMessageArtifact: (conversationId, messageId, version) =>
    j(`/conversations/${conversationId}/messages/${messageId}/artifact/revert`, json("POST", { version })),
  exportDocx: async (markdown, title) => {
    const res = await fetch("/api/export/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown, title }),
    })
    if (!res.ok) throw new Error("DOCX export failed")
    return res.blob()
  },
  aiTransform: (textOrObj, action, instruction) => {
    if (typeof textOrObj === 'object' && textOrObj !== null) {
      return j("/ai/transform", json("POST", textOrObj))
    }
    return j("/ai/transform", json("POST", { text: textOrObj, action, instruction }))
  },
  branchConversation: (conversationId, fromMessageId = null, title = null) =>
    j(`/conversations/${conversationId}/branch`, json('POST', { from_message_id: fromMessageId, title })),
  gitStatus: () => j('/git-status'),
  pinMessage: (id, messageId, pinned) =>
    j(`/conversations/${id}/messages/${messageId}/pin`, json('POST', { pinned })),
  // Pinning the conversation, not an answer inside it: what the sidebar's star
  // means, and what its Starred section lists.
  pinConversation: (id, pinned) => j(`/conversations/${id}/pin`, json('POST', { pinned })),
  // How this conversation's last turn ended, according to the server. The
  // interface used to be the only thing that knew: `resumable` arrived on the
  // terminal frame and lived in component state, so a reload lost it and a turn
  // killed with the process left no trace at all. `{}` means no turn yet.
  runState: (id) => j(`/conversations/${id}/run`),

  // Per-model reasoning effort persistence.
  getVariant: (modelId, conversationId) => {
    const params = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''
    return j(`/variant/${encodeURIComponent(modelId)}${params}`)
  },
  setVariant: (modelId, effort) =>
    j(`/variant/${encodeURIComponent(modelId)}`, json('PUT', { effort })),

  // `mode` is 'chat' or 'plan'. It is a field rather than a sentence glued to
  // the message: the sentence landed in the transcript and was replayed on
  // every later turn, and the server had no idea the mode existed.
  turn: async ({ conversationId, message, workspace, mode, attachments, guard, effort, variant, model, onEvent, signal }) => {
    let res
    try {
      res = await fetch(`${getBase()}/conversations/${conversationId}/turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        /* Attachments travel as structured data, not as a line of prose appended
           to the prompt. An image the model is meant to look at cannot be
           described to it as a filesystem path -- that is what produced an issue
           body containing `/home/wayne/.amethyst/attachments/…/Screenshot.png`
           where the screenshot should have been. */
        body: JSON.stringify({
          message,
          workspace,
          mode: mode || 'chat',
          attachments: (attachments || []).map((f) => ({
            path: f.path,
            name: f.name,
            media_type: f.content_type || null,
            bytes: f.bytes ?? null,
          })),
          guard: guard || null,
          effort: effort || null,
          variant: variant || null,
          model: model || null,
        }),
        signal,
      })
    } catch (err) {
      if (err instanceof TypeError) {
        publish({ phase: 'down', verified: false, attempts: 1, error: err.message })
        wakeBackend()
      }
      throw err
    }
    
    if (!res.ok || !res.body) {
      let detail = res.statusText
      try { detail = (await res.json()).detail || detail } catch { /* ignore */ }
      throw new Error(`${res.status}: ${detail}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false
    while (!done) {
      const { value, done: streamDone } = await reader.read()
      done = streamDone
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data: ')) continue
        
        let evt = null
        try {
          evt = JSON.parse(line.slice(6))
        } catch { 
          /* malformed frame, skip */ 
          continue
        }
        
        if (evt) {
          try {
            onEvent(evt)
          } catch (err) {
            console.error("Error processing SSE event:", err, evt)
          }
        }
      }
    }
  },

  // Stops the turn on the server. Aborting the browser's read only closes the
  // response: the loop behind it keeps calling models and tools.
  stopTurn: (id) => j(`/conversations/${id}/turn/stop`, json('POST', {})),

  // A turn suspended on a clarifying question. `answerQuestion` is what
  // resumes it; the turn is holding a future on the other end.
  questions: (conversationId) =>
    j(`/questions${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''}`),
  answerQuestion: (id, answers) => j(`/questions/${id}`, json('POST', { answers })),

  confirmations: () => j('/confirmations'),
  decideConfirmation: (id, { allow, remember }) =>
    j(`/confirmations/${id}`, json('POST', { allow, remember })),

  standingApprovals: () => j('/confirmations/preferences'),
  revokeApproval: (operationKey) =>
    j(`/confirmations/preferences/${encodeURIComponent(operationKey)}`, json('DELETE')),

  // Automations. A turn that runs without anyone typing.
  automations: () => j('/automations'),
  createAutomation: (body) => j('/automations', json('POST', body)),
  updateAutomation: (id, patch) => j(`/automations/${id}`, json('PATCH', patch)),
  deleteAutomation: (id) => j(`/automations/${id}`, json('DELETE')),
  // Answers with a job, not a result. It used to await the whole run -- up to
  // three minutes of open request, which a proxy times out and a person reads
  // as a failure while the run carries on unseen.
  runAutomation: (id) => j(`/automations/${id}/run`, json('POST', {})),
  retryAutomation: (id) => j(`/automations/${id}/retry`, json('POST', {})),
  // The run in flight for this automation, or the last one. What the page asks
  // on open, so a reload reconnects to a run rather than offering to start a
  // second one.
  automationJob: (id) => j(`/automations/${id}/job`),
  jobs: (params = '') => j(`/jobs${params}`),
  job: (id) => j(`/jobs/${id}`),
  // `reset_steps` clears the ledger of what already happened, so every step runs
  // again including the ones that sent something. Never the default.
  actOnJob: (id, action, body = {}) => j(`/jobs/${id}/${action}`, json('POST', body)),
  // Every kept run of one automation. They are out of the conversation rail,
  // so this is where they are read.
  automationRuns: (id) => j(`/automations/${id}/runs`),
  // Recent runs across all automations (for the Runs tab).
  recentRuns: (limit = 100) => j(`/automations/runs/recent?limit=${limit}`),
  // Run history chart stats for one automation.
  automationStats: (id, days = 30) => j(`/automations/${id}/stats?days=${days}`),
  // Run counts across every automation. What the chart is actually about.
  automationOverallStats: (days = 30) => j(`/automations/runs/stats?days=${days}`),
  // One run, in full: what ran, what it called, and what it produced.
  automationRunDetail: (runId) => j(`/automations/runs/${runId}`),
  // Whether anything will run these when this process is not running.
  automationScheduler: () => j('/automations/scheduler'),
  // The grants an automation can hold, and whether each can work right now.
  automationActions: () => j('/automations/actions'),
  // Available automation templates.
  automationTemplates: (category) => j(`/automations/templates${category ? `?category=${category}` : ''}`),
  // Due automations (for GitHub Actions scheduler).
  dueAutomations: () => j('/automations/due'),

  logs: (limit = 100) => j(`/logs?limit=${limit}`),

  memory: (conversationId) =>
    j(`/memory${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''}`),
  addMemory: (fact, conversationId) =>
    j('/memory', json('POST', { fact, conversation_id: conversationId || null })),
  toggleMemory: (enabled, conversationId) =>
    j('/memory/toggle', json('POST', { enabled, conversation_id: conversationId || null })),
  forgetMemory: (id) => j(`/memory/${id}`, json('DELETE')),
  forgetAllMemories: () => j('/memory', json('DELETE')),

  skills: () => j('/skills'),
  skillCatalogue: (refresh = false) => j(`/skills/catalogue${refresh ? '?refresh=true' : ''}`),
  installSkill: (url, overwrite = false) => j('/skills/install', json('POST', { url, overwrite })),
  createSkill: ({ name, description, instruction, overwrite = false }) =>
    j('/skills/create', json('POST', { name, description, instruction, overwrite })),
  removeSkill: (name) => j(`/skills/${encodeURIComponent(name)}`, json('DELETE')),

  tools: () => j('/tools'),
  tasks: ({ bucket = 'all', listId = null, limit = 200 } = {}) =>
    j(listId
      ? `/tasks?list_id=${listId}&limit=${limit}`
      : `/tasks?bucket=${encodeURIComponent(bucket)}&limit=${limit}`),
  taskBuckets: () => j('/tasks/buckets'),
  taskLists: () => j('/task-lists'),
  createTaskList: (name) => j('/task-lists', json('POST', { name })),
  renameTaskList: (id, name) => j(`/task-lists/${id}`, json('PATCH', { name })),
  calendar: (days = 14) => j(`/calendar?days=${days}`),
  syncTasks: () => j('/tasks/sync', json('POST')),

  // Mail. Straight from Gmail rather than through the connector -- the
  // connector answers in prose written for a model, see backend/mail/gmail.py.
  userProfile: () => j('/user/profile'),
  updateUserProfile: (profile) => j('/user/profile', json('POST', profile)),
  updateProfile: (profile) => j('/user/profile', json('POST', profile)),
  mailAccount: () => j('/mail/account'),
  mailThreads: ({ q = 'in:inbox', limit = 25 } = {}) =>
    j(`/mail/threads?q=${encodeURIComponent(q)}&limit=${limit}`),
  mailThread: (id) => j(`/mail/threads/${encodeURIComponent(id)}`),
  mailReply: (id, body) => j(`/mail/threads/${encodeURIComponent(id)}/reply`, json('POST', { body })),
  mailLabels: () => j('/mail/labels'),
  mailModifyLabels: (messageId, patch) =>
    j(`/mail/messages/${encodeURIComponent(messageId)}/labels`, json('POST', patch)),
  createTask: (body) => j('/tasks', json('POST', body)),
  updateTask: (id, patch) => j(`/tasks/${id}`, json('PATCH', patch)),
  deleteTask: (id) => j(`/tasks/${id}`, json('DELETE')),

  // A browser cannot hand the agent a path, so the file is uploaded first and
  // the message carries where it landed.
  upload: async (file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${getBase()}/attachments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    })
    if (!res.ok) {
      let detail = res.statusText
      try { detail = (await res.json()).detail || detail } catch { /* keep statusText */ }
      throw new Error(`${res.status}: ${detail}`)
    }
    return res.json()
  },
  skillSearch: (q, conversationId) =>
    j(`/skills/search?q=${encodeURIComponent(q)}${conversationId ? `&conversation_id=${encodeURIComponent(conversationId)}` : ''}`),

  capabilities: (conversationId) =>
    j(`/capabilities${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''}`),
  toggleCapability: (kind, name, enabled, conversationId) =>
    j(`/capabilities/${kind}/${encodeURIComponent(name)}`, json('POST', { enabled, conversation_id: conversationId || null })),
  resetCapability: (kind, name, conversationId) =>
    j(`/capabilities/${kind}/${encodeURIComponent(name)}?${conversationId ? `conversation_id=${encodeURIComponent(conversationId)}` : ''}`, json('DELETE')),

  capabilityProfiles: () => j('/capabilities/profiles'),
  saveCapabilityProfile: (name, conversationId) =>
    j('/capabilities/profiles', json('POST', { name, conversation_id: conversationId || null })),
  applyCapabilityProfile: (name, conversationId) =>
    j(`/capabilities/profiles/${encodeURIComponent(name)}/apply`, json('POST', { conversation_id: conversationId })),
  deleteCapabilityProfile: (name) =>
    j(`/capabilities/profiles/${encodeURIComponent(name)}`, json('DELETE')),

  mcpCatalogue: () => j('/mcp/catalogue'),
  // `accounts` asks each connector who it is signed in as, which can cost a
  // network round trip — so the 3s poll never asks, and the detail panel does.
  mcpServers: (accounts = false) => j(`/mcp/servers${accounts ? '?accounts=true' : ''}`),
  mcpAdd: (body) => j('/mcp/servers', json('POST', body)),
  mcpRemove: (name) => j(`/mcp/servers/${encodeURIComponent(name)}`, json('DELETE')),
  mcpOauthClient: (name, body) =>
    j(`/mcp/servers/${encodeURIComponent(name)}/oauth-client`, json('POST', body)),
  mcpSetEnv: (name, body) => j(`/mcp/servers/${encodeURIComponent(name)}/env`, json('POST', body)),
  mcpUnsetEnv: (name, key) =>
    j(`/mcp/servers/${encodeURIComponent(name)}/env/${encodeURIComponent(key)}`, json('DELETE')),
  // `force` signs out first, so the provider shows its account chooser rather
  // than silently handing back the session it already has.
  mcpLogin: (name, { force = false, accountHint = null } = {}) =>
    j(`/mcp/servers/${encodeURIComponent(name)}/login`,
      json('POST', { force, account_hint: accountHint })),
  mcpCancelLogin: (name) => j(`/mcp/servers/${encodeURIComponent(name)}/login`, json('DELETE')),
  mcpLogout: (name) => j(`/mcp/servers/${encodeURIComponent(name)}/logout`, json('POST', {})),
  mcpAuthorizations: () => j('/mcp/authorizations'),
  // Start every switched-on connector now, the way the first turn would.
  mcpReconcile: () => j('/mcp/reconcile', json('POST', {})),
  mcpConnect: (name) =>
    j(`/mcp/servers/${encodeURIComponent(name)}/connect`, json('POST', {})),

  // One read for the whole Today page: the day's events, what is owed, what is
  // unread, what was logged, and this morning's briefing. `degraded` names any
  // section that could not be read, so the page says so instead of showing a
  // zero nobody measured.
  today: () => j('/today'),

  journal: (kind) => j(`/journal${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
  journalEntry: (id) => j(`/journal/${id}`),
  // `force` rewrites an entry that already exists — the Regenerate button.
  generateJournal: (kind, { date = null, force = false } = {}) =>
    j(`/journal/${encodeURIComponent(kind)}/generate?force=${force ? 'true' : 'false'}`
      + (date ? `&entry_date=${encodeURIComponent(date)}` : ''), json('POST')),
  // The check-in answers. Stored before the model runs, so a provider that
  // fails costs the write-up and never what was typed.
  answerJournal: (id, userNotes) => j(`/journal/${id}`, json('PATCH', { user_notes: userNotes })),
  deleteJournal: (id) => j(`/journal/${id}`, json('DELETE')),

  // With `q`, a hybrid search over captured text; without it, the most recent
  // items. Both come back as items rather than passages.
  library: ({ q = '', kind = '', category = '', tag = '', order = 'desc', limit = 50, offset = 0 } = {}) =>
    j(`/library?limit=${limit}&offset=${offset}`
      + (q ? `&q=${encodeURIComponent(q)}` : '')
      + (kind ? `&kind=${encodeURIComponent(kind)}` : '')
      + (category ? `&category=${encodeURIComponent(category)}` : '')
      + (tag ? `&tag=${encodeURIComponent(tag)}` : '')
      + (order ? `&order=${encodeURIComponent(order)}` : '')),
  libraryItem: (id) => j(`/library/${id}`),
  addLibraryItem: (body) => j('/library', json('POST', body)),
  updateLibraryItem: (id, patch) => j(`/library/${id}`, json('PATCH', patch)),
  deleteLibraryItem: (id) => j(`/library/${id}`, json('DELETE')),
  // Clears the process-wide "that embedder refused" cache first, so starting
  // Ollama and pressing this is enough — no restart.
  reindexLibraryItem: (id) => j(`/library/${id}/reindex`, json('POST')),

  // Voice, values, palette, fonts. The response carries `prompt_block`: the
  // literal text the model will be handed, so the effect is visible.
  brand: () => j('/brand'),
  saveBrand: (body) => j('/brand', json('PUT', body)),

  // Enrichment is the mirror of reindex: "add a provider and press this".
  enrichLibraryItem: (id) => j(`/library/${id}/enrich`, json('POST')),
  // A route rather than a path: the browser is never handed a filesystem
  // location, and a missing still is a 404 rather than a broken <img>.
  thumbnailUrl: (id) => `${getBase()}/library/${id}/thumbnail`,
  mediaUrl: (id) => `${getBase()}/library/${id}/media`,

  // Export selected library items as a Spotify playlist via the MCP connector.
  exportPlaylist: (itemIds, name = '') =>
    j('/library/export-playlist', json('POST', { item_ids: itemIds, name })),

  // Instagram capture. Credentials go one way only — set and delete; the status
  // reports whether each is present, never what it is.
  instagram: () => j('/instagram'),
  saveInstagramCredentials: (body) => j('/instagram/credentials', json('PUT', body)),
  clearInstagramCredentials: () => j('/instagram/credentials', json('DELETE')),
  updateInstagram: (patch) => j('/instagram/settings', json('PATCH', patch)),
  allowInstagramSender: (id) => j(`/instagram/senders/${encodeURIComponent(id)}`, json('POST')),
  denyInstagramSender: (id) => j(`/instagram/senders/${encodeURIComponent(id)}`, json('DELETE')),
  setInstagramRelay: (body) => j('/instagram/relay', json('PUT', body)),
  clearInstagramRelay: () => j('/instagram/relay', json('DELETE')),
  syncInstagramRelay: () => j('/instagram/relay/sync', json('POST')),
  instagramEvents: () => j('/instagram/events'),
  retryInstagramEvent: (id) => j(`/instagram/events/${id}/retry`, json('POST')),

  // Sharing is off until a token exists. The token comes back exactly once,
  // from `rotateShareToken`, and nothing reads it out of the keychain again.
  shareStatus: () => j('/share'),
  rotateShareToken: () => j('/share/token', json('POST')),
  revokeShareToken: () => j('/share/token', json('DELETE')),

  // Spotlight search endpoints (Damon)
  searchWeb: (q, limit = 8, signal, offset = 0) =>
    j(`/search/web?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`, { signal }),
  searchYouTube: (q, limit = 8, signal, offset = 0, sort = 'relevance') =>
    j(`/search/youtube?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&sort=${sort}`, { signal }),
  searchImages: (q, limit = 12, signal) =>
    j(`/search/images?q=${encodeURIComponent(q)}&limit=${limit}`, { signal }),
  searchGitHub: (q, limit = 6, signal) =>
    j(`/search/github?q=${encodeURIComponent(q)}&limit=${limit}`, { signal }),
  searchWiki: (q, signal) =>
    j(`/search/wiki?q=${encodeURIComponent(q)}`, { signal }),
  // Which web-search API is set up, and setting one. Write-only for the key
  // itself: the GET says a provider has one, never what it is.
  searchProvider: () => j('/search/provider'),
  setSearchProvider: (name, key) =>
    j('/search/provider', { method: 'PUT', body: JSON.stringify({ name, key }) }),
  // The palette passes the article list and wiki card it already shows as
  // the evidence, so an answer never re-searches what is already on screen.
  // `wiki` is only sent when the caller decided it: `null` means "no wiki
  // for this", `undefined` means "you decide".
  searchAnswer: (q, signal, results = null, wiki = undefined) =>
    results
      ? j('/search/answer?q=' + encodeURIComponent(q), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wiki === undefined ? { results } : { results, wiki }),
          signal,
        })
      : j(`/search/answer?q=${encodeURIComponent(q)}`, { signal }),
}


/** Parse a timestamp the *server* wrote, which is UTC and does not say so.
 *
 *  Every `created_at` and `updated_at` in this schema comes from SQLite's
 *  `datetime('now')`, which is UTC and has no offset on it. JavaScript reads a
 *  bare `YYYY-MM-DD HH:MM:SS` as *local*, so a conversation from a minute ago
 *  showed up hours old -- five and a half of them on the machine this was found
 *  on, and never on the machine of anyone in London, which is why it survived.
 *  A value that already carries an offset is left alone.
 *
 *  This is only for those columns. Task dates -- `due_at`, `reminder_at`,
 *  `scheduled_at`, `completed_at` -- are written with `datetime.now()` and are
 *  genuinely local; putting them through here would break them the other way.
 */
export function serverTime(value) {
  if (!value) return null
  const text = String(value).trim()
  const bare = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)
  const d = new Date(bare ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtTime(iso) {
  const d = serverTime(iso)
  if (!d) return iso || ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function fmtDate(iso) {
  const d = serverTime(iso)
  if (!d) return iso || ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function prettyJSON(value) {
  try {
    return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2)
  } catch {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
}

/** Copy text, falling back when the Clipboard API is unavailable.
 *
 *  `navigator.clipboard` exists only in a secure context. Loopback counts, but
 *  the moment someone serves this to another machine over plain http it is
 *  gone -- and a copy button that silently does nothing is worse than one that
 *  says it failed. Resolves to whether the text actually made it.
 */
export async function copyText(text) {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* denied, or no permission: fall through to the old mechanism */
  }
  try {
    const holder = document.createElement('textarea')
    holder.value = text
    holder.setAttribute('readonly', '')
    holder.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(holder)
    holder.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(holder)
    return ok
  } catch {
    return false
  }
}

/** Open a link from wherever the interface is running.
 *
 *  In a browser tab, `window.open` is the right call. In the frameless
 *  pywebview spotlight it is a silent no-op -- WebKitGTK has no new-window
 *  policy for a frameless window, so a clicked result did nothing at all.
 *  The bridge hands the URL to the OS browser instead, which is where a
 *  link from a floating bar always belonged.
 */
export function openUrl(url) {
  if (!url) return
  if (window.pywebview?.api?.open_external) {
    window.pywebview.api.open_external(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}
