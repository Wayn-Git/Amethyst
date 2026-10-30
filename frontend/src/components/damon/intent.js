import rules from '../../../../backend/launcher/intent_rules.json'
import { classifyIntentWithRules } from './intentCore.js'

export const INTENT_RULES = rules

export function classifyIntent(raw, explicitMode = 'all') {
  return classifyIntentWithRules(raw, explicitMode, rules)
}
