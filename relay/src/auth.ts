/**
 * Who is asking, and what that buys them.
 *
 * Two credentials, deliberately unequal:
 *
 *   `RELAY_TOKEN`  - the machine's. It may take results, download staged bytes,
 *                    confirm a sync (which is what deletes them), and create
 *                    any kind of job. It is a Worker secret, set once by hand.
 *   `share_token`  - a phone's. It may create a job of a kind marked
 *                    `remoteCreatable` and poll a job it created, and nothing
 *                    else. It lives in the machine's keychain and is mirrored
 *                    into D1 on every sync, so revoking it is rotating it there.
 *
 * Neither ever reaches a provider. The Instagram access token, the app secret
 * and every model key stay where they are -- a remote client asks for *work* to
 * be done and is told whether it was, and no credential is part of that answer.
 * That is the whole reason `remoteCreatable` is per job type rather than a flag
 * on the token: a kind that spends a credential simply is not askable for.
 */

import type { Env } from './index.ts';

export type Caller = 'desktop' | 'client';

/**
 * Constant time, like every other secret comparison in this project. Length is
 * compared first and leaks only the length, which for a token is fixed.
 */
export function sameSecret(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export function bearer(header: string | null): string | null {
	if (!header) return null;
	const [scheme, ...rest] = header.split(' ');
	if (scheme.toLowerCase() !== 'bearer') return null;
	return rest.join(' ').trim() || null;
}

/**
 * The caller's level, or null for "nothing here answers you".
 *
 * `readState` is passed in rather than imported so this file does not depend on
 * the Worker's own module graph -- and so a test can say what the share token is
 * without standing up D1.
 */
export async function authenticate(
	request: Request,
	env: Pick<Env, 'RELAY_TOKEN'>,
	readState: (key: string) => Promise<string | null>,
): Promise<Caller | null> {
	const presented = bearer(request.headers.get('authorization'));
	if (!presented) return null;
	if (env.RELAY_TOKEN && sameSecret(presented, env.RELAY_TOKEN)) return 'desktop';
	const share = await readState('share_token');
	if (share && sameSecret(presented, share)) return 'client';
	return null;
}
