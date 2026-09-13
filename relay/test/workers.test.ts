/**
 * The worker mailbox: a third credential that may only write, and a queue that
 * is emptied by the laptop rather than by a timer.
 *
 * The relay understands nothing about a report. What it must get right is
 * narrower and easier to get wrong: who may write one, who may read one back,
 * what happens when a progress ping and a result race each other over the open
 * internet, and when a row is actually deleted.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ackReports, isWorker, MAX_REPORT_BYTES, pruneReports, report, reportsForSync } from '../src/workers.ts';
import { testEnv } from './harness.ts';

function post(body: unknown, token = 'a-worker-token'): Request {
	return new Request('https://relay.test/worker/report', {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

test('a worker token is recognised and nothing else is', () => {
	const env = testEnv();
	assert.equal(isWorker(post({}, 'a-worker-token'), env), true);
	// The laptop's own token is not a worker's. Three credentials, three roles,
	// and the most exposed of them buys the least.
	assert.equal(isWorker(post({}, 'a-relay-token'), env), false);
	assert.equal(isWorker(post({}, 'guess'), env), false);
	assert.equal(isWorker(new Request('https://relay.test/worker/report'), env), false);
});

test('a relay with no worker token has no mailbox at all', () => {
	const env = { ...testEnv(), WORKER_TOKEN: undefined };
	assert.equal(isWorker(post({}, 'anything'), env), false);
});

test('a report is stored and handed to the machine on its next sync', async () => {
	const env = testEnv();
	const response = await report(post({ job_id: 'b1:a:1', state: 'completed', result: { n: 3 }, lane: 'subagent' }), env);
	assert.equal(response.status, 200);

	const waiting = (await reportsForSync(env, 25)) as Array<Record<string, unknown>>;
	assert.equal(waiting.length, 1);
	assert.equal(waiting[0].job_id, 'b1:a:1');
	assert.deepEqual(waiting[0].result, { n: 3 });
	assert.equal(waiting[0].lane, 'subagent');
});

test('a result that arrived is never undone by a progress ping that arrived late', async () => {
	const env = testEnv();
	await report(post({ job_id: 'j', state: 'completed', result: { n: 1 } }), env);
	const late = await report(post({ job_id: 'j', state: 'running', progress: { done: 0 } }), env);
	assert.equal(late.status, 200);

	const waiting = (await reportsForSync(env, 25)) as Array<Record<string, unknown>>;
	assert.equal(waiting[0].state, 'completed');
	assert.deepEqual(waiting[0].result, { n: 1 });
});

test('a report without a job id or a known state is refused', async () => {
	const env = testEnv();
	assert.equal((await report(post({ state: 'completed' }), env)).status, 400);
	assert.equal((await report(post({ job_id: 'x', state: 'exfiltrating' }), env)).status, 400);
	assert.equal((await report(post({ job_id: 'y'.repeat(400), state: 'completed' }), env)).status, 400);
	assert.equal((await reportsForSync(env, 25)).length, 0);
});

test('a result too large to be a summary is refused rather than truncated', async () => {
	const env = testEnv();
	const huge = { job_id: 'big', state: 'completed', result: { blob: 'x'.repeat(MAX_REPORT_BYTES) } };
	assert.equal((await report(post(huge), env)).status, 413);
	assert.equal((await reportsForSync(env, 25)).length, 0);
});

test('a finished report is deleted only once the machine confirms it', async () => {
	const env = testEnv();
	await report(post({ job_id: 'j', state: 'completed', result: {} }), env);
	// Still offered: reading it is not taking it, the same discipline the
	// deliveries queue follows.
	assert.equal((await reportsForSync(env, 25)).length, 1);

	assert.equal(await ackReports(env, ['j']), 1);
	assert.equal((await reportsForSync(env, 25)).length, 0);
	// Acknowledging one twice is a no-op, which is what makes it safe for the
	// machine to re-send an acknowledgement it is unsure landed.
	assert.equal(await ackReports(env, ['j']), 0);
});

test('acknowledging a running report does not delete the result still to come', async () => {
	const env = testEnv();
	await report(post({ job_id: 'j', state: 'running', progress: { done: 1 } }), env);
	await ackReports(env, ['j']);
	assert.equal((await reportsForSync(env, 25)).length, 0, 'a marked report was still offered');

	// The worker finishes. The row is offered again -- a new fact undoes the
	// acknowledgement, which is what stops the answer being lost.
	await report(post({ job_id: 'j', state: 'completed', result: { n: 9 } }), env);
	const waiting = (await reportsForSync(env, 25)) as Array<Record<string, unknown>>;
	assert.equal(waiting.length, 1);
	assert.deepEqual(waiting[0].result, { n: 9 });
});

test('reports nobody came back for are pruned', async () => {
	const env = testEnv();
	await report(post({ job_id: 'old', state: 'completed', result: {} }), env);
	assert.equal(await pruneReports(env, -1), 1);
	assert.equal((await reportsForSync(env, 25)).length, 0);
});
