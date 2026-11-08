import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBundle } from '../src/mobile/bundle.js'

test('validates incoming synced credentials bundle with full credentials', () => {
  const incoming = {
    device_id: 'phone_01',
    llm: {
      providers: [
        { provider: 'openai', model: 'gpt-4o', api_key: 'sk-12345' },
      ],
      default: 0,
      provider: 'openai',
      model: 'gpt-4o',
      api_key: 'sk-12345',
    },
    composio: { api_key: 'comp_123', user_id: 'uid_123' },
    drive: { root_folder_id: 'root_1', inbox_folder_id: 'inbox_1' },
    prompts: { summary: 'Concise summary' },
  }
  const check = validateBundle(incoming)
  assert.equal(check.valid, true)
})

test('validates incoming synced credentials bundle with empty composio/drive', () => {
  const incoming = {
    device_id: 'phone_02',
    llm: {
      providers: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet', api_key: 'sk-ant-12345' },
      ],
      default: 0,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      api_key: 'sk-ant-12345',
    },
    composio: { api_key: '', user_id: '' },
    drive: { root_folder_id: '', inbox_folder_id: '', connected: false },
    prompts: { summary: 'Concise summary' },
  }
  const check = validateBundle(incoming)
  assert.equal(check.valid, true)
})
