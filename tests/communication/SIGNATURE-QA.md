# Signature features and premium visual system — QA record

This is the current delivery record. Earlier Step 1–5 reports describe the historical implementation.

## Implemented architecture
One authoritative semantic resolver remains responsible for supported meaning. Symbols, exact English/Urdu/Roman Urdu input and validated caregiver phrases enter that resolver. Bilingual clarification presents explicit alternatives or correction; confirmed choices return to the same resolver. Context and bounded local personalization reorder vocabulary without removing entries. Clear supported intent produces up to three equivalent bilingual candidates. Selection, speech and Partner Mode are explicit actions.

Caregiver studio persists validated semantic IDs, reviewed pairs, labels, icon/category, contexts, emergency priority and aliases through the existing single persistence owner. Personalization stores bounded IDs/counts/recent IDs/context/style, with disable and reset. Raw transcripts, selected messages and AI content are not persisted. Firebase backup excludes personalization/AI opt-in and remains optional.

The same-origin Node server hosts the production shell and Gemini endpoint. Only canonical built-in IDs/context/style leave the client. Both sides enforce the finite reviewed bilingual grammar. The provider can select appropriate reviewed wording and a polite alternative; unreviewed novel wording is intentionally rejected. SOS intents bypass AI. Missing key/model, network, quota, malformed output, changed meaning and stale responses preserve the visible local choices.

## New visual system
The stylesheet and communication composition were replaced with a deep teal/ink/cyan system: a bilingual message canvas and action dock, fixed quick communication tiles, input/sentence composition area, contextual clarification, situation recommendations, category navigation and large pictogram grid. Settings use four exclusive sections with a caregiver studio. Profile cards show per-profile context and wording preferences. Partner presentation uses a native full-screen dialog with large high-contrast bilingual messages.

No dashboard, camera, model training or cloud complexity was added.

## Automated results
- npm run typecheck: passed (application, tests and server).
- npm test: 448 passed, 0 failed; all prior tests retained, including 2,704 symbol-pair checks.
- npm run lint: 0 errors; 8 pre-existing warnings in shared UI primitives.
- npm run build: passed, including separate server artifact.
- npm run verify:boundaries: passed; provider URL/key identifiers excluded from client JS/CSS, fonts bundled, worker fully built.
- npm audit: 0 vulnerabilities.
- Final offline shell: 28 integrity-verified assets; build 02016561f0e257d64f2f865a.

New tests cover clarification, seven contexts, full vocabulary access, caregiver validation/reload/aliases/combinations, bilingual equivalence, negation, alias conflicts, personalization/reset/privacy, explicit partner/quick controls, provider protocol/output validation, rate limits, timeouts, missing key/network/quota fallback, stale/selected response guards and SOS isolation. Existing recognition lifecycle, TTS cancellation/repeat/missing Urdu voice, persistence/Firebase and partial service-worker installation tests remain passing.

## Browser and HTTP verification
Edge, production server on localhost:8787:
- Quick Water created three candidates with Speak disabled until explicit selection.
- Selected water appeared in the bilingual canvas; Partner Mode opened only on request.
- Partner No displayed a complete bilingual refusal without automatic speech.
- Escape closed the updated Partner dialog, preserved the selected sentence and returned focus to its trigger.
- Typed hot/cold conflict produced bilingual clarification; a confirmed cold choice returned to unselected sentence candidates.
- Roman Urdu negative water input preserved refusal in all three bilingual choices.
- Caregiver QA Water with a reviewed pair and exact Roman Urdu alias saved, resolved and survived reload. The disposable phrase was removed after QA.
- Context switching and independent profile context were visible; local personalization reset showed confirmation.
- Settings arrow-key navigation selected the next tab; high-contrast control was exercised. Urdu message elements had language and RTL semantics; sampled primary touch targets were at least 44 CSS px.
- Screenshots inspected for desktop composition, mobile message canvas/action wrapping and focus styling.
- No horizontal overflow in board, studio, SOS or profile measurements at 320, 390, 430, 768, 1024, 1440 and 2048 CSS px. The browser's 50% zoom and integer viewport API required 374/376px to bracket requested 375px; both passed.
- Narrow landscape 640×360 Partner Mode fit horizontally; controls remained reachable with at least 44px dimensions.
- Production private paths /.env.server, /server-dist/index.mjs and /api/private returned 404.
- Real POST /api/suggestions without a key returned 503 with an empty candidate list and Cache-Control: no-store, private.
- AI opt-in with unavailable configuration retained three local water choices; it was returned to its default off state after QA.
- Browser console inspection showed an unrelated Grammarly extension error; no application exception was observed in that inspection.

## Actual offline and recovery
Stopped the identified local Node server and separately confirmed the origin could not be fetched. A newly opened browser tab then started the final built application from the installed worker (index-BVcg7KNZ.js). /board, /settings, /profiles and /emergency loaded with the origin unavailable. The saved caregiver alias generated local candidates, selection and Partner Mode worked, context persisted, profile switching worked, personalization reset worked, and a selected breathing emergency remained readable. Restarting the server restored HTTP 200 shell access; the unconfigured Gemini boundary still returned its honest no-store fallback.

This is an origin-unavailable desktop test, not a physical airplane-mode/device certification. Existing automated tests additionally cover private/API cache exclusions, failed/partial installation, update cleanup and recovery.

## Remaining real-world limits
- No real Gemini key/model was configured. Live provider E2E is pending; model success in tests is explicitly mocked.
- Novel AI/caregiver sentence meanings and unreviewed paraphrases are rejected by design. Caregiver labels/aliases still require informed human review.
- Browser recognition may need network/permission; Roman Urdu is an exact alias layer with the English recognition mode, not a dedicated Roman Urdu model.
- This device reports no installed offline Urdu voice. Audible English/Urdu pronunciation, physical microphone performance, mobile Safari/Android behavior, screen-reader/switch access and AAC-user/caregiver evaluation remain pending.
- PWA first install and recovery from browser cache eviction require internet.
- No live Firebase deployment was performed. Public multi-instance server deployment needs HTTPS and a shared gateway rate budget; current limits are per process.

## Changed files
- .env.server.example
- .gitignore
- package.json
- README.md
- scripts/build-server.mjs
- scripts/test.mjs
- scripts/verify-boundaries.mjs
- server/index.ts
- server/suggestions.ts
- src/components/aac/CaregiverPhraseStudio.tsx
- src/components/aac/CustomPhraseSettings.tsx
- src/components/aac/PartnerMode.tsx
- src/components/aac/SentenceSuggestions.tsx
- src/components/aac/SignatureControls.tsx
- src/components/aac/SignatureSettings.tsx
- src/components/aac/VoiceCommandPanel.tsx
- src/features/communication/intentResolver.ts
- src/features/communication/voiceInput.ts
- src/features/signature/clarification.ts
- src/features/signature/context.ts
- src/features/signature/language.ts
- src/features/signature/types.ts
- src/features/suggestions/onlineSuggestions.ts
- src/hooks/useContextualSuggestions.ts
- src/index.css
- src/lib/firebase.ts
- src/lib/storage.ts
- src/sections/CommunicationBoardSection.tsx
- src/sections/HeaderSection.tsx
- src/sections/ProfileSection.tsx
- src/sections/SettingsSection.tsx
- src/store/communicationStore.ts
- src/types/aac.ts
- src/types/intent.ts
- tests/communication/signature.test.ts
- tsconfig.tests.json
- tests/communication/SIGNATURE-QA.md
- tests/communication/FINAL-QA.md (historical notice)
