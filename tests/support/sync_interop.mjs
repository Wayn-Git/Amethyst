import { seal, unseal, pairKey, b64, unb64 } from '../../frontend/src/lib/sync/crypto.js'
const [mode, ...rest] = process.argv.slice(2)

if (mode === 'open') {
  const [keyB64, nonce, ciphertext, opId, deviceId] = rest
  const opened = await unseal(nonce, ciphertext, { opId, deviceId, key: unb64(keyB64) })
  console.log(JSON.stringify(opened))
} else if (mode === 'seal') {
  const [keyB64, payloadJson, opId, deviceId] = rest
  const out = await seal(JSON.parse(payloadJson), { opId, deviceId, key: unb64(keyB64) })
  console.log(JSON.stringify(out))
} else if (mode === 'pairkey') {
  console.log(b64(await pairKey(rest[0])))
}
