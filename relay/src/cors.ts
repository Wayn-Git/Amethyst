/**
 * The routes a *browser* calls, and the headers that let it.
 *
 * This relay had no CORS at all, and that quietly made the phone companion
 * impossible in the shape it was designed for. A control device is a browser
 * loading the interface from wherever it is hosted -- Pages, Vercel, a tunnel --
 * and then calling `/pair` and `/ops` here. That is cross-origin every time, so
 * without these headers the browser refuses the request before it leaves and
 * the phone reports being offline while sitting on full signal.
 *
 * It went unnoticed because nothing that exercised this path was a browser:
 * the tests are Python and Node, neither of which has a same-origin policy, and
 * the machine's own interface is same-origin with the API it talks to.
 *
 * `*`, and deliberately without `Allow-Credentials`. The origin is not the
 * security boundary on either route and cannot be: `/pair` is unauthenticated
 * by design -- the 160-bit secret in the QR code is what makes an offer real --
 * and `/ops` takes a bearer token in a header. A hostile page can already reach
 * both with curl; what it cannot do is produce that AEAD tag or hold that
 * token. Pinning an origin list here would mean redeploying the Worker every
 * time somebody moves their frontend, for nothing gained.
 *
 * Its own module so it can be tested. `src/index.ts` imports
 * `cloudflare:workers` for the Workflow binding, which node cannot resolve, so
 * anything only reachable through the fetch handler is only reachable with
 * workerd -- and this rule is small enough that it should not need one.
 */

/** Only these. `/sync` is the machine, `/ig/webhook` is Meta, `/jobs` is the
 *  machine again: none of them is a browser, and none should advertise itself
 *  to one. */
export const BROWSER_ROUTES: ReadonlySet<string> = new Set(['/pair', '/ops']);

export const CORS_HEADERS: Readonly<Record<string, string>> = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS',
	'access-control-allow-headers': 'authorization, content-type',
	'access-control-max-age': '86400',
};

export function isBrowserRoute(path: string): boolean {
	return BROWSER_ROUTES.has(path);
}

/** The same response, with the headers a browser needs to read it. */
export function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * The answer to a preflight.
 *
 * 204 and empty. A preflight carries no credential and no body by definition,
 * so there is nothing to authenticate or validate -- and the 404 this used to
 * return reads to a browser as "no such endpoint", which cancels the request
 * that was about to follow it.
 */
export function preflight(): Response {
	return withCors(new Response(null, { status: 204 }));
}
