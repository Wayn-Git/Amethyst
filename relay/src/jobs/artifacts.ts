/**
 * Bytes, staged only when there are genuinely bytes.
 *
 * The README's promise is "nothing, and no card", and R2 is the one Cloudflare
 * product that asks for a card on file. So the bucket binding is **optional**
 * and every job type must work without it: `stage` answers null when there is
 * nowhere to put something, the job says so in its result, and the laptop
 * fetches the URL itself when it comes back. That is a worse outcome than
 * having the bytes waiting -- an asset that expired in the meantime is gone --
 * but it is a working relay on a free account, which is the point.
 *
 * Anything staged is deleted on the sync that confirms the laptop has it
 * (`JobStore.markSynced`) or by the daily prune, whichever comes first. Nothing
 * here is a store; it is a hand-off with a deadline.
 */

import type { Job } from './state.ts';

/** A ceiling, not a quota. Big enough for a PDF or a few minutes of audio. */
export const MAX_ARTIFACT_BYTES = 48 * 1024 * 1024;

export class ArtifactTooLarge extends Error {}

export interface ArtifactRef {
	key: string;
	name: string;
	bytes: number;
	content_type: string;
}

/** Where one job's bytes live. Prefixed by job id so cleanup is a prefix delete. */
export function artifactKey(job: Job, name: string): string {
	return `jobs/${job.id}/${name}`;
}

/**
 * Put one file where the laptop can fetch it, or answer null if there is no
 * bucket bound.
 */
export async function stage(
	bucket: R2Bucket | undefined,
	job: Job,
	name: string,
	body: ArrayBuffer,
	contentType: string,
): Promise<ArtifactRef | null> {
	if (body.byteLength > MAX_ARTIFACT_BYTES) {
		throw new ArtifactTooLarge(
			`${name} is ${Math.round(body.byteLength / 1e6)} MB, over the ${
				MAX_ARTIFACT_BYTES / 1e6
			} MB the relay will hold`,
		);
	}
	if (!bucket) return null;
	const key = artifactKey(job, name);
	await bucket.put(key, body, { httpMetadata: { contentType } });
	return { key, name, bytes: body.byteLength, content_type: contentType };
}

/** One staged file, for the laptop that is collecting it. */
export async function read(
	bucket: R2Bucket | undefined,
	key: string,
): Promise<R2ObjectBody | null> {
	if (!bucket) return null;
	return (await bucket.get(key)) as R2ObjectBody | null;
}
