/**
 * Which routes answer a browser.
 *
 * This is here because its absence cost the phone companion its entire reason
 * for existing and nothing noticed for a whole feature's worth of work. The
 * relay shipped with no CORS at all, so a phone loading the interface from
 * Pages, Vercel or a tunnel could not call `/pair` or `/ops` -- the browser
 * refused before the request left, and the phone reported being offline on full
 * signal. Every test of that path was Python or Node, neither of which enforces
 * a same-origin policy, and the machine's own interface is same-origin with the
 * API it talks to. So the one client that mattered was the one nothing ran as.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { CORS_HEADERS, isBrowserRoute, preflight, withCors } from '../src/cors.ts';

test('the two routes a browser calls are the two that advertise themselves', () => {
	assert.equal(isBrowserRoute('/pair'), true);
	assert.equal(isBrowserRoute('/ops'), true);
});

test('nothing else does', () => {
	// `/sync` is the machine, `/ig/webhook` is Meta, `/jobs` is the machine
	// again. None is a browser, and a route that cannot be called from one has
	// no business telling a page it may try.
	for (const path of ['/sync', '/health', '/ig/webhook', '/jobs', '/share', '/worker/report', '/']) {
		assert.equal(isBrowserRoute(path), false, `${path} should not be a browser route`);
	}
});

test('a preflight is answered, not 404ed', () => {
	// The 404 it used to get reads to a browser as "no such endpoint", which
	// cancels the request that was about to follow it -- so the real failure
	// showed up as a network error on a route that works perfectly well.
	const response = preflight();
	assert.equal(response.status, 204);
	assert.equal(response.headers.get('access-control-allow-origin'), '*');
	assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
});

test('the preflight allows the two headers pairing and sync actually send', () => {
	// `authorization` for /ops's bearer token, `content-type` for the JSON body.
	// Missing either means the browser refuses the request it just preflighted.
	const allowed = preflight().headers.get('access-control-allow-headers') ?? '';
	assert.match(allowed, /authorization/);
	assert.match(allowed, /content-type/);
});

test('an answer keeps its status, its body and its own headers', () => {
	const original = new Response(JSON.stringify({ waiting: true }), {
		status: 202,
		headers: { 'content-type': 'application/json' },
	});
	const wrapped = withCors(original);
	assert.equal(wrapped.status, 202);
	assert.equal(wrapped.headers.get('content-type'), 'application/json');
	assert.equal(wrapped.headers.get('access-control-allow-origin'), '*');
});

test('a refusal carries them too', async () => {
	// 429 from a full pairing door, 401 from a revoked device. A browser that
	// cannot read the status learns nothing, and the phone shows "offline" for
	// what is actually "you were revoked".
	const wrapped = withCors(new Response(JSON.stringify({ error: 'too many' }), { status: 429 }));
	assert.equal(wrapped.status, 429);
	assert.equal(wrapped.headers.get('access-control-allow-origin'), '*');
	assert.deepEqual(await wrapped.json(), { error: 'too many' });
});

test('credentials are never allowed alongside the wildcard', () => {
	// `*` with `Allow-Credentials: true` is rejected by every browser, and would
	// be the wrong thing to ask for anyway: these routes authenticate with a
	// bearer token in a header, never with a cookie.
	assert.equal('access-control-allow-credentials' in CORS_HEADERS, false);
	assert.equal(preflight().headers.get('access-control-allow-credentials'), null);
});
