# Step 1 communication contract

The active board uses the Zustand store, the local candidate service, and intentResolver. The old word/sentence builder is gone. Both stored display modes use semantic candidates. Phrase compatibility sentences derive from data/intents.ts.

The catalog contains 52 symbols in all nine existing categories. Original symbols remain; added symbols supply pain locations, headache, stomach pain, temperature feelings, sickness, fatigue, anger, comfort/rest, eating/drinking, go/call, negation, quantity, intensity, time, politeness, and explicit conjunction/relationship markers.

Resolution returns empty, clear, clarification, or unsupported. The original IDs and text are retained. Unknown concepts, conflicting feelings, unscoped negation, incomplete operators, and unlicensed modifiers produce no candidate. No arbitrary label or fallback text is concatenated. Explicit conjunction joins only validated compatible statements; it never implies cause, sequence, or a diagnosis.

Clear results contain one to three complete bilingual pairs with the same semantic key. Water and Headache have three alternatives. Other intents only use available authored alternatives; the engine does not pad the list. This follows the task's up-to-three requirement. No model, cloud, emotion inference, speech, or automatic selection is involved.

Supported composition includes request refusal, denial of symptoms, pain plus one location, severity, food/drink plus quantity, explicit eat/drink objects, go plus destination, call plus people, play/sleep with a person and/or at a place, compatible statements with And, and a symptom/feeling together with Help or Comfort. Unstated people roles and relationships remain ambiguous. No + an emergency Help request is clarified rather than guessed.

Text input at the domain API accepts exact authored complete English or Urdu utterances, including negative forms. Unrecognized text is preserved. The existing microphone adapter has deliberately not been changed in Step 1.

Custom tiles require a unique non-built-in ID, valid category/metadata, isCustom, bounded text fields, and an English/Urdu pair that matches the same supported intent. Labels are display assets, never inference input. Different equivalent catalog alternatives can form a verified pair. Arbitrary new custom wording cannot be automatically proven grammatical and equivalent: it is kept in existing stored data but excluded from the usable catalog until its meaning is supported. No custom editor or human-review workflow is added in this step.

Every input edit, mode/profile change, regeneration, custom deletion or hydration invalidates the selected output. A valid current candidate requires explicit selection. Normal Speak is disabled without it. Emergency symbol selection no longer invokes speech; existing explicit emergency speech controls and speech sequencing remain for Step 2.

Run npm run typecheck, npm run lint, npm test, and npm run build. Tests use Node's test runner and the esbuild already supplied with Vite, without adding a test framework. Fixtures check English/Urdu output, catalog coverage, negatives, combinations, conflicts, unknown input, custom validity, input preservation, all 2,704 symbol pairs, and state invalidation. Automated parity checks and authored fixtures are not a substitute for independent Urdu-speaker and AAC-user evaluation. Voice, Firebase, PWA, mobile layout, and physical-device tests are outside Step 1.

## Final verification — 13 September 2026

- Application and test TypeScript checks: passed.
- ESLint: passed, zero errors; eight pre-existing UI scaffold warnings remain.
- Node tests: 268 passed, zero failed. Includes all 2,704 ordered symbol pairs.
- Production build: passed, 1,777 modules transformed.
- No browser, microphone, audible TTS, or AAC-user evaluation was performed.

## Changed files (relative to app/)

- src/data/intents.ts (new)
- src/data/phrases.ts
- src/features/communication/intentResolver.ts (new)
- src/features/suggestions/index.ts
- src/utils/messageGeneration.ts
- src/store/communicationStore.ts
- src/types/intent.ts (new)
- src/types/aac.ts
- src/types/index.ts
- src/sections/CommunicationBoardSection.tsx
- src/sections/EmergencySection.tsx (symbol selection handler and explanatory text only)
- src/components/aac/SelectedMessagePreview.tsx
- src/lib/messageBuilder.ts (deleted)
- tests/communication/core.test.ts (new)
- tests/communication/store.test.ts (new)
- tests/communication/README.md (new)
- scripts/test.mjs (new)
- tsconfig.tests.json (new)
- package.json (test/typecheck scripts only)

The production dist/ output was rebuilt. Firebase, PWA, speech hooks, voice parsing, camera, emotion, framework versions, and dependency versions were not edited.
