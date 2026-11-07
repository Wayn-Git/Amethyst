import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepAiEngine probes local Ollama and lists free cloud providers', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepAiEngine.jsx', 'utf8')
  assert.match(content, /localhost:11434/)
  assert.match(content, /detectModels/)
  assert.match(content, /Groq/)
  assert.match(content, /Gemini|Google/)
  assert.match(content, /Skip for now/)
})
