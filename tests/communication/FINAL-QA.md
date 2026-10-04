> Historical Step 5 record. The required signature-layer delivery now includes Gemini. See [current signature QA](SIGNATURE-QA.md).

# Final integration and QA — Roadmap Step 5
Date: 13 September 2026. Authority: Ayesha-Eman-FYP-Complete-Audit.md, Section 22 Step 5, together with completed Steps 1–4.

## Architecture and AI decision
The authoritative path remains active board → store → local semantic/voice normalization → reviewed bilingual candidates → explicit user selection → one speech controller. One local persistence owner and an integrity-verified production shell support optional explicit Firebase backup.
Gemini was assessed and omitted: no measurable contextual improvement was established that can pass the existing bounded bilingual semantic verifier. A model constrained to exact reviewed alternatives duplicates local output. Accepting new language would need independent equivalence validation and user evaluation. The audit explicitly permits omitting the endpoint in this case.
No key was supplied in the project, no model calls or invented model results were used, and no client/server AI boundary was added. AI timeout/quota/output/rate-limit tests are therefore NOT claimed. Live Gemini E2E remains unperformed, pending any future justified enhancement. The final deliverable is local-only suggestion generation.

## Fixes
- Connected the missing user-facing custom phrase flow in existing Communication settings. Custom labels choose reviewed bilingual meanings; invalid labels and the 100-item limit receive feedback.
- Duplicate custom IDs or invalid additions no longer remove existing valid custom phrases or invalidate a selected sentence.
- Deleting a custom phrase preserves unrelated corrected text and its negation.
- New label controls use existing 48px styling and visible focus.
- Applied compatible npm audit fixes: 18 reported advisories reduced to zero, without a forced major upgrade.
- Replaced outdated README claims about automatic cloud synchronization and retained history.
- Added a reproducible built-bundle boundary check. It checks specific AI/key/private-key markers, remote font references and unresolved worker placeholders; it is not a proof against every possible secret encoding.

## Automated results
| Check | Result |
|---|---|
| npm run typecheck | Passed, application and tests |
| npm test | 399 passed, zero failed/skipped |
| npm run lint | Zero errors; same eight existing unused-scaffold warnings |
| npm run build | Passed; Vite 7.3.6; 28 verified offline assets |
| npm run verify:boundaries | Passed |
| npm audit | Zero reported vulnerabilities |

391 prior tests remain, with 8 final integration/UI tests added. Integrated tests cover English/Urdu/Roman Urdu recognition event streams through the real store and semantic engine, interim/final separation, refusal preservation, explicit selection, bilingual speech, cancellation, Repeat, SOS under forced network failure, custom persistence/deletion, duplicate protection and private Repeat-memory clearing. Browser recognition and speech adapters are mocked in these automated tests; no physical microphone or audible pronunciation claim follows from them.
Existing tests cover malformed/legacy storage, reset/storage failures, cloud unavailability/conflicts/timeouts/stale responses, exact commands, missing voices, all vocabulary/categories, contradictory combinations, PWA route fallback, partial installs, cache boundaries and recovery.

## Browser observations (desktop Edge)
- Production custom creation with synthetic labels “QA drink” / “میرا مشروب”, followed by reload, category discovery, keyboard symbol selection, three bilingual candidates, keyboard candidate selection and explicit Speak.
- Missing Urdu voice surfaced honestly while selected text remained visible. Explicit English speech and Repeat controls were exercised; actual acoustic output/pronunciation was not independently verified.
- Roman Urdu and Urdu-script refusal corrections produced negative candidates and invalidated the previous selected output.
- Adult profile selection persisted after reload. Original Child profile restored afterward.
- Firebase unavailable produced “Backup failed”, not a success indication. No successful live backup, restore, rules deployment or destructive cloud operation was performed.
- New build waited behind the previous worker and activated after closing/reopening the old client.
- Populated board and custom settings measured at actual CSS widths 320, 374, 390, 430, 768, 1024, 1440 and 2048; 374 was the nearest narrower width to requested 375 under this browser's scaling. No horizontal document overflow. New editor button/select/input controls were at least 44px. Narrow landscape 568×320 board also passed. Urdu output had language and RTL attributes.
- The broader unchanged settings/profile/SOS responsive matrix and confirmed-origin-outage route reloads are recorded in Steps 3/4. Final worker tests were rerun; a new physical-device airplane-mode test was not performed.
- Synthetic custom data was removed through Settings, the original profile restored and temporary viewport override reset.

## Workflow verdict and limits
Local symbols/supported text → semantics → suggestions → selection → speech-controller flow passes automated integration and observed browser interactions. Recognition permission/network failures, stale sessions, speech cancellation, missing voices, reset/storage failures, failed backup and offline caching are covered, with scope of each observation distinguished above.
The application is ready for a supervised local FYP demonstration of the verified bounded communication flow. It is NOT evidence of clinical suitability or completed real-world AAC evaluation.
Remaining acceptance work: physical English/Urdu microphone tests, audible bilingual output on target hardware (this device has no Urdu voice), mobile installation/airplane-mode behavior, screen-reader/200% native zoom evaluation, independent Urdu/AAC-user review, deployed Firebase rules and successful backup/restore/deletion if cloud backup will be demonstrated. API model integration is intentionally absent.
No camera/emotion inference, training, dashboard, AI persistence or UI redesign was added. Stopped after Step 5.
