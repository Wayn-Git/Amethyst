/**
 * The two job types that move bytes, built from one description.
 *
 * A document and an audio file differ in exactly three ways -- what content
 * types are acceptable, how big one is allowed to be, and what the machine does
 * with it afterwards -- so they are one factory and two calls rather than two
 * near-identical modules that drift. Adding "ebook" or "image" is another call.
 *
 * Neither of them *processes* anything. Extraction (`backend/documents/`),
 * ffmpeg and transcription (`backend/media/`) all stay on the machine: they
 * need a filesystem, they need binaries no Worker has, and transcription needs
 * a provider key that must never be in reach of a remote client. The relay's
 * job is to have the bytes before they expire, and to have stopped holding them
 * as soon as the machine does.
 */

import { type JobEnv, type JobType, Refused } from '../registry.ts';
import { get, safeUrl } from './http.ts';

export interface FileKind {
	kind: string;
	/** Content-type prefixes and exact types this will accept. */
	accepts: string[];
	maxBytes: number;
	remoteCreatable: boolean;
	/** What the staged object is called inside the job's prefix. */
	fallbackName: string;
}

function acceptable(contentType: string, accepts: string[]): boolean {
	return accepts.some((allowed) =>
		allowed.endsWith('/') ? contentType.startsWith(allowed) : contentType === allowed,
	);
}

/** A filename from the URL's last path segment, or the type's fallback. */
export function nameFor(url: string, fallback: string): string {
	try {
		const segment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
		const cleaned = segment.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
		return cleaned.includes('.') ? cleaned : fallback;
	} catch {
		return fallback;
	}
}

export function fileJobType(spec: FileKind): JobType<JobEnv> {
	return {
		kind: spec.kind,
		remoteCreatable: spec.remoteCreatable,
		maxAttempts: 3,

		accept(input) {
			const url = safeUrl(input.url);
			const title = typeof input.title === 'string' ? input.title.trim().slice(0, 400) : null;
			if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') {
				throw new Refused('title, if given, is a string');
			}
			return { url, title: title || null };
		},

		key(params) {
			return `${spec.kind}:${params.url}`;
		},

		steps: [
			{
				key: 'probe',
				/**
				 * A HEAD before a GET, so a 400 MB video is refused in one round trip
				 * rather than downloaded into a size check. Servers that refuse HEAD
				 * are common enough that a failed probe is not fatal -- the GET's own
				 * limits are the real ones.
				 */
				async run({ params }) {
					const url = String(params.url);
					try {
						const response = await fetch(url, {
							method: 'HEAD',
							redirect: 'follow',
							signal: AbortSignal.timeout(15_000),
						});
						const contentType = (response.headers.get('content-type') ?? '')
							.split(';')[0]
							.trim()
							.toLowerCase();
						const length = Number(response.headers.get('content-length') ?? 0);
						if (length > spec.maxBytes) {
							throw new Refused(
								`${Math.round(length / 1e6)} MB is more than the relay will hold for one job`,
							);
						}
						if (contentType && !acceptable(contentType, spec.accepts)) {
							throw new Refused(`${contentType} is not something a ${spec.kind} job carries`);
						}
						return { content_type: contentType || null, bytes: length || null };
					} catch (err) {
						if (err instanceof Refused) throw err;
						// A server that will not answer HEAD is not a reason to stop.
						return { content_type: null, bytes: null, probe: 'the source refused a HEAD' };
					}
				},
			},
			{
				key: 'stage',
				/**
				 * Fetch and put, in one step, because a step's answer is written to D1
				 * as JSON -- so bytes must never be one. What crosses the ledger is
				 * the key they were put under.
				 */
				async run({ params, stage }) {
					const url = String(params.url);
					const found = await get(url, { maxBytes: spec.maxBytes });
					if (found.content_type && !acceptable(found.content_type, spec.accepts)) {
						throw new Refused(
							`${found.content_type} is not something a ${spec.kind} job carries`,
						);
					}
					const name = nameFor(found.final_url, spec.fallbackName);
					const ref = await stage(name, found.body, found.content_type || 'application/octet-stream');
					if (!ref) {
						// No bucket bound. Not a failure: the machine has the URL and a
						// working fetch of its own, and saying so is more useful than a
						// job that fails because of how this relay was deployed.
						return {
							staged: false,
							why: 'this relay has no artifact bucket; the machine will fetch it itself',
							content_type: found.content_type,
							bytes: found.bytes,
							final_url: found.final_url,
						};
					}
					return { staged: true, artifact: ref, final_url: found.final_url };
				},
			},
		],

		result(params, done) {
			const staged = (done.stage ?? {}) as Record<string, unknown>;
			const probe = (done.probe ?? {}) as Record<string, unknown>;
			const artifact = staged.artifact as Record<string, unknown> | undefined;
			return {
				url: params.url,
				title: params.title,
				final_url: staged.final_url ?? null,
				content_type: artifact?.content_type ?? staged.content_type ?? probe.content_type ?? null,
				bytes: artifact?.bytes ?? staged.bytes ?? probe.bytes ?? null,
				// The only thing the machine needs to collect the bytes, and the only
				// thing `markSynced` needs to delete them.
				artifact: artifact ?? null,
				staged: staged.staged === true,
				why: staged.why ?? null,
			};
		},
	};
}

/** A PDF, a Word file, a deck. The machine extracts it -- see `backend/documents/`. */
export const documentFetch = fileJobType({
	kind: 'document_fetch',
	accepts: [
		'application/pdf',
		'application/epub+zip',
		'application/vnd.openxmlformats-officedocument.',
		'application/vnd.oasis.opendocument.',
		'application/msword',
		'application/rtf',
		'text/',
	],
	// A large PDF is a scanned book, and the machine can fetch that itself.
	maxBytes: 32 * 1024 * 1024,
	remoteCreatable: true,
	fallbackName: 'document',
});

/**
 * A podcast episode, a voice note, a recording. Transcription is deliberately
 * *not* here: the key that would pay for it lives in the machine's keychain and
 * putting it in a Worker would hand a provider credential to whatever can reach
 * the Worker. `backend/media/audio.py` does that work where the key already is.
 */
export const mediaFetch = fileJobType({
	kind: 'media_fetch',
	accepts: ['audio/', 'video/', 'application/ogg'],
	maxBytes: 48 * 1024 * 1024,
	remoteCreatable: true,
	fallbackName: 'media',
});
