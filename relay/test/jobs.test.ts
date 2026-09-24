/**
 * The durable job layer: what a job is, what a retry may repeat, and what the
 * relay stops holding once the machine has taken it.
 *
 * The relay used to have exactly one piece of retryable work -- the Instagram
 * receipt -- with its own Workflow, its own table and its own dispatch
 * function. This is the generic version of that, and almost everything asserted
 * here is about a promise the bespoke version never had to make: any *kind* of
 * work can be written down, run somewhere always-on, and collected later
 * without being done twice.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authenticate, sameSecret } from '../src/auth.ts';
import { ackJobs, createJob, jobsForSync, readArtifact, readJob, sweepJobs } from '../src/jobs/api.ts';
import { runJob } from '../src/jobs/runner.ts';
import { IllegalTransition, assertTransition, backoffFor } from '../src/jobs/state.ts';
import { JobStore } from '../src/jobs/store.ts';
import { register, Unretryable, typeFor } from '../src/jobs/registry.ts';
import { registerJobTypes } from '../src/jobs/types/index.ts';
import { DyingStep, FakeBucket, FakeStep, stubFetch, testEnv } from './harness.ts';

registerJobTypes();

/** How many times each step of this kind has actually run, across the process. */
const runs: Record<string, number> = {};

/**
 * A job type that exists only to be counted. Registering it in a test file is
 * itself the claim being made: adding a kind is a module and a `register` call,
 * with nothing in the Worker, the runner or the workflow to edit.
 */
register({
	kind: 'counted',
	remoteCreatable: false,
	maxAttempts: 3,
	accept: (input) => ({ name: String(input.name ?? 'x'), fail: input.fail ?? false }),
	key: (params) => `counted:${params.name}`,
	steps: [
		{
			key: 'first',
			async run({ params }) {
				runs.first = (runs.first ?? 0) + 1;
				return { name: params.name };
			},
		},
		{
			key: 'second',
			async run({ params }) {
				runs.second = (runs.second ?? 0) + 1;
				if (params.fail === 'always') throw new Error('the far end is down');
				if (params.fail === 'never') throw new Unretryable('that url is gone');
				return { ok: true };
			},
		},
	],
	result: (params, done) => ({ name: params.name, second: done.second }),
});

function freshEnv(bucket?: FakeBucket) {
	runs.first = 0;
	runs.second = 0;
	return testEnv({ bucket });
}

async function newJob(env: any, kind = 'counted', input: Record<string, unknown> = {}) {
	const type = typeFor(kind)!;
	const params = type.accept(input);
	const { job, created } = await new JobStore(env.DB).create(kind, type.key(params), {
		params,
		maxAttempts: type.maxAttempts,
		origin: 'client',
	});
	return { job, created };
}

// ------------------------------------------------------------------ creating

test('a job is written down before anything runs it', async () => {
	const env = freshEnv();
	const { job, created } = await newJob(env, 'counted', { name: 'alpha' });
	assert.equal(created, true);
	assert.equal(job.state, 'queued');
	assert.equal(job.attempts, 0);
	const stored = await new JobStore(env.DB).get(job.id);
	assert.equal(stored?.kind, 'counted');
	assert.equal(stored?.idempotencyKey, 'counted:alpha');
});

test('the same request twice is one job', async () => {
	const env = freshEnv();
	const first = await newJob(env, 'counted', { name: 'alpha' });
	const second = await newJob(env, 'counted', { name: 'alpha' });
	assert.equal(second.created, false);
	assert.equal(second.job.id, first.job.id);
	// Mutation check: make `create` insert unconditionally and this is two rows
	// -- a phone whose network dropped mid-share would fetch the same link twice.
	const counts = await new JobStore(env.DB).counts();
	assert.equal(counts.queued, 1);
});

test('a finished job is not re-opened by asking again', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });
	await runJob(env, job.id, new FakeStep());
	const again = await newJob(env, 'counted', { name: 'alpha' });
	assert.equal(again.created, false);
	assert.equal(again.job.state, 'completed');
	// Asking for work that is done gets the record of it. Running it a second
	// time would be the answer to a question nobody asked.
	assert.equal(runs.first, 1);
});

// ------------------------------------------------------------------ the run

test('a job runs its steps in order and completes', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });
	const step = new FakeStep();
	const outcome = await runJob(env, job.id, step);
	assert.equal(outcome.state, 'completed');
	assert.deepEqual(step.ran, ['first', 'second']);
	const done = await new JobStore(env.DB).get(job.id);
	assert.equal(done?.state, 'completed');
	assert.deepEqual(done?.result, { name: 'alpha', second: { ok: true } });
	assert.equal(done?.attempts, 1);
});

test('progress says which step is running', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });
	const store = new JobStore(env.DB);
	await store.begin(job);
	await store.progress(job, { step: 'second', done: 1, total: 2 });
	const seen = await store.get(job.id);
	assert.deepEqual(seen?.progress, { step: 'second', done: 1, total: 2 });
});

// ------------------------------------------------------------- idempotency

test('a step that already ran is not run again by the next attempt', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });

	// The instance dies after `first` has returned and been recorded.
	await runJob(env, job.id, new DyingStep('second'));
	assert.equal(runs.first, 1);

	// A new instance, from the top -- which is the only way a workflow re-enters.
	const step = new FakeStep();
	const outcome = await runJob(env, job.id, step);
	assert.equal(outcome.state, 'completed');
	// Mutation check: delete the `job_steps` lookup in `runJob` and this is 2 --
	// the relay would send a second receipt for a delivery it already answered.
	assert.equal(runs.first, 1);
	assert.equal(runs.second, 1);
	assert.deepEqual(step.ran, ['second']);
});

test('the ledger records a step after it returns, never before', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });
	// `first` throws inside the step, so nothing about it is written down and the
	// next attempt runs it again. At-least-once for the step in flight is the
	// deliberate half of the trade; the alternative silently skips work.
	await runJob(env, job.id, new DyingStep('first'));
	const store = new JobStore(env.DB);
	assert.deepEqual(await store.steps((await store.get(job.id))!), []);
});

// ----------------------------------------------------------------- retries

test('a failing step backs off rather than spinning', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha', fail: 'always' });
	const outcome = await runJob(env, job.id, new FakeStep());
	assert.equal(outcome.state, 'waiting');
	assert.equal(outcome.retryInSeconds, backoffFor(1));
	const waiting = await new JobStore(env.DB).get(job.id);
	assert.match(String(waiting?.lastError), /the far end is down/);
});

test('the backoff doubles and is capped', () => {
	assert.equal(backoffFor(1), 15);
	assert.equal(backoffFor(2), 30);
	assert.equal(backoffFor(3), 60);
	assert.equal(backoffFor(50), 3600);
});

test('a job that spends its attempts fails rather than retrying forever', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha', fail: 'always' });
	const store = new JobStore(env.DB);
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = (await store.get(job.id))!;
		if (current.state === 'waiting') await store.enter(current, 'queued');
		await runJob(env, job.id, new FakeStep());
	}
	const spent = await store.get(job.id);
	assert.equal(spent?.state, 'failed');
	assert.equal(spent?.attempts, 3);
});

test('a refusal stops the job instead of buying two more attempts', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha', fail: 'never' });
	const outcome = await runJob(env, job.id, new FakeStep());
	assert.equal(outcome.state, 'failed');
	const failed = await new JobStore(env.DB).get(job.id);
	assert.equal(failed?.attempts, 1);
	assert.match(String(failed?.lastError), /that url is gone/);
	// Not recorded: a person retrying wants the step that refused to be tried,
	// not skipped because it has an answer on file.
	const store = new JobStore(env.DB);
	assert.deepEqual(await store.steps(failed!), ['first']);
});

test('a kind nothing knows how to run fails without retrying', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });
	await env.DB.prepare("UPDATE jobs SET kind = 'gone' WHERE id = ?").bind(job.id).run();
	const outcome = await runJob(env, job.id, new FakeStep());
	assert.equal(outcome.state, 'failed');
});

// -------------------------------------------------------------- transitions

test('the state machine refuses a move it does not allow', () => {
	assertTransition('queued', 'running');
	assertTransition('completed', 'synced');
	assert.throws(() => assertTransition('completed', 'running'), IllegalTransition);
	assert.throws(() => assertTransition('synced', 'queued'), IllegalTransition);
});

test('a second instance for a finished job does nothing', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });
	await runJob(env, job.id, new FakeStep());
	const step = new FakeStep();
	const outcome = await runJob(env, job.id, step);
	assert.equal(outcome.state, 'completed');
	assert.deepEqual(step.ran, []);
});

test('a stalled job is reclaimed and dispatched again', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha' });
	const store = new JobStore(env.DB);
	await store.begin(job);
	// Its instance stopped answering an hour ago.
	await env.DB
		.prepare('UPDATE jobs SET updated_at = updated_at - 3600 WHERE id = ?')
		.bind(job.id)
		.run();
	const swept = await sweepJobs(env as any, { staleAfterSeconds: 900 });
	assert.equal(swept.reclaimed, 1);
	// Dispatched inline, because the test env has no Workflow binding -- which is
	// also what a relay on an account without Workflows does.
	assert.equal(swept.dispatched, 1);
	assert.equal((await store.get(job.id))?.state, 'completed');
});

test('a waiting job is promoted only once its backoff has run out', async () => {
	const env = freshEnv();
	const { job } = await newJob(env, 'counted', { name: 'alpha', fail: 'always' });
	await runJob(env, job.id, new FakeStep());
	const store = new JobStore(env.DB);
	assert.deepEqual(await store.promoteDue(), []);
	await env.DB
		.prepare('UPDATE jobs SET updated_at = updated_at - 120 WHERE id = ?')
		.bind(job.id)
		.run();
	const due = await store.promoteDue();
	assert.equal(due.length, 1);
	assert.equal(due[0].state, 'queued');
});

test('jobsForSync returns ready and pending jobs via syncBundle without SQL error', async () => {
	const env = freshEnv();
	const { job: job1 } = await newJob(env, 'counted', { name: 'done-job' });
	await runJob(env, job1.id, new FakeStep());
	const { job: job2 } = await newJob(env, 'counted', { name: 'pending-job' });

	const result = await jobsForSync(env as any, 25);
	assert.equal(Array.isArray(result.ready), true);
	assert.equal(Array.isArray(result.pending), true);
	assert.equal((result.ready as any[]).length, 1);
	assert.equal((result.pending as any[]).length, 1);
	assert.equal((result.ready as any[])[0].id, job1.id);
	assert.equal((result.pending as any[])[0].id, job2.id);
});

