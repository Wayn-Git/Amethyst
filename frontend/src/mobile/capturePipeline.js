import { safeStorage } from '../lib/storage.js'
import { computeItemHash, syncItemsBatchToDrive } from './driveSync.js'
import { extractInstagramTier1 } from './instagramExtractor.js'
import { attemptTier2Extraction } from './tier2Extractor.js'
import {
  downloadMediaToDisk,
  uploadToGeminiFilesApi,
  analyzeVideoReel,
  analyzeCarousel,
} from './geminiPipeline.js'

export const SAVED_ITEMS_STORAGE_KEY = 'amethyst_saved_items'

let pipelineSubscribers = new Set()

/**
 * Subscribe to saved items state updates.
 */
export function subscribePipeline(callback) {
  pipelineSubscribers.add(callback)
  return () => pipelineSubscribers.delete(callback)
}

function notifySubscribers(items) {
  for (const sub of pipelineSubscribers) {
    try {
      sub(items)
    } catch {}
  }
}

/**
 * Load all saved items from persistent storage.
 */
export function loadSavedItems() {
  try {
    const raw = safeStorage.getItem(SAVED_ITEMS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

/**
 * Persist all items to storage.
 */
export function persistSavedItems(items) {
  try {
    safeStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify(items))
    notifySubscribers(items)
  } catch {}
}

/**
 * Resume any items stuck in 'processing' on app launch.
 */
export function resumePendingPipelineItems(config = {}) {
  const items = loadSavedItems()
  let modified = false
  const updated = items.map((item) => {
    if (item.status === 'processing') {
      modified = true
      return {
        ...item,
        status: 'queued',
        progress: 'Resuming after restart…',
      }
    }
    return item
  })

  if (modified) {
    persistSavedItems(updated)
    // Kick off processing for resumed items
    for (const item of updated) {
      if (item.status === 'queued') {
        processSavedItem(item.id, config).catch((err) =>
          console.warn('[Pipeline] Auto-resume failed for item:', item.id, err)
        )
      }
    }
  }
  return updated
}

/**
 * 1. Write-First Enqueue:
 * Persists URL to local storage in <500ms before any network call.
 * Idempotent by 16-hex hash of canonical URL.
 */
export async function enqueueSave(rawUrl, config = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Valid URL is required')
  }

  const cleanUrl = rawUrl.trim()
  const id = computeItemHash(cleanUrl)
  const items = loadSavedItems()

  // 1. Deduplication check
  const existing = items.find((i) => i.id === id)
  if (existing) {
    if (existing.status === 'ready' || existing.status === 'processing') {
      return existing
    }
  }

  // 2. Write-first immediate persist (<500ms)
  const newItem = {
    id,
    url: cleanUrl,
    canonicalUrl: cleanUrl,
    savedAt: new Date().toISOString(),
    status: 'queued',
    progress: 'Queued for processing…',
    caption: '',
    owner: null,
    music: null,
    mediaType: 'unknown',
    summary: null,
    transcript: null,
    tags: [],
    resources: [],
    slides: [],
    error: null,
  }

  const newItems = [newItem, ...items.filter((i) => i.id !== id)]
  persistSavedItems(newItems)

  // 3. Trigger processing asynchronously
  processSavedItem(id, config).catch((err) => {
    console.error(`[Pipeline] Failed processing ${id}:`, err)
  })

  return newItem
}

/**
 * Execute processing pipeline for an item.
 */
export async function processSavedItem(id, config = {}) {
  const items = loadSavedItems()
  const itemIndex = items.findIndex((i) => i.id === id)
  if (itemIndex === -1) return

  const item = { ...items[itemIndex], status: 'processing', progress: 'Fetching metadata…' }
  items[itemIndex] = item
  persistSavedItems(items)

  const geminiKey = config.geminiKey || safeStorage.getItem('GEMINI_API_KEY')
  const composioKey = config.composioKey || safeStorage.getItem('COMPOSIO_API_KEY')
  const spikeFolder = config.spikeFolder || safeStorage.getItem('SPIKE_DRIVE_FOLDER') || 'amethyst-spike'

  try {
    const isInstagram = /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv|reels)\//i.test(item.url)

    if (isInstagram) {
      // Step 1: Tier 1 Native HTTP fetch to embed
      const tier1 = await extractInstagramTier1(item.url)

      if (tier1.status === 'unavailable' || tier1.status === 'error') {
        item.status = 'failed'
        item.error = tier1.error || 'Instagram post unavailable or private'
        items[itemIndex] = item
        persistSavedItems(items)
        return item
      }

      item.caption = tier1.caption || ''
      item.owner = tier1.owner
      item.music = tier1.music
      item.mediaType = tier1.mediaType
      item.embedUrl = tier1.embedUrl

      // Step 2: Handle Video Reels
      if (tier1.mediaType === 'video') {
        let finalVideoUrl = tier1.videoUrl

        // If video_url is null (licensed music gating), attempt Tier 2
        if (!finalVideoUrl) {
          item.progress = 'Running Tier 2 DOM extraction…'
          items[itemIndex] = item
          persistSavedItems(items)

          const tier2 = await attemptTier2Extraction(tier1.shortcode)
          if (tier2.success && tier2.videoUrl && !tier2.isBlob) {
            finalVideoUrl = tier2.videoUrl
          } else {
            // Tier 2 could not recover downloadable MP4
            // Decision rule: Fallback to ready_partial with caption, song info, and official embed
            item.status = 'ready_partial'
            item.progress = 'Saved with embed playback & music metadata (licensed audio)'
            items[itemIndex] = item
            persistSavedItems(items)

            // Sync partial item to Drive
            if (composioKey) {
              await syncItemsBatchToDrive({ items: [item], folderName: spikeFolder, apiKey: composioKey }).catch(() => {})
            }
            return item
          }
        }

        // Direct video available: download and run Gemini
        if (finalVideoUrl && geminiKey) {
          item.progress = 'Downloading video…'
          items[itemIndex] = item
          persistSavedItems(items)

          const dl = await downloadMediaToDisk(finalVideoUrl, `${item.id}.mp4`)

          item.progress = 'Uploading to Gemini Files API…'
          items[itemIndex] = item
          persistSavedItems(items)

          const upload = await uploadToGeminiFilesApi({
            fileUri: dl.uri,
            mimeType: 'video/mp4',
            displayName: `amethyst_${item.id}`,
            apiKey: geminiKey,
          })

          item.progress = 'Analyzing video with Gemini 3.5 Flash Lite…'
          items[itemIndex] = item
          persistSavedItems(items)

          const analysis = await analyzeVideoReel({
            fileUri: upload.fileUri,
            mimeType: upload.mimeType,
            caption: item.caption,
            music: item.music,
            apiKey: geminiKey,
          })

          item.summary = analysis.summary || ''
          item.transcript = analysis.transcript || ''
          item.tags = analysis.tags || []
          item.resources = analysis.resources || []
          item.status = 'ready'
          item.progress = 'Extraction complete'
        } else {
          item.status = 'ready_partial'
          item.progress = 'Saved with metadata & embed playback'
        }
      } else if (tier1.mediaType === 'sidecar') {
        // Step 3: Handle Carousels
        const slideChildren = tier1.sidecarChildren || []
        if (slideChildren.length > 0 && geminiKey) {
          item.progress = `Downloading ${slideChildren.length} carousel slides…`
          items[itemIndex] = item
          persistSavedItems(items)

          const downloadedSlides = []
          for (let i = 0; i < slideChildren.length; i++) {
            const child = slideChildren[i]
            if (child.displayUrl) {
              const dl = await downloadMediaToDisk(child.displayUrl, `${item.id}_slide_${i + 1}.jpg`)
              downloadedSlides.push({
                fileUri: dl.uri,
                mimeType: 'image/jpeg',
                slideIndex: i + 1,
              })
            }
          }

          item.progress = 'Analyzing carousel slides in one Gemini call…'
          items[itemIndex] = item
          persistSavedItems(items)

          const carouselAnalysis = await analyzeCarousel({
            slideImages: downloadedSlides,
            caption: item.caption,
            apiKey: geminiKey,
          })

          item.slides = carouselAnalysis.slides || []
          item.summary = carouselAnalysis.summary || ''
          item.tags = carouselAnalysis.tags || []
          item.resources = carouselAnalysis.resources || []
          item.status = 'ready'
          item.progress = 'Carousel analysis complete'
        } else {
          item.status = 'ready_partial'
          item.progress = 'Carousel saved with embed playback'
        }
      } else {
        // Single image
        item.status = 'ready_partial'
        item.progress = 'Saved with embed playback'
      }
    } else {
      // Non-Instagram (YouTube Shorts, X, Reddit, etc.):
      // Save URL + caption + embed playback and stop with ready_partial
      item.status = 'ready_partial'
      item.progress = 'Saved URL for embed playback'
    }

    // Step 4: Sync to Google Drive via Composio
    if (composioKey) {
      item.progress = 'Syncing to Google Drive…'
      items[itemIndex] = item
      persistSavedItems(items)

      await syncItemsBatchToDrive({
        items: [item],
        folderName: spikeFolder,
        apiKey: composioKey,
      }).catch((err) => {
        console.warn('[DriveSync] Drive sync deferred:', err.message)
      })
    }

    item.progress = 'Ready'
    items[itemIndex] = item
    persistSavedItems(items)
    return item
  } catch (err) {
    console.error('[Pipeline] Error in item processing:', err)
    item.status = 'failed'
    item.error = err.message || 'Processing error'
    item.progress = 'Failed'
    items[itemIndex] = item
    persistSavedItems(items)
    return item
  }
}

