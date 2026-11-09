/**
 * Tool Registry & Safety Classification for Mobile Agent.
 * All tool calls execute through composioClient.js.
 */

import { executeComposioTool, listAvailableTools } from '../composioClient.js'
import { sanitizeErrorMessage } from '../shareJob.js'

export const MAX_TOOL_RESULT_LENGTH = 8000

/**
 * Core Google Drive tool definitions available even offline or when
 * dynamic Composio catalog fetching is unavailable.
 */
export const CORE_DRIVE_TOOLS = [
  {
    name: 'GOOGLEDRIVE_FIND_FILE',
    description: 'Search for files or folders in Google Drive by query or name.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: "Google Drive search query, e.g. name contains 'notes' and trashed = false",
        },
      },
      required: ['q'],
    },
  },
  {
    name: 'GOOGLEDRIVE_CREATE_FILE_FROM_TEXT',
    description: 'Create a new text or markdown file in Google Drive.',
    parameters: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'Name of the file to create, e.g. notes.md' },
        text_content: { type: 'string', description: 'Plain text or markdown content of the file' },
        parent_id: { type: 'string', description: 'Target Google Drive folder ID (optional)' },
      },
      required: ['file_name', 'text_content'],
    },
  },
  {
    name: 'GOOGLEDRIVE_GET_FILE',
    description: 'Retrieve metadata or content of a specific file from Google Drive.',
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID' },
      },
      required: ['file_id'],
    },
  },
]

/**
 * Known write, destructive, or outbound verbs.
 * Any tool matching these requires explicit user confirmation before executing.
 */
const WRITE_VERBS = new Set([
  'send', 'delete', 'remove', 'trash', 'create', 'write',
  'update', 'patch', 'modify', 'move', 'share', 'upload',
  'post', 'put', 'execute', 'run', 'edit', 'destroy',
  'insert', 'drop', 'archive', 'revoke', 'invite',
])

/**
 * Known read-only verbs.
 */
const READ_VERBS = new Set([
  'find', 'get', 'list', 'search', 'read', 'fetch',
  'query', 'check', 'inspect', 'describe', 'view', 'show',
  'count', 'download',
])

/**
 * Classify whether a tool execution represents a write, destructive,
 * or outbound action requiring user confirmation.
 *
 * Examples:
 * - GOOGLEDRIVE_FIND_FILE -> false (read-only)
 * - GMAIL_FETCH_EMAILS -> false (read-only)
 * - GOOGLEDRIVE_CREATE_FILE_FROM_TEXT -> true (write)
 * - GMAIL_SEND_EMAIL -> true (write/outbound)
 * - GOOGLEDRIVE_DELETE_FILE -> true (destructive)
 */
export function isWriteAction(toolName, _args = {}) {
  if (!toolName) return true
  const lower = String(toolName).toLowerCase()

  // Tokenize by underscores, hyphens, and camelCase
  const tokens = lower
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .split(/[_-\s]+/)

  const hasWrite = tokens.some((t) => WRITE_VERBS.has(t)) ||
    Array.from(WRITE_VERBS).some((v) => lower.includes(v))

  const hasRead = tokens.some((t) => READ_VERBS.has(t)) ||
    Array.from(READ_VERBS).some((v) => lower.includes(v))

  // If action contains write indicators (even if it has read, e.g. create_or_get), treat as write
  if (hasWrite) return true
  if (hasRead) return false

  // Unknown tools default to requiring confirmation (fail-safe)
  return true
}

/**
 * Truncate large tool result payloads to prevent blowing LLM context/spend.
 */
export function truncateToolResult(content, maxChars = MAX_TOOL_RESULT_LENGTH) {
  const str = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  if (str.length <= maxChars) {
    return str
  }
  const excess = str.length - maxChars
  return `${str.slice(0, maxChars)}\n\n... [Tool result truncated: ${excess} characters omitted to save tokens]`
}

/**
 * Normalize Composio raw tool object into canonical tool schema.
 */
export function normalizeComposioTool(raw) {
  if (!raw) return null
  const slug = raw.slug || raw.name
  if (!slug) return null

  const description = raw.description || raw.name || slug
  const rawParams = raw.input_parameters || raw.parameters || {}

  let properties = {}
  let required = []

  if (rawParams.properties && typeof rawParams.properties === 'object') {
    properties = rawParams.properties
    required = Array.isArray(rawParams.required) ? rawParams.required : []
  } else if (rawParams.type === 'object' && !rawParams.properties) {
    properties = {}
    required = []
  } else {
    // Parameter dictionary format
    for (const [key, prop] of Object.entries(rawParams)) {
      if (key === 'type' && typeof prop === 'string') continue
      properties[key] = {
        type: prop?.type || 'string',
        description: prop?.description || '',
      }
      if (prop?.required === true) {
        required.push(key)
      }
    }
  }

  return {
    name: slug,
    description: description.split('\n')[0].slice(0, 300),
    parameters: {
      type: 'object',
      properties,
      required,
    },
  }
}

/**
 * Format canonical tools list into the provider-specific tool-calling format.
 */
export function formatToolsForProvider(tools = [], provider = 'anthropic') {
  const prov = (provider || '').toLowerCase()

  if (prov === 'anthropic') {
    return tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.parameters || { type: 'object', properties: {} },
    }))
  }

  if (prov === 'google' || prov === 'gemini') {
    return tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      parameters: {
        type: 'OBJECT',
        properties: t.parameters?.properties || {},
        required: t.parameters?.required || [],
      },
    }))
  }

  // OpenAI / OpenRouter / Groq format
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    parameters: t.parameters || { type: 'object', properties: {} },
  }))
}

let _toolsCache = new Map()
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function clearToolsCache() {
  _toolsCache.clear()
}

/**
 * Load available tools for the user_id from Composio, falling back
 * to core Drive tools if needed.
 */
export async function getToolsForUser({ composioConfig, http, forceRefresh = false }) {
  const toolMap = new Map()

  // 1. Add core drive tools first
  for (const t of CORE_DRIVE_TOOLS) {
    toolMap.set(t.name, t)
  }

  // 2. Fetch live connected tools from Composio if configured
  if (composioConfig?.api_key && composioConfig?.user_id) {
    const cacheKey = `${composioConfig.api_key}:${composioConfig.user_id}`
    const cached = _toolsCache.get(cacheKey)
    const now = Date.now()

    if (!forceRefresh && cached && (now - cached.timestamp < TOOLS_CACHE_TTL_MS)) {
      for (const t of cached.tools) {
        toolMap.set(t.name, t)
      }
      return Array.from(toolMap.values())
    }

    try {
      const rawTools = await listAvailableTools({ composioConfig, http })
      const composioTools = []
      if (Array.isArray(rawTools)) {
        for (const raw of rawTools) {
          const norm = normalizeComposioTool(raw)
          if (norm && norm.name) {
            toolMap.set(norm.name, norm)
            composioTools.push(norm)
          }
        }
      }
      _toolsCache.set(cacheKey, { tools: composioTools, timestamp: now })
    } catch {
      // Non-fatal: keep core tools
    }
  }

  return Array.from(toolMap.values())
}

/**
 * Execute a single tool through composioClient.js with safety confirmation
 * gate and size truncation.
 */
export async function executeToolWithSafety({
  toolName,
  args = {},
  composioConfig,
  http,
  onConfirm = null, // async ({ tool, args, reason }) => boolean
}) {
  const requiresConfirm = isWriteAction(toolName, args)

  if (requiresConfirm) {
    if (!onConfirm) {
      return {
        status: 'denied',
        error: `Action "${toolName}" requires user confirmation, but no confirmation handler was provided.`,
      }
    }

    const reason = `Action "${toolName}" may create, modify, delete, or send data.`
    let allowed = false
    try {
      allowed = await onConfirm({ tool: toolName, args, reason })
    } catch {
      allowed = false
    }

    if (!allowed) {
      return {
        status: 'cancelled',
        error: `User denied permission to execute "${toolName}".`,
      }
    }
  }

  try {
    const rawResult = await executeComposioTool({
      composioConfig,
      toolSlug: toolName,
      args,
      http,
    })

    const truncated = truncateToolResult(rawResult)
    return {
      status: 'done',
      data: truncated,
      raw: rawResult,
    }
  } catch (err) {
    if (err.authError || err.isRateLimit) {
      throw err
    }
    return {
      status: 'error',
      error: sanitizeErrorMessage(err.message || `Tool ${toolName} failed`),
    }
  }
}
