import { safeStorage } from '../lib/storage.js'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { getSecureKey } from './secureStorage.js'
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
export const MAX_INLINE_VIDEO_BYTES = 15 * 1024 * 1024 // 15MB inline limit

export async function generate240pxWebp(imageUrl) {
  if (!imageUrl) return null
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = setTimeout(() => {
      img.src = ''
      resolve(null)
    }, 4000)
    img.onload = () => {
      clearTimeout(timer)
      try {
        let width = img.naturalWidth || img.width || 240
        let height = img.naturalHeight || img.height || 240
        const maxDim = 240
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width)
            width = maxDim
          } else {
            width = Math.round((width * maxDim) / height)
            height = maxDim
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, width)
        canvas.height = Math.max(1, height)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/webp', 0.8)
        resolve(dataUrl)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    img.src = imageUrl
  })
}

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
      console.log(`[Pipeline] Auto-resuming item ${item.id} from status 'processing' -> 'queued'`)
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
        console.log(`[Pipeline] Triggering processSavedItem for resumed item ${item.id}`)
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

  const geminiKey = config.geminiKey || await getSecureKey('GEMINI_API_KEY')
  const composioKey = config.composioKey || await getSecureKey('COMPOSIO_API_KEY')
  const spikeFolder = config.spikeFolder || await getSecureKey('SPIKE_DRIVE_FOLDER') || 'amethyst-spike'

  try {
    const isInstagram = /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv|reels)\//i.test(item.url)

    if (isInstagram) {
      // Step 1: Tier 1 Native HTTP fetch to embed (re-resolve fresh at processing time)
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

      // Ensure no CDN URLs are ever persisted on item or owner
      delete item.videoUrl
      delete item.mediaUrl
      delete item.thumbnailUrl
      if (item.owner) {
        delete item.owner.profilePic
      }

      // Generate 240px WebP data URL for thumbnail at save time
      const rawThumb = tier1.thumbnailUrl || tier1.displayUrl || (tier1.carouselMedia?.[0]?.displayUrl) || null
      if (rawThumb) {
        try {
          const webpData = await generate240pxWebp(rawThumb)
          if (webpData) {
            item.thumbnail_url = webpData
          }
        } catch (err) {
          console.warn('[Pipeline] WebP generation failed:', err.message)
        }
      }

      // Step 2: Handle Video Reels
      if (tier1.mediaType === 'video') {
        const finalVideoUrl = tier1.videoUrl

        // If video_url is null (licensed music gating), Tier 2 is disabled
        if (!finalVideoUrl) {
          console.log(`[Pipeline] No public videoUrl for ${item.id} (licensed audio). Ending as ready_partial.`)
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

        // Direct video available: download and run Gemini inline
        if (finalVideoUrl && geminiKey) {
          console.log(`[Pipeline] Downloading video for ${item.id} from embed…`)
          item.progress = 'Downloading video…'
          items[itemIndex] = item
          persistSavedItems(items)

          const dl = await downloadMediaToDisk(finalVideoUrl, `${item.id}.mp4`)
          console.log(`[Pipeline] Video downloaded to disk: ${dl.path}`)

          // Enforce 15MB inline limit
          const stat = await Filesystem.stat({
            path: `${item.id}.mp4`,
            directory: Directory.Cache,
          })
          item.mediaSizeBytes = stat.size

          if (stat.size > MAX_INLINE_VIDEO_BYTES) {
            const sizeMB = (stat.size / (1024 * 1024)).toFixed(1)
            console.warn(`[Pipeline] Video size ${sizeMB}MB exceeds 15MB inline limit. Ending as ready_partial.`)
            item.status = 'ready_partial'
            item.progress = `Saved with embed playback (video size ${sizeMB}MB exceeds 15MB limit)`
            item.error = `Video size ${sizeMB}MB exceeds 15MB limit`
            await Filesystem.deleteFile({ path: `${item.id}.mp4`, directory: Directory.Cache }).catch(() => {})
            items[itemIndex] = item
            persistSavedItems(items)

            if (composioKey) {
              await syncItemsBatchToDrive({ items: [item], folderName: spikeFolder, apiKey: composioKey }).catch(() => {})
            }
            return item
          }

          item.progress = 'Reading video from cache…'
          items[itemIndex] = item
          persistSavedItems(items)

          const fileRes = await Filesystem.readFile({
            path: `${item.id}.mp4`,
            directory: Directory.Cache,
          })

          item.progress = 'Analyzing video with Gemini 3.5 Flash Lite…'
          items[itemIndex] = item
          persistSavedItems(items)

          console.log(`[Pipeline] Calling analyzeVideoReel with Gemini 3.5 Flash Lite (inline base64 ${fileRes.data.length} chars)…`)
          const analysis = await analyzeVideoReel({
            inlineData: fileRes.data,
            mimeType: 'video/mp4',
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
          console.log(`[Pipeline] Extraction COMPLETE for ${item.id}. REACHED READY! Summary: "${item.summary}"`)
        } else {
          item.status = 'ready_partial'
          item.progress = 'Saved with metadata & embed playback'
        }
      } else if (tier1.mediaType === 'sidecar') {
        // Step 3: Handle Carousels (base64 inline images)
        const slideChildren = tier1.sidecarChildren || []
        if (slideChildren.length > 0 && geminiKey) {
          item.progress = `Downloading ${slideChildren.length} carousel slides…`
          items[itemIndex] = item
          persistSavedItems(items)

          const downloadedSlides = []
          let totalSlideBytes = 0
          for (let i = 0; i < slideChildren.length; i++) {
            const child = slideChildren[i]
            if (child.displayUrl) {
              const slideName = `${item.id}_slide_${i + 1}.jpg`
              await downloadMediaToDisk(child.displayUrl.replace(/&amp;/g, '&'), slideName)
              const stat = await Filesystem.stat({ path: slideName, directory: Directory.Cache }).catch(() => ({}))
              if (stat.size) totalSlideBytes += stat.size
              const fileRes = await Filesystem.readFile({
                path: slideName,
                directory: Directory.Cache,
              })
              downloadedSlides.push({
                inlineData: fileRes.data,
                mimeType: 'image/jpeg',
                slideIndex: i + 1,
              })
            }
          }
          item.mediaSizeBytes = totalSlideBytes

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
        // Single image: treat as a 1-slide carousel
        const singleImageUrl = (tier1.displayUrl || tier1.thumbnailUrl || '').replace(/&amp;/g, '&')
        if (singleImageUrl && geminiKey) {
          const slideName = `${item.id}_slide_1.jpg`
          await downloadMediaToDisk(singleImageUrl, slideName)
          const stat = await Filesystem.stat({ path: slideName, directory: Directory.Cache }).catch(() => ({}))
          if (stat.size) item.mediaSizeBytes = stat.size
          const fileRes = await Filesystem.readFile({
            path: slideName,
            directory: Directory.Cache,
          })
          item.progress = 'Analyzing image with Gemini 3.5 Flash Lite…'
          items[itemIndex] = item
          persistSavedItems(items)

          const analysis = await analyzeCarousel({
            slideImages: [
              {
                inlineData: fileRes.data,
                mimeType: 'image/jpeg',
                slideIndex: 1,
              },
            ],
            caption: item.caption,
            apiKey: geminiKey,
          })

          item.slides = analysis.slides || []
          item.summary = analysis.summary || ''
          item.tags = analysis.tags || []
          item.resources = analysis.resources || []
          item.status = 'ready'
          item.progress = 'Image analysis complete'
        } else {
          item.status = 'ready_partial'
          item.progress = 'Saved with embed playback'
        }
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

