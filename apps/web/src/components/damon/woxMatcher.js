/**
 * Flow Launcher + Wox Client-Side Fuzzy String Matcher.
 * Matches acronyms (Flow Launcher StringMatcher.IsAcronym), multi-word tokens, and word boundaries.
 */

const SCORE_MATCH = 16
const BONUS_BOUNDARY = 8
const BONUS_CAMEL_CASE = 10
const BONUS_FIRST_CHAR = 12
const BONUS_CONSECUTIVE = 5
const BONUS_PREFIX = 20
const BONUS_EXACT = 100
const BONUS_ACRONYM = 90

const DELIMITERS = new Set([' ', '_', '-', '/', '\\', '.', ':', ';', ',', '#', '@', '(', ')', '[', ']', '{', '}'])

function isAcronymChar(text, idx) {
  if (idx === 0) return true
  const prev = text[idx - 1]
  const curr = text[idx]
  if (DELIMITERS.has(prev) && !DELIMITERS.has(curr)) return true
  if (prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z') return true
  if (!(prev >= '0' && prev <= '9') && (curr >= '0' && curr <= '9')) return true
  return false
}

function getAcronymString(text) {
  const letters = []
  for (let i = 0; i < text.length; i++) {
    if (isAcronymChar(text, i)) {
      letters.push(text[i].toLowerCase())
    }
  }
  return letters.join('')
}

function isBoundaryChar(text, idx) {
  if (idx === 0) return true
  const prev = text[idx - 1]
  if (DELIMITERS.has(prev)) return true
  const curr = text[idx]
  if (prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z') return true
  return false
}

function singleTokenMatch(text, pattern) {
  if (!pattern) return { isMatch: true, score: 0 }
  if (!text) return { isMatch: false, score: 0 }

  const textLower = text.toLowerCase()
  const patternLower = pattern.toLowerCase()
  const pLen = pattern.length
  const tLen = text.length

  // 1. Exact match
  if (textLower === patternLower) {
    return { isMatch: true, score: BONUS_EXACT + pLen * SCORE_MATCH }
  }

  // 2. Prefix match
  if (textLower.startsWith(patternLower)) {
    return { isMatch: true, score: BONUS_PREFIX + pLen * SCORE_MATCH + BONUS_FIRST_CHAR }
  }

  // 3. Flow Launcher Acronym match (e.g. 'vsc' -> 'Visual Studio Code', 'am' -> 'Amethyst')
  const acronym = getAcronymString(text)
  if (acronym && patternLower === acronym) {
    return { isMatch: true, score: BONUS_ACRONYM + pLen * 10 }
  }
  if (acronym && acronym.startsWith(patternLower)) {
    return { isMatch: true, score: BONUS_ACRONYM - 10 + pLen * 8 }
  }

  // 4. Word boundary substring match
  const pos = textLower.indexOf(patternLower)
  if (pos >= 0 && isBoundaryChar(text, pos)) {
    return {
      isMatch: true,
      score: BONUS_PREFIX + pLen * SCORE_MATCH + BONUS_BOUNDARY + (pLen - 1) * BONUS_CONSECUTIVE,
    }
  }

  // 5. Sequential fuzzy matching
  const matchedIndexes = []
  let pIdx = 0
  for (let tIdx = 0; tIdx < tLen; tIdx++) {
    if (textLower[tIdx] === patternLower[pIdx]) {
      matchedIndexes.push(tIdx)
      pIdx++
      if (pIdx === pLen) break
    }
  }

  if (matchedIndexes.length !== pLen) {
    return { isMatch: false, score: 0 }
  }

  let score = 0
  let prevIdx = -1
  for (let i = 0; i < pLen; i++) {
    const matchIdx = matchedIndexes[i]
    score += SCORE_MATCH
    if (isBoundaryChar(text, matchIdx)) score += BONUS_BOUNDARY
    if (i > 0 && matchIdx === prevIdx + 1) score += BONUS_CONSECUTIVE
    if (prevIdx >= 0) {
      const gap = matchIdx - prevIdx - 1
      if (gap > 0) score -= Math.min(gap * 2, 10)
    }
    prevIdx = matchIdx
  }

  if (score < 10) {
    if (textLower.includes(patternLower)) {
      return { isMatch: true, score: Math.max(15, pLen * 4) }
    }
    return { isMatch: false, score: 0 }
  }

  return { isMatch: true, score }
}

export function woxFuzzyMatch(text, pattern) {
  if (!pattern) return { isMatch: true, score: 0 }
  if (!text) return { isMatch: false, score: 0 }

  const tokens = pattern.trim().split(/\s+/)
  if (!tokens.length) return { isMatch: true, score: 0 }

  if (tokens.length === 1) {
    return singleTokenMatch(text, tokens[0])
  }

  let totalScore = 0
  for (const tok of tokens) {
    const res = singleTokenMatch(text, tok)
    if (!res.isMatch) return { isMatch: false, score: 0 }
    totalScore += res.score
  }

  return { isMatch: true, score: totalScore }
}
