/**
 * Damon intent router.
 *
 * Every keystroke used to fan out to every provider: apps, files, windows,
 * clipboard, system commands, library, web, video, images, GitHub, and the
 * answer model. The result was a wall of unrelated sections and a network
 * call for a query that only ever wanted one of them.
 *
 * This file is deliberately a pure function over a declarative rule table.
 * No model call, no network, no React. The backend reads the same
 * `intent_rules.json`, so the two cannot drift.
 */

function compile(pattern) {
  return new RegExp(pattern, 'i')
}

function isQuestion(text, rules) {
  const rule = (rules.rules || []).find((entry) => entry.mode === 'question')
  if (!rule) return false
  if (rule.min_length && text.length < rule.min_length) return false
  return rule.patterns.some((pattern) => compile(pattern).test(text))
}

function buildIntent(mode, subject, explicit, rules) {
  const config = rules.intents[mode] || rules.intents.local
  const ask = config.ask === 'question' ? isQuestion(subject, rules) : Boolean(config.ask)
  return {
    mode,
    label: config.label,
    icon: config.icon,
    tone: config.tone,
    view: config.view || 'all',
    placeholder: config.placeholder,
    providers: [...(config.providers || [])],
    external: [...(config.external || [])],
    evidence: ask ? [...(config.evidence || [])] : [],
    ask,
    subject,
    explicit,
    localSearch: Boolean(config.localSearch),
  }
}

export function classifyIntentWithRules(raw, explicitMode, rules) {
  const text = String(raw ?? '').trim()
  const explicit = explicitMode && explicitMode !== 'all' ? explicitMode : null

  // A chosen mode is a promise. It wins over any prefix the user typed.
  if (explicit && rules.intents[explicit]) {
    return buildIntent(explicit, text, true, rules)
  }

  if (!text) return buildIntent('home', '', false, rules)

  for (const prefix of rules.prefixes || []) {
    const pattern = compile(prefix.pattern)
    if (pattern.test(text)) {
      return buildIntent(prefix.mode, text.replace(pattern, '').trim(), true, rules)
    }
  }

  for (const rule of rules.rules || []) {
    if (rule.min_length && text.length < rule.min_length) continue
    for (const source of rule.patterns) {
      const pattern = compile(source)
      if (!pattern.test(text)) continue
      const subject = rule.strip ? text.replace(pattern, '').trim() : text
      return buildIntent(rule.mode, subject, false, rules)
    }
  }

  const words = text.split(/\s+/).filter(Boolean).length
  const fallback = rules.fallback
  const mode = words <= fallback.short_max_words ? fallback.short : fallback.default
  return buildIntent(mode, text, false, rules)
}
