/**
 * "Got it" -- the receipt Instagram's 24-hour window will not wait for.
 *
 * This was `src/ack.ts`: its own Workflow class, its own dispatch function, its
 * own retry policy. All of that was the generic machinery in `src/jobs/`
 * written once for one job, so it is now the same machinery's first job type
 * and the bespoke copy is gone. What has not changed is any of the behaviour --
 * the same three steps, the same allowlist check, the same `outbound` row, and
 * the same idempotency key (the delivery's body hash), so Meta re-delivering
 * still buys exactly one receipt.
 *
 * The wording is load-bearing. It says received, not saved: the reel has not
 * been transcribed, enriched or written to the library and will not be until
 * the machine is running.
 */

import type { Env } from '../../index.ts';
import { type JobType, Refused } from '../registry.ts';

/**
 * Five attempts over roughly ten minutes: long enough to ride out a Graph
 * incident, short enough to stay inside the 24-hour window with room to spare.
 */
const RETRIES = { limit: 5, delay: '30 seconds', backoff: 'exponential' } as const;

export const instagramAck: JobType<Env> = {
	kind: 'instagram_ack',
	// Never. The reply goes out over the account's own access token, so a
	// credential weaker than the machine's must not be able to ask for one.
	remoteCreatable: false,
	maxAttempts: 2,
	retries: RETRIES,

	accept(input) {
		const senderId = typeof input.sender_id === 'string' ? input.sender_id.trim() : '';
		const bodyHash = typeof input.body_hash === 'string' ? input.body_hash.trim() : '';
		if (!senderId || !bodyHash) throw new Refused('an ack needs a sender_id and a body_hash');
		return { sender_id: senderId, body_hash: bodyHash };
	},

	/** The delivery, not the moment. One delivery, one receipt, forever. */
	key(params) {
		return `instagram_ack:${params.body_hash}`;
	},

	steps: [
		{
			key: 'may we answer',
			/**
			 * Asked once and recorded, so a retry half an hour later does not
			 * re-decide on a different answer and send a receipt for a reel the
			 * machine has by now saved and replied to itself.
			 */
			async run({ env, params }) {
				const { allowedSenders, getState } = await import('../../index');
				if ((await getState(env, 'reply_on_save')) !== '1') {
					return { ok: false, why: 'replies are off' };
				}
				const allowed = await allowedSenders(env);
				if (!allowed.includes(String(params.sender_id))) {
					return { ok: false, why: 'sender is not on the allowlist' };
				}
				if (!(await getState(env, 'access_token'))) {
					return { ok: false, why: 'no access token' };
				}
				return { ok: true, why: '' };
			},
		},
		{
			key: 'send',
			/**
			 * The one externally visible operation. A non-2xx throws, which is how a
			 * step asks for the next attempt -- returning normally would record a
			 * send that never happened.
			 */
			async run({ env, params, done }) {
				const permitted = (done['may we answer'] ?? {}) as { ok?: boolean; why?: string };
				if (!permitted.ok) {
					const { recordOutbound } = await import('../../outbound');
					await recordOutbound(
						env,
						String(params.body_hash),
						String(params.sender_id),
						'skipped',
						permitted.why,
					);
					// Not a failure. Replies being off, or a stranger messaging the
					// account, is the system working -- and a *failed* job would be
					// collected by the machine as something that went wrong. The row
					// says what was decided; the job finishes having decided it.
					return { sent: false, why: permitted.why ?? 'not permitted' };
				}
				const { sendAckOnce } = await import('../../index');
				const outcome = await sendAckOnce(env, String(params.sender_id));
				if (!outcome.ok) throw new Error(`graph ${outcome.status}: ${outcome.detail}`);
				return { sent: true };
			},
		},
		{
			key: 'record sent',
			async run({ env, params, done }) {
				const sent = (done.send ?? {}) as { sent?: boolean };
				if (!sent.sent) return { recorded: false };
				const { recordOutbound } = await import('../../outbound');
				await recordOutbound(env, String(params.body_hash), String(params.sender_id), 'sent');
				return { recorded: true };
			},
		},
	],

	result(params, done) {
		const sent = (done.send ?? {}) as { sent?: boolean; why?: string };
		// Nothing for the machine to fetch: the receipt has been sent, and what
		// the machine reads about it is the `outbound` summary `/sync` already
		// returns. The job exists for the retries, not for a result.
		return {
			sender_id: params.sender_id,
			body_hash: params.body_hash,
			acked: sent.sent === true,
			why: sent.why ?? null,
		};
	},
};
