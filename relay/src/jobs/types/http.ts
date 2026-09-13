/**
 * Fetching, with the limits a job needs and nothing else.
 *
 * The relay reaches out to whatever URL somebody shared, so this is the only
 * place that decides what "whatever" is allowed to be: an http(s) URL, a
 * bounded number of bytes, and a bounded wait. The machine runs the same
 * argument in `backend/web/safety.py` before a fetch; this is the cloud half of
 * it, and it is deliberately the stricter of the two -- a Worker has no user
 * watching it to notice something odd.
 */

import { Unretryable } from '../registry.ts';

export const FETCH_TIMEOUT_MS = 30_000;

/** Enough for a page's head and text. Anything larger is not a link, it is a file. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

export class Refusal extends Unretryable {}

/** An http(s) URL, or a refusal naming what was wrong with it. */
export function safeUrl(raw: unknown): string {
	const text = typeof raw === 'string' ? raw.trim() : '';
	if (!text) throw new Refusal('a url is required');
	let candidate = text;
	const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
	if (match) {
		candidate = match[0];
	}
	let url: URL;
	try {
		url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
	} catch {
		throw new Refusal(`'${text.slice(0, 80)}' is not a url`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Refusal(`${url.protocol} is not a scheme this fetches`);
	}
	// Cloudflare will not route to these anyway, but a refusal that says so is
	// better than a fetch that times out and is retried three times first.
	const host = url.hostname.toLowerCase();
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '0.0.0.0' ||
		host.startsWith('127.') ||
		host.startsWith('10.') ||
		host.startsWith('192.168.') ||
		host === '[::1]' ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host)
	) {
		throw new Refusal('that address is not reachable from the relay');
	}
	return url.toString();
}

export interface Fetched {
	status: number;
	final_url: string;
	content_type: string;
	bytes: number;
	body: ArrayBuffer;
}

/**
 * GET a URL with a cap on both time and size.
 *
 * A 4xx throws `Unretryable` -- the page will still be missing in fifteen
 * minutes -- while a 5xx or a network error throws plainly, which is how a step
 * asks for the next attempt.
 */
export async function get(url: string, options: { maxBytes?: number; accept?: string } = {}): Promise<Fetched> {
	const maxBytes = options.maxBytes ?? MAX_PAGE_BYTES;
	const response = await fetch(url, {
		redirect: 'follow',
		headers: {
			// Says what this is. A relay that pretends to be a browser is a relay
			// whose traffic nobody can identify, including its owner.
			'user-agent': 'AMETHYST-relay/1.0 (+personal archive)',
			...(options.accept ? { accept: options.accept } : {}),
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (response.status >= 400 && response.status < 500) {
		throw new Refusal(`the source answered ${response.status}`);
	}
	if (!response.ok) {
		throw new Error(`the source answered ${response.status}`);
	}
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > maxBytes) {
		throw new Refusal(
			`${Math.round(declared / 1e6)} MB is more than the relay will hold for one job`,
		);
	}
	const body = await response.arrayBuffer();
	if (body.byteLength > maxBytes) {
		throw new Refusal(
			`${Math.round(body.byteLength / 1e6)} MB is more than the relay will hold for one job`,
		);
	}
	return {
		status: response.status,
		final_url: response.url || url,
		content_type: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
		bytes: body.byteLength,
		body,
	};
}

/** The `<title>`, when there is one. Not a parser: a title and nothing else. */
export function titleOf(html: string): string | null {
	const match = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html);
	if (!match) return null;
	const text = match[1]
		.replace(/\s+/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.trim();
	return text || null;
}
