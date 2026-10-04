# CommuniCare AAC

English/Urdu AAC with one local semantic engine, reviewed sentence choices and explicit speech.

## Run
Use Node 22.12+ and run these commands in app/:

```sh
npm ci
npm run typecheck
npm test
npm run lint
npm run build
npm run verify:boundaries
npm audit
npm start
```

Open http://localhost:8787. The server serves dist/ and POST /api/suggestions at the same origin. npm run dev remains available for local UI development; its static-only server falls back to local suggestions without an API proxy. Production needs HTTPS at the origin root and a maintained Node host/reverse proxy. Deploy dist/ with server-dist/ and production dependencies; only dist/ is public. Do not expose source or environment files.

## Communication and signature features
Symbols, supported typed text and English/Urdu/Roman Urdu speech aliases enter the same semantic resolver. Ambiguous/incomplete input offers bilingual clarification choices or correction, never guessed output. Confirmed choices return to the resolver. Clear meaning offers 1–3 bilingual candidates; users select, then Speak or open Partner Mode. No input, candidate, context, AI response or partner reply automatically speaks.

Home, School, Meal, Medical, Social, Travel and Emergency prioritize available symbols without hiding vocabulary. Fixed quick communication and SOS remain reachable. Context and preferred style reorder equivalent candidates only. Urgency is never added unless already part of the meaning.

Partner Mode uses a full-screen native modal with large English/Urdu text, explicit speech controls, Yes/No replies and Back. Repeat plays the last explicitly requested speech, which may differ from the displayed message.

Caregiver Phrase Studio supports bilingual labels, icons, categories, canonical symbol combinations, up to three reviewed alternatives, exact aliases including Roman Urdu, contexts and emergency priority. Every save requires review. Sentence pairs must belong to the local reviewed equivalent set; arbitrary new facts or translations are rejected. Caregivers remain responsible for ensuring their labels and aliases mean the declared intent. Known conflicts trigger clarification.

## Gemini configuration and safety
Gemini is implemented behind the Node server, disabled by default in Communication settings. Set GEMINI_API_KEY and GEMINI_MODEL in the server environment only, and APP_ORIGIN to the exact public origin. See .env.server.example. The application does not automatically read that example file. Never use a VITE-prefixed secret.

The request sends canonical built-in symbol IDs, situation and style. The server reconstructs the local intent and reviewed bilingual alternatives. It sends only these minimal values to Gemini using the [official generateContent API](https://ai.google.dev/api/generate-content). It does not send raw transcripts, audio, custom labels, profiles, history, Firebase or camera data.

The model can select contextual wording and a reviewed polite variant. Both server and client require exact membership in the reviewed equivalent bilingual set. Novel model paraphrases, mismatched languages, reversed negation, added urgency/facts/advice, duplicates and malformed output are rejected. This deliberate bound sacrifices open-ended wording for verifiable meaning preservation. Urgent style cannot manufacture an emergency.

Local choices remain visible immediately. The server has a 3.5-second provider timeout, exact-origin/content-type checks, a 4 KB input cap, per-IP/global rate limits and no-store responses. The client has cancellation/timeout and resolution-identity guards; late responses cannot replace newer or selected input. No AI content is persisted. Missing configuration, offline, quota, network or validation failures retain local candidates. Live Gemini E2E is pending until a real server key/model is configured; tests use explicit mocked provider responses.

Rate limiting is per server process; a multi-instance public deployment needs a shared gateway limit and normal operational monitoring. Reverse proxies must preserve the configured Origin behavior. No deployment is performed by this task.

## Local privacy and optional backup
One persistence owner validates profiles, settings, custom phrases and bounded per-profile personalization. Personalization stores canonical IDs, capped counts, up to eight recent IDs, context and style; it can be disabled or reset in Communication settings. Raw transcripts, selected/generated messages, history and AI requests/responses are not retained. Repeat is session-only.

Profiles share device settings and custom phrases; they are not private accounts. Firebase is optional explicit backup/restore/delete, with no automatic cloud queue. Personalization and AI opt-in are excluded from backup. Configure public Firebase web values using .env.example and deploy the supplied rules only to your own project. No live Firebase deployment is claimed.

Reset clears validated current/legacy communication storage and attempts scoped legacy Firestore disk-cache cleanup. It preserves the offline shell and optional backup identity. Cloud deletion is a separate explicit action.

## Offline
Open the production application online once and wait for Offline ready in Advanced. The worker verifies every required built JS/CSS/font/asset before installing; partial installation cannot replace a complete cache. It excludes API/private/Firebase responses. Close all app tabs to activate a waiting complete update.

After installation, /board, /settings, /profiles and /emergency support offline reload. Symbols, clarification, contexts, studio data, personalization, local candidates, Partner Mode and SOS text work offline. TTS needs installed device voices. Browser recognition may need internet and permission; Roman Urdu uses supported exact aliases with the English recognizer, not a separate speech model. Missing Urdu voice is reported honestly. First installation/cache eviction requires reconnection.

## Evidence and limits
See [signature implementation and QA](tests/communication/SIGNATURE-QA.md). Earlier step reports are historical. Physical-device microphone accuracy, audible Urdu pronunciation, assistive-technology testing and independent bilingual AAC-user/caregiver evaluation remain necessary.
