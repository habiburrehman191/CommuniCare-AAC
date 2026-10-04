# Step 2 — Voice input, speech output, and emergency flow

The implementation uses the audit in app/Ayesha-Eman-FYP-Complete-Audit.md and the completed Step 1 catalog/resolver. Only Step 2 and the four already-added interrupted-review regressions were addressed. There is no UI redesign, new AI dependency, or modification to Firebase, PWA, camera, emotion, or framework/dependency versions.

## Voice behavior

VoiceCommandPanel is now communication input: English (en-US) and Urdu (ur-PK), live/interim transcript, final transcript, editable final text, and explicit Start/Stop Listening. Each manually started recognition session uses interim results, one best alternative, and one utterance; it never automatically restarts. A starting/stopping state prevents overlapping sessions. Stop awaits the current final result; abort, Clear, symbol edits, language change, and unmount invalidate late events. Startup and stopping timeouts release hung sessions. Incomplete final/interim combinations are displayed for correction rather than committed after dropping unfinished words.

Completed normal speech is passed through a small exact alias adapter to the existing Step 1 semantic resolver. Roman Urdu aliases and meaning-preserving English contractions retain the original transcript. Unknown speech stays visible with no guessed sentence. Candidates still require explicit selection; selecting or dictating never speaks them.

Only whole-utterance explicit UI controls execute: speak message, stop speaking, repeat message, clear message, remove last symbol, and open emergency board, plus listed Urdu/Roman Urdu equivalents. Bare Stop, No, and Help remain communication. Typed text never executes a UI control. Recognition alternatives are not searched for a more convenient match, and transcripts are not logged or added to persisted state.

## Speech behavior

One shared SpeechController owns the complete utterance sequence, current owner/session, cancellation, voice inventory, completion promise, and last explicitly spoken bilingual message. Board, Emergency, and Settings use the same hook/adapter. There are no inter-language delayed callbacks. Stop, changed input, new candidate, a replacement speech request, or owner unmount invalidate every old callback and watchdog. The promise reports completion, cancellation, unavailable voice/support, or failure. History is recorded only after completion.

Repeat uses an isolated copy of the last explicit speech request, including its language/settings, even after Clear or a newer unspoken selection. Its contents are displayed beside the Repeat control. Settings test speech does not replace the last communication message.

The entire requested language plan is checked before playback. Urdu text is never sent to Hindi, Arabic, or English voices. Missing voices produce a visible explanation, with an explicit English-only choice. Settings labels distinguish English only, Urdu only, and English plus Urdu, and show Urdu/local-voice availability.

## Emergency behavior

Predefined emergency text comes from the local Step 1 catalog. Selecting a card displays that message and cancels old speech without automatically speaking. Explicit Speak buttons speak the selected/predefined message. SOS Help uses the same reviewed local Help content. Stop cancels speech; there is no fake independent alarm toggle. Emergency Repeat and all emergency speech require localService voices, even when the device is online. If those are absent, the message remains visible and the user can explicitly choose an available local language. Normal-board selections do not contaminate emergency messages.

## Preserved Step 1 and narrow regression fixes

All original 268 Step 1 tests remain. The interrupted review had added four failing cases before Step 2 began: question punctuation becoming a statement, lowercase English I after Please, unscoped time/refusal across multiple requests/people, and rejection of a valid custom refusal. Those tests remain and now pass. The resolver/candidate contract and authored catalog remain in place; no replacement semantic engine was introduced.

## Automated checks

- Application, build configuration, and communication test typechecks passed.
- ESLint passed: zero errors and the same eight pre-existing UI scaffold warnings.
- 322 tests passed, zero failed: original Step 1 tests, four preserved review regressions, and 50 focused Step 2 tests.
- Tests cover English/Urdu modes, interim/final aggregation, negation, exact commands, stale recognition sessions, permission/service errors, timeouts, TTS ordering, stale callbacks, cancellation, Repeat, voice absence, local-only SOS, and actual server rendering of a voice-only selected-message preview.

## Changed files, relative to app/

- src/components/aac/VoiceCommandPanel.tsx
- src/components/aac/SelectedMessagePreview.tsx
- src/features/communication/voiceCommands.ts
- src/features/communication/voiceInput.ts (new)
- src/features/communication/recognitionController.ts (new)
- src/features/communication/speechController.ts (new)
- src/features/communication/speechBinding.ts (new)
- src/features/communication/emergencySpeech.ts (new)
- src/features/communication/intentResolver.ts (four preserved regression fixes)
- src/hooks/useSpeechRecognition.ts (new)
- src/hooks/useSpeechSynthesis.ts
- src/store/communicationStore.ts
- src/sections/CommunicationBoardSection.tsx
- src/sections/EmergencySection.tsx
- src/sections/SettingsSection.tsx (speech controls only)
- src/lib/urduCommands.ts (deleted unused parser)
- scripts/test.mjs
- tests/communication/voice.test.ts (new)
- tests/communication/speech.test.ts (new)
- tests/communication/STEP-2-RESULTS.md (new)

The four regression additions in tests/communication/core.test.ts predate the Step 2 starting snapshot and were retained. dist/ was regenerated by the production build.

## Practical limits and manual device checks

No real microphone, audible English/Urdu output, installed-device SOS, or browser interaction test was performed. The tests use controllable browser-API adapters and one rendered-component check; they do not prove recognition accuracy or pronunciation. On the demonstration device, verify both language modes, microphone denial, a negated request, Stop during each language, Clear/navigation during speech, Repeat after Clear, missing Urdu, and SOS with the network disabled and installed local voices.

Speech understanding remains bounded by Step 1 and the explicit aliases. For example, unsupported detail is retained for correction rather than weakened into a different known intent. Roman Urdu aliases do not guarantee that a browser will transcribe speech into Roman Urdu. Browser recognition may use a remote service and fail offline; see [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition). Emergency speech requires installed local voices, identified by [localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService); no alternative-language pronunciation fallback is used. PWA cold-start guarantees remain Step 4 work, unchanged here.

Final production build: passed; 1,782 modules transformed. Protected-file comparison confirmed Firebase/sync, PWA files, Step 1 phrase/intent catalog, and dependency manifests are unchanged.
