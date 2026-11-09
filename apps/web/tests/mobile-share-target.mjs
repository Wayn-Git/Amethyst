import { test } from 'node:test'
import assert from 'node:assert/strict'

// Polyfill window.localStorage for Node test environment
if (typeof globalThis.window === 'undefined') {
  const store = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
  }
  globalThis.localStorage = globalThis.window.localStorage
}

import {
  buildJobId,
  normalizeUrl,
  extractUrl,
  isPcRunnerHost,
  isVideoContent,
  routeJob,
  extractPageText,
  formatSummaryMarkdown,
  formatInboxJob,
  sanitizeErrorMessage,
  parseRetryAfter,
  DEFAULT_MAX_ARTICLE_CHARS,
} from '../src/mobile/shareJob.js'
import {
  enqueueShare,
  getShareJobs,
  getShareJob,
  clearAllShareJobs,
  processJob,
  processQueue,
  retryShareJob,
  calculateBackoffMs,
  loadPersistedQueue,
  SHARE_QUEUE_STORAGE_KEY,
} from '../src/mobile/shareQueue.js'
import { summarizeWithLlm, resolveProviderConfig } from '../src/mobile/llmClient.js'
import {
  executeComposioTool,
  ensureSummariesFolder,
  writeSummaryToDrive,
  writeInboxJobToDrive,
  checkFileExists,
} from '../src/mobile/composioClient.js'
import { safeStorage } from '../src/lib/storage.js'

const MOCK_BUNDLE = {
  device_id: 'test_phone_device_01',
  llm: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    api_key: 'sk-ant-fake-key-for-test-only',
  },
  composio: {
    api_key: 'comp_fake_key_for-test-only',
    user_id: 'test_user_01',
  },
  drive: {
    root_folder_id: 'drive_root_folder_111',
    inbox_folder_id: 'drive_inbox_folder_222',
  },
  prompts: {
    summary: 'Summarize concisely with bullet points.',
  },
}

test('1. Dedupe by hash: URL and text canonicalization generates identical job IDs', () => {
  const raw1 = 'https://example.com/article?utm_source=twitter&utm_medium=social&igsh=abcdef'
  const raw2 = 'https://example.com/article'
  const raw3 = 'Check this out: https://example.com/article?fbclid=xyz123'

  const id1 = buildJobId(raw1)
  const id2 = buildJobId(raw2)
  const id3 = buildJobId(raw3)

  assert.equal(id1, id2, 'Tracking query parameters must not alter job ID')
  assert.equal(id1, id3, 'Surrounding text must not alter job ID when same URL is present')

  const slash1 = buildJobId('https://example.com/path/')
  const slash2 = buildJobId('https://example.com/path')
  assert.equal(slash1, slash2, 'Trailing slashes should be normalized')

  const text1 = buildJobId('Important meeting notes with team')
  const text2 = buildJobId('  Important   meeting    notes with team \n ')
  assert.equal(text1, text2, 'Whitespace variations in plain text must produce identical job IDs')

  const diffId = buildJobId('https://example.com/different-article')
  assert.notEqual(id1, diffId)
})

test('2. Dedupe by hash: Double share prevents queue duplication', async () => {
  clearAllShareJobs()

  const shareText = 'https://example.com/research-paper?utm_source=linkedin'
  const expectedId = buildJobId(shareText)

  // First share
  const job1 = await enqueueShare(shareText, { autoProcess: false })
  assert.equal(job1.id, expectedId)
  assert.equal(getShareJobs().length, 1)

  // Second share of same link with different wrapper text
  const job2 = await enqueueShare(`Hey read this: https://example.com/research-paper`, { autoProcess: false })
  assert.equal(job2.id, expectedId)
  assert.equal(getShareJobs().length, 1, 'Double share must not create duplicate entry in queue')

  // If first job is completed, subsequent share returns completed job without re-enqueueing
  job1.state = 'completed'
  job1.summary = 'Existing summary'
  safeStorage.setItem(SHARE_QUEUE_STORAGE_KEY, JSON.stringify([job1]))
  loadPersistedQueue()

  const job3 = await enqueueShare('https://example.com/research-paper', { autoProcess: false })
  assert.equal(job3.state, 'completed')
  assert.equal(job3.summary, 'Existing summary')
  assert.equal(getShareJobs().length, 1)
})

test('3. Routing: Mirrors PC runner hosts exactly, and catches unsupported schemes', () => {
  // Plain text -> summary
  const rText = routeJob('Meeting action items: 1. finalize spec 2. deploy')
  assert.equal(rText.route, 'summary')
  assert.equal(rText.kind, 'text')
  assert.equal(rText.targetUrl, null)

  // Normal web article -> summary
  const rArticle = routeJob('https://paulgraham.com/lesson.html?session=abc')
  assert.equal(rArticle.route, 'summary')
  assert.equal(rArticle.kind, 'url')
  assert.equal(rArticle.targetUrl, 'https://paulgraham.com/lesson.html?session=abc', 'Target URL must be original')

  // Supported PC runner hosts:
  // 1. Instagram
  const rIgReel = routeJob('https://www.instagram.com/reel/DA123456789/?igsh=xyz')
  assert.equal(rIgReel.route, 'inbox')
  assert.equal(rIgReel.kind, 'video')

  const rIgPost = routeJob('https://instagr.am/p/ABC987654/')
  assert.equal(rIgPost.route, 'inbox')
  assert.equal(rIgPost.kind, 'video')

  // 2. YouTube
  const rYt = routeJob('https://youtu.be/dQw4w9WgXcQ')
  assert.equal(rYt.route, 'inbox')
  assert.equal(rYt.kind, 'video')

  const rYtShorts = routeJob('https://youtube.com/shorts/abcdefg')
  assert.equal(rYtShorts.route, 'inbox')
  assert.equal(rYtShorts.kind, 'video')

  // 3. Reddit
  const rReddit = routeJob('https://www.reddit.com/r/technology/comments/123/title/')
  assert.equal(rReddit.route, 'inbox')
  assert.equal(rReddit.kind, 'url')

  const rVReddit = routeJob('https://v.redd.it/12345abcdef')
  assert.equal(rVReddit.route, 'inbox')
  assert.equal(rVReddit.kind, 'video')

  // 4. Twitter / X
  const rTwitter = routeJob('https://x.com/user/status/1234567890')
  assert.equal(rTwitter.route, 'inbox')
  assert.equal(rTwitter.kind, 'url')

  // 5. Pinterest
  const rPin = routeJob('https://pin.it/abc1234')
  assert.equal(rPin.route, 'inbox')

  // 6. Threads
  const rThreads = routeJob('https://www.threads.net/@user/post/C98765')
  assert.equal(rThreads.route, 'inbox')

  // 7. Direct MP4
  const rMp4 = routeJob('https://files.example.com/recording.mp4')
  assert.equal(rMp4.route, 'inbox')
  assert.equal(rMp4.kind, 'video')

  // Non-PC website (e.g. Medium, Substack, GitHub) -> goes to summary!
  const rMedium = routeJob('https://medium.com/@author/great-post')
  assert.equal(rMedium.route, 'summary')

  // Unsupported scheme (e.g. ftp:// or file://)
  const rFtp = routeJob('ftp://files.example.com/archive.zip')
  assert.equal(rFtp.route, 'unsupported')
  assert.ok(rFtp.error.includes('Unsupported'))
})

test('4. Fetch with original URL and use canonical form only for hash', async () => {
  clearAllShareJobs()

  const originalUrl = 'https://example.com/article?page=2&ref=newsletter&token=abc123'
  const job = await enqueueShare(originalUrl, { autoProcess: false })

  // Target URL is original
  assert.equal(job.url, originalUrl)

  // Canonical URL has tracking parameters stripped
  assert.ok(!job.canonicalUrl.includes('ref=newsletter'))
  assert.ok(job.canonicalUrl.includes('token=abc123')) // non-tracking params kept

  let requestedUrl = null
  const fakeHttp = async ({ url, data }) => {
    if (url.startsWith('https://example.com')) {
      requestedUrl = url
      return { status: 200, data: '<html><title>Test Page</title><body>Article body text here.</body></html>' }
    }
    if (url.includes('api.anthropic.com')) {
      return { status: 200, data: { content: [{ type: 'text', text: 'Summary of article.' }] } }
    }
    if (url.includes('GOOGLEDRIVE_FIND_FILE')) {
      return { status: 200, data: { files: [] } }
    }
    if (url.includes('GOOGLEDRIVE_CREATE_FILE_FROM_TEXT')) {
      return { status: 200, data: { id: 'file_created_1' } }
    }
    return { status: 200, data: {} }
  }

  await processJob(job, {
    bundleResolver: async () => MOCK_BUNDLE,
    httpClientGet: fakeHttp,
    httpClientPost: fakeHttp,
  })

  // Verified: Native HTTP fetched with original URL!
  assert.equal(requestedUrl, originalUrl)
})

test('5. Check file existence in Drive before writing: Idempotency & crash recovery', async () => {
  clearAllShareJobs()

  const articleUrl = 'https://example.com/crashed-upload-test'
  const job = await enqueueShare(articleUrl, { autoProcess: false })

  let findFileCalled = false
  let createFileCalled = false

  // Simulate Drive already having <id>.md (write succeeded earlier, but app died before updating queue)
  const fakeHttp = async ({ url, data }) => {
    if (url === articleUrl) {
      return { status: 200, data: '<html><title>Silicon</title><body>Some body text.</body></html>' }
    }
    if (url.includes('api.anthropic.com')) {
      return { status: 200, data: { content: [{ type: 'text', text: 'Silicon summary.' }] } }
    }
    if (url.includes('GOOGLEDRIVE_FIND_FILE')) {
      findFileCalled = true
      // Return summaries folder or existing file
      if (data?.arguments?.q?.includes(`name = '${job.id}.md'`)) {
        return {
          status: 200,
          data: { files: [{ id: 'existing_drive_file_id_999', name: `${job.id}.md` }] },
        }
      }
      return {
        status: 200,
        data: { files: [{ id: 'summaries_folder_123', name: 'summaries' }] },
      }
    }
    if (url.includes('GOOGLEDRIVE_CREATE_FILE_FROM_TEXT')) {
      createFileCalled = true
      return { status: 200, data: { id: 'should_not_be_created' } }
    }
    return { status: 200, data: {} }
  }

  const success = await processJob(job, {
    bundleResolver: async () => MOCK_BUNDLE,
    httpClientGet: fakeHttp,
    httpClientPost: fakeHttp,
  })

  assert.equal(success, true)
  assert.equal(findFileCalled, true, 'Must check GOOGLEDRIVE_FIND_FILE before writing')
  assert.equal(createFileCalled, false, 'Must NOT call CREATE_FILE_FROM_TEXT if file already exists in Drive')
  assert.equal(job.state, 'completed')
  assert.ok(job.progress.includes('Found existing'))
})

test('6. Error classification: Article-fetch 401/403/404/5xx must NOT set authError', async () => {
  clearAllShareJobs()

  // Article page returns 403 Forbidden (e.g. Cloudflare or paywall)
  const paywallUrl = 'https://wsj.com/articles/paywalled-article'
  const job = await enqueueShare(paywallUrl, { autoProcess: false })

  let llmReceivedContent = ''
  const fakeHttp = async ({ url, data }) => {
    if (url === paywallUrl) {
      // Simulating a paywall/CDN 403
      return { status: 403, data: 'Forbidden. Please sign in or subscribe.' }
    }
    if (url.includes('api.anthropic.com')) {
      llmReceivedContent = data.messages[0].content
      return { status: 200, data: { content: [{ type: 'text', text: 'Summary of shared link.' }] } }
    }
    if (url.includes('GOOGLEDRIVE_FIND_FILE')) {
      return { status: 200, data: { files: [{ id: 'summaries_folder_id' }] } }
    }
    if (url.includes('GOOGLEDRIVE_CREATE_FILE_FROM_TEXT')) {
      return { status: 200, data: { id: 'file_id_created' } }
    }
    return { status: 200, data: {} }
  }

  const success = await processJob(job, {
    bundleResolver: async () => MOCK_BUNDLE,
    httpClientGet: fakeHttp,
    httpClientPost: fakeHttp,
  })

  // Job must succeed despite article 403!
  assert.equal(success, true)
  assert.equal(job.state, 'completed')
  assert.equal(job.authError, false, 'Article 403 must NEVER set authError')
  assert.ok(llmReceivedContent.includes(paywallUrl), 'Falls back to summarizing the raw URL/link')
})

test('7. Error classification: Only LLM 401/403 -> "Re-scan QR on your PC"', async () => {
  clearAllShareJobs()

  const job = await enqueueShare('https://example.com/llm-auth-check', { autoProcess: false })

  const fakeHttp = async ({ url }) => {
    if (url.startsWith('https://example.com')) {
      return { status: 200, data: '<html><body>Article text</body></html>' }
    }
    if (url.includes('api.anthropic.com')) {
      return { status: 401, data: { error: { message: 'invalid_x_api_key' } } }
    }
    return { status: 200, data: {} }
  }

  const success = await processJob(job, {
    bundleResolver: async () => MOCK_BUNDLE,
    httpClientGet: fakeHttp,
    httpClientPost: fakeHttp,
  })

  assert.equal(success, false)
  assert.equal(job.state, 'failed')
  assert.equal(job.authError, true)
  assert.equal(job.error, 'Re-scan QR on your PC')
  assert.equal(job.authSource, 'llm')
})

test('8. Error classification: Composio 401 -> "Reconnect Google Drive on the PC"', async () => {
  clearAllShareJobs()

  const job = await enqueueShare('https://example.com/composio-auth-check', { autoProcess: false })

  const fakeHttp = async ({ url }) => {
    if (url.startsWith('https://example.com')) {
      return { status: 200, data: '<html><body>Article text</body></html>' }
    }
    if (url.includes('api.anthropic.com')) {
      return { status: 200, data: { content: [{ type: 'text', text: 'Good summary.' }] } }
    }
    if (url.includes('composio.dev')) {
      return { status: 401, data: { error: 'Unauthorized or expired connected account' } }
    }
    return { status: 200, data: {} }
  }

  const success = await processJob(job, {
    bundleResolver: async () => MOCK_BUNDLE,
    httpClientGet: fakeHttp,
    httpClientPost: fakeHttp,
  })

  assert.equal(success, false)
  assert.equal(job.state, 'failed')
  assert.equal(job.authError, true)
  assert.equal(job.error, 'Reconnect Google Drive on the PC')
  assert.equal(job.authSource, 'composio')
})

test('9. Rate limit 429: Honors Retry-After header and schedules next retry', async () => {
  clearAllShareJobs()

  const job = await enqueueShare('https://example.com/rate-limit-check', { autoProcess: false })

  const fakeHttp = async ({ url }) => {
    if (url.startsWith('https://example.com')) {
      return { status: 200, data: '<html><body>Article text</body></html>' }
    }
    if (url.includes('api.anthropic.com')) {
      // 429 with 45 seconds Retry-After
      return {
        status: 429,
        headers: { 'retry-after': '45' },
        data: { error: { message: 'Rate limit exceeded' } },
      }
    }
    return { status: 200, data: {} }
  }

  const before = Date.now()
  const success = await processJob(job, {
    bundleResolver: async () => MOCK_BUNDLE,
    httpClientGet: fakeHttp,
    httpClientPost: fakeHttp,
  })

  assert.equal(success, false)
  assert.equal(job.state, 'failed')
  assert.equal(job.authError, false, '429 is not an auth error')
  // Next retry scheduled around ~45s in future
  assert.ok(job.nextRetryAt >= before + 44000)
  assert.ok(job.nextRetryAt <= before + 46000)
  assert.ok(job.progress.includes('Retrying in 45s'))
})

test('10. Strip HTML and cap article text at ~20,000 chars with notice in summary', () => {
  // Generate long HTML (> 30,000 chars) with comments and script tags
  const repeatParagraph = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio.</p>\n'
  const longHtml = `
    <html>
      <head><title>Massive Article</title><style>body { color: red; }</style></head>
      <body>
        <!-- Header comment -->
        <nav><a href="/">Home</a></nav>
        <script>console.log("bad script");</script>
        <main>
          ${repeatParagraph.repeat(400)}
        </main>
        <footer>Copyright 2026</footer>
      </body>
    </html>
  `

  const parsed = extractPageText(longHtml, { maxChars: 20000 })
  assert.equal(parsed.title, 'Massive Article')
  assert.ok(!parsed.text.includes('<script>'))
  assert.ok(!parsed.text.includes('body { color: red; }'))
  assert.ok(!parsed.text.includes('Header comment'))
  assert.equal(parsed.text.length, 20000)
  assert.equal(parsed.wasTruncated, true)

  // Markdown format must announce truncation to user
  const md = formatSummaryMarkdown({
    title: parsed.title,
    url: 'https://example.com/massive',
    summaryText: 'Summary of truncated content.',
    wasTruncated: parsed.wasTruncated,
    maxChars: 20000,
  })

  assert.ok(md.includes('> **Notice:** Source text was truncated at 20,000 characters prior to summarization.'))
})

test('11. Security: Confirm no API keys or key URLs appear in Gemini path or error strings', async () => {
  // 1. Check Gemini path URL
  let capturedGeminiUrl = null
  let capturedGeminiHeaders = null

  const geminiBundle = {
    ...MOCK_BUNDLE,
    llm: {
      provider: 'google',
      model: 'gemini-1.5-flash',
      api_key: 'AIzaSyFakeSecretKeyNotReal1234567890',
    },
  }

  const fakeHttp = async ({ url, headers }) => {
    capturedGeminiUrl = url
    capturedGeminiHeaders = headers
    return {
      status: 200,
      data: {
        candidates: [{ content: { parts: [{ text: 'Gemini summary.' }] } }],
      },
    }
  }

  await summarizeWithLlm({
    llmConfig: geminiBundle.llm,
    text: 'Some input text',
    http: fakeHttp,
  })

  // Verify: Key is NEVER in query parameter, only in header!
  assert.ok(!capturedGeminiUrl.includes('key='), 'URL must NEVER contain API key')
  assert.ok(!capturedGeminiUrl.includes(geminiBundle.llm.api_key))
  assert.equal(capturedGeminiHeaders['x-goog-api-key'], geminiBundle.llm.api_key)

  // 2. Check sanitizeErrorMessage
  const leakyError = 'Request failed: https://api.example.com/v1?key=AIzaSySecret12345 with token sk-ant-secret123'
  const sanitized = sanitizeErrorMessage(leakyError)
  assert.ok(!sanitized.includes('AIzaSySecret12345'))
  assert.ok(!sanitized.includes('sk-ant-secret123'))
  assert.ok(sanitized.includes('[REDACTED]'))
})

test('12. LLM Client: Fallback to alias when providers[] is missing or empty', async () => {
  // Case A: Missing providers[] property entirely
  const aliasOnlyConfig = {
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    api_key: 'sk-ant-alias-only-key',
  }

  const resolvedA = resolveProviderConfig(aliasOnlyConfig)
  assert.equal(resolvedA.provider, 'anthropic')
  assert.equal(resolvedA.model, 'claude-3-5-haiku-20241022')
  assert.equal(resolvedA.api_key, 'sk-ant-alias-only-key')

  let calledUrlA = null
  let calledHeadersA = null
  await summarizeWithLlm({
    llmConfig: aliasOnlyConfig,
    text: 'Test content A',
    http: async ({ url, headers }) => {
      calledUrlA = url
      calledHeadersA = headers
      return {
        status: 200,
        data: { content: [{ type: 'text', text: 'Anthropic summary from alias.' }] },
      }
    },
  })
  assert.equal(calledUrlA, 'https://api.anthropic.com/v1/messages')
  assert.equal(calledHeadersA['x-api-key'], 'sk-ant-alias-only-key')

  // Case B: Empty providers[] array
  const emptyProvidersConfig = {
    providers: [],
    default: 0,
    provider: 'openai',
    model: 'gpt-4o-mini',
    api_key: 'sk-openai-alias-key',
  }

  const resolvedB = resolveProviderConfig(emptyProvidersConfig)
  assert.equal(resolvedB.provider, 'openai')
  assert.equal(resolvedB.model, 'gpt-4o-mini')
  assert.equal(resolvedB.api_key, 'sk-openai-alias-key')

  let calledUrlB = null
  let calledHeadersB = null
  await summarizeWithLlm({
    llmConfig: emptyProvidersConfig,
    text: 'Test content B',
    http: async ({ url, headers }) => {
      calledUrlB = url
      calledHeadersB = headers
      return {
        status: 200,
        data: { choices: [{ message: { content: 'OpenAI summary from alias.' } }] },
      }
    },
  })
  assert.equal(calledUrlB, 'https://api.openai.com/v1/chat/completions')
  assert.equal(calledHeadersB['Authorization'], 'Bearer sk-openai-alias-key')
})

test('13. LLM Client: Route provider/model pair by provider entry, never guessing from model name', async () => {
  const multiProviderLlm = {
    providers: [
      {
        provider: 'anthropic',
        model: 'gpt-model-deceptive-name-4',
        api_key: 'sk-ant-custom-anthropic-key',
      },
      {
        provider: 'google',
        model: 'claude-model-deceptive-name-3',
        api_key: 'AIzaSyFakeGoogleKey456',
      },
      {
        provider: 'openai',
        model: 'claude-3-5-sonnet-deceptive',
        api_key: 'sk-openai-custom-key',
      },
      {
        provider: 'custom-local',
        model: 'mistral-7b',
        api_key: 'sk-local-key',
        base_url: 'http://192.168.1.50:8000/v1',
      },
    ],
    default: 0,
    provider: 'anthropic',
    model: 'gpt-model-deceptive-name-4',
    api_key: 'sk-ant-custom-anthropic-key',
  }

  // 1. Default routing (index 0: Anthropic despite 'gpt-' model name)
  let call1 = null
  await summarizeWithLlm({
    llmConfig: multiProviderLlm,
    text: 'Hello test',
    http: async (opts) => {
      call1 = opts
      return {
        status: 200,
        data: { content: [{ type: 'text', text: 'Anthropic response.' }] },
      }
    },
  })
  assert.equal(call1.url, 'https://api.anthropic.com/v1/messages', 'Must route to Anthropic API')
  assert.equal(call1.headers['x-api-key'], 'sk-ant-custom-anthropic-key')
  assert.equal(call1.data.model, 'gpt-model-deceptive-name-4')

  // 2. Route by provider 'google' (despite 'claude-' in model name)
  let call2 = null
  await summarizeWithLlm({
    llmConfig: multiProviderLlm,
    targetProvider: 'google',
    text: 'Hello test 2',
    http: async (opts) => {
      call2 = opts
      return {
        status: 200,
        data: { candidates: [{ content: { parts: [{ text: 'Google response.' }] } }] },
      }
    },
  })
  assert.ok(call2.url.includes('generativelanguage.googleapis.com'), 'Must route to Google Gemini API')
  assert.ok(call2.url.includes('claude-model-deceptive-name-3:generateContent'))
  assert.equal(call2.headers['x-goog-api-key'], 'AIzaSyFakeGoogleKey456')

  // 3. Route by provider 'openai' (despite 'claude-' in model name)
  let call3 = null
  await summarizeWithLlm({
    llmConfig: multiProviderLlm,
    targetProvider: 'openai',
    text: 'Hello test 3',
    http: async (opts) => {
      call3 = opts
      return {
        status: 200,
        data: { choices: [{ message: { content: 'OpenAI response.' } }] },
      }
    },
  })
  assert.equal(call3.url, 'https://api.openai.com/v1/chat/completions', 'Must route to OpenAI API')
  assert.equal(call3.headers['Authorization'], 'Bearer sk-openai-custom-key')
  assert.equal(call3.data.model, 'claude-3-5-sonnet-deceptive')

  // 4. Route by provider with custom base_url
  let call4 = null
  await summarizeWithLlm({
    llmConfig: multiProviderLlm,
    targetProvider: 'custom-local',
    text: 'Hello test 4',
    http: async (opts) => {
      call4 = opts
      return {
        status: 200,
        data: { choices: [{ message: { content: 'Local response.' } }] },
      }
    },
  })
  assert.equal(call4.url, 'http://192.168.1.50:8000/v1/chat/completions', 'Must route to custom base_url')
  assert.equal(call4.headers['Authorization'], 'Bearer sk-local-key')
  assert.equal(call4.data.model, 'mistral-7b')
})
