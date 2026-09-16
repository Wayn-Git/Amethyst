/**
 * Safe localStorage wrapper that never throws ReferenceError or SecurityError
 * even in private mode, sandboxed iframes, pywebview (WebKitGTK/WKWebView),
 * SSR, or environments where `localStorage` is not exposed globally.
 */
export const safeStorage = {
  getItem(key, fallback = null) {
    try {
      if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
        const val = window.localStorage.getItem(key)
        return val !== null ? val : fallback
      }
    } catch {
      /* ignore restricted storage */
    }
    return fallback
  },

  setItem(key, value) {
    try {
      if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
        window.localStorage.setItem(key, String(value))
        return true
      }
    } catch {
      /* quota exceeded, security restriction, or private mode */
    }
    return false
  },

  removeItem(key) {
    try {
      if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
        window.localStorage.removeItem(key)
        return true
      }
    } catch {
      /* ignore */
    }
    return false
  },

  clear() {
    try {
      if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
        window.localStorage.clear()
        return true
      }
    } catch {
      /* ignore */
    }
    return false
  },
}

export default safeStorage
