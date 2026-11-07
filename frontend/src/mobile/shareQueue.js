import { safeStorage } from '../lib/storage.js'
import { getBundle } from './bundle.js'
import { httpGet, httpPost } from './nativeHttp.js'
import {
  buildJobId,
  routeJob,
  extractPageText,
  formatSummaryMarkdown,
  formatInboxJob,
  sanitizeErrorMessage,
  DEFAULT_MAX_ARTICLE_CHARS,
} from './shareJob.js'
import { summarizeWithLlm, resolveProviderConfig } from './llmClient.js'
import { writeSummaryToDrive, writeInboxJobToDrive } from './composioClient.js'

export const SHARE_QUEUE_STORAGE_KEY = 'amethyst.mobile.share_queue'

const BASE_BACKOFF_MS = 5000 // 5 seconds
const MAX_BACKOFF_MS = 600000 // 10 minutes

let queueState = []
let queueLoaded = false
const subscribers = new Set()
let isProcessing = false
let tickTimer = null

/**
 * Notify all UI subscribers of queue changes.
 */
function notifySubscribers() {
  const snapshot = [...queueState]
  for (const sub of subscribers) {
    try {
      sub(snapshot)
    } catch {
      // Ignore subscriber callback errors
    }
  }
}

/**
 * Load queue from persistent storage.
 */
export function loadPersistedQueue() {
  try {
    const raw = safeStorage.getItem(SHARE_QUEUE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        // If app was killed while a job was 'processing', reset state to 'queued'
        queueState = parsed.map((job) => {
          if (job.state === 'processing') {
            return { ...job, state: 'queued', progress: 'Resuming after app restart…' }
          }
          return { ...job }
        })
        queueLoaded = true
        return queueState
      }
    }
  } catch {
    // If parse fails, reset to empty
  }
  queueState = []
  queueLoaded = true
  return queueState
}

/**
 * Persist queue to storage.
 */
export function persistQueue() {
  try {
    safeStorage.setItem(SHARE_QUEUE_STORAGE_KEY, JSON.stringify(queueState))
  } catch {
    // Non-blocking in restricted storage
  }
}

/**
 * Calculate exponential backoff with jitter.
 * Never retries in a tight loop.
 */
export function calculateBackoffMs(attempts) {
  const safeAttempts = Math.max(1, attempts)
  const exponential = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * Math.pow(2, safeAttempts - 1)
  )
  // Jitter factor between 0.85 and 1.15 (+/- 15%)
  const jitter = 0.85 + Math.random() * 0.3
  return Math.round(Math.max(BASE_BACKOFF_MS, exponential * jitter))
}

/**
 * Get all current jobs (sorted newest first).
 */
export function getShareJobs() {
  if (!queueLoaded) {
    loadPersistedQueue()
  }
  return [...queueState].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

/**
 * Get job by ID.
 */
export function getShareJob(id) {
  if (!queueLoaded) {
    loadPersistedQueue()
  }
  return queueState.find((j) => j.id === id) || null
}

/**
 * Enqueue a shared item.
 * Deduplicates by hash: if the job already exists, returns existing job.
 */
export async function enqueueShare(sharedText, { autoProcess = true } = {}) {
  if (!sharedText || typeof sharedText !== 'string' || !sharedText.trim()) {
    throw new Error('Shared content is empty.')
  }

  if (!queueLoaded) {
    loadPersistedQueue()
  }

  const rawText = sharedText.trim()
  const id = buildJobId(rawText)
  const routed = routeJob(rawText)

  // 1. Deduplication check
  const existingIndex = queueState.findIndex((j) => j.id === id)
  if (existingIndex >= 0) {
    const existing = queueState[existingIndex]
    // If completed or currently active, return existing without re-triggering
    if (existing.state === 'completed' || existing.state === 'processing') {
      return existing
    }
    // If previously failed, reset to queued so it can retry
    const updated = {
      ...existing,
      state: 'queued',
      progress: 'Retrying shared content…',
      nextRetryAt: 0,
      updatedAt: new Date().toISOString(),
    }
    queueState[existingIndex] = updated
    persistQueue()
    notifySubscribers()
    if (autoProcess) triggerQueueProcessing()
    return updated
  }

  // 2. Check for unsupported URL scheme
  if (routed.route === 'unsupported') {
    const unsupportedJob = {
      id,
      rawText,
      url: routed.targetUrl,
      canonicalUrl: routed.canonicalUrl,
      text: routed.rawText,
      route: 'unsupported',
      kind: 'unknown',
      state: 'failed',
      progress: routed.error || 'Unsupported content',
      error: routed.error || 'Unsupported content',
      authError: false,
      attempts: 1,
      nextRetryAt: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: null,
    }
    queueState.unshift(unsupportedJob)
    persistQueue()
    notifySubscribers()
    return unsupportedJob
  }

  // 3. Create fresh job
  const job = {
    id,
    rawText,
    url: routed.targetUrl, // ORIGINAL URL!
    canonicalUrl: routed.canonicalUrl,
    text: routed.rawText,
    route: routed.route,
    kind: routed.kind,
    state: 'queued',
    progress: 'Queued for processing…',
    error: null,
    authError: false,
    authSource: null,
    attempts: 0,
    nextRetryAt: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary: null,
  }

  queueState.unshift(job)
  persistQueue()
  notifySubscribers()

  // 4. Immediately kick off queue processing
  if (autoProcess) triggerQueueProcessing()
  return job
}

/**
 * Manual retry for a failed job.
 */
export async function retryShareJob(id) {
  if (!queueLoaded) loadPersistedQueue()
  const job = queueState.find((j) => j.id === id)
  if (!job) return null

  job.state = 'queued'
  job.authError = false
  job.authSource = null
  job.error = null
  job.nextRetryAt = 0
  job.progress = 'Retrying…'
  job.updatedAt = new Date().toISOString()

  persistQueue()
  notifySubscribers()
  triggerQueueProcessing()
  return job
}

/**
 * Remove a job from the queue.
 */
export function removeShareJob(id) {
  if (!queueLoaded) loadPersistedQueue()
  queueState = queueState.filter((j) => j.id !== id)
  persistQueue()
  notifySubscribers()
}

/**
 * Clear all completed jobs.
 */
export function clearCompletedShareJobs() {
  if (!queueLoaded) loadPersistedQueue()
  queueState = queueState.filter((j) => j.state !== 'completed')
  persistQueue()
  notifySubscribers()
}

/**
 * Clear entire queue (used in tests or reset).
 */
export function clearAllShareJobs() {
  queueState = []
  persistQueue()
  notifySubscribers()
}

/**
 * Subscribe to queue changes.
 * Returns unsubscribe function.
 */
export function subscribeShareQueue(listener) {
  subscribers.add(listener)
  if (!queueLoaded) loadPersistedQueue()
  listener([...queueState])
  return () => subscribers.delete(listener)
}

/**
 * Update job progress helper.
 */
function updateJobProgress(id, progress) {
  const job = queueState.find((j) => j.id === id)
  if (job) {
    job.progress = progress
    job.updatedAt = new Date().toISOString()
    persistQueue()
    notifySubscribers()
  }
}

/**
 * Process a single share job.
 */
export async function processJob(job, {
  bundleResolver = getBundle,
  httpClientGet = httpGet,
  httpClientPost = httpPost,
  maxArticleChars = DEFAULT_MAX_ARTICLE_CHARS,
} = {}) {
  job.state = 'processing'
  job.attempts += 1
  job.updatedAt = new Date().toISOString()
  updateJobProgress(job.id, 'Starting share job…')

  try {
    // 1. Check pairing bundle
    const bundle = await bundleResolver()
    if (!bundle || !bundle.device_id) {
      const err = new Error('Re-scan QR on your PC')
      err.authError = true
      err.source = 'bundle'
      throw err
    }

    if (job.route === 'summary') {
      // 2. Summary route (articles or plain text)
      let contentToSummarize = job.rawText
      let pageTitle = ''
      let wasTruncated = false

      if (job.url) {
        updateJobProgress(job.id, 'Fetching article text…')
        try {
          // Fetch with ORIGINAL URL (Item 6)
          const pageRes = await httpClientGet({ url: job.url })

          // IMPORTANT (Item 2): Article fetch 401/403/404/5xx must NOT set authError
          if (pageRes && pageRes.status >= 200 && pageRes.status < 300 && pageRes.data) {
            // Strip HTML and cap article text (Item 3)
            const parsed = extractPageText(pageRes.data, { maxChars: maxArticleChars })
            if (parsed.text && parsed.text.length > 50) {
              contentToSummarize = parsed.text
              pageTitle = parsed.title || ''
              wasTruncated = parsed.wasTruncated
            }
          } else {
            // Paywall, login wall, 404, or 5xx: fall back to raw URL without setting authError
            updateJobProgress(
              job.id,
              `Page returned HTTP ${pageRes?.status || 'error'}; summarizing link…`
            )
          }
        } catch {
          // Network timeout or unreachable: fall back to raw URL
          updateJobProgress(job.id, 'Page fetch unreachable; summarizing link…')
        }
      }

      const activeLlm = resolveProviderConfig(bundle.llm)
      const modelName = activeLlm?.model || bundle.llm?.model || 'LLM'
      updateJobProgress(job.id, `Generating summary with ${modelName}…`)

      const summaryText = await summarizeWithLlm({
        llmConfig: bundle.llm,
        prompt: bundle.prompts?.summary,
        text: contentToSummarize,
        title: pageTitle,
        url: job.url || '',
        http: httpClientPost,
      })

      if (!summaryText || !summaryText.trim()) {
        throw new Error('LLM returned an empty summary.')
      }

      updateJobProgress(job.id, 'Saving summary to Google Drive…')
      const markdown = formatSummaryMarkdown({
        title: pageTitle,
        url: job.url || '',
        summaryText,
        processedAt: new Date().toUTCString(),
        wasTruncated,
        maxChars: maxArticleChars,
      })

      const driveRes = await writeSummaryToDrive({
        composioConfig: bundle.composio,
        driveConfig: bundle.drive,
        jobId: job.id,
        content: markdown,
        http: httpClientPost,
      })

      job.state = 'completed'
      job.progress = driveRes.alreadyExists
        ? `Found existing summaries/${job.id}.md (skipped)`
        : `Saved to summaries/${job.id}.md`
      job.summary = summaryText
      job.error = null
      job.authError = false
      job.authSource = null
      job.updatedAt = new Date().toISOString()
      persistQueue()
      notifySubscribers()
      return true
    } else if (job.route === 'inbox') {
      // 3. PC Inbox route (Instagram, YouTube, Reddit, Twitter, Threads, etc.)
      updateJobProgress(job.id, 'Uploading to PC inbox…')

      const inboxJob = formatInboxJob({
        id: job.id,
        kind: job.kind || 'video',
        url: job.url, // ORIGINAL URL!
        text: job.rawText,
        createdAt: job.createdAt,
      })

      const driveRes = await writeInboxJobToDrive({
        composioConfig: bundle.composio,
        driveConfig: bundle.drive,
        inboxJob,
        http: httpClientPost,
      })

      job.state = 'completed'
      job.progress = driveRes.alreadyExists
        ? `Found existing inbox/${job.id}.json (skipped)`
        : 'Sent to PC inbox for video processing'
      job.error = null
      job.authError = false
      job.authSource = null
      job.updatedAt = new Date().toISOString()
      persistQueue()
      notifySubscribers()
      return true
    } else {
      throw new Error(job.error || 'Unsupported job route')
    }
  } catch (err) {
    const isRate = Boolean(err.isRateLimit)
    const isAuth = Boolean(err.authError)

    job.state = 'failed'
    job.authError = isAuth
    job.authSource = err.source || null

    if (isAuth) {
      // Classify error text by source (Item 2)
      if (err.source === 'composio') {
        job.error = 'Reconnect Google Drive on the PC'
      } else {
        job.error = 'Re-scan QR on your PC'
      }
      job.progress = job.error
      job.nextRetryAt = 0 // Never auto-retry auth errors in a loop
    } else if (isRate) {
      // 429 Rate Limit honoring Retry-After (Item 2)
      const delayMs = err.retryAfterMs || 60000
      job.nextRetryAt = Date.now() + delayMs
      job.error = err.message
      const seconds = Math.round(delayMs / 1000)
      job.progress = `Rate limited (429). Retrying in ${seconds}s…`
    } else {
      // Transient error: exponential backoff with jitter
      job.error = sanitizeErrorMessage(err.message || 'Operation failed')
      const backoffMs = calculateBackoffMs(job.attempts)
      job.nextRetryAt = Date.now() + backoffMs
      const seconds = Math.round(backoffMs / 1000)
      job.progress = `Failed: ${job.error}. Retrying in ${seconds}s…`
    }

    job.updatedAt = new Date().toISOString()
    persistQueue()
    notifySubscribers()
    return false
  }
}

/**
 * Drain pending jobs in the queue sequentially.
 */
export async function processQueue(options = {}) {
  if (isProcessing) return
  isProcessing = true

  try {
    if (!queueLoaded) loadPersistedQueue()

    const now = Date.now()
    const eligibleJobs = queueState.filter((job) => {
      if (job.state === 'queued') return true
      if (job.state === 'failed' && !job.authError && job.nextRetryAt <= now) {
        return true
      }
      return false
    })

    for (const job of eligibleJobs) {
      await processJob(job, options)
    }
  } finally {
    isProcessing = false
  }
}

function triggerQueueProcessing() {
  processQueue().catch(() => {})
}

/**
 * Initialize share queue background loop and app state listener.
 */
export function initShareQueue(options = {}) {
  loadPersistedQueue()

  // Periodic tick for scheduled retries (every 5 seconds)
  if (!tickTimer && typeof setInterval !== 'undefined') {
    tickTimer = setInterval(() => {
      const now = Date.now()
      const hasDue = queueState.some(
        (j) => j.state === 'failed' && !j.authError && j.nextRetryAt > 0 && j.nextRetryAt <= now
      )
      if (hasDue) {
        processQueue(options).catch(() => {})
      }
    }, 5000)
  }

  // Trigger immediate drain for pending jobs
  triggerQueueProcessing()

  return () => {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  }
}
