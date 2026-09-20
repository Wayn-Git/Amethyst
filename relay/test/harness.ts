/**
 * Enough of Cloudflare to run the job layer on a laptop.
 *
 * D1 is SQLite, so the shim below is a real SQLite database (`node:sqlite`)
 * behind D1's prepare/bind/first/all/run shape, loaded from the same
 * `schema.sql` that is deployed. That matters: a hand-written fake would agree
 * with whatever the tests expected, while this one disagrees with a typo in the
 * schema, a missing column or a constraint that does not do what the comment
 * above it claims.
 *
 * Nothing here needs workerd, and nothing here needs a network: `src/jobs/`
 * takes a `StepLike` rather than importing `cloudflare:workers`, which is the
 * whole reason retries, idempotency and state transitions can be asserted at
 * all.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { StepLike } from '../src/jobs/runner.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** One prepared statement, bound or not. */
class Statement {
	private db: DatabaseSync;
	private sql: string;
	private args: unknown[];
	constructor(db: DatabaseSync, sql: string, args: unknown[] = []) {
		this.db = db;
		this.sql = sql;
		this.args = args;
	}

	bind(...args: unknown[]): Statement {
		return new Statement(this.db, this.sql, args);
	}

	async first<T>(): Promise<T | null> {
		const row = this.db.prepare(this.sql).get(...(this.args as never[]));
		return (row as T) ?? null;
	}

	async all<T>(): Promise<{ results: T[] }> {
		return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] };
	}

	async run(): Promise<{ meta: { changes: number } }> {
		const result = this.db.prepare(this.sql).run(...(this.args as never[]));
		return { meta: { changes: Number(result.changes ?? 0) } };
	}
}

export class FakeD1 {
	readonly db = new DatabaseSync(':memory:');

	constructor() {
		this.db.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));
	}

	prepare(sql: string): Statement {
		return new Statement(this.db, sql);
	}

	/**
	 * D1's batch: several statements, one round trip, one transaction. Real D1
	 * rolls the whole batch back if any statement throws, so the shim does too --
	 * a fake that committed the successful half would let a test pass against
	 * code that leaves the table half written.
	 */
	async batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]> {
		this.db.exec('BEGIN');
		try {
			const out = [];
			for (const statement of statements) out.push(await statement.run());
			this.db.exec('COMMIT');
			return out;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
}

/** R2, as a Map. Enough to prove a staged object is deleted when it should be. */
export class FakeBucket {
	readonly objects = new Map<string, { body: ArrayBuffer; contentType: string }>();

	async put(key: string, body: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
		this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType ?? '' });
		return { key };
	}

	async get(key: string) {
		const found = this.objects.get(key);
		if (!found) return null;
		return {
			body: found.body,
			size: found.body.byteLength,
			httpMetadata: { contentType: found.contentType },
		};
	}

	async delete(key: string) {
		this.objects.delete(key);
	}
}

export interface TestEnv {
	DB: any;
	ARTIFACTS?: any;
	JOBS?: undefined;
	RELAY_TOKEN: string;
	WORKER_TOKEN?: string;
}

export function testEnv(
	options: { bucket?: FakeBucket; relayToken?: string; workerToken?: string } = {},
): TestEnv {
	return {
		DB: new FakeD1(),
		ARTIFACTS: options.bucket,
		JOBS: undefined,
		RELAY_TOKEN: options.relayToken ?? 'a-relay-token',
		WORKER_TOKEN: options.workerToken ?? 'a-worker-token',
	};
}

/**
 * A `WorkflowStep` that simply runs the work, and records what it ran.
 *
 * `failures` makes a named step throw a given number of times before it
 * succeeds -- which is how a test says "Graph was down for two attempts"
 * without a timer or a network.
 */
export class FakeStep implements StepLike {
	readonly ran: string[] = [];
	private failures: Record<string, number>;
	constructor(failures: Record<string, number> = {}) {
		this.failures = failures;
	}

	async do<T>(name: string, configOrCallback: unknown, maybeCallback?: unknown): Promise<T> {
		const callback = (typeof configOrCallback === 'function' ? configOrCallback : maybeCallback) as
			() => Promise<T>;
		this.ran.push(name);
		const left = this.failures[name] ?? 0;
		if (left > 0) {
			this.failures[name] = left - 1;
			throw new Error(`${name} is having a bad minute`);
		}
		return callback();
	}
}

/** A step that dies partway through the job, the way a lost instance does. */
export class DyingStep implements StepLike {
	readonly ran: string[] = [];
	private dieOn: string;
	constructor(dieOn: string) {
		this.dieOn = dieOn;
	}

	async do<T>(name: string, configOrCallback: unknown, maybeCallback?: unknown): Promise<T> {
		const callback = (typeof configOrCallback === 'function' ? configOrCallback : maybeCallback) as
			() => Promise<T>;
		this.ran.push(name);
		if (name === this.dieOn) throw new Error('the instance was evicted');
		return callback();
	}
}

/** Answer every fetch with this, and remember what was asked for. */
export function stubFetch(
	answer: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): { calls: string[]; restore: () => void } {
	const calls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: any, init?: any) => {
		const url = typeof input === 'string' ? input : input.url;
		calls.push(`${init?.method ?? 'GET'} ${url}`);
		return answer(url, init);
	}) as typeof fetch;
	return { calls, restore: () => { globalThis.fetch = original; } };
}
