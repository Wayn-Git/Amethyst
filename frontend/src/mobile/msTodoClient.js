import { Capacitor, CapacitorHttp } from '@capacitor/core'
import {
  getMicrosoftAccessToken,
  refreshMicrosoftToken,
  markServiceExpired,
} from './connectionStatus.js'

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
export const MAX_PAGES = 50

let customGraphFetcher = null

/**
 * Configure custom fetcher for testing and fakes.
 */
export function setGraphFetcher(fetcher) {
  customGraphFetcher = fetcher
}

export function clearGraphFetcher() {
  customGraphFetcher = null
}

const isDev =
  (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') ||
  (typeof import.meta !== 'undefined' && import.meta.env?.DEV)

/**
 * Normalize Microsoft Graph task object into Amethyst task model.
 */
export function normalizeGraphTask(item, listName = 'Tasks', listId = null) {
  if (!item) return null
  const isDone = item.status === 'completed'
  let due = null
  if (item.dueDateTime?.dateTime) {
    due = item.dueDateTime.dateTime.split('T')[0]
  } else if (item.due) {
    due = item.due
  }

  return {
    id: item.id,
    title: item.title || '',
    status: isDone ? 'completed' : 'todo',
    completed: isDone,
    due,
    importance: item.importance || 'normal',
    context: listName,
    list_name: listName,
    listId: listId || item.listId || null,
    body: typeof item.body === 'object' ? item.body?.content || '' : item.body || '',
    raw: item,
  }
}

/**
 * Execute HTTP request supporting custom fetcher, Capacitor native bridge, and web fetch.
 */
async function executeHttp({ url, method = 'GET', data = null, headers = {} }, fetcherOverride = null) {
  const activeFetcher = fetcherOverride || customGraphFetcher

  if (activeFetcher) {
    const res = await activeFetcher({ url, method, data, headers })
    // Adapt fetch Response vs raw object
    const status = res.status ?? (res.ok ? 200 : 400)
    const resHeaders = res.headers || {}
    let resData
    if (typeof res.json === 'function') {
      resData = await res.json().catch(() => null)
    } else {
      resData = res.data !== undefined ? res.data : null
    }

    return {
      status,
      ok: status >= 200 && status < 300,
      data: resData,
      headers: resHeaders,
    }
  }

  if (Capacitor.isNativePlatform?.()) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      data: data !== null && data !== undefined ? data : undefined,
    })
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      data: res.data,
      headers: res.headers || {},
    }
  }

  // Web / standard fetch
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: data !== null && data !== undefined ? (typeof data === 'string' ? data : JSON.stringify(data)) : undefined,
  })

  const contentType = res.headers?.get?.('content-type') || ''
  let parsedData = null
  if (contentType.includes('application/json')) {
    parsedData = await res.json().catch(() => null)
  } else {
    parsedData = await res.text().catch(() => null)
  }

  return {
    status: res.status,
    ok: res.ok,
    data: parsedData,
    headers: res.headers || {},
  }
}

/**
 * Make an authenticated Microsoft Graph API request with automatic token refresh.
 */
export async function graphRequest({
  url,
  method = 'GET',
  data = null,
  headers = {},
  fetcher = null,
  retryOn401 = true,
} = {}) {
  let token
  try {
    token = await getMicrosoftAccessToken()
  } catch (err) {
    if (isDev) {
      console.warn('[msTodoClient] Token resolution failed:', err.message)
    }
    throw err
  }

  const reqHeaders = {
    Authorization: `Bearer ${token}`,
    ...headers,
  }

  let res
  try {
    res = await executeHttp({ url, method, data, headers: reqHeaders }, fetcher)
  } catch (netErr) {
    if (isDev) {
      console.error(`[msTodoClient] Network failure on ${method} ${url}:`, netErr.message)
    }
    const err = new Error(netErr.message || 'Offline: Network request failed')
    err.isOffline = true
    err.code = 'OFFLINE'
    throw err
  }

  // Handle 401 Unauthorized: attempt refresh then retry
  if (res.status === 401 && retryOn401) {
    if (isDev) {
      console.warn(`[msTodoClient] 401 received for ${url}. Attempting token refresh...`)
    }
    try {
      await refreshMicrosoftToken()
      // Retry once with refreshed token
      return await graphRequest({
        url,
        method,
        data,
        headers,
        fetcher,
        retryOn401: false,
      })
    } catch (refreshErr) {
      if (isDev) {
        console.error('[msTodoClient] 401 refresh failed, marking expired:', {
          status: refreshErr.status || 401,
          body: refreshErr.body || refreshErr.message,
        })
      }
      await markServiceExpired('microsoftTodo')
      const err = new Error('Token expired, reconnect')
      err.status = 401
      err.code = 'TOKEN_EXPIRED'
      throw err
    }
  }

  // Handle HTTP error codes (>= 400)
  if (res.status >= 400) {
    const errBody = res.data
    if (isDev) {
      console.error(`[msTodoClient] Graph API failure (${res.status}) on ${method} ${url}:`, {
        status: res.status,
        body: errBody,
      })
    }

    const message =
      errBody?.error?.message ||
      errBody?.message ||
      `Microsoft Graph request failed (${res.status})`
    const err = new Error(message)
    err.status = res.status
    err.body = errBody
    if (res.status === 401) {
      err.code = 'TOKEN_EXPIRED'
    }
    throw err
  }

  return res.data
}

/**
 * Fetch all task lists from Microsoft Graph (following @odata.nextLink).
 */
export async function getLists({ fetcher } = {}) {
  let nextUrl = `${GRAPH_BASE_URL}/me/todo/lists`
  const lists = []
  let page = 0

  while (nextUrl && page < MAX_PAGES) {
    page++
    const payload = await graphRequest({ url: nextUrl, method: 'GET', fetcher })
    const items = Array.isArray(payload?.value) ? payload.value : []
    lists.push(...items)
    nextUrl = payload?.['@odata.nextLink'] || null
  }

  return lists
}

/**
 * Resolve the default task list.
 */
export async function getDefaultList({ fetcher } = {}) {
  const lists = await getLists({ fetcher })
  if (!lists.length) return null

  const defaultList =
    lists.find((l) => l.wellknownListName === 'defaultList') ||
    lists.find((l) => l.displayName?.toLowerCase() === 'tasks') ||
    lists[0]

  return defaultList
}

/**
 * Fetch tasks for a list following @odata.nextLink.
 */
export async function getTasks(listId = null, { fetcher, includeCompleted = true } = {}) {
  let targetListId = listId
  let targetListName = 'Tasks'

  if (!targetListId) {
    const defaultList = await getDefaultList({ fetcher })
    if (defaultList) {
      targetListId = defaultList.id
      targetListName = defaultList.displayName || 'Tasks'
    } else {
      const emptyResult = []
      emptyResult.listId = null
      emptyResult.listName = targetListName
      emptyResult.tasks = []
      return emptyResult
    }
  }

  let nextUrl = `${GRAPH_BASE_URL}/me/todo/lists/${targetListId}/tasks`
  const rawItems = []
  let page = 0

  while (nextUrl && page < MAX_PAGES) {
    page++
    const payload = await graphRequest({ url: nextUrl, method: 'GET', fetcher })
    const items = Array.isArray(payload?.value) ? payload.value : []
    rawItems.push(...items)
    nextUrl = payload?.['@odata.nextLink'] || null
  }

  const normalized = rawItems.map((item) => normalizeGraphTask(item, targetListName, targetListId))
  const filtered = includeCompleted ? normalized : normalized.filter((t) => !t.completed)

  filtered.listId = targetListId
  filtered.listName = targetListName
  filtered.tasks = filtered

  return filtered
}

/**
 * Create a task in Microsoft Graph.
 */
export async function createTask(
  { title, listId = null, body = null, dueDateTime = null, importance = null },
  { fetcher } = {}
) {
  let targetListId = listId
  let targetListName = 'Tasks'

  if (!targetListId) {
    const defaultList = await getDefaultList({ fetcher })
    if (!defaultList) {
      throw new Error('No Microsoft To Do list available to create task')
    }
    targetListId = defaultList.id
    targetListName = defaultList.displayName || 'Tasks'
  }

  const postData = {
    title: (title || '').trim(),
    ...(body ? { body: { content: body, contentType: 'text' } } : {}),
    ...(dueDateTime ? { dueDateTime } : {}),
    ...(importance ? { importance } : {}),
  }

  const payload = await graphRequest({
    url: `${GRAPH_BASE_URL}/me/todo/lists/${targetListId}/tasks`,
    method: 'POST',
    data: postData,
    fetcher,
  })

  return normalizeGraphTask(payload, targetListName, targetListId)
}

/**
 * Complete or uncomplete a task in Microsoft Graph via PATCH.
 */
export async function completeTask(listId, taskId, completed = true, { fetcher } = {}) {
  let targetListId = listId
  if (!targetListId) {
    const defaultList = await getDefaultList({ fetcher })
    targetListId = defaultList?.id
  }

  if (!targetListId || !taskId) {
    throw new Error('Both listId and taskId required to complete task')
  }

  const patchData = {
    status: completed ? 'completed' : 'notStarted',
  }

  const payload = await graphRequest({
    url: `${GRAPH_BASE_URL}/me/todo/lists/${targetListId}/tasks/${taskId}`,
    method: 'PATCH',
    data: patchData,
    fetcher,
  })

  return normalizeGraphTask(payload, 'Tasks', targetListId)
}

export default {
  GRAPH_BASE_URL,
  MAX_PAGES,
  setGraphFetcher,
  clearGraphFetcher,
  normalizeGraphTask,
  graphRequest,
  getLists,
  getDefaultList,
  getTasks,
  createTask,
  completeTask,
}
