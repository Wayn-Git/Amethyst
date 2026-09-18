/**
 * The sync mailbox at the relay.
 *
 * What is asserted here is what the relay is responsible for and nothing more:
 * that it does not store the same op twice, that it hands an op to every device
 * but the sender, that it deletes one only when everybody has it, and that it
 * cannot read any of them. The merge itself is not tested here -- it does not
 * happen here. `tests/test_sync_convergence.py` owns that.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { FakeD1 } from './harness.ts';
import { acceptOps, ackOps, collect, opsForSync, pruneOps, KEEP_SECONDS, MAX_OP_BYTES } from '../src/ops.ts';

/** The mailbox only ever needs D1; `as never` keeps the shim off the Env type. */
function testEnv() {
	return { DB: new FakeD1() } as never;
}

/** The database behind the env, for assertions the mailbox API does not expose. */
function db(env: never): FakeD1 {
	return (env as unknown as { DB: FakeD1 }).DB;
}

function sealed(id: string, from: string) {
	return { op_id: id, from_device: from, nonce: 'bm9uY2U=', ciphertext: 'c2VhbGVk' };
}

/** The device mirror the host pushes on every sync. */
async function withDevices(env: never, ...ids: string[]) {
	await (env as { DB: FakeD1 }).DB
		.prepare('INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, ?)')
		.bind('devices', JSON.stringify(ids.map((id) => ({ id, role: 'control' }))), 0)
		.run();
}

test('an op is stored and handed to the other device', async () => {
	const env = testEnv();
	assert.equal(await acceptOps(env, [sealed('op-1', 'phone')], 'phone'), 1);

	const forLaptop = await opsForSync(env, 'laptop');
	assert.equal(forLaptop.length, 1);
	assert.equal(forLaptop[0].op_id, 'op-1');
	assert.equal(forLaptop[0].ciphertext, 'c2VhbGVk');
});

test('a device is never handed back its own op', async () => {
	const env = testEnv();
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	assert.deepEqual(await opsForSync(env, 'phone'), []);
});

test('uploading the same op twice stores it once', async () => {
	// The normal outcome of a sync that wrote and then timed out.
	const env = testEnv();
	assert.equal(await acceptOps(env, [sealed('op-1', 'phone')], 'phone'), 1);
	assert.equal(await acceptOps(env, [sealed('op-1', 'phone')], 'phone'), 0);

	const { results } = await db(env).prepare('SELECT op_id FROM ops').all();
	assert.equal(results.length, 1);
});

test('a device may only upload as itself', async () => {
	// Otherwise it could forge the one field the AEAD binds its ciphertext to.
	const env = testEnv();
	await acceptOps(env, [sealed('op-1', 'somebody-else')], 'phone');
	const row = await db(env).prepare('SELECT from_device FROM ops WHERE op_id = ?').bind('op-1').first();
	assert.equal(row.from_device, 'phone');
});

test('a malformed op is skipped and the rest of the batch still lands', async () => {
	const env = testEnv();
	const stored = await acceptOps(
		env,
		[{ op_id: '' }, { nonsense: true }, sealed('op-good', 'phone'), null],
		'phone',
	);
	assert.equal(stored, 1);
});

test('an op too large to be an op is refused', async () => {
	const env = testEnv();
	const huge = { ...sealed('op-huge', 'phone'), ciphertext: 'x'.repeat(MAX_OP_BYTES + 1) };
	assert.equal(await acceptOps(env, [huge], 'phone'), 0);
});

test('an op survives until every other device has taken it', async () => {
	const env = testEnv();
	await withDevices(env, 'phone', 'laptop', 'tablet');
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');

	await ackOps(env, 'laptop', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 1,
		'the tablet has not had it yet');

	await ackOps(env, 'tablet', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 0,
		'everybody owed it has it, so the queue lets it go');
});

test('an acknowledged op is not offered again', async () => {
	const env = testEnv();
	await withDevices(env, 'phone', 'laptop', 'tablet');
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	await ackOps(env, 'laptop', ['op-1']);
	assert.deepEqual(await opsForSync(env, 'laptop'), []);
});

test('acknowledging the same op twice is free', async () => {
	const env = testEnv();
	await withDevices(env, 'phone', 'laptop');
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	await ackOps(env, 'laptop', ['op-1']);
	await ackOps(env, 'laptop', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM op_acks').first()).n, 1);
});

test('nothing is deleted while the relay does not know who is owed', async () => {
	// Forgetting the device list is a reason to keep an op, never to drop it.
	const env = testEnv();
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	await ackOps(env, 'laptop', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 1);
	assert.equal(await collect(env), 0);
});

test('a revoked device stops holding rows open', async () => {
	// The mirror is refreshed on every sync, so revoking on the machine releases
	// the queue here within one poll.
	const env = testEnv();
	await withDevices(env, 'phone', 'laptop', 'tablet');
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	await ackOps(env, 'laptop', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 1);

	await withDevices(env, 'phone', 'laptop'); // the tablet was revoked
	assert.equal(await collect(env), 1);
});

test('ops are handed over oldest first', async () => {
	const env = testEnv();
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	await db(env).prepare('UPDATE ops SET created_at = 1 WHERE op_id = ?').bind('op-1').run();
	await acceptOps(env, [sealed('op-2', 'phone')], 'phone');
	await db(env).prepare('UPDATE ops SET created_at = 2 WHERE op_id = ?').bind('op-2').run();

	assert.deepEqual((await opsForSync(env, 'laptop')).map((o) => o.op_id), ['op-1', 'op-2']);
});

test('ops nobody came back for are pruned', async () => {
	const env = testEnv();
	await acceptOps(env, [sealed('op-old', 'phone')], 'phone');
	await db(env)
		.prepare('UPDATE ops SET created_at = ?')
		.bind(Math.floor(Date.now() / 1000) - KEEP_SECONDS - 1)
		.run();
	assert.equal(await pruneOps(env), 1);
});

test('the relay stores what it cannot read', async () => {
	// The whole claim of this table: the columns it holds are an opaque id, an
	// opaque device name, and bytes. Nothing here is the user's data in the clear.
	const env = testEnv();
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	const row = await db(env).prepare('SELECT * FROM ops').first();
	assert.deepEqual(Object.keys(row).sort(), [
		'ciphertext', 'created_at', 'from_device', 'nonce', 'op_id',
	]);
});

test("the machine's own ops are collected, though it is in no mirror", async () => {
	// The bug that filled this table. `mirror()` on the machine lists the paired
	// devices -- the rows in its `devices` table -- and the machine itself is not
	// one of them: it keeps its identity in `app_settings` and authenticates with
	// RELAY_TOKEN, not a device token. `collect` used to require
	// `o.from_device IN (mirror)`, which is never true of an op the machine sent,
	// so nothing it published was ever reclaimed. Those rows sat here until the
	// eight-day prune, and on a machine publishing its transcript every fifteen
	// seconds that is most of what D1 was holding.
	const env = testEnv();
	await withDevices(env, 'phone');
	await acceptOps(env, [sealed('op-1', 'the-machine')], 'the-machine');

	// The one live device that is not the sender has taken it, so nobody is owed
	// it any more.
	await ackOps(env, 'phone', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 0);
});

test('an op still owed to a second device is kept', async () => {
	// The other half of the same rule: "everyone but the sender" has to mean
	// everyone, or the fix above would collect an op a phone has not seen.
	const env = testEnv();
	await withDevices(env, 'phone', 'tablet');
	await acceptOps(env, [sealed('op-1', 'the-machine')], 'the-machine');

	await ackOps(env, 'phone', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 1);

	await ackOps(env, 'tablet', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 0);
});

test('a device-sent op is still owed only to the others', async () => {
	// The sender is never handed its own op, so it must not be counted as owing
	// an acknowledgement for it.
	const env = testEnv();
	await withDevices(env, 'phone', 'laptop');
	await acceptOps(env, [sealed('op-1', 'phone')], 'phone');
	await ackOps(env, 'laptop', ['op-1']);
	assert.equal((await db(env).prepare('SELECT count(*) AS n FROM ops').first()).n, 0);
});
