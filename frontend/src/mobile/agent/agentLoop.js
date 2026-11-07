/**
 * Agent Reason -> Act -> Observe Loop for Mobile Companion.
 * UI-independent engine for running turns, invoking tools via Composio,
 * enforcing confirmation gates, and preventing prompt-injection escalation.
 */

import { chatWithLlm, getAvailableModels } from '../llmClient.js'
import { MOBILE_BASE_PROMPT } from './prompts.js'
import { getToolsForUser, executeToolWithSafety } from './toolRegistry.js'
import { getConversation, createConversation, saveConversation } from './conversationStore.js'

export const DEFAULT_MAX_STEPS = 8

/**
 * Run a full agent turn on mobile.
 */
export async function runAgentTurn({
  conversationId,
  userText,
  bundle,
  selectedModelId = null,
  onEvent = () => {},
  onConfirm = null,
  signal = null,
  http = undefined,
  maxSteps = DEFAULT_MAX_STEPS,
}) {
  // 1. Validate bundle
  if (!bundle || !bundle.device_id || !bundle.llm) {
    const errorMsg = 'Pair with your PC to start using the mobile agent.'
    onEvent({
      type: 'error',
      error: errorMsg,
      missingBundle: true,
    })
    const err = new Error(errorMsg)
    err.missingBundle = true
    throw err
  }

  // 2. Resolve or create local conversation
  let conversation = null
  if (conversationId) {
    conversation = await getConversation(conversationId)
  }
  if (!conversation) {
    const title = (userText || 'New conversation').trim().slice(0, 40)
    conversation = await createConversation(title)
  }

  // 3. Add user message
  const userMsg = {
    id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    content: userText,
    timestamp: new Date().toISOString(),
  }
  conversation.messages.push(userMsg)
  await saveConversation(conversation)
  onEvent({ type: 'user_message', message: userMsg })

  // 4. Resolve active model and tools
  const { models, defaultModelId } = getAvailableModels(bundle.llm)
  const activeModelId = selectedModelId || defaultModelId || models[0]?.id
  const targetModel = models.find((m) => m.id === activeModelId) || models[0] || null

  const tools = await getToolsForUser({
    composioConfig: bundle.composio,
    http,
  })

  // 5. Execution loop
  let currentStep = 0
  let accumulatedDelta = ''
  let turnCompleted = false

  while (currentStep < maxSteps && !turnCompleted) {
    if (signal?.aborted) {
      onEvent({ type: 'status', status: 'interrupted' })
      return { conversation, status: 'interrupted' }
    }

    onEvent({ type: 'status', status: 'thinking' })

    let response = null
    try {
      response = await chatWithLlm({
        llmConfig: bundle.llm,
        selectedModel: targetModel,
        messages: conversation.messages,
        tools,
        systemPrompt: MOBILE_BASE_PROMPT,
        onDelta: (chunk) => {
          accumulatedDelta += chunk
          onEvent({
            type: 'delta',
            delta: chunk,
            fullText: accumulatedDelta,
          })
        },
        signal,
        http,
      })
    } catch (llmErr) {
      if (signal?.aborted || llmErr.name === 'AbortError') {
        onEvent({ type: 'status', status: 'interrupted' })
        return { conversation, status: 'interrupted' }
      }

      const isAuth = llmErr.authError || llmErr.status === 401 || llmErr.status === 403
      const isComposio = llmErr.source === 'composio'
      const finalMsg = isAuth
        ? (isComposio ? 'Reconnect Google Drive on the PC' : 'Re-scan QR on your PC')
        : llmErr.message

      onEvent({
        type: 'error',
        error: finalMsg,
        authError: isAuth,
        isRateLimit: Boolean(llmErr.isRateLimit),
        retryAfterMs: llmErr.retryAfterMs,
        source: llmErr.source || 'llm',
      })
      throw llmErr
    }

    const hasToolCalls = Array.isArray(response.tool_calls) && response.tool_calls.length > 0

    // Branch A: Direct answer, no tool calls
    if (!hasToolCalls) {
      const assistantText = response.text || accumulatedDelta || ''
      const assistantMsg = {
        id: `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: assistantText,
        timestamp: new Date().toISOString(),
      }
      conversation.messages.push(assistantMsg)
      await saveConversation(conversation)

      onEvent({
        type: 'done',
        conversation,
        fullText: assistantText,
      })
      turnCompleted = true
      return { conversation, status: 'completed', fullText: assistantText }
    }

    // Branch B: Model invoked tool calls
    onEvent({ type: 'status', status: 'tool' })

    const assistantTurnMsg = {
      id: `msg_a_tc_${Date.now()}_${currentStep}`,
      role: 'assistant',
      content: response.text || null,
      tool_calls: response.tool_calls,
      timestamp: new Date().toISOString(),
    }
    conversation.messages.push(assistantTurnMsg)

    for (const tc of response.tool_calls) {
      if (signal?.aborted) {
        onEvent({ type: 'status', status: 'interrupted' })
        return { conversation, status: 'interrupted' }
      }

      onEvent({
        type: 'tool_call',
        id: tc.id,
        tool: tc.name,
        arguments: tc.arguments,
        status: 'running',
      })

      let execResult = null
      try {
        execResult = await executeToolWithSafety({
          toolName: tc.name,
          args: tc.arguments,
          composioConfig: bundle.composio,
          http,
          onConfirm: async ({ tool, args, reason }) => {
            onEvent({ type: 'status', status: 'awaiting_confirmation' })
            if (onConfirm) {
              return onConfirm({ tool, args, reason, requestId: tc.id })
            }
            // Return false if no confirm handler
            return false
          },
        })
      } catch (toolErr) {
        if (toolErr.authError || toolErr.isRateLimit) {
          const isComposio = toolErr.source === 'composio'
          const errMsg = toolErr.authError
            ? (isComposio ? 'Reconnect Google Drive on the PC' : 'Re-scan QR on your PC')
            : toolErr.message

          onEvent({
            type: 'error',
            error: errMsg,
            authError: toolErr.authError,
            isRateLimit: Boolean(toolErr.isRateLimit),
            retryAfterMs: toolErr.retryAfterMs,
            source: toolErr.source || 'composio',
          })
          throw toolErr
        }

        execResult = {
          status: 'error',
          error: toolErr.message || `Tool ${tc.name} execution failed`,
        }
      }

      const isError = execResult.status === 'error' || execResult.status === 'cancelled'
      const payloadContent = isError ? execResult.error : execResult.data

      onEvent({
        type: 'tool_result',
        id: tc.id,
        tool: tc.name,
        result: payloadContent,
        status: execResult.status,
      })

      // Wrap in untrusted data delimiters so LLM treats as inert DATA, not instructions
      const wrappedData = `<untrusted_tool_result name="${tc.name}" status="${execResult.status}">\n${payloadContent}\n</untrusted_tool_result>`

      conversation.messages.push({
        id: `msg_t_${Date.now()}_${tc.id}`,
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: wrappedData,
        is_error: isError,
        timestamp: new Date().toISOString(),
      })
    }

    currentStep += 1

    // Guard: Step limit reached
    if (currentStep >= maxSteps && !turnCompleted) {
      onEvent({
        type: 'warning',
        warning: `Maximum tool execution steps (${maxSteps}) reached.`,
      })

      // Synthesize final response with no further tools
      const finalResp = await chatWithLlm({
        llmConfig: bundle.llm,
        selectedModel: targetModel,
        messages: [
          ...conversation.messages,
          {
            role: 'user',
            content: `NOTICE: Maximum tool call limit (${maxSteps} steps) reached. Provide your final answer based on the information gathered so far without making any further tool calls.`,
          },
        ],
        tools: [],
        systemPrompt: MOBILE_BASE_PROMPT,
        onDelta: (chunk) => {
          accumulatedDelta += chunk
          onEvent({
            type: 'delta',
            delta: chunk,
            fullText: accumulatedDelta,
          })
        },
        signal,
        http,
      })

      const assistantMsg = {
        id: `msg_a_final_${Date.now()}`,
        role: 'assistant',
        content: finalResp.text || accumulatedDelta || '',
        timestamp: new Date().toISOString(),
      }
      conversation.messages.push(assistantMsg)
      await saveConversation(conversation)

      onEvent({
        type: 'done',
        conversation,
        fullText: assistantMsg.content,
      })
      turnCompleted = true
      return { conversation, status: 'completed', fullText: assistantMsg.content }
    }
  }

  await saveConversation(conversation)
  return { conversation, status: 'completed', fullText: accumulatedDelta }
}

