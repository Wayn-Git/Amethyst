/**
 * Every job type this relay can run.
 *
 * The one file a new capability is added to, and the only one. Nothing in
 * `src/index.ts`, `src/jobs/runner.ts` or `src/jobs/workflow.ts` names a kind.
 */

import { register } from '../registry.ts';
import { documentFetch, mediaFetch } from './files.ts';
import { instagramAck } from './instagram_ack.ts';
import { urlIngest } from './url_ingest.ts';

let registered = false;

/** Idempotent, because both the fetch handler and the Workflow call it. */
export function registerJobTypes(): void {
	if (registered) return;
	register(urlIngest);
	register(documentFetch);
	register(mediaFetch);
	register(instagramAck);
	registered = true;
}

export { documentFetch, instagramAck, mediaFetch, urlIngest };
