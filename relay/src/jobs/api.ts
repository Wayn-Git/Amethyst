/**
 * The job endpoints, and the part of `/sync` that carries jobs.
 *
 * Four routes and no knowledge of what a job *is*: every one of them reaches
 * the registry for the kind it was handed and refuses what is not there. Adding
 * a capability touches `src/jobs/types/` and nothing in this file.
 */

import { type Caller } from '../auth.ts';
import { read } from './artifacts.ts';
import { dispatch, type DispatchEnv } from './dispatch.ts';
import { creatableKinds, Refused, typeFor } from './registry.ts';
import { desktopView, publicView } from './state.ts';
import { JobStore, MAX_OPEN_JOBS } from './store.ts';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

/** How many finished jobs one sync takes. Matches the delivery batch. */
export const SYNC_BATCH = 25;

/**
 * Create a job, or hand back the one that already exists for this request.
 *
 * A 200 with an existing id rather than a 409, because from the caller's side
 * "I asked for this and it is being done" is the same answer whether or not
 * this particular request is what started it. A phone whose network dropped
 * between the send and the reply retries and learns exactly that.
 */
export async function createJob<E extends DispatchEnv>(
	request: Request,
	env: E,
	caller: Caller,
	waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = ((await request.json()) ?? {}) as Record<string, unknown>;
	} catch {
		return json({ error: 'that body is not JSON' }, 400);
	}

	const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
	const type = typeFor(kind);
	if (!type || !creatableKinds(caller).includes(kind)) {
		// One answer for "no such kind" and "not yours to ask for". A caller
		// holding the weaker token learns which kinds it may create by being told
		// them, not by probing for which ones exist.
		return json(
			{ error: `'${kind || 'nothing'}' is not a job this relay runs for you`,
			  kinds: creatableKinds(caller) },
			400,
		);
	}

	let params: Record<string, unknown>;
	try {
		params = type.accept(body);
	} catch (err) {
		// Self-diagnosing on purpose: a phone showing "400 Bad Request" in a toast
		// names nothing anybody can act on.
		return json({ error: err instanceof Refused ? err.message : String(err) }, 400);
	}

	const store = new JobStore(env.DB);
	if ((await store.openCount()) >= MAX_OPEN_JOBS) {
		return json({ error: 'the relay is backlogged; try again once the machine has synced' }, 503);
	}

	const { job, created } = await store.create(type.kind, type.key(params), {
		params,
		maxAttempts: type.maxAttempts,
		origin: caller === 'desktop' ? 'desktop' : 'client',
	});
	if (created) await dispatch(env, job, waitUntil);
	return json({ ...publicView(job), created }, created ? 201 : 200);
}

/** One job's state, for whoever is allowed to see it. */
export async function readJob<E extends DispatchEnv>(
	env: E,
	caller: Caller,
	id: string,
): Promise<Response> {
	const job = await new JobStore(env.DB).get(id);
	// A client may poll a job it created. Not one the webhook created, and not
	// one the machine created: the same 404 either way, so the endpoint does not
	// confirm that a job it will not show you exists.
	if (!job || (caller === 'client' && job.origin !== 'client')) {
		return json({ error: 'no such job' }, 404);
	}
	return json(caller === 'desktop' ? desktopView(job) : publicView(job));
}

/**
 * Staged bytes, for the machine that is collecting them.
 *
 * Desktop only, and by key rather than by name: the key is in the result the
 * machine was just handed, so there is nothing to guess and nothing to
 * enumerate.
 */
export async function readArtifact<E extends DispatchEnv>(
	env: E,
	caller: Caller,
	jobId: string,
	key: string,
): Promise<Response> {
	if (caller !== 'desktop') return json({ error: 'no such job' }, 404);
	const job = await new JobStore(env.DB).get(jobId);
	if (!job || !job.artifacts.includes(key)) return json({ error: 'no such artifact' }, 404);
	const object = await read(env.ARTIFACTS, key);
	if (!object) return json({ error: 'that artifact is no longer here' }, 410);
	return new Response(object.body, {
		headers: {
			'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'content-length': String(object.size),
		},
	});
}

/**
 * What `/sync` says about jobs: what is finished and waiting to be taken, and
 * what is still in flight.
 *
 * The second half is the answer to "the machine has been off for a day, what
 * happened" -- without it a reconnecting machine sees an empty list and cannot
 * tell a quiet relay from one halfway through five downloads.
 */
export async function jobsForSync<E extends DispatchEnv>(
	env: E,
	limit: number,
): Promise<Record<string, unknown>> {
	const store = new JobStore(env.DB);
	// Two queries instead of three: UNION the two job lists, counts stays separate.
	const [bundle, counts] = await Promise.all([
		store.syncBundle(limit),
		store.counts(),
	]);
	return {
		ready: bundle.ready.map(desktopView),
		pending: bundle.pending.map(publicView),
		counts,
	};
}

/**
 * The machine confirming it has these, which is what deletes them.
 *
 * After the machine has the result, never before: a job acknowledged on the way
 * out would be one lost by a sync that failed halfway. The same discipline
 * `RelayPoller` already follows for deliveries -- acknowledge the previous
 * batch on the *next* call.
 */
export async function ackJobs<E extends DispatchEnv>(env: E, ids: unknown): Promise<number> {
	if (!Array.isArray(ids) || !ids.length) return 0;
	const store = new JobStore(env.DB);
	let synced = 0;
	for (const raw of ids.slice(0, 100)) {
		const id = String(raw);
		const job = await store.get(id);
		if (!job) continue;
		if (job.state === 'synced') {
			// Acknowledging one twice is a no-op, which is what makes it safe for
			// the machine to re-send an acknowledgement it is unsure landed.
			synced += 1;
			continue;
		}
		if (job.state !== 'completed' && job.state !== 'failed') continue;
		await store.markSynced(job, env.ARTIFACTS);
		synced += 1;
	}
	return synced;
}

/**
 * Jobs whose instance is gone, jobs whose backoff has run out, and rows nobody
 * came back for. The cron's whole job list.
 */
export async function sweepJobs<E extends DispatchEnv>(
	env: E,
	options: { staleAfterSeconds?: number; waitUntil?: (p: Promise<unknown>) => void } = {},
): Promise<{ reclaimed: number; dispatched: number }> {
	const store = new JobStore(env.DB);
	const reclaimed = await store.reclaimStalled(options.staleAfterSeconds ?? 900);
	const due = await store.promoteDue();
	let dispatched = 0;
	for (const job of [...reclaimed, ...due]) {
		if (job.state !== 'queued') continue;
		await dispatch(env, job, options.waitUntil);
		dispatched += 1;
	}
	return { reclaimed: reclaimed.length, dispatched };
}
