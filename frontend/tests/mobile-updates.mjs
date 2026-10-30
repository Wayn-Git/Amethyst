import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newerUpdate } from '../src/mobile/updates.js'
const release = {version_code:2, version:'1.0.1', sha256:'a'.repeat(64), size:6000000}
test('update check compares Android build codes and never offers a downgrade', () => {
  assert.equal(newerUpdate(release, '1'), true)
  assert.equal(newerUpdate(release, '2'), false)
  assert.equal(newerUpdate(release, '3'), false)
})
test('untrusted update metadata and oversized APKs are refused', () => {
  for (const change of [{sha256:'bad'}, {version_code:2.5}, {size:0}, {size:101*1024*1024}, {version:''}]) {
    assert.throws(() => newerUpdate({...release,...change}, '1'))
  }
  assert.throws(() => newerUpdate(release, 'unknown'))
})
