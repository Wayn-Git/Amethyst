import { test } from 'node:test'
import assert from 'node:assert/strict'
// Capacitor's real proxy exposes a then property even though the native API
// has no then method. Exercise initialization under its Android bridge.
import { Capacitor } from '@capacitor/core'
const saved = new Map()
const calls = []
globalThis.androidBridge = {}
Capacitor.nativePromise = async (_plugin, method, args) => {
  calls.push(method)
  if (method === 'internalGetItem') return {data:saved.get(args.prefixedKey) ?? null}
  if (method === 'internalSetItem') {saved.set(args.prefixedKey,args.data); return}
  if (method === 'internalRemoveItem') {saved.delete(args.prefixedKey); return {success:true}}
  throw new Error(`Unexpected native method ${method}`)
}
// Headers select only native methods, leaving the JS implementation's helpers.
Capacitor.PluginHeaders = [{name:'SecureStorage',methods:['internalGetItem','internalSetItem','internalRemoveItem'].map(name=>({name,rtype:'promise'}))}]

test('native vault resolves without assimilating the Capacitor proxy as a promise', {timeout:2000}, async () => {
  const {nativeVault} = await import('../src/lib/credentials.js')
  const vault = await nativeVault()
  assert.equal(vault.then, undefined)
  assert.equal(typeof vault.get, 'function')
  await vault.set('probe', { value: 'persisted' })
  assert.deepEqual(await vault.get('probe'), { value: 'persisted' })
  await vault.remove('probe')
  assert.equal(await vault.get('probe'), null)
  assert.equal(calls.includes('then'), false)
})
