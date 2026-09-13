/**
 * A link, caught while the machine was off.
 *
 * The oldest job in the system and the reason `/share` exists: somebody on a
 * phone sends a URL, and it has to still be there on Tuesday. What the relay
 * adds over simply writing the URL down is the part that decays -- a page that
 * is deleted, paywalled or rewritten between the share and the sync. So the
 * fetch happens now and the *title and shape* of what was found are recorded.
 *
 * What it deliberately does not do is keep the page. The library's readable
 * extraction, its enrichment, its embeddings and its files are all on the
 * machine (ADR-0004), and a second copy of the text in D1 would be a parallel
 * library with none of that and no way to search it. The laptop refetches with
 * its own pipeline; this result is what tells it whether that is worth doing.
 */

import { type JobType, Refused, type JobEnv } from '../registry.ts';
import { get, safeUrl, titleOf } from './http.ts';

/** Hosts whose pages are a login wall to anything without a session. */
const OPAQUE_HOSTS = ['instagram.com', 'x.com', 'twitter.com', 'facebook.com'];

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return '';
	}
}

export const urlIngest: JobType<JobEnv> = {
	kind: 'url_ingest',
	// The one kind a phone may create, because it is the one whose whole purpose
	// is being created from a phone.
	remoteCreatable: true,
	maxAttempts: 3,

	accept(input) {
		const url = safeUrl(input.url);
		const kind = typeof input.kind === 'string' ? input.kind.trim().slice(0, 40) : null;
		const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) : null;
		if (input.kind !== undefined && input.kind !== null && typeof input.kind !== 'string') {
			throw new Refused('kind, if given, is a string');
		}
		return { url, kind: kind || null, note: note || null };
	},

	/**
	 * The URL itself, not the URL and the minute. Sharing the same link twice in
	 * a day is a person repeating themselves, and the library would deduplicate
	 * it on arrival anyway -- doing it here saves the fetch as well.
	 */
	key(params) {
		return `url_ingest:${params.url}`;
	},

	steps: [
		{
			key: 'fetch',
			async run({ params }) {
				const url = String(params.url);
				const host = hostOf(url);
				if (OPAQUE_HOSTS.some((opaque) => host === opaque || host.endsWith(`.${opaque}`))) {
					// Fetching this gets a login wall, and a login wall's `<title>` is
					// worse than no title: it would be recorded as the page's name.
					// The machine opens these properly (backend/library/reels.py).
					return { skipped: 'that host serves a login wall to anything without a session' };
				}
				try {
					const found = await get(url, { accept: 'text/html,*/*' });
					const html = found.content_type.startsWith('text/')
						? new TextDecoder().decode(found.body.slice(0, 64 * 1024))
						: '';
					return {
						status: found.status,
						final_url: found.final_url,
						content_type: found.content_type,
						bytes: found.bytes,
						title: html ? titleOf(html) : null,
					};
				} catch (err) {
					return {
						skipped: `fetch deferred to desktop: ${err instanceof Error ? err.message : String(err)}`,
					};
				}
			},
		},
	],

	result(params, done) {
		const fetched = (done.fetch ?? {}) as Record<string, unknown>;
		return {
			// What the machine needs to run its own capture. The URL it was given
			// rather than the one redirects landed on: the library deduplicates on
			// what a person shared, and a tracking redirect resolves differently
			// every time.
			url: params.url,
			kind: params.kind,
			note: params.note,
			final_url: fetched.final_url ?? null,
			title: fetched.title ?? null,
			content_type: fetched.content_type ?? null,
			reachable: fetched.status !== undefined,
			// Said out loud rather than inferred from a null title, so the machine
			// does not report "could not read it" for a page nobody tried to read.
			skipped: fetched.skipped ?? null,
		};
	},
};
