import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepMicrosoftTodo component matches design requirements', () => {
  const file = fs.readFileSync('frontend/src/components/onboarding/StepMicrosoftTodo.jsx', 'utf8')
  assert.match(file, /Step 4 of 6 · Tasks/)
  assert.match(file, /Connect Microsoft To Do/)
  assert.match(file, /startMicrosoftDeviceAuth/)
  assert.match(file, /pollMicrosoftDeviceAuth/)
  assert.match(file, /api\.syncTasks/)
  assert.match(file, /userCode/)
  assert.match(file, /Copy code|Code copied/)
  assert.match(file, /What it powers/)
  assert.match(file, /Today/)
  assert.match(file, /Backlog/)
  assert.match(file, /Deadlines/)
  assert.match(file, /Reminders/)
  assert.match(file, /Skip for now/)
})

test('SplashScreenWizard wires StepMicrosoftTodo into step sequence', () => {
  const file = fs.readFileSync('frontend/src/components/SplashScreenWizard.jsx', 'utf8')
  assert.match(file, /import StepMicrosoftTodo from '\.\/onboarding\/StepMicrosoftTodo\.jsx'/)
  assert.match(file, /'microsoft_todo'/)
  assert.match(file, /case 'microsoft_todo':/)
  assert.match(file, /<StepMicrosoftTodo/)
})

test('BrandIcon contains microsoft-todo brand vector', () => {
  const file = fs.readFileSync('frontend/src/components/onboarding/BrandIcon.jsx', 'utf8')
  assert.match(file, /microsofttodo|microsoft/)
})

test('frontend api.js exposes Microsoft device flow methods', () => {
  const file = fs.readFileSync('frontend/src/api.js', 'utf8')
  assert.match(file, /startMicrosoftDeviceAuth\s*:/)
  assert.match(file, /pollMicrosoftDeviceAuth\s*:/)
  assert.match(file, /\/auth\/microsoft\/device\/start/)
  assert.match(file, /\/auth\/microsoft\/device\/poll/)
})

test('backend exposes device code flow endpoints and functions', () => {
  const authMs = fs.readFileSync('backend/auth/microsoft.py', 'utf8')
  assert.match(authMs, /DEVICE_ENDPOINT/)
  assert.match(authMs, /def start_device_flow/)
  assert.match(authMs, /def poll_device_flow/)

  const apiMain = fs.readFileSync('backend/api/main.py', 'utf8')
  assert.match(apiMain, /\/api\/auth\/microsoft\/device\/start/)
  assert.match(apiMain, /\/api\/auth\/microsoft\/device\/poll\/\{device_code\}/)
})

test('onboarding steps reflect consistent 6-step progression', () => {
  const profile = fs.readFileSync('frontend/src/components/onboarding/StepProfile.jsx', 'utf8')
  const ai = fs.readFileSync('frontend/src/components/onboarding/StepAiEngine.jsx', 'utf8')
  const storage = fs.readFileSync('frontend/src/components/onboarding/StepStorage.jsx', 'utf8')
  const todo = fs.readFileSync('frontend/src/components/onboarding/StepMicrosoftTodo.jsx', 'utf8')
  const mobile = fs.readFileSync('frontend/src/components/onboarding/StepMobile.jsx', 'utf8')
  const launch = fs.readFileSync('frontend/src/components/onboarding/StepLaunch.jsx', 'utf8')

  assert.match(profile, /Step 1 of 6 · Profile/)
  assert.match(ai, /Step 2 of 6 · AI engine/)
  assert.match(storage, /Step 3 of 6 · Storage/)
  assert.match(todo, /Step 4 of 6 · Tasks/)
  assert.match(mobile, /Step 5 of 6 · Mobile/)
  assert.match(launch, /Step 6 of 6 · Launch/)
  assert.match(launch, /Tasks/)
  assert.match(launch, /Microsoft To Do/)
})
