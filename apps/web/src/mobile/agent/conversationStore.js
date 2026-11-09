/**
 * Local-only Conversation Store for Mobile Companion.
 * Stores conversations strictly on the phone (Native Vault / safeStorage).
 * Conversations never leave the phone and are never sent to the PC or relay.
 */

import { nativeVault } from '../../lib/credentials.js'
import { safeStorage } from '../../lib/storage.js'

const CONVERSATION_INDEX_KEY = 'amethyst.mobile.agent.conversations'
const CONVERSATION_PREFIX = 'amethyst.mobile.agent.conv.'

let memoryIndex = null
const memoryStore = new Map()

/**
 * Generate a unique local conversation ID.
 */
export function generateConversationId() {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `mconv_${ts}_${rand}`
}

/**
 * Read the list of conversation summaries.
 */
export async function listConversations() {
  if (memoryIndex) {
    return [...memoryIndex]
  }

  try {
    const vault = await nativeVault()
    if (vault) {
      const raw = await vault.get(CONVERSATION_INDEX_KEY)
      if (raw) {
        memoryIndex = typeof raw === 'string' ? JSON.parse(raw) : raw
        return [...memoryIndex]
      }
    }
  } catch {
    // Fallback to safeStorage
  }

  try {
    const fallback = safeStorage.getItem(CONVERSATION_INDEX_KEY)
    if (fallback) {
      memoryIndex = JSON.parse(fallback)
      return [...memoryIndex]
    }
  } catch {
    // Non-fatal
  }

  memoryIndex = []
  return []
}

/**
 * Fetch a full conversation by its ID.
 */
export async function getConversation(id) {
  if (!id) return null
  if (memoryStore.has(id)) {
    return memoryStore.get(id)
  }

  const key = `${CONVERSATION_PREFIX}${id}`
  try {
    const vault = await nativeVault()
    if (vault) {
      const raw = await vault.get(key)
      if (raw) {
        const conv = typeof raw === 'string' ? JSON.parse(raw) : raw
        memoryStore.set(id, conv)
        return conv
      }
    }
  } catch {
    // Fallback to safeStorage
  }

  try {
    const raw = safeStorage.getItem(key)
    if (raw) {
      const conv = JSON.parse(raw)
      memoryStore.set(id, conv)
      return conv
    }
  } catch {
    // Non-fatal
  }

  return null
}

/**
 * Create a new local conversation.
 */
export async function createConversation(title = 'New conversation') {
  const id = generateConversationId()
  const now = new Date().toISOString()
  const newConv = {
    id,
    title: title.trim() || 'New conversation',
    created_at: now,
    updated_at: now,
    messages: [],
  }

  await saveConversation(newConv)
  return newConv
}

/**
 * Save or update a conversation locally.
 */
export async function saveConversation(conv) {
  if (!conv || !conv.id) {
    throw new Error('Cannot save invalid conversation: missing ID')
  }

  const now = new Date().toISOString()
  const fullConv = {
    ...conv,
    updated_at: now,
    messages: Array.isArray(conv.messages) ? conv.messages : [],
  }

  memoryStore.set(conv.id, fullConv)

  // 1. Save full conversation payload
  const key = `${CONVERSATION_PREFIX}${conv.id}`
  const serialized = JSON.stringify(fullConv)

  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.set(key, serialized)
    }
  } catch {}

  try {
    safeStorage.setItem(key, serialized)
  } catch {}

  // 2. Update index
  const index = await listConversations()
  const lastUserOrAssistantMsg = fullConv.messages
    .slice()
    .reverse()
    .find((m) => m.role === 'user' || m.role === 'assistant')
  const preview = (lastUserOrAssistantMsg?.content || '').slice(0, 80)

  const summary = {
    id: fullConv.id,
    title: fullConv.title || 'Conversation',
    created_at: fullConv.created_at || now,
    updated_at: fullConv.updated_at,
    message_count: fullConv.messages.length,
    preview,
  }

  const existingIdx = index.findIndex((c) => c.id === conv.id)
  if (existingIdx >= 0) {
    index[existingIdx] = summary
  } else {
    index.unshift(summary)
  }

  // Sort descending by updated_at
  index.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  memoryIndex = index

  const serializedIndex = JSON.stringify(index)
  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.set(CONVERSATION_INDEX_KEY, serializedIndex)
    }
  } catch {}

  try {
    safeStorage.setItem(CONVERSATION_INDEX_KEY, serializedIndex)
  } catch {}

  return fullConv
}

/**
 * Delete a conversation locally.
 */
export async function deleteConversation(id) {
  if (!id) return

  memoryStore.delete(id)
  const key = `${CONVERSATION_PREFIX}${id}`

  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.remove(key)
    }
  } catch {}

  try {
    safeStorage.removeItem(key)
  } catch {}

  const index = await listConversations()
  const filtered = index.filter((c) => c.id !== id)
  memoryIndex = filtered

  const serializedIndex = JSON.stringify(filtered)
  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.set(CONVERSATION_INDEX_KEY, serializedIndex)
    }
  } catch {}

  try {
    safeStorage.setItem(CONVERSATION_INDEX_KEY, serializedIndex)
  } catch {}
}

/**
 * Clear all conversations (for testing or reset).
 */
export async function clearAllConversations() {
  const index = await listConversations()
  for (const c of index) {
    const key = `${CONVERSATION_PREFIX}${c.id}`
    try {
      const vault = await nativeVault()
      if (vault) await vault.remove(key)
    } catch {}
    try {
      safeStorage.removeItem(key)
    } catch {}
  }

  memoryStore.clear()
  memoryIndex = []

  try {
    const vault = await nativeVault()
    if (vault) await vault.remove(CONVERSATION_INDEX_KEY)
  } catch {}
  try {
    safeStorage.removeItem(CONVERSATION_INDEX_KEY)
  } catch {}
}
