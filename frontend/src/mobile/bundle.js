import { nativeVault, isNativeMobile } from '../lib/credentials.js'
import { safeStorage } from '../lib/storage.js'

export const BUNDLE_KEY = 'amethyst.v2.bundle'

/**
 * Fixture bundle for sessions D and E to use before pairing works.
 * Conforms to CONTRACT v2 bundle schema.
 */
export const BUNDLE_FIXTURE = {
  device_id: 'dev_fixture_mobile_01',
  llm: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    api_key: 'sk-ant-api03-fixture-fake-key-not-real-do-not-use',
  },
  composio: {
    api_key: 'comp_fixture_fake_key_0123456789abcdef',
    user_id: 'user_fixture_01',
  },
  drive: {
    root_folder_id: 'drive_root_folder_fixture_12345',
    inbox_folder_id: 'drive_inbox_folder_fixture_67890',
  },
  prompts: {
    summary: 'Summarize the input concisely with key takeaways and actionable points.',
  },
}

let memoryBundle = null

/**
 * Retrieve the paired bundle from Android Keystore / iOS Keychain.
 * Returns null if not paired.
 * Never logs keys or tokens.
 */
export async function getBundle() {
  try {
    const vault = await nativeVault()
    if (vault) {
      const stored = await vault.get(BUNDLE_KEY)
      if (!stored) return null
      return typeof stored === 'string' ? JSON.parse(stored) : stored
    }
  } catch {
    // If native vault fails, check in-memory / safe fallback
  }

  if (memoryBundle) return memoryBundle

  try {
    const fallback = safeStorage.getItem(BUNDLE_KEY)
    if (fallback) return JSON.parse(fallback)
  } catch {
    return null
  }
  return null
}

/**
 * Save the paired bundle into Android Keystore / iOS Keychain only.
 * Never logs keys or tokens.
 */
export async function saveBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Invalid bundle')
  }

  memoryBundle = bundle

  const vault = await nativeVault()
  if (vault) {
    await vault.set(BUNDLE_KEY, bundle)
    safeStorage.removeItem(BUNDLE_KEY)
    return
  }

  if (!isNativeMobile()) {
    try {
      safeStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle))
    } catch {
      // Non-blocking in test environment
    }
  }
}

/**
 * Clear the paired bundle from Keystore / Keychain.
 */
export async function clearBundle() {
  memoryBundle = null
  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.remove(BUNDLE_KEY)
    }
  } catch {
    // Ignore vault remove error on cleanup
  }
  try {
    safeStorage.removeItem(BUNDLE_KEY)
  } catch {
    // Ignore storage remove error
  }
}

/**
 * Check whether a bundle currently exists.
 */
export async function hasBundle() {
  const b = await getBundle()
  return Boolean(b?.device_id)
}

/**
 * Load fixture bundle into Keystore / Keychain for sessions D and E.
 */
export async function loadFixtureBundle() {
  await saveBundle(BUNDLE_FIXTURE)
  return BUNDLE_FIXTURE
}
