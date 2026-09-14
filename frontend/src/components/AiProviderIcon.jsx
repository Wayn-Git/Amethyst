import { useMemo } from 'react'
import * as si from 'simple-icons'

/* Embedded SVG paths from thesvg.org / simple-icons / brand vectors */
const OPENAI_PATH =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.5045 4.5045 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.597 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4062-.667zM20.932 18.0673a4.4708 4.4708 0 0 1 .5346 3.0137l-.142-.0852-4.783-2.7582a.7712.7712 0 0 0-.7806 0l-5.8428 3.3685v-2.3324a.0804.0804 0 0 1 .0332-.0615L14.26 13.0498a4.4992 4.4992 0 0 1 6.672 5.0175zM12 14.7077l-2.614-1.509 2.614-1.509 2.614 1.509-2.614 1.509z'

const GROQ_PATH =
  'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V14h-2v2.93A8 8 0 0 1 4.07 13H7v-2H4.07A8 8 0 0 1 11 4.07V7h2V4.07A8 8 0 0 1 19.93 11H17v2h2.93A8 8 0 0 1 13 16.93z'

const COHERE_PATH =
  'M7.5 4a3.5 3.5 0 0 0-3.5 3.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9zm0 3h9a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5z'

const STEPFUN_PATH =
  'M22.012 0h1.032v.927H24v.968h-.956V3.78h-1.032V1.896h-1.878v-.97h1.878V0zM2.6 12.371V1.87h.969v10.502h-.97zm10.423.66h10.95v.918h-6.208v9.579h-4.742V13.03zM5.629 3.333v12.356H0v4.51h10.386V8L20.859 8l-.003-4.668-15.227.001z'

const NOUS_PATH =
  'M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.8l7 3.5v7.4l-7 3.5-7-3.5V8.3l7-3.5zm0 3.2L6.5 11 12 14.2 17.5 11 12 8z'

const KILOCODE_PATH =
  'M4 3h4v7.2l5.6-7.2h5L11.5 13l7.5 8h-5.2L8 14.8V21H4V3z'

const OPENCODE_PATH =
  'M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4zm3 4.5l5 3.5-5 3.5v-2l2.1-1.5L5 10.5v-2zm7 7h6v2h-6v-2z'

const ALL_PROVIDERS_PATH =
  'M3 6.5h18v2H3v-2zm0 4.5h18v2H3v-2zm0 4.5h18v2H3v-2z'

const AUTO_WAND_PATH =
  'M14.5 2.5a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L8.2 22.8a1 1 0 0 1-.7.3H2.5a1 1 0 0 1-1-1v-5a1 1 0 0 1 .3-.7L14.5 2.5zm1.4 2.8L4.5 16.7v2.8h2.8L18.7 8.1l-2.8-2.8zM18 1.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5zm4 5l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1z'

export default function AiProviderIcon({
  provider,
  name,
  model,
  size = 16,
  className = '',
  color,
}) {
  const modelStr = (model || '').toLowerCase().trim()
  const provStr = (provider || name || '').toLowerCase().trim()

  const { path, viewBox } = useMemo(() => {
    // 1. Check special types first: All (≡) and Auto (magic wand)
    if (provStr === 'all' || provStr === 'menu' || provStr === 'list') {
      return { path: ALL_PROVIDERS_PATH, viewBox: '0 0 24 24' }
    }
    if (provStr === 'auto' || provStr === 'routing' || modelStr === 'auto') {
      return { path: AUTO_WAND_PATH, viewBox: '0 0 24 24' }
    }

    // 2. Identify brand by model id first, then fallback to provider name
    const target = `${modelStr} ${provStr}`

    // Anthropic / Claude
    if (target.includes('claude') || target.includes('anthropic')) {
      return { path: si.siAnthropic?.path, viewBox: '0 0 24 24' }
    }

    // Google / Gemini / Gemma
    if (target.includes('gemini') || target.includes('gemma')) {
      return { path: si.siGooglegemini?.path, viewBox: '0 0 24 24' }
    }
    if (target.includes('google')) {
      return { path: si.siGoogle?.path, viewBox: '0 0 24 24' }
    }

    // Meta / Llama
    if (target.includes('llama') || target.includes('meta')) {
      return { path: si.siMeta?.path, viewBox: '0 0 24 24' }
    }

    // Mistral / Codestral
    if (target.includes('mistral') || target.includes('codestral') || target.includes('ministral')) {
      return { path: si.siMistralai?.path, viewBox: '0 0 24 24' }
    }

    // DeepSeek
    if (target.includes('deepseek')) {
      return { path: si.siDeepseek?.path, viewBox: '0 0 24 24' }
    }

    // Moonshot / Kimi
    if (target.includes('moonshot') || target.includes('kimi')) {
      return { path: si.siMoonshotai?.path, viewBox: '0 0 24 24' }
    }

    // MiniMax
    if (target.includes('minimax')) {
      return { path: si.siMinimax?.path, viewBox: '0 0 24 24' }
    }

    // Qwen / Alibaba / DashScope
    if (target.includes('qwen') || target.includes('alibaba') || target.includes('dashscope')) {
      return { path: si.siQwen?.path, viewBox: '0 0 24 24' }
    }

    // OpenAI / GPT / o1 / o3
    if (target.includes('openai') || target.includes('chatgpt') || target.includes('gpt') || target.includes('o1') || target.includes('o3')) {
      return { path: OPENAI_PATH, viewBox: '0 0 24 24' }
    }

    // StepFun
    if (target.includes('stepfun') || target.includes('step-')) {
      return { path: STEPFUN_PATH, viewBox: '0 0 24 24' }
    }

    // Cohere
    if (target.includes('cohere') || target.includes('north') || target.includes('command-r')) {
      return { path: COHERE_PATH, viewBox: '0 0 24 24' }
    }

    // Nvidia
    if (target.includes('nvidia') || target.includes('nemotron') || target.includes('nvlm')) {
      return { path: si.siNvidia?.path, viewBox: '0 0 24 24' }
    }

    // Cloudflare
    if (target.includes('cloudflare') || target.startsWith('@cf')) {
      return { path: si.siCloudflare?.path, viewBox: '0 0 24 24' }
    }

    // Ollama
    if (target.includes('ollama')) {
      return { path: si.siOllama?.path, viewBox: '0 0 24 24' }
    }

    // Groq
    if (target.includes('groq')) {
      return { path: GROQ_PATH, viewBox: '0 0 24 24' }
    }

    // Nous Research
    if (target.includes('nous') || target.includes('hermes')) {
      return { path: NOUS_PATH, viewBox: '0 0 24 24' }
    }

    // Perplexity
    if (target.includes('perplexity') || target.includes('sonar')) {
      return { path: si.siPerplexity?.path, viewBox: '0 0 24 24' }
    }

    // KiloCode
    if (target.includes('kilocode') || target.includes('kilo')) {
      return { path: KILOCODE_PATH, viewBox: '0 0 24 24' }
    }

    // OpenCode / Pickle
    if (target.includes('opencode') || target.includes('pickle')) {
      return { path: OPENCODE_PATH, viewBox: '0 0 24 24' }
    }

    // Fallback: provider name matching or general code icon
    return { path: KILOCODE_PATH, viewBox: '0 0 24 24' }
  }, [modelStr, provStr])

  const iconColor = color || 'currentColor'

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox || '0 0 24 24'}
      fill={iconColor}
      className={`ai-provider-svg ${className}`}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}
