import { httpPost } from './nativeHttp.js'
import { sanitizeErrorMessage, parseRetryAfter } from './shareJob.js'

/**
 * Resolve provider config from bundle.llm.
 * Reads providers[] and default; falls back to top-level alias (provider, model, api_key).
 * Routes each call by the provider's own entry, not by guessing from the model name.
 */
export function resolveProviderConfig(llmConfig, targetProvider = null) {
  if (!llmConfig || typeof llmConfig !== 'object') {
    return null
  }

  const providers = Array.isArray(llmConfig.providers) ? llmConfig.providers : []
  let entry = null

  // 1. Explicit target provider requested (by index or provider name)
  if (targetProvider !== null && targetProvider !== undefined) {
    if (typeof targetProvider === 'number' && providers[targetProvider]) {
      entry = providers[targetProvider]
    } else if (typeof targetProvider === 'string') {
      entry = providers.find(
        (p) => p.provider?.toLowerCase() === targetProvider.toLowerCase() ||
               p.id?.toLowerCase() === targetProvider.toLowerCase() ||
               p.name?.toLowerCase() === targetProvider.toLowerCase()
      )
    }
  }

  // 2. Read from default pointer if present
  if (!entry && providers.length > 0) {
    const def = llmConfig.default
    if (typeof def === 'number' && providers[def]) {
      entry = providers[def]
    } else if (typeof def === 'string') {
      entry = providers.find(
        (p) => p.provider?.toLowerCase() === def.toLowerCase() ||
               p.id?.toLowerCase() === def.toLowerCase() ||
               p.name?.toLowerCase() === def.toLowerCase()
      )
    }
    // Fall back to first provider in list
    if (!entry) {
      entry = providers[0]
    }
  }

  // 3. Fallback to top-level alias if providers[] missing, empty, or unresolvable
  if (!entry) {
    if (llmConfig.provider || llmConfig.api_key) {
      entry = {
        provider: llmConfig.provider,
        model: llmConfig.model,
        api_key: llmConfig.api_key,
        base_url: llmConfig.base_url,
      }
    }
  }

  if (!entry || !entry.api_key) {
    return null
  }

  return {
    provider: (entry.provider || llmConfig.provider || 'anthropic').toLowerCase(),
    model: entry.model || llmConfig.model || '',
    api_key: entry.api_key || llmConfig.api_key || '',
    base_url: entry.base_url || llmConfig.base_url || '',
    models: entry.models || [],
  }
}

/**
 * Returns a sane default model for known provider names.
 */
export function getDefaultModelForProvider(provider) {
  const p = (provider || '').toLowerCase()
  if (p === 'anthropic') return 'claude-3-5-sonnet-20241022'
  if (p === 'google' || p === 'gemini') return 'gemini-2.0-flash'
  if (p === 'openai') return 'gpt-4o'
  if (p === 'openrouter') return 'anthropic/claude-3.5-sonnet'
  if (p === 'groq') return 'llama-3.3-70b-versatile'
  return 'default'
}

/**
 * Collect all models available across all configured providers in bundle.llm.
 * Preselects default model based on bundle.llm.default.
 */
export function getAvailableModels(llmConfig) {
  if (!llmConfig || typeof llmConfig !== 'object') {
    return { models: [], defaultModelId: null }
  }

  const providers = Array.isArray(llmConfig.providers) && llmConfig.providers.length > 0
    ? llmConfig.providers
    : (llmConfig.provider && llmConfig.api_key ? [llmConfig] : [])

  if (providers.length === 0) {
    return { models: [], defaultModelId: null }
  }

  const defaultIdx = typeof llmConfig.default === 'number'
    ? llmConfig.default
    : (typeof llmConfig.default === 'string'
        ? providers.findIndex((p) => p.provider?.toLowerCase() === llmConfig.default?.toLowerCase())
        : 0)
  const safeDefaultIdx = defaultIdx >= 0 && defaultIdx < providers.length ? defaultIdx : 0

  const models = []
  let defaultModelId = null

  providers.forEach((p, pIdx) => {
    const providerName = (p.provider || 'anthropic').toLowerCase()
    let modelList = []
    if (Array.isArray(p.models) && p.models.length > 0) {
      modelList = p.models
    } else if (p.model) {
      modelList = [p.model]
    } else {
      modelList = [getDefaultModelForProvider(providerName)]
    }

    modelList.forEach((m) => {
      const modelName = typeof m === 'string' ? m : (m.id || m.name || String(m))
      const id = `${pIdx}:${modelName}`
      const capitalized = providerName.charAt(0).toUpperCase() + providerName.slice(1)
      models.push({
        id,
        providerIndex: pIdx,
        provider: providerName,
        model: modelName,
        label: `${capitalized} · ${modelName}`,
      })

      if (pIdx === safeDefaultIdx && (!defaultModelId || modelName === p.model)) {
        defaultModelId = id
      }
    })
  })

  if (!defaultModelId && models.length > 0) {
    defaultModelId = models[0].id
  }

  return { models, defaultModelId }
}

/**
 * Call the configured LLM to generate a concise summary.
 * Conforms to provider specifications:
 * - Anthropic: Messages API v2023-06-01
 * - Google Gemini: generateContent v1beta (x-goog-api-key header ONLY, NEVER in URL)
 * - OpenAI / OpenRouter / Groq / OpenAI-compatible: Chat Completions API
 *
 * Never logs, prints, or displays API keys or URLs containing keys.
 */
export async function summarizeWithLlm({
  llmConfig,
  prompt,
  text,
  title = '',
  url = '',
  http = httpPost,
  targetProvider = null,
}) {
  const active = resolveProviderConfig(llmConfig, targetProvider)

  if (!active || !active.api_key) {
    const err = new Error('Re-scan QR on your PC')
    err.authError = true
    err.source = 'llm'
    throw err
  }

  const provider = active.provider
  const model = active.model || 'claude-3-5-sonnet-20241022'
  const apiKey = active.api_key
  const baseUrl = active.base_url
  const systemPrompt = prompt || 'Summarize the input concisely with key takeaways and actionable points.'

  let userContent = ''
  if (title) userContent += `Title: ${title}\n`
  if (url) userContent += `Source URL: ${url}\n`
  if (userContent) userContent += '\n'
  userContent += text

  // 1. Anthropic Claude (routed strictly by provider's own entry)
  if (provider === 'anthropic') {
    const res = await http({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      data: {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      },
    })

    if (res.status === 401 || res.status === 403) {
      const err = new Error('Re-scan QR on your PC')
      err.authError = true
      err.source = 'llm'
      throw err
    }

    if (res.status === 429) {
      const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
      const delayMs = parseRetryAfter(retryHeader)
      const err = new Error('LLM rate limit reached (429). Retrying soon.')
      err.isRateLimit = true
      err.retryAfterMs = delayMs
      err.source = 'llm'
      throw err
    }

    if (res.status >= 400) {
      const rawMsg = res.data?.error?.message || `LLM request failed with status ${res.status}`
      throw new Error(sanitizeErrorMessage(rawMsg))
    }

    const contentBlocks = res.data?.content || []
    const textBlock = contentBlocks.find((b) => b.type === 'text') || contentBlocks[0]
    return textBlock?.text || ''
  }

  // 2. Google Gemini
  // IMPORTANT: Key is passed via header 'x-goog-api-key', NEVER in query parameter.
  if (provider === 'google' || provider === 'gemini') {
    const res = await http({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: {
        'x-goog-api-key': apiKey,
      },
      data: {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
      },
    })

    if (res.status === 401 || res.status === 403) {
      const err = new Error('Re-scan QR on your PC')
      err.authError = true
      err.source = 'llm'
      throw err
    }

    if (res.status === 429) {
      const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
      const delayMs = parseRetryAfter(retryHeader)
      const err = new Error('Google Gemini rate limit reached (429). Retrying soon.')
      err.isRateLimit = true
      err.retryAfterMs = delayMs
      err.source = 'llm'
      throw err
    }

    if (res.status >= 400) {
      const rawMsg = res.data?.error?.message || `Google Gemini request failed with status ${res.status}`
      throw new Error(sanitizeErrorMessage(rawMsg))
    }

    const candidate = res.data?.candidates?.[0]
    const part = candidate?.content?.parts?.[0]
    return part?.text || ''
  }

  // 3. OpenAI / OpenRouter / Groq / OpenAI-compatible
  let endpoint = 'https://api.openai.com/v1/chat/completions'
  if (baseUrl) {
    const root = baseUrl.replace(/\/+$/, '')
    endpoint = root.endsWith('/chat/completions') ? root : `${root}/chat/completions`
  } else if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions'
  } else if (provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions'
  }

  const res = await http({
    url: endpoint,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    data: {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    },
  })

  if (res.status === 401 || res.status === 403) {
    const err = new Error('Re-scan QR on your PC')
    err.authError = true
    err.source = 'llm'
    throw err
  }

  if (res.status === 429) {
    const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
    const delayMs = parseRetryAfter(retryHeader)
    const err = new Error('LLM rate limit reached (429). Retrying soon.')
    err.isRateLimit = true
    err.retryAfterMs = delayMs
    err.source = 'llm'
    throw err
  }

  if (res.status >= 400) {
    const rawMsg = res.data?.error?.message || `LLM request failed with status ${res.status}`
    throw new Error(sanitizeErrorMessage(rawMsg))
  }

  return res.data?.choices?.[0]?.message?.content || ''
}

/**
 * Perform a full multi-turn chat completion with optional tool calls and streaming.
 * Routes each call by the provider's own entry, never guessing by model name.
 * Handles Anthropic, Google Gemini, and OpenAI-compatible providers.
 */
export async function chatWithLlm({
  llmConfig,
  selectedModel = null,
  messages = [],
  tools = [],
  systemPrompt = '',
  onDelta = null,
  signal = null,
  http = httpPost,
}) {
  if (signal?.aborted) {
    const err = new Error('Turn interrupted by user')
    err.name = 'AbortError'
    throw err
  }

  let providerIndex = null
  let requestedModel = null

  if (selectedModel && typeof selectedModel === 'object') {
    providerIndex = selectedModel.providerIndex ?? null
    requestedModel = selectedModel.model || null
  } else if (typeof selectedModel === 'string') {
    if (selectedModel.includes(':')) {
      const parts = selectedModel.split(':')
      const parsedIdx = parseInt(parts[0], 10)
      if (!Number.isNaN(parsedIdx)) {
        providerIndex = parsedIdx
        requestedModel = parts.slice(1).join(':')
      } else {
        requestedModel = selectedModel
      }
    } else {
      requestedModel = selectedModel
    }
  }

  const active = resolveProviderConfig(llmConfig, providerIndex)
  if (!active || !active.api_key) {
    const err = new Error('Re-scan QR on your PC')
    err.authError = true
    err.source = 'llm'
    throw err
  }

  const provider = active.provider
  const model = requestedModel || active.model || getDefaultModelForProvider(provider)
  const apiKey = active.api_key
  const baseUrl = active.base_url

  // 1. ANTHROPIC (Messages API)
  if (provider === 'anthropic') {
    const anthropicMessages = []
    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'user') {
        anthropicMessages.push({
          role: 'user',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        })
      } else if (msg.role === 'assistant') {
        const blocks = []
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content })
        }
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id || `toolu_${Math.random().toString(36).slice(2, 10)}`,
              name: tc.name,
              input: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : (tc.arguments || {}),
            })
          }
        }
        anthropicMessages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : '' })
      } else if (msg.role === 'tool') {
        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          is_error: msg.is_error || msg.status === 'error',
        }
        const lastMsg = anthropicMessages[anthropicMessages.length - 1]
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(toolResultBlock)
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [toolResultBlock],
          })
        }
      }
    }

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.parameters || { type: 'object', properties: {} },
    }))

    const payload = {
      model,
      max_tokens: 4096,
      messages: anthropicMessages,
    }
    if (systemPrompt) payload.system = systemPrompt
    if (anthropicTools.length > 0) payload.tools = anthropicTools

    const res = await http({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      data: payload,
    })

    if (signal?.aborted) {
      const err = new Error('Turn interrupted by user')
      err.name = 'AbortError'
      throw err
    }

    if (res.status === 401 || res.status === 403) {
      const err = new Error('Re-scan QR on your PC')
      err.authError = true
      err.source = 'llm'
      throw err
    }

    if (res.status === 429) {
      const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
      const delayMs = parseRetryAfter(retryHeader)
      const err = new Error('LLM rate limit reached (429). Retrying soon.')
      err.isRateLimit = true
      err.retryAfterMs = delayMs
      err.source = 'llm'
      throw err
    }

    if (res.status >= 400) {
      const rawMsg = res.data?.error?.message || `Anthropic request failed with status ${res.status}`
      throw new Error(sanitizeErrorMessage(rawMsg))
    }

    const contentBlocks = res.data?.content || []
    let text = ''
    const toolCalls = []

    for (const b of contentBlocks) {
      if (b.type === 'text') {
        text += b.text
        if (onDelta) onDelta(b.text)
      } else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id,
          name: b.name,
          arguments: b.input || {},
        })
      }
    }

    return { text, tool_calls: toolCalls, raw: res.data }
  }

  // 2. GOOGLE GEMINI (generateContent)
  // Key passed strictly via header x-goog-api-key, never in URL
  if (provider === 'google' || provider === 'gemini') {
    const contents = []
    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
        })
      } else if (msg.role === 'assistant') {
        const parts = []
        if (msg.content) {
          parts.push({ text: msg.content })
        }
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : (tc.arguments || {}),
              },
            })
          }
        }
        contents.push({ role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] })
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.name,
                response: {
                  content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                },
              },
            },
          ],
        })
      }
    }

    const geminiTools = tools.length > 0
      ? [
          {
            function_declarations: tools.map((t) => ({
              name: t.name,
              description: t.description || '',
              parameters: t.parameters || { type: 'OBJECT', properties: {} },
            })),
          },
        ]
      : undefined

    const payload = { contents }
    if (systemPrompt) {
      payload.system_instruction = { parts: [{ text: systemPrompt }] }
    }
    if (geminiTools) {
      payload.tools = geminiTools
    }

    const res = await http({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: {
        'x-goog-api-key': apiKey,
      },
      data: payload,
    })

    if (signal?.aborted) {
      const err = new Error('Turn interrupted by user')
      err.name = 'AbortError'
      throw err
    }

    if (res.status === 401 || res.status === 403) {
      const err = new Error('Re-scan QR on your PC')
      err.authError = true
      err.source = 'llm'
      throw err
    }

    if (res.status === 429) {
      const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
      const delayMs = parseRetryAfter(retryHeader)
      const err = new Error('Google Gemini rate limit reached (429). Retrying soon.')
      err.isRateLimit = true
      err.retryAfterMs = delayMs
      err.source = 'llm'
      throw err
    }

    if (res.status >= 400) {
      const rawMsg = res.data?.error?.message || `Google Gemini request failed with status ${res.status}`
      throw new Error(sanitizeErrorMessage(rawMsg))
    }

    const candidate = res.data?.candidates?.[0]
    const parts = candidate?.content?.parts || []
    let text = ''
    const toolCalls = []

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p.text) {
        text += p.text
        if (onDelta) onDelta(p.text)
      } else if (p.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${i}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args || {},
        })
      }
    }

    return { text, tool_calls: toolCalls, raw: res.data }
  }

  // 3. OPENAI / OPENROUTER / GROQ / OPENAI-COMPATIBLE
  let endpoint = 'https://api.openai.com/v1/chat/completions'
  if (baseUrl) {
    const root = baseUrl.replace(/\/+$/, '')
    endpoint = root.endsWith('/chat/completions') ? root : `${root}/chat/completions`
  } else if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions'
  } else if (provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions'
  }

  const openaiMessages = []
  if (systemPrompt) {
    openaiMessages.push({ role: 'system', content: systemPrompt })
  }

  for (const msg of messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'user') {
      openaiMessages.push({
        role: 'user',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      })
    } else if (msg.role === 'assistant') {
      const item = {
        role: 'assistant',
        content: msg.content || null,
      }
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        item.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
          },
        }))
      }
      openaiMessages.push(item)
    } else if (msg.role === 'tool') {
      openaiMessages.push({
        role: 'tool',
        tool_call_id: msg.tool_call_id,
        name: msg.name,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      })
    }
  }

  const openaiTools = tools.length > 0
    ? tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      }))
    : undefined

  const payload = {
    model,
    messages: openaiMessages,
  }
  if (openaiTools) payload.tools = openaiTools

  const res = await http({
    url: endpoint,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    data: payload,
  })

  if (signal?.aborted) {
    const err = new Error('Turn interrupted by user')
    err.name = 'AbortError'
    throw err
  }

  if (res.status === 401 || res.status === 403) {
    const err = new Error('Re-scan QR on your PC')
    err.authError = true
    err.source = 'llm'
    throw err
  }

  if (res.status === 429) {
    const retryHeader = res.headers?.['retry-after'] || res.headers?.['Retry-After']
    const delayMs = parseRetryAfter(retryHeader)
    const err = new Error('LLM rate limit reached (429). Retrying soon.')
    err.isRateLimit = true
    err.retryAfterMs = delayMs
    err.source = 'llm'
    throw err
  }

  if (res.status >= 400) {
    const rawMsg = res.data?.error?.message || `LLM request failed with status ${res.status}`
    throw new Error(sanitizeErrorMessage(rawMsg))
  }

  const choice = res.data?.choices?.[0]
  const message = choice?.message || {}
  const text = message.content || ''
  if (text && onDelta) onDelta(text)

  const toolCalls = []
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      let parsedArgs = {}
      try {
        parsedArgs = typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments || {})
      } catch {
        parsedArgs = {}
      }
      toolCalls.push({
        id: tc.id,
        name: tc.function?.name,
        arguments: parsedArgs,
      })
    }
  }

  return { text, tool_calls: toolCalls, raw: res.data }
}
