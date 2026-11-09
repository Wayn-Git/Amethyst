import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { enqueueShare, processQueue } from './shareQueue.js'

export const ShareTarget = registerPlugin('ShareTarget')

let initialized = false

/**
 * Check for incoming share intent and enqueue if found.
 */
export async function checkIncomingShare() {
  try {
    const item = await ShareTarget.getSharedItem()
    if (item && item.text && typeof item.text === 'string' && item.text.trim()) {
      await enqueueShare(item.text)
      await ShareTarget.clearSharedItem()
      return item
    }
  } catch (err) {
    // Non-blocking if plugin not registered (e.g. running in browser)
  }
  return null
}

/**
 * Initialize native share target listeners and app state monitors.
 */
export function initShareTarget() {
  if (initialized) return
  initialized = true

  // 1. Check intent immediately on startup
  checkIncomingShare().catch(() => {})

  // 2. Listen for runtime shares while app is open / backgrounded
  try {
    ShareTarget.addListener('shareReceived', async (item) => {
      if (item && item.text) {
        await enqueueShare(item.text)
        await ShareTarget.clearSharedItem().catch(() => {})
      }
    })
  } catch {
    // Web environment without native plugin
  }

  // 3. Listen for app foregrounding to re-check intents and resume queue
  try {
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        checkIncomingShare().catch(() => {})
        processQueue().catch(() => {})
      }
    })
  } catch {
    // Web environment
  }
}
