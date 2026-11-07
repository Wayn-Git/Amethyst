import { safeStorage } from '../lib/storage.js'
import { httpGet, httpPost } from './nativeHttp.js'
import { sanitizeErrorMessage, parseRetryAfter } from './shareJob.js'

const COMPOSIO_BASE_URL = 'https://backend.composio.dev'

/**
 * Build proper auth headers for Composio API.
 * Never logs or prints API keys.
 */
function getComposioHeaders(apiKey) {
  if (!apiKey) return {}
  const isUserKey = apiKey.startsWith('uak_') || apiKey.startsWith('uak-')
  return {
    'content-type': 'application/json',
    ...(isUserKey ? { 'x-user-api-key': apiKey } : { 'x-api-key': apiKey }),
  }
}

/**
 * Execute a tool on the Composio API.
 */
export async function executeComposioTool({
  composioConfig,
  toolSlug,
  args,
  http = httpPost,
}) {
  if (!composioConfig || !composioConfig.api_key) {
    const err = new Error('Reconnect Google Drive on the PC')
    err.authError = true
    err.source = 'composio'
    throw err
  }

  const apiKey = composioConfig.api_key
  const userId = composioConfig.user_id

  const res = await http({
    url: `${COMPOSIO_BASE_URL}/api/v3.1/tools/execute/${toolSlug}`,
    headers: getComposioHeaders(apiKey),
    data: {
      arguments: args,
      user_id: userId,
      dangerously_skip_version_check: true,
    },
  })

  // 1. Check for 401 / 403 on Composio
  if (res.status === 401 || res.status === 403) {
    const err = new Error('Reconnect Google Drive on the PC')
    err.authError = true
    err.source = 'composio'
    throw err
  }

  // 2. Check for 429 Rate Limit
  if (res.status === 429) {
    const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
    const delayMs = parseRetryAfter(retryHeader)
    const err = new Error('Composio rate limit reached (429). Retrying soon.')
    err.isRateLimit = true
    err.retryAfterMs = delayMs
    err.source = 'composio'
    throw err
  }

  // 3. Other HTTP errors
  if (res.status >= 400) {
    const rawMsg =
      res.data?.error ||
      res.data?.message ||
      `Composio tool ${toolSlug} failed with status ${res.status}`
    const sanitized = sanitizeErrorMessage(typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg))
    const err = new Error(sanitized)
    if (/unauthori|invalid api key|forbidden|expired|token/i.test(sanitized)) {
      err.authError = true
      err.message = 'Reconnect Google Drive on the PC'
      err.source = 'composio'
    }
    throw err
  }

  // 4. In-body error flags from Composio tool execution
  if (res.data && res.data.successful === false) {
    const errorDetail = sanitizeErrorMessage(res.data.error || 'Unknown Composio error')
    const err = new Error(`Composio action ${toolSlug} failed: ${errorDetail}`)
    if (/unauthori|invalid api key|forbidden|expired|token/i.test(errorDetail)) {
      err.authError = true
      err.message = 'Reconnect Google Drive on the PC'
      err.source = 'composio'
    }
    throw err
  }

  return res.data?.data || res.data
}

/**
 * Check whether a specific file already exists inside a given Google Drive folder.
 */
export async function checkFileExists({
  composioConfig,
  folderId,
  fileName,
  http = httpPost,
}) {
  if (!folderId || !fileName) return null

  const query = `'${folderId}' in parents and name = '${fileName}' and trashed = false`
  try {
    const findRes = await executeComposioTool({
      composioConfig,
      toolSlug: 'GOOGLEDRIVE_FIND_FILE',
      args: { q: query },
      http,
    })

    const files = findRes?.files || []
    if (Array.isArray(files) && files.length > 0 && files[0].id) {
      return files[0]
    }
  } catch (err) {
    if (err.authError || err.isRateLimit) throw err
    // Non-fatal if search query fails; proceed to normal write path
  }
  return null
}

/**
 * Ensure <root>/summaries/ folder exists in Google Drive.
 * Caches folder ID to avoid repeated round trips.
 */
export async function ensureSummariesFolder({
  composioConfig,
  rootFolderId,
  http = httpPost,
}) {
  if (!rootFolderId) {
    throw new Error('Google Drive root folder ID is missing.')
  }

  const cacheKey = `amethyst.drive.summaries_folder.${rootFolderId}`
  const cached = safeStorage.getItem(cacheKey)
  if (cached) return cached

  // 1. Find existing 'summaries' folder under root
  const query = `'${rootFolderId}' in parents and name = 'summaries' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  try {
    const findRes = await executeComposioTool({
      composioConfig,
      toolSlug: 'GOOGLEDRIVE_FIND_FILE',
      args: { q: query },
      http,
    })

    const files = findRes?.files || []
    if (Array.isArray(files) && files.length > 0 && files[0].id) {
      safeStorage.setItem(cacheKey, files[0].id)
      return files[0].id
    }
  } catch (findErr) {
    if (findErr.authError || findErr.isRateLimit) throw findErr
  }

  // 2. Create 'summaries' folder if not found
  const createRes = await executeComposioTool({
    composioConfig,
    toolSlug: 'GOOGLEDRIVE_CREATE_FOLDER',
    args: {
      name: 'summaries',
      parent_id: rootFolderId,
    },
    http,
  })

  const newId = createRes?.id
  if (newId) {
    safeStorage.setItem(cacheKey, newId)
    return newId
  }

  throw new Error('Could not resolve or create summaries folder on Google Drive.')
}

/**
 * Write completed summary markdown to Google Drive at <root>/summaries/<jobId>.md.
 * Checks if the file already exists first; if so, skips creation and returns alreadyExists.
 */
export async function writeSummaryToDrive({
  composioConfig,
  driveConfig,
  jobId,
  content,
  http = httpPost,
}) {
  const summariesFolderId = await ensureSummariesFolder({
    composioConfig,
    rootFolderId: driveConfig.root_folder_id,
    http,
  })

  const fileName = `${jobId}.md`

  // 1. Idempotency check: check if <id>.md already exists in summaries/
  const existing = await checkFileExists({
    composioConfig,
    folderId: summariesFolderId,
    fileName,
    http,
  })
  if (existing) {
    return { alreadyExists: true, id: existing.id, name: fileName }
  }

  // 2. Write file
  const res = await executeComposioTool({
    composioConfig,
    toolSlug: 'GOOGLEDRIVE_CREATE_FILE_FROM_TEXT',
    args: {
      file_name: fileName,
      text_content: content,
      parent_id: summariesFolderId,
    },
    http,
  })

  return { alreadyExists: false, ...res }
}

/**
 * Write inbox job JSON to Google Drive at <root>/inbox/<jobId>.json for PC drainer.
 * Checks if the file already exists first; if so, skips creation and returns alreadyExists.
 */
export async function writeInboxJobToDrive({
  composioConfig,
  driveConfig,
  inboxJob,
  http = httpPost,
}) {
  if (!driveConfig || !driveConfig.inbox_folder_id) {
    throw new Error('Google Drive inbox folder ID is not configured.')
  }

  const fileName = `${inboxJob.id}.json`

  // 1. Idempotency check: check if <id>.json already exists in inbox/
  const existing = await checkFileExists({
    composioConfig,
    folderId: driveConfig.inbox_folder_id,
    fileName,
    http,
  })
  if (existing) {
    return { alreadyExists: true, id: existing.id, name: fileName }
  }

  // 2. Write file
  const res = await executeComposioTool({
    composioConfig,
    toolSlug: 'GOOGLEDRIVE_CREATE_FILE_FROM_TEXT',
    args: {
      file_name: fileName,
      text_content: JSON.stringify(inboxJob, null, 2),
      parent_id: driveConfig.inbox_folder_id,
    },
    http,
  })

  return { alreadyExists: false, ...res }
}

/**
 * List connected toolkits for this user_id from Composio API.
 * GET /api/v3.1/connected_accounts?user_ids=<user_id>
 */
export async function listConnectedToolkits({
  composioConfig,
  http = httpGet,
}) {
  if (!composioConfig || !composioConfig.api_key) {
    const err = new Error('Reconnect Google Drive on the PC')
    err.authError = true
    err.source = 'composio'
    throw err
  }

  const apiKey = composioConfig.api_key
  const userId = composioConfig.user_id
  const url = `${COMPOSIO_BASE_URL}/api/v3.1/connected_accounts?user_ids=${encodeURIComponent(userId || '')}&limit=50`

  const res = await http({
    url,
    headers: getComposioHeaders(apiKey),
  })

  if (res.status === 401 || res.status === 403) {
    const err = new Error('Reconnect Google Drive on the PC')
    err.authError = true
    err.source = 'composio'
    throw err
  }

  if (res.status === 429) {
    const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
    const delayMs = parseRetryAfter(retryHeader)
    const err = new Error('Composio rate limit reached (429). Retrying soon.')
    err.isRateLimit = true
    err.retryAfterMs = delayMs
    err.source = 'composio'
    throw err
  }

  if (res.status >= 400) {
    return []
  }

  const items = res.data?.items || res.data?.connected_accounts || (Array.isArray(res.data) ? res.data : [])
  const toolkits = new Set()
  for (const item of items) {
    const status = item.status || item.connection_status
    if (status && status !== 'ACTIVE') continue
    const slug = item.toolkit?.slug || item.appUniqueId || item.appName || item.app
    if (slug) toolkits.add(slug.toLowerCase())
  }
  return Array.from(toolkits)
}

/**
 * List available tools for a given toolkit slug from Composio API.
 * GET /api/v3.1/tools?toolkit_slug=<slug>
 */
export async function listToolsForToolkit({
  composioConfig,
  toolkitSlug,
  http = httpGet,
}) {
  if (!composioConfig || !composioConfig.api_key) {
    const err = new Error('Reconnect Google Drive on the PC')
    err.authError = true
    err.source = 'composio'
    throw err
  }

  const apiKey = composioConfig.api_key
  const url = `${COMPOSIO_BASE_URL}/api/v3.1/tools?toolkit_slug=${encodeURIComponent(toolkitSlug)}&limit=50`

  const res = await http({
    url,
    headers: getComposioHeaders(apiKey),
  })

  if (res.status === 401 || res.status === 403) {
    const err = new Error('Reconnect Google Drive on the PC')
    err.authError = true
    err.source = 'composio'
    throw err
  }

  if (res.status === 429) {
    const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
    const delayMs = parseRetryAfter(retryHeader)
    const err = new Error('Composio rate limit reached (429). Retrying soon.')
    err.isRateLimit = true
    err.retryAfterMs = delayMs
    err.source = 'composio'
    throw err
  }

  if (res.status >= 400) {
    return []
  }

  const items = res.data?.items || (Array.isArray(res.data) ? res.data : [])
  return items
}

/**
 * List all available tools across connected toolkits for this user_id.
 */
export async function listAvailableTools({
  composioConfig,
  http = httpGet,
}) {
  if (!composioConfig || !composioConfig.api_key) {
    const err = new Error('Reconnect Google Drive on the PC')
    err.authError = true
    err.source = 'composio'
    throw err
  }

  let toolkits = []
  try {
    toolkits = await listConnectedToolkits({ composioConfig, http })
  } catch (err) {
    if (err.authError || err.isRateLimit) throw err
    // If listing fails, fallback to googledrive which is always in bundle
    toolkits = ['googledrive']
  }

  if (toolkits.length === 0) {
    toolkits = ['googledrive']
  }

  const allTools = []
  for (const slug of toolkits) {
    try {
      const tools = await listToolsForToolkit({ composioConfig, toolkitSlug: slug, http })
      if (Array.isArray(tools)) {
        allTools.push(...tools)
      }
    } catch (err) {
      if (err.authError || err.isRateLimit) throw err
      // Ignore individual toolkit failure
    }
  }

  return allTools
}

