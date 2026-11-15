import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { safeStorage } from '../../lib/storage.js'
import { extractInstagramTier1 } from '../instagramExtractor.js'
import { attemptTier2Extraction } from '../tier2Extractor.js'
import {
  downloadMediaToDisk,
  uploadToGeminiFilesApi,
  analyzeVideoReel,
  analyzeCarousel,
  executeGeminiWithRetry,
  GEMINI_MODEL,
} from '../geminiPipeline.js'
import {
  computeItemHash,
  syncItemsBatchToDrive,
  resolveDriveFolderId,
  pickDeterministicWinner,
} from '../driveSync.js'
import {
  enqueueSave,
  loadSavedItems,
  persistSavedItems,
  resumePendingPipelineItems,
} from '../capturePipeline.js'

export default function MobileSpikeHarness({ onClose }) {
  const [runningTest, setRunningTest] = useState(null)
  const [logs, setLogs] = useState([])
  const [testResults, setTestResults] = useState({})
  const [networkType, setNetworkType] = useState('unknown')

  const geminiKey = safeStorage.getItem('GEMINI_API_KEY') || ''
  const composioKey = safeStorage.getItem('COMPOSIO_API_KEY') || ''
  const spikeFolder = safeStorage.getItem('SPIKE_DRIVE_FOLDER') || 'amethyst-spike'

  const appendLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 150)])
  }

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.connection) {
      setNetworkType(navigator.connection.type || navigator.connection.effectiveType || 'wifi')
    }
  }, [])

  // ==========================================
  // T1: Tier 2 on Licensed Reels
  // ==========================================
  const runTestT1 = async () => {
    setRunningTest('T1')
    appendLog('Starting T1: Tier 2 on Licensed Reels...')
    const licensedUrls = [
      'https://www.instagram.com/reel/DdXGIh1JE4m/',
      'https://www.instagram.com/reel/DfaJEL3hAT4/',
      'https://www.instagram.com/reel/DfWaz5WNc3V/',
    ]

    const runs = []
    for (const url of licensedUrls) {
      appendLog(`Checking ${url}...`)
      const t1 = await extractInstagramTier1(url)
      if (t1.status === 'needs_tier2' || (t1.isVideo && !t1.videoUrl)) {
        appendLog(`Attempting Tier 2 hidden DOM on ${t1.shortcode}…`)
        const t2 = await attemptTier2Extraction(t1.shortcode)
        runs.push({
          url,
          shortcode: t1.shortcode,
          song: t1.music?.songName,
          t1Status: t1.status,
          t2Success: t2.success,
          isBlob: t2.isBlob,
          bytesObtained: t2.bytesObtained,
          method: t2.method,
          latencyMs: t2.latencyMs,
          error: t2.error,
        })
        appendLog(`T2 result: ${t2.method} (blob: ${t2.isBlob}, bytes: ${t2.bytesObtained})`)
      } else {
        runs.push({
          url,
          shortcode: t1.shortcode,
          song: t1.music?.songName,
          t1Status: t1.status,
          t2Success: false,
          isBlob: false,
          bytesObtained: false,
          method: 'not_needed_or_unavailable',
          error: t1.error || (t1.videoUrl ? 'Direct video_url present in Tier 1' : 'Post unavailable'),
        })
      }
    }

    const n = runs.length
    const successfulBytes = runs.filter((r) => r.bytesObtained).length
    const successRate = Math.round((successfulBytes / n) * 100)
    const verdict = n < 10 ? 'INCONCLUSIVE' : successRate >= 70 ? 'PASS' : 'FAIL'

    const t1Result = {
      test: 'T1_Tier2_Licensed_Reels',
      n,
      successCount: successfulBytes,
      successRatePct: successRate,
      verdict,
      runs,
      recommendation:
        successRate < 70
          ? 'Disable Tier 2 DOM scraper. Ship fallback: ready_partial with caption, official embed, and song metadata.'
          : 'Include Tier 2 DOM scraper in production pipeline.',
    }

    setTestResults((prev) => ({ ...prev, T1: t1Result }))
    appendLog(`T1 Complete: Verdict ${verdict} (Success: ${successRate}%, n=${n})`)
    setRunningTest(null)
  }

  // ==========================================
  // T2: Carousels Multi-Slide Gemini
  // ==========================================
  const runTestT2 = async () => {
    setRunningTest('T2')
    appendLog('Starting T2: Carousels JSON Paths & Single Gemini Call...')
    const carouselUrls = [
      'https://www.instagram.com/p/Dfg7exjmqI2/',
      'https://www.instagram.com/p/DffsOulx7Ip/',
      'https://www.instagram.com/p/Dffxea7gAY4/',
    ]

    const runs = []
    for (const url of carouselUrls) {
      appendLog(`Extracting embed for carousel ${url}…`)
      const t1 = await extractInstagramTier1(url)
      if (t1.mediaType === 'sidecar') {
        const slides = t1.sidecarChildren || []
        appendLog(`Found ${slides.length} slides for ${t1.shortcode}`)

        let geminiRes = null
        let geminiError = null
        if (slides.length > 0 && geminiKey) {
          try {
            // Test single-call multimodal analysis
            const downloadedSlides = []
            for (let i = 0; i < slides.length; i++) {
              if (slides[i].displayUrl) {
                const dl = await downloadMediaToDisk(slides[i].displayUrl, `t2_slide_${i}.jpg`)
                downloadedSlides.push({ fileUri: dl.uri, mimeType: 'image/jpeg', slideIndex: i + 1 })
              }
            }
            appendLog(`Calling Gemini with ${downloadedSlides.length} slides…`)
            geminiRes = await analyzeCarousel({
              slideImages: downloadedSlides,
              caption: t1.caption,
              apiKey: geminiKey,
            })
            appendLog(`Gemini carousel success: ${geminiRes.tags?.length || 0} tags returned`)
          } catch (err) {
            geminiError = err.message
            appendLog(`Gemini call error: ${err.message}`)
          }
        }

        runs.push({
          url,
          shortcode: t1.shortcode,
          slideCount: slides.length,
          slidesExposedInEmbed: slides.length > 0,
          geminiSuccess: Boolean(geminiRes),
          perSlideResults: Boolean(geminiRes?.slides && geminiRes.slides.length > 0),
          summarySnippet: geminiRes?.summary?.slice(0, 80),
          error: geminiError,
        })
      } else {
        runs.push({
          url,
          shortcode: t1.shortcode,
          slideCount: 0,
          slidesExposedInEmbed: false,
          error: t1.error || 'Not a sidecar carousel',
        })
      }
    }

    const n = runs.length
    const exposedCount = runs.filter((r) => r.slidesExposedInEmbed).length
    const verdict = n < 10 ? 'INCONCLUSIVE' : exposedCount >= 2 ? 'PASS' : 'FAIL'

    const t2Result = {
      test: 'T2_Carousels',
      n,
      slidesExposedCount: exposedCount,
      verdict,
      runs,
    }

    setTestResults((prev) => ({ ...prev, T2: t2Result }))
    appendLog(`T2 Complete: Verdict ${verdict} (${exposedCount}/${n} exposed slides)`)
    setRunningTest(null)
  }

  // ==========================================
  // T3: Cellular vs Wi-Fi Comparison
  // ==========================================
  const runTestT3 = async () => {
    setRunningTest('T3')
    appendLog(`Starting T3: Testing on network: ${networkType}…`)
    const mixedUrls = [
      'https://www.instagram.com/reel/DfgS7lWq_CZ/',
      'https://www.instagram.com/reel/Dff6X_cyhSy/',
      'https://www.instagram.com/reel/DffDcvkJ91o/',
      'https://www.instagram.com/reel/Dfgg0RTPYbV/',
      'https://www.instagram.com/reel/DfYFVE_ulU5/',
    ]

    const runs = []
    for (const url of mixedUrls) {
      appendLog(`Fetching ${url}…`)
      const res = await extractInstagramTier1(url)
      runs.push({
        url,
        shortcode: res.shortcode,
        status: res.status,
        mediaType: res.mediaType,
        hasVideoUrl: Boolean(res.videoUrl),
        videoUrl: res.videoUrl,
        song: res.music?.songName,
        networkType,
      })
    }

    const n = runs.length
    const passCount = runs.filter((r) => r.status === 'ready' || r.status === 'needs_tier2').length
    const successRate = Math.round((passCount / n) * 100)
    const verdict = n < 10 ? 'INCONCLUSIVE' : 'MEASURED'

    const t3Result = {
      test: 'T3_Cellular_vs_Wifi',
      networkType,
      n,
      passCount,
      successRatePct: successRate,
      verdict,
      runs,
    }

    setTestResults((prev) => ({ ...prev, T3: t3Result }))
    appendLog(`T3 Complete: ${passCount}/${n} passed on ${networkType}`)
    setRunningTest(null)
  }

  // ==========================================
  // T4: Download + Files API Upload
  // ==========================================
  const runTestT4 = async () => {
    setRunningTest('T4')
    appendLog('Starting T4: Download 10-15MB MP4 + Files API Upload…')

    // Public test 10MB MP4 sample
    const sampleVideoUrl =
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    const t0 = Date.now()

    try {
      appendLog('Streaming 10MB MP4 straight to disk via Filesystem.downloadFile…')
      const dl = await downloadMediaToDisk(sampleVideoUrl, 'spike_t4_test.mp4')
      const dlDurationMs = Date.now() - t0
      appendLog(`Download complete in ${dlDurationMs}ms to ${dl.path}`)

      appendLog('Uploading to Gemini Files API via native resumable upload…')
      const tUploadStart = Date.now()
      const upload = await uploadToGeminiFilesApi({
        fileUri: dl.uri,
        mimeType: 'video/mp4',
        displayName: 'spike_t4_test',
        apiKey: geminiKey,
      })
      const uploadDurationMs = Date.now() - tUploadStart
      appendLog(`Files API upload complete in ${uploadDurationMs}ms. URI: ${upload.fileUri}`)

      const t4Result = {
        test: 'T4_Download_FilesAPI_Upload',
        n: 1,
        downloadTimeMs: dlDurationMs,
        uploadTimeMs: uploadDurationMs,
        fileUri: upload.fileUri,
        bridgeErrors: 0,
        verdict: 'PASS',
      }
      setTestResults((prev) => ({ ...prev, T4: t4Result }))
    } catch (err) {
      appendLog(`T4 Error: ${err.message}`)
      setTestResults((prev) => ({
        ...prev,
        T4: { test: 'T4_Download_FilesAPI_Upload', n: 1, error: err.message, verdict: 'FAIL' },
      }))
    }
    setRunningTest(null)
  }

  // ==========================================
  // T5: Kill Test & Queue Crash Recovery
  // ==========================================
  const runTestT5 = async () => {
    setRunningTest('T5')
    appendLog('Starting T5: Kill Test & Write-First Crash Recovery…')

    const testUrl = 'https://www.instagram.com/reel/DfaJEL3hAT4/'
    const t0 = Date.now()
    const item = await enqueueSave(testUrl)
    const writeTimeMs = Date.now() - t0
    appendLog(`Write-First completed in ${writeTimeMs}ms (ID: ${item.id})`)

    // Simulate item being left in 'processing' state before kill
    const currentItems = loadSavedItems()
    const idx = currentItems.findIndex((i) => i.id === item.id)
    if (idx !== -1) {
      currentItems[idx].status = 'processing'
      currentItems[idx].progress = 'Simulated kill mid-pipeline'
      persistSavedItems(currentItems)
    }

    // Run auto-resume on relaunch
    appendLog('Simulating app relaunch: running resumePendingPipelineItems()…')
    const resumed = resumePendingPipelineItems()
    const recovered = resumed.find((i) => i.id === item.id)

    const success = recovered && recovered.status === 'queued'
    appendLog(`Recovery result: status=${recovered?.status}, progress=${recovered?.progress}`)

    const t5Result = {
      test: 'T5_Kill_Test',
      n: 1,
      writeFirstTimeMs: writeTimeMs,
      recoveredSuccessfully: success,
      verdict: success && writeTimeMs < 500 ? 'PASS' : 'FAIL',
    }

    setTestResults((prev) => ({ ...prev, T5: t5Result }))
    setRunningTest(null)
  }

  // ==========================================
  // T6: Composio 50 Drive Writes
  // ==========================================
  const runTestT6 = async () => {
    setRunningTest('T6')
    appendLog(`Starting T6: 50 Real Drive Writes to folder "${spikeFolder}"…`)

    if (!composioKey) {
      appendLog('Composio API key missing in .env')
      setTestResults((prev) => ({
        ...prev,
        T6: { test: 'T6_Composio_Drive_Writes', error: 'Missing Composio API Key', verdict: 'UNVERIFIED' },
      }))
      setRunningTest(null)
      return
    }

    const testItems = []
    for (let i = 1; i <= 50; i++) {
      const pad = String(i).padStart(3, '0')
      testItems.push({
        url: `https://www.instagram.com/reel/spike_test_${pad}/`,
        canonicalUrl: `https://www.instagram.com/reel/spike_test_${pad}/`,
        caption: `Automated Spike Test Reel #${i} testing Composio 50-batch Google Drive sync`,
        summary: `Summary of spike item #${i} validated through Amethyst mobile harness.`,
        tags: ['spike', 'drive', 'composio', `batch_${Math.ceil(i / 10)}`],
        savedAt: new Date().toISOString(),
      })
    }

    const t0 = Date.now()
    try {
      appendLog('Syncing 50 items batch via COMPOSIO_MULTI_EXECUTE_TOOL…')
      const batchResult = await syncItemsBatchToDrive({
        items: testItems,
        folderName: spikeFolder,
        apiKey: composioKey,
      })

      const totalTimeMs = Date.now() - t0
      appendLog(
        `Batch complete in ${totalTimeMs}ms: ${batchResult.syncedCount} synced, ${batchResult.skippedCount} skipped.`
      )

      // Test Concurrent Race for Deterministic Winner
      const raceFiles = [
        { id: 'drive_client_android', createdTime: '2026-11-09T18:00:01.200Z' },
        { id: 'drive_client_ios', createdTime: '2026-11-09T18:00:01.350Z' },
      ]
      const winner = pickDeterministicWinner(raceFiles)

      const t6Result = {
        test: 'T6_Composio_50_Drive_Writes',
        n: 50,
        totalTimeMs,
        syncedCount: batchResult.syncedCount,
        skippedCount: batchResult.skippedCount,
        deterministicWinnerId: winner.id,
        verdict: batchResult.syncedCount > 0 ? 'PASS' : 'FAIL',
      }

      setTestResults((prev) => ({ ...prev, T6: t6Result }))
    } catch (err) {
      appendLog(`T6 Error: ${err.message}`)
      setTestResults((prev) => ({
        ...prev,
        T6: { test: 'T6_Composio_50_Drive_Writes', error: err.message, verdict: 'FAIL' },
      }))
    }
    setRunningTest(null)
  }

  // ==========================================
  // T7: Gemini Queue 50 Saves
  // ==========================================
  const runTestT7 = async () => {
    setRunningTest('T7')
    appendLog('Starting T7: 50 Saves Through Gemini Queue (Free Tier Pacing)…')

    if (!geminiKey) {
      appendLog('Gemini API key missing in .env')
      setTestResults((prev) => ({
        ...prev,
        T7: { test: 'T7_Gemini_Queue', error: 'Missing Gemini Key', verdict: 'UNVERIFIED' },
      }))
      setRunningTest(null)
      return
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
    let successCount = 0
    let rateLimitCount = 0
    const t0 = Date.now()

    for (let i = 1; i <= 50; i++) {
      appendLog(`Processing item [${i}/50]…`)
      const payload = {
        contents: [
          {
            parts: [
              {
                text: `Extract 3 tags and 1-sentence summary from this caption: "Item #${i}: Coding tutorial on algorithms and distributed systems."`,
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.2,
        },
      }

      try {
        const res = await executeGeminiWithRetry(url, payload, { apiKey: geminiKey })
        if (res?.candidates) {
          successCount += 1
        }
      } catch (err) {
        if (err.message.includes('429')) rateLimitCount += 1
        appendLog(`Item ${i} error: ${err.message}`)
      }
    }

    const totalTimeMs = Date.now() - t0
    const t7Result = {
      test: 'T7_Gemini_Queue_50_Items',
      n: 50,
      successCount,
      rateLimitCount,
      totalTimeMs,
      verdict: successCount >= 45 ? 'PASS' : 'FAIL',
    }

    setTestResults((prev) => ({ ...prev, T7: t7Result }))
    appendLog(`T7 Complete: ${successCount}/50 passed in ${Math.round(totalTimeMs / 1000)}s`)
    setRunningTest(null)
  }

  // ==========================================
  // T8: URL Re-Fetch 24h Check
  // ==========================================
  const runTestT8 = async () => {
    setRunningTest('T8')
    appendLog('Starting T8: Signed Media URL Validity Re-Fetch…')

    const storedUrls = testResults.T3?.runs?.filter((r) => r.videoUrl) || []
    if (storedUrls.length === 0) {
      appendLog('No signed media URLs stored from T3 yet. Run T3 first.')
      setTestResults((prev) => ({
        ...prev,
        T8: { test: 'T8_URL_Refetch', error: 'No stored URLs from T3', verdict: 'INCONCLUSIVE' },
      }))
      setRunningTest(null)
      return
    }

    let activeCount = 0
    for (const r of storedUrls) {
      appendLog(`Checking TTL for shortcode ${r.shortcode}…`)
      try {
        const res = await fetch(r.videoUrl, { method: 'HEAD' })
        if (res.ok) {
          activeCount += 1
          appendLog(`URL for ${r.shortcode} still ACTIVE (HTTP ${res.status})`)
        } else {
          appendLog(`URL for ${r.shortcode} expired/failed (HTTP ${res.status})`)
        }
      } catch (err) {
        appendLog(`URL for ${r.shortcode} check error: ${err.message}`)
      }
    }

    const t8Result = {
      test: 'T8_URL_Refetch',
      n: storedUrls.length,
      activeCount,
      successRatePct: Math.round((activeCount / storedUrls.length) * 100),
      verdict: storedUrls.length < 10 ? 'INCONCLUSIVE' : 'MEASURED',
    }

    setTestResults((prev) => ({ ...prev, T8: t8Result }))
    setRunningTest(null)
  }

  // ==========================================
  // Run All Tests Sequentially
  // ==========================================
  const runAllTests = async () => {
    await runTestT1()
    await runTestT2()
    await runTestT3()
    await runTestT4()
    await runTestT5()
    await runTestT6()
    await runTestT7()
    await runTestT8()
  }

  // ==========================================
  // Export results.json
  // ==========================================
  const handleExportJson = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      device: 'Android_10BD6N042K000F3',
      networkType,
      spikeFolder,
      results: testResults,
      logs: logs.slice(0, 50),
    }

    const jsonString = JSON.stringify(exportData, null, 2)
    try {
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'results.json'
      a.click()
      URL.revokeObjectURL(url)
      appendLog('results.json exported to Downloads!')
    } catch {
      appendLog('Failed to trigger download, copied to clipboard.')
      navigator.clipboard?.writeText(jsonString)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0f12] text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-[#161a20] border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="font-semibold text-sm tracking-wide text-white">SPIKE HARNESS</h2>
          <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
            {networkType.toUpperCase()}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
        >
          Close
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Action Controls */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={runAllTests}
            disabled={Boolean(runningTest)}
            className="py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-xs text-white disabled:opacity-50"
          >
            Run All Tests (T1 - T8)
          </button>
          <button
            onClick={handleExportJson}
            className="py-2.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium text-xs text-white"
          >
            Export results.json
          </button>
        </div>

        {/* Individual Test Buttons */}
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={runTestT1}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T1: Tier 2
          </button>
          <button
            onClick={runTestT2}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T2: Carousel
          </button>
          <button
            onClick={runTestT3}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T3: Net
          </button>
          <button
            onClick={runTestT4}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T4: Media
          </button>
          <button
            onClick={runTestT5}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T5: Kill
          </button>
          <button
            onClick={runTestT6}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T6: Drive
          </button>
          <button
            onClick={runTestT7}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T7: Queue
          </button>
          <button
            onClick={runTestT8}
            disabled={Boolean(runningTest)}
            className="py-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono border border-slate-700"
          >
            T8: Re-fetch
          </button>
        </div>

        {/* Live Test Results Card */}
        <div className="bg-[#13161c] border border-slate-800 rounded-lg p-3 space-y-2">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Test Summary Table</h3>
          <div className="space-y-1.5 text-xs font-mono">
            {['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map((key) => {
              const res = testResults[key]
              const statusColor =
                res?.verdict === 'PASS'
                  ? 'text-emerald-400'
                  : res?.verdict === 'INCONCLUSIVE'
                  ? 'text-amber-400'
                  : res?.verdict === 'FAIL'
                  ? 'text-rose-400'
                  : 'text-slate-500'

              return (
                <div key={key} className="flex items-center justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-300 font-medium">{key}</span>
                  <span className="text-slate-400 text-[11px]">{res?.test || 'Not run'}</span>
                  <span className={`font-bold ${statusColor}`}>
                    {res ? `[${res.verdict}] (n=${res.n || 0})` : 'PENDING'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Console Logs */}
        <div className="bg-black/60 border border-slate-800 rounded-lg p-3">
          <h3 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Execution Logs</h3>
          <div className="h-48 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">No tests executed yet.</p>
            ) : (
              logs.map((l, i) => <p key={i}>{l}</p>)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
