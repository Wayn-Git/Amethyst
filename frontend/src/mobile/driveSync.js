import { safeStorage } from '../lib/storage.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const COMPOSIO_MCP_ENDPOINT = 'https://connect.composio.dev/mcp'
const DRIVE_HASH_INDEX_KEY = 'amethyst_drive_synced_hashes'

/**
 * Compute 16-hex item hash from canonical URL.
 */
export function computeItemHash(canonicalUrl) {
  const bytes = sha256(new TextEncoder().encode(canonicalUrl.trim()))
  return bytesToHex(bytes).slice(0, 16)
}

/**
 * Load local hash index of already-synced items to avoid search-before-create.
 */
export function getLocalDriveHashIndex() {
  try {
    const raw = safeStorage.getItem(DRIVE_HASH_INDEX_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed
      }
    }
  } catch {}
  return {}
}

/**
 * Save hash to local index.
 */
export function recordSyncedHash(itemHash, fileId) {
  const index = getLocalDriveHashIndex()
  index[itemHash] = {
    fileId,
    syncedAt: new Date().toISOString(),
  }
  try {
    safeStorage.setItem(DRIVE_HASH_INDEX_KEY, JSON.stringify(index))
  } catch {}
}

/**
 * Deterministic winner rule for duplicate Drive files.
 * Rule: Lowest (createdTime, fileId).
 */
export function pickDeterministicWinner(files) {
  if (!files || files.length === 0) return null
  return files.reduce((winner, current) => {
    if (!winner) return current
    const timeWin = new Date(winner.createdTime || 0).getTime()
    const timeCurr = new Date(current.createdTime || 0).getTime()
    if (timeCurr < timeWin) return current
    if (timeCurr > timeWin) return winner
    // Tie-breaker: lowest fileId lexicographically
    return (current.id || '').localeCompare(winner.id || '') < 0 ? current : winner
  }, null)
}

/**
 * Execute Composio MCP JSON-RPC call.
 */
async function callComposioMcp({ method, params, apiKey }) {
  if (!apiKey) throw new Error('Composio API key missing')

  const res = await fetch(COMPOSIO_MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-consumer-api-key': apiKey,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Composio MCP HTTP ${res.status}: ${text}`)
  }

  const rawText = await res.text()
  // Parse Server-Sent Events (SSE) data stream
  const lines = rawText.split('\n')
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim()
      if (dataStr) {
        try {
          const json = JSON.parse(dataStr)
          return json
        } catch {}
      }
    }
  }

  // Fallback direct JSON parse
  return JSON.parse(rawText)
}

/**
 * Find or resolve target Drive folder ID by name.
 */
let cachedFolderId = null
export async function resolveDriveFolderId({ folderName = 'amethyst-spike', apiKey }) {
  if (cachedFolderId) return cachedFolderId

  const searchRes = await callComposioMcp({
    method: 'tools/call',
    params: {
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments: {
        tools: [
          {
            tool_slug: 'GOOGLEDRIVE_FIND_FILE',
            arguments: {
              q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            },
          },
        ],
        sync_response_to_workbench: false,
      },
    },
    apiKey,
  })

  try {
    const content = searchRes?.result?.content?.[0]?.text
    if (content) {
      const inner = JSON.parse(content)
      const files = inner?.data?.results?.[0]?.response?.data?.files || []
      if (files.length > 0) {
        cachedFolderId = files[0].id
        return cachedFolderId
      }
    }
  } catch {}

  // If folder not found, create it
  const createRes = await callComposioMcp({
    method: 'tools/call',
    params: {
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments: {
        tools: [
          {
            tool_slug: 'GOOGLEDRIVE_CREATE_FOLDER',
            arguments: {
              folder_name: folderName,
            },
          },
        ],
        sync_response_to_workbench: false,
      },
    },
    apiKey,
  })

  try {
    const content = createRes?.result?.content?.[0]?.text
    if (content) {
      const inner = JSON.parse(content)
      const folder = inner?.data?.results?.[0]?.response?.data
      cachedFolderId = folder?.id || null
      return cachedFolderId
    }
  } catch {}

  return null
}

/**
 * Format combined JSON + Markdown payload for Google Drive.
 * File format: <sha256[:16]>.json containing metadata and markdown note together.
 */
export function formatDriveItemPayload(item) {
  const itemHash = computeItemHash(item.canonicalUrl || item.url)
  const markdownNote = `---
id: ${itemHash}
url: ${item.url}
saved_at: ${item.savedAt || new Date().toISOString()}
media_type: ${item.mediaType || 'unknown'}
song: ${item.music?.songName || 'None'}
artist: ${item.music?.artistName || 'None'}
tags: ${(item.tags || []).join(', ')}
---

# ${item.summary || item.caption?.slice(0, 60) || 'Saved Item'}

${item.summary ? `### Summary\n${item.summary}\n` : ''}
${item.transcript ? `### Transcript\n${item.transcript}\n` : ''}

### Caption
${item.caption || 'No caption'}

### Source
- [Platform Post](${item.url})
`

  const payload = {
    id: itemHash,
    canonicalUrl: item.canonicalUrl || item.url,
    originalUrl: item.url,
    savedAt: item.savedAt || new Date().toISOString(),
    mediaType: item.mediaType,
    owner: item.owner,
    music: item.music,
    summary: item.summary,
    transcript: item.transcript,
    tags: item.tags || [],
    resources: item.resources || [],
    slides: item.slides || [],
    status: item.status || 'ready',
    markdownNote,
  }

  return {
    fileName: `${itemHash}.json`,
    textContent: JSON.stringify(payload, null, 2),
    itemHash,
  }
}

/**
 * Sync batch of items to Google Drive in ONE multi-execute call.
 */
export async function syncItemsBatchToDrive({ items, folderName = 'amethyst-spike', apiKey }) {
  if (!items || items.length === 0) return { syncedCount: 0, skippedCount: 0, results: [] }

  const index = getLocalDriveHashIndex()
  const pendingItems = []
  let skippedCount = 0

  for (const item of items) {
    const hash = computeItemHash(item.canonicalUrl || item.url)
    if (index[hash]) {
      skippedCount += 1
    } else {
      pendingItems.push(item)
    }
  }

  if (pendingItems.length === 0) {
    return { syncedCount: 0, skippedCount, results: [] }
  }

  const folderId = await resolveDriveFolderId({ folderName, apiKey })

  const tools = pendingItems.slice(0, 50).map((item) => {
    const { fileName, textContent } = formatDriveItemPayload(item)
    const args = {
      file_name: fileName,
      text_content: textContent,
    }
    if (folderId) {
      args.parent_folder_id = folderId
    }
    return {
      tool_slug: 'GOOGLEDRIVE_CREATE_FILE_FROM_TEXT',
      arguments: args,
    }
  })

  const res = await callComposioMcp({
    method: 'tools/call',
    params: {
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments: {
        tools,
        sync_response_to_workbench: false,
      },
    },
    apiKey,
  })

  const results = []
  let syncedCount = 0

  try {
    const text = res?.result?.content?.[0]?.text
    if (text) {
      const parsed = JSON.parse(text)
      const executionResults = parsed?.data?.results || []
      for (let i = 0; i < executionResults.length; i++) {
        const exec = executionResults[i]
        const item = pendingItems[i]
        const hash = computeItemHash(item.canonicalUrl || item.url)
        const fileData = exec?.response?.data
        if (fileData?.id) {
          recordSyncedHash(hash, fileData.id)
          syncedCount += 1
          results.push({
            hash,
            fileId: fileData.id,
            status: 'synced',
          })
        } else {
          results.push({
            hash,
            status: 'failed',
            error: exec?.response?.error || 'Unknown write error',
          })
        }
      }
    }
  } catch (err) {
    throw new Error(`Drive batch sync parsing failed: ${err.message}`)
  }

  return {
    syncedCount,
    skippedCount,
    results,
  }
}
