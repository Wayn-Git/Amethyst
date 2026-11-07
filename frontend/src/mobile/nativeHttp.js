import { Capacitor, CapacitorHttp } from '@capacitor/core'

let customHttpHandler = null

/**
 * Configure a custom HTTP handler (used for test fakes and dependency injection).
 */
export function setCustomHttpHandler(handler) {
  customHttpHandler = handler
}

export function clearCustomHttpHandler() {
  customHttpHandler = null
}

/**
 * Execute native GET request.
 * Bypasses webview CORS restrictions on mobile via CapacitorHttp.
 */
export async function httpGet({ url, headers = {}, timeout = 25000 }) {
  if (customHttpHandler) {
    return customHttpHandler({ method: 'GET', url, headers, timeout })
  }

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: timeout,
      readTimeout: timeout,
    })
    return {
      status: res.status,
      data: res.data,
      headers: res.headers || {},
    }
  }

  // Fallback for webview / test runner
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    const contentType = res.headers.get('content-type') || ''
    const data = contentType.includes('application/json')
      ? await res.json().catch(() => '')
      : await res.text()
    return {
      status: res.status,
      data,
      headers: Object.fromEntries(res.headers.entries()),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Execute native POST request.
 * Bypasses webview CORS restrictions on mobile via CapacitorHttp.
 */
export async function httpPost({ url, headers = {}, data = {}, timeout = 40000 }) {
  if (customHttpHandler) {
    return customHttpHandler({ method: 'POST', url, headers, data, timeout })
  }

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url,
      headers: { 'Content-Type': 'application/json', ...headers },
      data,
      connectTimeout: timeout,
      readTimeout: timeout,
    })
    return {
      status: res.status,
      data: res.data,
      headers: res.headers || {},
    }
  }

  // Fallback for webview / test runner
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof data === 'string' ? data : JSON.stringify(data),
      signal: controller.signal,
    })
    const contentType = res.headers.get('content-type') || ''
    const responseData = contentType.includes('application/json')
      ? await res.json().catch(() => ({}))
      : await res.text()
    return {
      status: res.status,
      data: responseData,
      headers: Object.fromEntries(res.headers.entries()),
    }
  } finally {
    clearTimeout(timer)
  }
}
