# Astra companion implementation status

Updated 2026-10-29. This is an initial implementation, not a release-ready mobile app.

## Implemented

- Capacitor 8 Android and iOS projects wrap the existing React application. Native startup loads device credentials from secure storage before rendering; validated `amethyst://pair` links open the local pairing route.
- Five companion tabs reuse Home, remote agent, terminal, files and media views. Connection status comes from the host capabilities endpoint. Mobile Home layout is separate from desktop layout.
- Capture drafts and a minimal library/job snapshot are AES-GCM encrypted in IndexedDB. Capture submission waits for durable local storage. Stable UUIDs deduplicate host jobs; changed content under the same UUID is refused. Accepted jobs remain distinguishable from completed imports.
- Device tokens have an explicit method/path capability allowlist. Missing grants deny access. Forwarded loopback requests cannot inherit local trust. WebSocket frames recheck grants; relay intent dispatch rejects unknown, revoked or agent-disabled devices.
- Shell, launch, kill and power HTTP actions create expiring, device-owned drafts and require a single-use approval through ConfirmationService, with an execution audit. Direct remote turns cannot select full-access or auto-edit and require write approval.
- Full relay queues reject new work visibly instead of discarding older requests. Legacy raw browser group-key storage migrates toward a nonextractable key; native group keys use the secure vault.

## Validation

` .venv/bin/python -m pytest tests/test_mobile_captures.py tests/test_library.py tests/test_mobile_access.py tests/test_api_remote_access.py tests/test_remote_control.py tests/test_terminal.py tests/test_sync_devices.py tests/test_sync_remote_control.py -q `: 155 passed. Warnings: Starlette deprecation and subprocess transport cleanup after event-loop shutdown.

`npm run test:sync --prefix frontend`: 35 passed. `npm run test:mobile --prefix frontend`: 5 passed, covering encryption/isolation, interrupted writes during unpair, pairing routes, required approval, and dashboard cache separation/migration.

Production Vite build passes, with chunk-size and mixed static/dynamic import warnings. Capacitor synchronization copies the build and registers plugins; this is not native compilation.

Additional dashboard checks did not pass: `dashboard-shell.mjs` fails an unchanged resize assertion (expected height 4, actual 3); `dashboard-recovery.mjs` needs a running Vite test server and could not load `/@react-refresh` at port 5177. No screenshots were taken.

## Run

Install frontend dependencies with `npm ci` in `frontend`, then run `npm run mobile:sync`. Open Android with `npm run mobile:android`, or iOS on macOS with `npm run mobile:ios`. Pair with the desktop's existing relay pairing flow and a host URL reachable by the phone. Native cleartext/mixed-content access is disabled; use a trusted HTTPS host. Do not disable certificate validation to work around device networking.

## Remaining before release

- Compile and test on Android/iOS hardware, including secure-storage lifecycle, TLS, keyboard/insets, pairing, revoked permissions, and reconnect. This Linux environment has no Java/Android SDK/adb and cannot run Xcode.
- Native share extension/intents, attachment import, push notifications and background transfer are not implemented.
- Agent UI currently uses the existing queued relay workflow; live direct conversation streaming and native session handoff remain to be implemented. Relay jobs do not yet expose interactive approvals.
- Only capture/snapshot storage is encrypted locally. Existing sync replica/outbox and widget caches retain their browser storage behavior; native-wide encrypted persistence is unfinished.
- Capture delivery requires a reachable host API; Cloudflare capture forwarding, explicit failed-job retry controls and completed-capture retention management remain unfinished.
- Terminal sessions remain backend-process scoped. tmux persistence, workspace file editing, read-only terminal sessions and full desktop handoff are unfinished.
- Stream revocation currently checks on traffic; proactive idle disconnect and continuous HTTP screen/camera stream checks remain unfinished.
- Queue dispatch rechecks device grants, but accepted agent jobs need another grant check at execution and interactive permission handling before broader remote-agent rollout.

Changes are in the shared worktree alongside unrelated UI work; only companion-owned files belong to this implementation.
