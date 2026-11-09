/**
 * Client operating system detection and copy personalization.
 */

export function getClientOSFromUA(userAgent = '') {
  const ua = (userAgent || '').toLowerCase()
  if (ua.includes('mac') || ua.includes('darwin')) return 'Mac'
  if (ua.includes('win')) return 'PC'
  if (ua.includes('linux')) return 'Linux machine'
  return 'computer'
}

export function getClientOS() {
  if (typeof window === 'undefined') return 'Mac'
  return getClientOSFromUA(window.navigator?.userAgent || '')
}

export function getDisclaimerText(os = null) {
  const targetOS = os || getClientOS()
  return `Everything stays on this ${targetOS} until you connect something.`
}

