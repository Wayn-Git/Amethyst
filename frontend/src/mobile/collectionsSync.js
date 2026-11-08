import { safeStorage } from '../lib/storage.js'
import { putRecord, records, getLocalOwner } from './storage.js'
import { identity } from '../lib/sync/client.js'
import {
  getConnectionStatus,
  formatConnectionLabel,
  getGoogleDriveAccessToken,
  refreshGoogleDriveToken,
} from './connectionStatus.js'
import { getBundle } from './bundle.js'
import { executeComposioTool } from './composioClient.js'
import { api } from '../api.js'

export const COLLECTIONS_STORAGE_KEY = 'amethyst.mobile.collections.v1'
export const COLLECTIONS_RECORD_NAME = 'collections_store'

let memoryCollectionsStore = null
const subscribers = new Set()

function notifySubscribers() {
  const current = getStoredCollections()
  for (const sub of subscribers) {
    try {
      sub(current)
    } catch {}
  }
}

export function subscribeCollections(listener) {
  subscribers.add(listener)
  listener(getStoredCollections())
  return () => subscribers.delete(listener)
}

/**
 * Synchronous read of current cached collections.
 */
export function getStoredCollections() {
  if (memoryCollectionsStore) return memoryCollectionsStore

  try {
    const raw = safeStorage.getItem(COLLECTIONS_STORAGE_KEY)
    if (raw) {
      memoryCollectionsStore = JSON.parse(raw)
      return memoryCollectionsStore
    }
  } catch {}

  return {
    lists: [],
    items: [],
    lastSyncedAt: null,
  }
}

/**
 * Read collections from durable encrypted storage (storage.js records).
 */
export async function loadCollectionsFromStore() {
  try {
    const recs = await records(COLLECTIONS_RECORD_NAME)
    if (recs && recs.length > 0 && recs[0].value) {
      memoryCollectionsStore = recs[0].value
      safeStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(memoryCollectionsStore))
      notifySubscribers()
      return memoryCollectionsStore
    }
  } catch {}

  return getStoredCollections()
}

/**
 * Save collections to both encrypted store and safeStorage cache.
 */
export async function saveCollectionsToStore(storeData) {
  const dataToSave = {
    lists: Array.isArray(storeData.lists) ? storeData.lists : [],
    items: Array.isArray(storeData.items) ? storeData.items : [],
    lastSyncedAt: storeData.lastSyncedAt || new Date().toISOString(),
  }

  memoryCollectionsStore = dataToSave

  try {
    safeStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(dataToSave))
  } catch {}

  try {
    await putRecord(COLLECTIONS_RECORD_NAME, dataToSave)
  } catch (err) {
    console.warn('[collectionsSync] putRecord failed, falling back to safeStorage:', err.message)
  }

  notifySubscribers()
  return dataToSave
}

/**
 * Returns formatted status label or integer count.
 * Never shows empty '0' when disconnected, expired or offline.
 */
export function getCollectionsDisplayState() {
  const store = getStoredCollections()
  const lists = store.lists || []

  if (lists.length > 0) {
    return {
      count: lists.length,
      label: String(lists.length),
      isRealCount: true,
      status: 'synced',
    }
  }

  // If count is 0, check real connection status instead of showing empty "0"
  const conns = getConnectionStatus()
  const driveStatus = conns.googleDrive

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      count: 0,
      label: 'offline',
      isRealCount: false,
      status: 'offline',
    }
  }

  if (driveStatus === 'offline') {
    return {
      count: 0,
      label: 'offline',
      isRealCount: false,
      status: 'offline',
    }
  }

  if (driveStatus === 'expired') {
    return {
      count: 0,
      label: 'expired',
      isRealCount: false,
      status: 'expired',
    }
  }

  if (driveStatus === 'missing') {
    return {
      count: 0,
      label: 'not connected',
      isRealCount: false,
      status: 'not connected',
    }
  }

  return {
    count: 0,
    label: '0',
    isRealCount: true,
    status: 'connected',
  }
}

/**
 * Read collection count from the exact store written by sync.
 */
export function getCollectionsCount() {
  const state = getCollectionsDisplayState()
  return state.label
}

/**
 * Read last-synced time from store.
 */
export function getLastSyncedTime() {
  const store = getStoredCollections()
  return store.lastSyncedAt || null
}

/**
 * Human readable last-synced string (e.g. "Just now", "5m ago", "12:30 PM").
 */
export function formatLastSyncedTime(isoString) {
  if (!isoString) return 'Never'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return 'Never'

  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return 'Just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Synchronize Collections and Library items from Drive / Composio or API.
 * Supports full pull on fresh install and incremental sync after.
 */
export async function syncCollections({
  isManual = false,
  fullPull = false,
  apiClient = api,
  composioConfig: customComposio,
  driveConfig: customDrive,
} = {}) {
  const existingStore = await loadCollectionsFromStore()
  const isFreshInstall = !existingStore.lastSyncedAt || fullPull || existingStore.lists.length === 0

  let bundle = null
  try {
    bundle = await getBundle()
  } catch {}

  const composioConfig = customComposio || bundle?.composio
  const driveConfig = customDrive || bundle?.drive

  let pulledLists = []
  let pulledItems = []
  let syncSource = 'none'

  // Strategy 1: Try local API if connected (e.g. LAN PC or proxy)
  try {
    const [listsRes, libRes] = await Promise.allSettled([
      apiClient.get ? apiClient.get('/library/lists') : null,
      apiClient.library ? apiClient.library({ limit: 500 }) : null,
    ])

    if (listsRes.status === 'fulfilled' && Array.isArray(listsRes.value) && listsRes.value.length > 0) {
      pulledLists = listsRes.value
      syncSource = 'api'
    }
    if (libRes.status === 'fulfilled' && libRes.value?.items && libRes.value.items.length > 0) {
      pulledItems = libRes.value.items
      syncSource = 'api'
    }
  } catch {}

  // Strategy 2: If API was unavailable or returned empty, sync directly from Google Drive / Composio
  if (pulledLists.length === 0 && (driveConfig?.root_folder_id || driveConfig?.rootFolderId)) {
    const rootFolderId = driveConfig.root_folder_id || driveConfig.rootFolderId

    // 2a. Download library-catalog.json via Composio or direct Drive API
    let catalogJson = null
    if (composioConfig?.api_key) {
      try {
        const findRes = await executeComposioTool({
          composioConfig,
          toolSlug: 'GOOGLEDRIVE_FIND_FILE',
          args: {
            q: `'${rootFolderId}' in parents and name = 'library-catalog.json' and trashed = false`,
          },
        })
        const files = findRes?.files || []
        if (Array.isArray(files) && files.length > 0 && files[0].id) {
          const downloadRes = await executeComposioTool({
            composioConfig,
            toolSlug: 'GOOGLEDRIVE_DOWNLOAD_FILE',
            args: { fileId: files[0].id },
          })
          if (downloadRes) {
            const raw = typeof downloadRes === 'string' ? downloadRes : downloadRes.content || JSON.stringify(downloadRes)
            catalogJson = JSON.parse(raw)
            syncSource = 'drive_catalog'
          }
        }
      } catch (composioErr) {
        console.warn('[collectionsSync] Composio catalog pull failed:', composioErr.message)
      }
    }

    // 2b. Direct Drive API fetch if Composio wasn't used or returned nothing
    if (!catalogJson) {
      try {
        const token = await getGoogleDriveAccessToken()
        if (token) {
          const findUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${rootFolderId}' in parents and name = 'library-catalog.json' and trashed = false`)}&fields=files(id,name,modifiedTime)`
          const findRes = await fetch(findUrl, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (findRes.ok) {
            const findData = await findRes.json()
            const fileId = findData.files?.[0]?.id
            if (fileId) {
              const dlUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
              const dlRes = await fetch(dlUrl, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (dlRes.ok) {
                catalogJson = await dlRes.json()
                syncSource = 'drive_catalog_direct'
              }
            }
          }
        }
      } catch (driveErr) {
        console.warn('[collectionsSync] Direct Drive catalog pull failed:', driveErr.message)
      }
    }

    if (catalogJson) {
      if (Array.isArray(catalogJson.lists)) {
        pulledLists = catalogJson.lists.map((l) => ({
          id: l.id,
          name: l.title || l.name || 'Untitled Collection',
          title: l.title || l.name || 'Untitled Collection',
          description: l.description || '',
          icon: l.icon || 'bookmark',
          item_count: typeof l.item_count === 'number' ? l.item_count : 0,
          cover_item_id: l.cover_item_id || null,
          is_smart: Boolean(l.is_smart),
        }))
      }
      if (Array.isArray(catalogJson.items)) {
        pulledItems = catalogJson.items
      }
    }
  }

  // Strategy 3: Incremental vs Full Pull Store Update
  let nextLists = []
  let nextItems = []

  if (isFreshInstall || pulledLists.length > 0) {
    // Full pull or clean replace of pulled lists
    nextLists = pulledLists.length > 0 ? pulledLists : existingStore.lists || []
    nextItems = pulledItems.length > 0 ? pulledItems : existingStore.items || []
  } else {
    // Incremental merge: keep existing lists and append/update modified
    const listMap = new Map((existingStore.lists || []).map((l) => [String(l.id), l]))
    for (const pl of pulledLists) {
      listMap.set(String(pl.id), { ...(listMap.get(String(pl.id)) || {}), ...pl })
    }
    nextLists = Array.from(listMap.values())

    const itemMap = new Map((existingStore.items || []).map((i) => [String(i.id || i.uuid), i]))
    for (const pi of pulledItems) {
      itemMap.set(String(pi.id || pi.uuid), { ...(itemMap.get(String(pi.id || pi.uuid)) || {}), ...pi })
    }
    nextItems = Array.from(itemMap.values())
  }

  const nowIso = new Date().toISOString()
  const saved = await saveCollectionsToStore({
    lists: nextLists,
    items: nextItems,
    lastSyncedAt: nowIso,
  })

  return {
    success: true,
    source: syncSource,
    isFreshInstall,
    listsCount: nextLists.length,
    itemsCount: nextItems.length,
    lastSyncedAt: nowIso,
    store: saved,
  }
}
