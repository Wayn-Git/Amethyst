/**
 * The one door that answers an unauthenticated caller.
 *
 * `src/pairing.ts` had no tests at all, which is the wrong file in this repo to
 * have none: it is the only route a stranger can reach without a credential, so
 * the caps that keep it from being a place to put data are load-bearing, and
 * "deleted on read" is what stops a second party collecting somebody else's
 * device token.
 *
 * What is asserted is what the relay is responsible for and nothing more. It
 * cannot open either half of the handshake and there is no assertion here that
 * pretends it can -- `tests/test_sync_devices.py` owns the crypto.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { FakeD1 } from './harness.ts';
import {
	answerPairing,
	offerPairing,
	pairingsForSync,
	prunePairings,
	takePairing,
	MAX_PAIR_BYTES,
	MAX_PENDING_PAIRINGS,
	PAIR_TTL_SECONDS,
} from '../src/pairing.ts';

function testEnv() {
	return { DB: new FakeD1() } as never;
}

function db(env: never): FakeD1 {
	return (env as unknown as { DB: FakeD1 }).DB;
}

/** A control device's sealed offer. The bytes are opaque here by design. */
function offer(id: string) {
	return { request_id: id, nonce: 'bm9uY2U=', ciphertext: 'c2VhbGVk' };
}

/** Move every pairing row back in time, to age one out without sleeping. */
function age(env: never, seconds: number) {
	db(env).db.exec(
		`UPDATE state SET updated_at = updated_at - ${seconds}` +
			" WHERE key LIKE 'pair_req:%' OR key LIKE 'pair_res:%'",
	);
}

test('an offer is carried to the machine on its next sync', async () => {
	const env = testEnv();
	assert.equal(await offerPairing(env, offer('a')), true);
	const waiting = await pairingsForSync(env);
	assert.equal(waiting.length, 1);
	assert.equal(waiting[0].request_id, 'a');
});

test('a malformed offer is refused rather than stored', async () => {
	const env = testEnv();
	assert.equal(await offerPairing(env, { nonce: 'x', ciphertext: 'y' }), false);
	assert.equal(await offerPairing(env, { request_id: '', nonce: 'x', ciphertext: 'y' }), false);
	assert.equal(await offerPairing(env, null), false);
	assert.equal((await pairingsForSync(env)).length, 0);
});

test('an oversized offer is refused', async () => {
	const env = testEnv();
	const huge = { request_id: 'a', nonce: 'n', ciphertext: 'x'.repeat(MAX_PAIR_BYTES + 1) };
	assert.equal(await offerPairing(env, huge), false);
});

test('the door is capped, so junk cannot become storage', async () => {
	const env = testEnv();
	for (let i = 0; i < MAX_PENDING_PAIRINGS; i += 1) {
		assert.equal(await offerPairing(env, offer(`req-${i}`)), true);
	}
	// The cap is what bounds the cost of a stranger posting here: at most a
	// handful exist at once, and opening one is a single AEAD attempt.
	assert.equal(await offerPairing(env, offer('one-too-many')), false);
});

test('an offer older than the TTL is not handed to the machine', async () => {
	const env = testEnv();
	await offerPairing(env, offer('stale'));
	age(env, PAIR_TTL_SECONDS + 1);
	assert.equal((await pairingsForSync(env)).length, 0);
});

test('answering deletes the request, so a second machine cannot answer it', async () => {
	const env = testEnv();
	await offerPairing(env, offer('a'));
	assert.equal(await answerPairing(env, offer('a')), true);
	assert.equal((await pairingsForSync(env)).length, 0);
});

test('an answer is delivered once and then gone', async () => {
	const env = testEnv();
	await offerPairing(env, offer('a'));
	await answerPairing(env, offer('a'));
	// It carries the device's token and the group key, sealed. There is no
	// reason for a queue on somebody else's computer to keep a copy of that
	// after it has been handed over.
	assert.notEqual(await takePairing(env, 'a'), null);
	assert.equal(await takePairing(env, 'a'), null);
});

test('a plaintext refusal is carried like an answer', async () => {
	const env = testEnv();
	await offerPairing(env, offer('a'));
	// The machine saying "there is no code open here". Nothing is sealed because
	// there is nothing to seal: the request id is the relay's own routing key
	// and it already holds it. Without this the device learns nothing for two
	// minutes and then reports a timeout, which reads as "your laptop is
	// asleep" and sends somebody to check the wrong thing.
	assert.equal(await answerPairing(env, { request_id: 'a', refused: 'expired' }), true);
	const taken = await takePairing(env, 'a');
	assert.deepEqual(taken, { request_id: 'a', refused: 'expired' });
});

test('a refusal with no reason is not an answer', async () => {
	const env = testEnv();
	assert.equal(await answerPairing(env, { request_id: 'a', refused: '' }), false);
	assert.equal(await answerPairing(env, { request_id: 'a' }), false);
});

test('taking an answer refuses an absurd request id without a query', async () => {
	const env = testEnv();
	assert.equal(await takePairing(env, ''), null);
	assert.equal(await takePairing(env, 'x'.repeat(65)), null);
});

test('an abandoned handshake is swept rather than left in state forever', async () => {
	const env = testEnv();
	await offerPairing(env, offer('a'));
	await offerPairing(env, offer('b'));
	await answerPairing(env, offer('b'));
	assert.equal(await prunePairings(env), 0);
	age(env, PAIR_TTL_SECONDS + 1);
	// One abandoned request and one answer nobody came back for.
	assert.equal(await prunePairings(env), 2);
});
