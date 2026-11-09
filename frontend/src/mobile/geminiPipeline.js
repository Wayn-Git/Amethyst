import { Filesystem, Directory } from '@capacitor/filesystem'
import { Capacitor } from '@capacitor/core'
import { httpGet, httpPost } from './nativeHttp.js'

export const GEMINI_MODEL = 'gemini-3.5-flash-lite'
const MIN_REQUEST_INTERVAL_MS = 4000 // 15 RPM Free Tier ceiling

let lastRequestTimestamp = 0

/**
 * Token bucket pacer: enforces 4.0s minimum spacing between Gemini requests.
 */
export async function waitForTokenBucket() {
  const now = Date.now()
  const elapsed = now - lastRequestTimestamp
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const waitMs = MIN_REQUEST_INTERVAL_MS - elapsed
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  lastRequestTimestamp = Date.now()
}

/**
 * Calculate exponential backoff with jitter on 429 / 503 errors.
 */
export function calculateGeminiBackoff(attempt) {
  const base = Math.min(60000, Math.pow(2, attempt) * 2000)
  const jitter = Math.random() * 1500
  return base + jitter
}

/**
 * Download media file straight to device disk via Filesystem.downloadFile.
 * Zero byte transfer across JavaScript bridge.
 */
export async function downloadMediaToDisk(url, filename, { directory = Directory.Cache } = {}) {
  const downloadResult = await Filesystem.downloadFile({
    url,
    path: filename,
    directory,
  })

  const uriResult = await Filesystem.getUri({
    path: filename,
    directory,
  })

  return {
    path: downloadResult.path || filename,
    uri: uriResult.uri,
  }
}

/**
 * Upload local file to Gemini Files API without Base64 bridge serialization.
 */
export async function uploadToGeminiFilesApi({ fileUri, mimeType, displayName, apiKey }) {
  if (!apiKey) throw new Error('Gemini API key is required')

  // 1. Get file blob from native file URL via Capacitor local asset loader
  const webSrc = Capacitor.isNativePlatform() ? Capacitor.convertFileSrc(fileUri) : fileUri
  const localRes = await fetch(webSrc)
  const blob = await localRes.blob()
  const fileSize = blob.size

  // 2. Initialize resumable upload
  const startUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`
  const startHeaders = {
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': String(fileSize),
    'X-Goog-Upload-Header-Content-Type': mimeType,
    'Content-Type': 'application/json',
  }

  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: startHeaders,
    body: JSON.stringify({
      file: { display_name: displayName || 'amethyst_media' },
    }),
  })

  if (!startRes.ok) {
    const errText = await startRes.text()
    throw new Error(`Gemini Files API upload initialization failed (${startRes.status}): ${errText}`)
  }

  const uploadUrl =
    startRes.headers.get('X-Goog-Upload-URL') || startRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) {
    throw new Error('Gemini Files API did not return upload URL')
  }

  // 3. Upload binary file bytes directly
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(fileSize),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: blob,
  })

  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    throw new Error(`Gemini Files API upload transfer failed (${uploadRes.status}): ${errText}`)
  }

  const uploadData = await uploadRes.json()
  const fileInfo = uploadData.file
  const fileUriResult = fileInfo.uri
  const fileName = fileInfo.name

  // 4. Poll until state is ACTIVE (if initially PROCESSING)
  let currentState = fileInfo.state
  let pollAttempts = 0
  while (currentState === 'PROCESSING' && pollAttempts < 20) {
    pollAttempts += 1
    await new Promise((r) => setTimeout(r, 2000))
    const checkRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`
    )
    if (checkRes.ok) {
      const checkData = await checkRes.json()
      currentState = checkData.state
    }
  }

  if (currentState !== 'ACTIVE' && currentState !== 'STATE_UNSPECIFIED') {
    throw new Error(`Gemini file processing did not become active (state: ${currentState})`)
  }

  return {
    fileUri: fileUriResult,
    fileName,
    mimeType,
  }
}

/**
 * Execute Gemini generateContent with token-bucket pacing and retry backoff.
 */
export async function executeGeminiWithRetry(url, payload, { maxRetries = 5 } = {}) {
  let attempt = 0
  while (attempt <= maxRetries) {
    attempt += 1
    await waitForTokenBucket()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const status = res.status
      if (status === 200) {
        return await res.json()
      }

      if (status === 429 || status === 503) {
        if (attempt <= maxRetries) {
          const backoffMs = calculateGeminiBackoff(attempt)
          console.warn(`[Gemini] Hit HTTP ${status} (attempt ${attempt}). Backing off for ${Math.round(backoffMs)}ms…`)
          await new Promise((r) => setTimeout(r, backoffMs))
          continue
        }
      }

      const errText = await res.text()
      throw new Error(`Gemini request failed (${status}): ${errText}`)
    } catch (err) {
      if (attempt > maxRetries) throw err
      const backoffMs = calculateGeminiBackoff(attempt)
      await new Promise((r) => setTimeout(r, backoffMs))
    }
  }
  throw new Error('Gemini max retries exceeded')
}

/**
 * Analyze Video Reel with Gemini 3.5 Flash Lite in one call.
 */
export async function analyzeVideoReel({ fileUri, mimeType = 'video/mp4', caption = '', music = null, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  const musicContext = music?.songName
    ? `Audio attribution from platform: Song "${music.songName}" by "${music.artistName || 'Unknown'}" (${music.usesOriginalAudio ? 'Original Audio' : 'Licensed Audio'}). Do not guess different songs.`
    : 'No platform song metadata provided.'

  const prompt = `You are extracting structured metadata from this social video for personal knowledge library.
Caption provided: "${caption}"
${musicContext}

Return a valid JSON object matching this schema exactly:
{
  "transcript": "string: complete spoken audio transcript or description of dialogue",
  "summary": "string: clear 2-3 sentence summary of the video content and key takeaway",
  "tags": ["string: 3 to 7 relevant categorization tags"],
  "resources": ["string: URLs, books, tools, or references mentioned in the video or caption"]
}`

  const payload = {
    contents: [
      {
        parts: [
          {
            file_data: {
              mime_type: mimeType,
              file_uri: fileUri,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.2,
    },
  }

  const responseJson = await executeGeminiWithRetry(url, payload)
  const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!candidateText) {
    throw new Error('Gemini returned empty candidate response')
  }

  return JSON.parse(candidateText)
}

/**
 * Analyze Carousel with multiple slides in ONE single Gemini call.
 */
export async function analyzeCarousel({ slideImages, caption = '', apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  const parts = []

  // Add all slide images as parts
  for (let i = 0; i < slideImages.length; i++) {
    const slide = slideImages[i]
    if (slide.inlineData) {
      parts.push({
        inline_data: {
          mime_type: slide.mimeType || 'image/jpeg',
          data: slide.inlineData,
        },
      })
    } else if (slide.fileUri) {
      parts.push({
        file_data: {
          mime_type: slide.mimeType || 'image/jpeg',
          file_uri: slide.fileUri,
        },
      })
    }
  }

  const prompt = `This is a multi-slide carousel post (${slideImages.length} slides).
Post caption: "${caption}"

Analyze all slides sequentially and return a single valid JSON object:
{
  "slides": [
    {
      "slideIndex": 1,
      "ocrText": "exact text on slide",
      "description": "visual description of slide"
    }
  ],
  "summary": "comprehensive summary of entire carousel",
  "tags": ["3 to 7 tags"],
  "resources": ["any URLs, tools or resources referenced"]
}`

  parts.push({ text: prompt })

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.2,
    },
  }

  const responseJson = await executeGeminiWithRetry(url, payload)
  const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!candidateText) {
    throw new Error('Gemini returned empty candidate response')
  }

  return JSON.parse(candidateText)
}

