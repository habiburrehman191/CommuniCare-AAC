# Step 4 — persistence, privacy and offline reliability

Implemented only audit Roadmap Step 4; semantic resolver, recognition lifecycle, TTS sequencing and Step 3 communication layout remain intact.

## Contract
- One reference-counted PersistenceOwner owns hydration and synchronous local writes. It subscribes before the first user edit, normalizes complete snapshots, and ignores runtime-only updates.
- Version 3 explicitly retains only validated profiles, preferences and supported bilingual custom phrases. Legacy versions migrate through the same validator; malformed current data cannot revive an older copy.
- Profile changes, hydration and reset invalidate communication input, selected/generated output and Repeat memory. Mode/preferences/profile references stay consistent. Profiles share device settings and custom phrases; they are not private accounts.
- Transcripts, AI data, sentence selections, message history and usage counts are not retained. Migration overwrites old private fields and removes legacy keys only after a successful replacement write.
- The configured project's legacy Firestore IndexedDB caches are removed without initializing Firebase. A blocked deletion reports a storage error; close old app tabs and retry reset.
- Local reset clears current and legacy app-state keys, resets defaults and runtime speech memory. It intentionally preserves the offline shell and anonymous Firebase identity so an existing optional backup can still be accessed. Delete cloud backup is a separate explicit operation.
- Firebase is lazy and optional. There are no startup cloud reads, automatic uploads, realtime hydration, Firestore persistent caches or offline write queues.
- Backup/restore/delete are explicit Advanced actions. Transactions compare the previously read remote revision on every retry. Operation tokens and local revisions reject stale acknowledgements/restores; pending restores also guard new communication activity. A deletion leaves only a revision tombstone, preventing an earlier create from resurrecting backup content.
- An already submitted remote transaction cannot be physically cancelled by the browser; its result cannot overwrite local state, and revision checks prevent it from overwriting a later remote revision. Failed/timed-out operations never report success.
- Cloud identity remains anonymous and browser-bound; this is optional backup, not cross-device account sync.

## Offline shell
Build generates dist/sw.js from the exact built JS/CSS/font/icon manifest. All 28 asset responses must match SHA-256 hashes before the installation is complete. Failed download, integrity check, cache write or completion marker rejects installation and removes only the partial new cache.
Only same-origin GET requests for allowlisted static assets and known app navigations are intercepted. Firebase/API/unknown/private requests, authorization-bearing requests and query-bearing assets are not cached. Old app caches are cleaned only after complete installation; unrelated caches remain untouched.
Updates wait until old clients close; no forced activation or HTML/chunk version mixing. A missing asset returns an explicit failure offline and is verified and repaired when reachable again. English and Arabic fonts are bundled locally.
Deploy the entire dist directory at the origin root over HTTPS (localhost is allowed for testing). First successful online installation is required; browser cache eviction can require reconnection. Browser recognition and device speech voice availability are separate from the app shell.

## Verification (2026-09-13)
- npm run typecheck: passed, app and tests.
- npm test: 391 passed, zero failed/skipped. Existing communication/voice/UI suites retained; hydration assertion updated to require cleared transient input.
- npm run lint: zero errors, eight pre-existing scaffold warnings.
- npm run build: passed, 28 verified cached assets.
- New tests cover persistence/reload, malformed and legacy schemas, profile consistency, reset and storage failures, optional/unavailable Firebase, failed/time-out/stale operations, privacy allowlists and scoped legacy cache removal.
- Worker tests execute the real worker template in a VM with browser cache/network mocks: offline routes, startup, private-request boundaries, failed/partial install, old-cache protection, activation cleanup, missing-asset recovery and actual build manifest generation.
- Edge production preview: confirmed HTTP origin unreachable after stopping the actual Vite child processes, then loaded /emergency, /settings and /board successfully. The first interrupted-shell attempt had left a child process running and was discarded as outage evidence.
- Origin restart: app recovered; newly built worker displayed “Update ready — close all app tabs to apply”. Closing the old client and reopening yielded “Offline ready”.
- No production Firebase data was read, uploaded or deleted. Firebase failures/concurrency are covered through deterministic CloudPort tests; deployed Firebase rules and live-project integration have not been exercised or deployed.
- Physical device voice output, browser cache eviction policy and airplane-mode testing on mobile devices remain environment-dependent.

## Deployment
Firestore rules are included locally and must be deployed with the application before optional backup is used. No deployment was performed. Backup failure remains explicit if remote rules/configuration do not support the new envelope.
