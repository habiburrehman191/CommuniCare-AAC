# Ayesha-Eman fyp Project — Complete Technical and Product Audit

**Audit date:** 12 September 2026  
**Decision:** Improve the existing application. Rebuild its communication pipeline, not the entire application.  
**Scope:** Analysis only. No implementation patches, source changes, dependency updates, or deployment.

## Evidence and limitations

The supplied ZIP was inspected through a separate working copy. All 148 project-owned files, including the supplied production build, were compared against the archive after inspection: **148 matched; zero changed**. Third-party `node_modules` were used for verification, not treated as your application’s implementation. Documentation was treated as a claim to check, not as instructions to execute.

The review covered the application entry point, every route and page, active sections and AAC components, state, phrase data, both message builders, both command parsers, speech hooks, persistence, Firebase configuration and rules, service worker, manifest, styles, build configuration, documentation, and the import reachability of unused components. The generic UI collection was checked for active usage and potentially sensitive behavior; it is not evidence of implemented product features.

**Checks actually performed:**

| Check | Observed result |
|---|---|
| Application TypeScript check | Passed, no diagnostics |
| Build-configuration TypeScript check | Passed, no diagnostics |
| ESLint | Passed with **0 errors and 8 warnings** |
| Production Vite build | Passed using the supplied dependencies; 1,774 modules transformed |
| Supplied build versus fresh build | **All 16 production files matched byte-for-byte** |
| Existing application tests | **Zero project test files or configured test suites found** |
| Direct function/store probes | Confirmed sentence concatenation, unsafe command matching, and stale profile/mode state |
| Browser checks | Inspected the fresh production board and settings; selected symbols; measured desktop/mobile layout and small controls |
| 390 × 844 mobile viewport | Board document approximately **1,451px wide**; message preview started approximately **912px below the top** in the tested state |
| Browser warning/error log sample | No warnings/errors captured during the inspected board/settings interaction |

The initial build attempt encountered an environment permission error while launching the build helper. The subsequent permitted run succeeded; this was not a source-code build failure.

**Not verified:** actual microphone recognition, audible TTS output or pronunciation, installed Urdu voices, real-device offline installation, a full service-worker lifecycle, deployed Firebase rules, real cloud synchronization, cloud-project configuration, dependency vulnerability advisories, or testing with AAC users. No microphone/camera permission was requested and no real communication was sent to an AI service. Browser checks used synthetic selections in the local audit preview.

Module paths in this report identify locations **inside the supplied archive**, beginning at its `app/` directory. Proposed new module names in the roadmap are explicitly marked; none has been implemented.

## 1. Executive summary

The current project is a **bilingual preset AAC phrase board with browser TTS, a limited Urdu command recognizer, shared local state, optional Firebase synchronization, and a basic PWA shell**.

It is not yet the intelligent communication system described in your target. The most important missing part is the central pipeline:

**Input → understand intent → three complete bilingual alternatives → choose one → display and speak.**

Currently, symbols become one concatenated message. Voice input is reduced to a small command vocabulary. There is no active sentence-suggestion engine, no online language-model integration, and no user-selection stage between multiple candidate sentences.

The project is a useful working frontend foundation, but its product maturity is **an early functional prototype**. Passing compilation and a production build does not make it communication-reliable. Intent can be reversed, profile state can become inconsistent, mobile layout overflows, and the emergency “Silence Alarm” action does not silence speech.

There are also substantial differences between the interface’s claims and implementation. “Clinical-Grade,” individualized motor-skill calibration, AI emotion priors, and several cloud/analytics descriptions are not supported by the implemented behavior or supplied evaluation evidence.

**Recommendation:** Keep React, TypeScript, Vite, the small Zustand store approach, much of the phrase catalog, symbol/category components, and the useful parts of TTS/PWA support. Replace sentence construction and voice interpretation. Simplify the main screen. Make local communication reliable before considering Gemini.

## 2. Current architecture

There is one Vite React SPA, not a full-stack AI application. Firebase is accessed directly through its browser SDK. No application backend, server-side AI endpoint, or Functions implementation is present.

```text
index.html + src/main.tsx
          ↓
App → AppRouter → MainLayout
                   ├─ HeaderSection
                   │    ├─ network status
                   │    ├─ PWA install handling
                   │    └─ useOfflineSync
                   └─ route outlet
                        ├─ /          WelcomePage
                        ├─ /profiles  ProfileSection
                        ├─ /board     CommunicationBoardSection
                        ├─ /emergency EmergencySection
                        ├─ /caregiver CaregiverDashboardSection
                        └─ /settings  SettingsSection

phrases.ts → category filter → SymbolCard
                                    ↓
                       communicationStore.selectSymbol
                                    ↓
                       generateCommunicationMessage
                                    ↓
                       SelectedMessagePreview
                                    ↓ explicit Speak button
                       useSpeechSynthesis

VoiceCommandPanel → browser recognition → alias matcher
                                         ↓
                         symbol/action in the same store

Store ↔ localStorage
      ↔ useOfflineSync ↔ anonymous Firebase Auth
                       ↔ Firestore userStates/{uid}
                       ↔ Firestore persistent browser cache
```

Important qualifications:

- `/board` renders `CommunicationBoardSection`, **not** `components/aac/AACBoard.tsx`.
- The active generator is `utils/messageGeneration.ts`. `lib/messageBuilder.ts` is a separate unused implementation.
- The active command parser is `features/communication/voiceCommands.ts`. `lib/urduCommands.ts` is unused.
- `features/suggestions/index.ts` contains an interface, not recommendation behavior.
- The caregiver section also calls `useOfflineSync`, creating a second sync controller while the header remains mounted.
- Routing does not enforce caregiver authentication or private profile access.
- The various `features/*/index.ts` files are mostly types or re-exports; they do not form independent feature services.

The component structure is understandable. The architectural problem is **duplicated ownership and missing domain logic**, not the choice of React or Zustand.

## 3. Current user flow

### Opening the application

The start URL is `/`, a welcome page. The default active profile is “Child Profile.” Users can open the board without choosing a profile. The header hydrates the store from browser storage and conditionally starts Firebase synchronization.

### Tapping symbols

1. The board filters `initialPhrases` by the active category.
2. Tapping a symbol calls `selectSymbol`.
3. A previously unselected symbol is appended to `selectedSymbols`; tapping it again removes it.
4. Its usage counter increases on selection, **before any speech occurs**.
5. The store immediately rebuilds a single English/Urdu message.
6. The right-hand preview shows that message and removable symbol chips.

Selection is an ordered set-like toggle: the same symbol cannot be intentionally repeated as a second occurrence.

### Using the microphone

1. The user presses Start Listening.
2. The app creates a browser recognizer fixed to `ur-PK`.
3. It waits for a one-shot recognition result, requesting up to five alternatives.
4. An alias matcher picks one command using exact matching first, then substring matching.
5. A matched symbol command selects one built-in phrase; other supported actions remove, clear, or open Emergency.
6. The transcript is displayed in the diagnostic panel and logged to the console.
7. Unmatched speech does not become message input or sentence suggestions.

The recognized Speak command has no implemented action. Stop speech is not an active voice command.

### Getting suggestions

There is no suggestion stage on the active board. The user gets **one automatically constructed message**, not three alternatives. The caregiver page’s top-five frequency list is a separate retrospective display.

### Selecting and speaking

There is no final-sentence selection because there are no candidate sentences. Pressing Speak Message records a history entry and submits the current generated message to browser TTS. Auto mode speaks English, then schedules Urdu after English ends.

Pressing Stop Speaking calls the browser cancellation method. Pressing Speak again after completion repeats the current message, but there is no explicit Repeat action or separately retained last-spoken message.

### Emergency

The persistent header link opens a separate emergency screen. Selecting a predefined emergency card immediately attempts English-then-Urdu TTS and records history. Each card also has a redundant speech button. Emergency selection changes the same symbol selection used by the normal board.

## 4. What is already good

- **A real, buildable foundation:** the application compiles, lint has no errors, and the production build reproduces the archived build.
- **Appropriate core technology:** React, TypeScript, Vite, and a small Zustand store are sufficient for this FYP.
- **Useful bilingual content:** 28 built-in phrases across nine daily-life categories, including three emergency phrases.
- **Offline-friendly content:** the catalog and vector icons are part of the application bundle; selecting a symbol does not call an AI API.
- **Explicit speech activation on the normal board:** tapping ordinary symbols does not immediately speak them.
- **Useful manual controls:** clear, remove-last, individual removal, and a displayed message are present.
- **Several accessibility basics:** semantic buttons, pressed states, large symbol cards, Urdu language/direction attributes, and a live region for message updates.
- **TTS capability checks and voice loading:** the hook detects support, loads voices, handles voice-list changes, and retains utterances during playback.
- **Persistent emergency access:** the header link is available across routes.
- **Local persistence fallback:** missing Firebase configuration does not prevent using the local board.
- **A meaningful Firestore ownership rule:** reads and writes are restricted to the authenticated user’s document; other collections default to deny.
- **Bounded in-memory history:** the store retains the latest 50 entries rather than unlimited history.

Keep these as building blocks. Their existence should not be presented as proof of end-to-end reliability.

## 5. What is bad, broken, or weak

| Priority | Finding | Practical consequence |
|---|---|---|
| Critical for communication | Voice matching ignores negation and uses loose substrings | A request can be interpreted as its opposite |
| Critical for product goal | No intent model or three-sentence selection flow | The central promised capability is absent |
| High | Sentence mode concatenates independent messages | Contradictory or unrelated meanings can be spoken together |
| High | “Silence Alarm” executes another speech request | The emergency control does not match its label |
| High | Bilingual speech uses uncancelled delayed callbacks | Old Urdu output can start after the user moved on |
| High | Mobile board overflows substantially | Core communication is awkward on a phone |
| High | Profiles share history, counters, and preferences | Apparent personalization does not provide isolation |
| High | Duplicate sync controllers and unreliable timestamp/status handling | Changes can be overwritten, skipped, or described as synchronized incorrectly |
| Medium | Custom phrases are stored but excluded from the board | Data support does not produce a usable feature |
| Medium | Emotion setting has no consuming suggestion logic | The interface implies intelligence that is not implemented |
| Medium | Many accessibility settings exist only as fields | Users cannot obtain the advertised behavior |
| Medium | UI styling mixes utilities that the configured Tailwind build does not generate | Intended sizes, shadows, and focus rings are inconsistent |
| Medium | No application tests | Successful builds conceal behavioral failures |

Additional concrete weaknesses:

- The board displays “Used 0 times” from each static phrase’s `usageCount`, while actual counts live elsewhere. The displayed number does not track selection.
- “Spoken Messages” counts history entries created before TTS succeeds. It is not a count of successfully delivered speech, and it is capped by the 50-entry history.
- The caregiver view is openly navigable on the same device. Its title does not establish an access boundary.
- The default category contains only Yes, No, and Bathroom. Water and Help require category navigation or another route, despite being marked quick access.
- “Quick” and favorite metadata do not create an actual quick-access area on the active board.
- A hidden loading overlay remains in the DOM after being made transparent. Its loading text remained exposed in the inspected accessibility/DOM snapshots.
- Technical language, metadata, and animated status elements occupy attention needed for communication.

## 6. Sentence engine audit

**Primary evidence:** `app/src/utils/messageGeneration.ts`, especially `buildWordMessage` and `buildSentenceMessage`; `app/src/data/phrases.ts`; `app/src/store/communicationStore.ts`.

### Active algorithm

Word mode joins selected English labels with spaces and independently joins Urdu labels with spaces. It is literal concatenation.

Sentence mode processes every selected symbol separately:

1. Look for its phrase ID in a hard-coded map of 14 bilingual templates.
2. Otherwise use that symbol’s stored `sentenceEnglish` / `sentenceUrdu`.
3. Trim the fallback text and append punctuation if necessary.
4. Join all resulting sentences with spaces.

There is no grammar engine, subject/object composition, intent consolidation, contradiction handling, negation handling, confidence estimate, maximum message length, or three-choice generation.

### Reproduced output

| Input | Actual output |
|---|---|
| Water, sentence mode | “I need water.” |
| No + Water, sentence mode | “No. I need water.” |
| Happy + Sad, sentence mode | “I feel happy. I feel sad.” |
| Water + Pain, word mode | “Water Pain” |
| Help, normal board sentence mode | “I need help.” |

The same Help phrase on the emergency route uses its catalog sentence, “I need help now.” The normal-board override removes the urgency. Other overrides also change the catalog wording: for example, “my medicine” becomes “medicine.”

A single known symbol can produce a useful complete message. Multiple symbols do not produce a understood combined meaning. Some combinations are legitimate separate statements, but the engine cannot distinguish those from contradictions or accidental selections.

Your exact “Headache Stomach pain Hot Cold Sick Pain” sequence cannot be reproduced from this catalog because most of those symbols are absent. **Headache itself is absent.** However, literal word concatenation exists, and sentence-mode contradiction is demonstrable with existing symbols.

### Fallback and custom phrases

Fallback punctuation is not grammatical validation. An incomplete custom sentence such as a list of words would merely acquire a period. Urdu fallback text without punctuation would receive an English full stop. Terminal Urdu question punctuation is not included in the punctuation test.

The store supports adding/deleting custom phrases, and persistence carries them, but the board filters only `initialPhrases`. No active custom-phrase editor or merged catalog is present. Therefore custom phrase handling is **data plumbing without a complete user flow**.

### English/Urdu parity

Every built-in phrase contains English and Urdu labels and sentences. This is a sound starting point. However:

- Separate override templates create two competing content sources.
- Several Urdu sentences use masculine forms such as “چاہتا ہوں” or “کر رہا ہوں” for all users.
- Profiles have no voice/wording agreement preference.
- UI actions and explanatory text are predominantly English.
- There is no semantic review process or documented bilingual evaluation set.

### The unused second builder

`app/src/lib/messageBuilder.ts` has a different ID vocabulary (`water`, `pain`, etc.), priority-based `if/else` rules, and a word-concatenation fallback. It can silently omit selected concepts when higher-priority branches match. It is **not called by the active board**, so it neither fixes nor explains current board behavior.

**Decision:** Rebuild the active engine around a small verified bilingual intent catalog. Retire the second builder after its useful phrase content has been reviewed. Do not attempt to turn arbitrary joining into reliable communication through punctuation fixes.

## 7. Smart suggestion audit

**There is no active smart-suggestion engine.**

`app/src/features/suggestions/index.ts` defines `PhraseSuggestion`, containing a phrase and a reason. The type system lists reasons such as favorite, high usage, same category, emergency context, and caregiver recommended. None of that constitutes scoring or ranking implementation.

Current behavior is:

| Potential output | Exists today? |
|---|---|
| Next-word suggestions | No active implementation found |
| Recommended symbols on the board | No |
| Three alternative complete sentences | No |
| One message assembled from selected symbols | Yes |
| Top-five historical phrase display | Yes, on the caregiver page |

The caregiver ranking sorts `phraseUsageCounts` descending and takes five entries. It has no recency decay, intent context, language handling, confidence, or candidate validation. Counts record symbol selections, not successful communication. Ties have no explicit product-level ranking policy.

That display may describe past interactions, but it does not help turn current input into the intended three sentences. There is also no active “For You” dashboard or recommendation-score rail to remove from this version.

**Decision:** Build a small deterministic candidate selector for the current intent. Do not add a recommendation framework, embedding database, or scoring dashboard.

## 8. Microphone / voice audit

**Primary evidence:** `app/src/features/communication/voiceCommands.ts` and `app/src/components/aac/VoiceCommandPanel.tsx`.

| Requirement | Current implementation |
|---|---|
| Explicit microphone button | Yes: Start Listening and Stop Listening |
| Continuous recognition | No: `continuous = false` |
| Interim transcript | No: `interimResults = false` |
| Recognition language | Always `ur-PK` |
| English recognition mode | No language switch to an English locale |
| Urdu recognition | Requested through the browser; physical support not verified |
| Roman Urdu | A few textual command aliases; not general Roman Urdu understanding |
| Dictation | No |
| Final transcript display | Yes, as “Recognized text” |
| Transcript drives live candidates | No |
| Unmatched natural speech retained as input | No; displayed but not used for communication |
| Confidence threshold | No |
| Error states | Permission, no speech, audio capture, network, unsupported language, abort, and generic errors |
| Raw transcript persistence | No direct local/cloud transcript field found |
| Transcript logging | Yes, including recognition alternatives and normalized alternatives |

### Matching defects

Exact matching across alternatives is attempted first. Partial matching then accepts either `transcript.includes(alias)` **or** `alias.includes(transcript)`. The matcher iterates commands before transcripts, so command order can outweigh the recognizer’s best alternative. It does not use confidence values or token boundaries.

Direct probes of the real parser produced:

| Transcript | Result |
|---|---|
| “I do not want water” | Water |
| “I am not in pain” | Pain |
| “I feel lonely” | No match; no communication input |
| “unknown” | No, because the substring `no` occurs inside the word |
| “h” | Help, because the alias contains the transcript |
| “emergency help” | Help rather than the emergency-navigation action |
| “speak” | Recognized Speak placeholder; no speech action |
| “stop” | No match |
| “mera sar dard kar raha hai” | Generic Pain; headache specificity lost |

This is more serious than limited vocabulary. The system can lose negation and specificity while appearing to understand the user.

“English commands supported” in the label means the alias table contains English text. It does not prove that English speech is reliably recognized while the recognizer is configured for Urdu. The unsupported-language hint suggests trying Roman Urdu/English without changing that recognizer configuration.

There is cleanup on component unmount, which is useful. However, a Start request is not given a separate “starting” state, creating a window for repeated starts before `onstart`. Error displays are technical and English-only; “recognized” is used even when no supported command matched.

Browser speech recognition has limited availability and can use a remote recognition service. It cannot be described as guaranteed offline or fully local from this implementation. This is confirmed by the [MDN SpeechRecognition documentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

**Decision:** Keep capability detection and useful error categories. Replace command-first interpretation with dictation-first input, preserve the transcript, and reserve whole-utterance exact commands for explicitly defined controls. Do not add always-on listening.

## 9. TTS audit

**Primary evidence:** `app/src/hooks/useSpeechSynthesis.ts`, plus the board, emergency, and settings callers.

### What exists

- Browser Speech Synthesis, with English and Urdu requests.
- Voice discovery and a polling fallback while voices are initially unavailable.
- Rate, pitch, and volume values passed to utterances.
- A visible Stop button on the normal board while `isSpeaking` is true.
- English-first, then Urdu behavior in Auto mode.
- A settings test that attempts both languages.
- Re-speaking the current message by pressing Speak again.

### Weaknesses

1. **Unsafe Urdu voice substitution.** If no Urdu voice exists, the hook chooses Hindi, then Arabic, then English/default. It assigns that selected voice’s language to the utterance. This can cause Urdu text to be treated as another language. There is no user-facing warning or explicit choice to accept that substitution.
2. **Stop does not own the entire bilingual sequence.** The board schedules Urdu with a 350ms timer; Emergency uses a 200ms timer. These timers are not canceled on Stop, Clear, route changes, or a new speech request. Old output can reappear after a newer action.
3. **The apparent async method does not await playback.** `speak` submits speech and returns; `await speak(...)` is not a playback-completion guarantee. Sequencing depends on callback behavior instead.
4. **Global browser state has multiple local owners.** Each hook instance assigns the global `onvoiceschanged` property and cancels global synthesis on cleanup. The design is fragile if multiple instances are mounted together or delayed callbacks survive route changes.
5. **Failures are mostly console-only.** Current UI callers do not surface meaningful TTS errors. A thrown `speak` exception is logged without invoking the provided `onError` callback.
6. **History is recorded before delivery.** Interrupted or failed speech can appear as spoken history.
7. **Language labels are misleading.** “English First” currently means English only; “Urdu First” means Urdu only. Only Auto speaks both.
8. **No explicit Repeat state.** Repeating after edits/clear cannot reliably retrieve the last selected spoken sentence.
9. **No complete missing-voice policy.** Support for the browser API does not mean an Urdu voice, a local voice, or intelligible pronunciation is available.

The hook returns voice information, but Settings does not use it to show Urdu availability. A safe fallback is to keep the Urdu message visible and explain that Urdu speech is unavailable, with an explicit English alternative if useful. Do not silently claim Hindi or Arabic output is Urdu support.

**Decision:** Keep the browser TTS adapter but give one controller ownership of speech, sequence cancellation, repeat state, and error/status reporting. Physically verify English and Urdu on the actual demonstration devices.

## 10. AI / API audit

No Gemini, OpenAI, or other language-model API call was found in the application. No AI SDK, model prompt, server-side text-generation endpoint, candidate validator, or request/response lifecycle exists.

The unused gesture module imports MediaPipe, which is actual model-based hand landmark technology. However, it is not connected to the active communication screen and is not a sentence-generation system.

The emotion preference is merely stored. Its label claims it informs “AI phrase suggestions,” but no consumer implements that behavior. The project should describe its present text behavior as **preset phrase generation**, not learned understanding.

### Keys and boundaries

- The archive contains `.env.example`, with placeholder Firebase values; no populated `.env` was found.
- Pattern checks found no Google API key, OpenAI-style secret, private-key block, or assigned token-secret value in the inspected application files/build/logs. This is evidence from a bounded scan, not an absolute guarantee about external configuration.
- `VITE_*` values are client-visible. They must never hold a Gemini or other private AI-service key.
- Firebase’s web configuration is intentionally public configuration; its presence in React is not itself a secret leak. Authorization still depends on rules and project configuration. See [Firebase’s API-key guidance](https://firebase.google.com/docs/projects/api-keys).

### Is online AI necessary?

**No, not for core AAC or the stated daily-communication examples.** A reviewed intent catalog can provide three useful bilingual alternatives for Water, Headache, help, bathroom, discomfort, and other supported daily needs without a model.

If your FYP evaluation requires an AI contribution, an optional, evaluated sentence-enhancement layer is reasonable after the local path works. Do not use an API call merely to justify the project title.

### Best integration point

Place an optional enhancement adapter **after normalized input/local intent resolution and before candidate presentation**. Use one small server endpoint. It should receive only the necessary current input and allowed intent constraints, not the entire communication history or profile.

Require exactly three bounded bilingual candidates, validate structure and language presence, reject duplicates and changed intent, and retain local results on timeout or failure. Structural JSON validation alone does not prove semantic safety. For the safest FYP scope, constrain outputs to reviewed intents and facts; unsupported ambiguity should require clarification rather than invented meaning.

Keep the key only on the server, restrict endpoint usage, limit request size/rate, apply a timeout, prevent stale responses replacing newer input, and never speak model output automatically. Google explicitly advises against exposing Gemini keys in production client apps: [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key).

## 11. Offline / PWA audit

**Primary evidence:** `app/public/sw.js`, `app/public/manifest.json`, `app/index.html`, `app/firebase.json`, `app/src/hooks/usePWAInstall.ts`.

### Good foundation

The manifest has names, start URL, standalone display, theme/background colors, and a set of icons. The app includes install-prompt handling and an iOS hint. Firebase Hosting has an SPA rewrite. The service worker uses navigation network-first with cached-index fallback and runtime caching for other requests.

### Reliability gaps

- **Critical JavaScript/CSS chunks are not precached.** Only `/`, `/index.html`, the manifest, and two icons are listed. The first page loads its chunks before a newly registered worker necessarily controls it. Opening once online therefore does not guarantee the full application can subsequently reload offline.
- **README overstates precaching.** It says the full icon set is in the cached shell; the worker explicitly lists only the 192px and 512px icons.
- **Install errors are swallowed.** A failed precache is caught and logged rather than propagated, allowing an incomplete worker installation to appear successful.
- **Cache version is fixed.** `communicare-shell-v1` is not tied to build content. Immediate activation plus independently cached HTML/assets lacks an explicit coherent-update strategy.
- **Caching is too broad.** Except for several Firebase hosts, the worker handles all GET requests, not just a controlled same-origin asset list. A future GET API response could accidentally be cached.
- **Cache cleanup is too broad.** Activation deletes all cache names except its own. On a shared origin, that could remove unrelated application caches.
- **Background cache writes lack lifecycle protection.** Runtime `cache.put` operations are launched without consistently attaching them to `event.waitUntil`; offline behavior should not depend on those writes completing by chance.
- **Network-first navigation has no bounded timeout.** A slow network can delay fallback.
- **Paths are inconsistent.** Vite uses a relative base and the HTML uses relative manifest/service-worker paths, while the manifest and worker assume origin-root paths. Root routes are straightforward, but trailing-slash/deeper/subdirectory access needs verification.
- **Localhost registration is disabled.** A normal `localhost` development check does not exercise the PWA. The string check treats `127.0.0.1` differently.
- **Fonts are remote.** Google Fonts adds a network dependency. Runtime caching may help after controlled loads, but guaranteed offline Urdu typography is not established.

The preset board’s message logic can operate without internet **once the application code and necessary assets are available**. Browser recognition and voice availability are separate dependencies; PWA installation cannot make them offline automatically.

The service worker is not the same as Firestore’s persistent cache. Excluding Firebase HTTP requests from shell caching does not mean Firestore data is absent from browser storage.

**Decision:** Keep PWA support, but verify and simplify its cache contract around the actual built shell, offline routes, essential symbols/fonts, and safe updates. Do not advertise “works offline after one visit” until that exact cold-start scenario passes.

## 12. Data / Firebase / persistence audit

### What is stored

| Data | Location and behavior |
|---|---|
| Profiles and active profile ID | One shared localStorage state; conditionally the same Firestore document |
| Voice preferences and emotion-related fields | Same shared state |
| Language field | Serialized from profile; not a functioning UI-language system |
| Phrase usage counts | Shared map, incremented on symbol selection |
| Communication history | Latest 50 English/Urdu message entries with mode and timestamp |
| Custom phrases | Stored even though the active board does not expose them |
| Current selected symbols/generated message | Runtime Zustand state; excluded from serialized state |
| Raw recognition transcript and alternatives | Component memory and browser console, not the stored-state schema |
| Raw audio/video/frames | No application recording/storage flow found |
| Cloud copy | `userStates/{anonymous uid}` when Firebase is configured |
| Firestore offline copy | SDK persistent local cache, separate from localStorage |

The localStorage key is `ai-communication-system-v2`, with fallback reading from `ai-communication-system`. The stored schema says version 2, but there is no substantive versioned migration or runtime schema validation.

### Profile isolation

Profiles are three selectable placeholders. They do not isolate history, counts, custom phrases, or settings. History items do not contain profile IDs. Profile selection mostly changes display identity and communication mode; it does not calibrate motor access, sentence complexity, or vocabulary.

There is no cross-device caregiver identity/linking workflow. Anonymous authentication on another browser normally gives another identity, so comments suggesting automatic caregiver-device sharing are not implemented by this design.

### Sync behavior and defects

`useOfflineSync` hydrates from localStorage, compares a cloud `updatedAt` against local time, writes the apparently newer state, subscribes to remote updates, saves local changes, and debounces cloud pushes by 1.2 seconds.

The important problems are:

1. **Two controllers on the caregiver route.** Header and caregiver each hydrate, subscribe, reconcile, and schedule writes independently.
2. **First subscribed update can be skipped.** `isInitialMount` discards the first store event seen after subscribing. In production/local-only startup, that can be the first actual user change rather than hydration. Development StrictMode can produce different timing and conceal the issue.
3. **Mode is persisted incorrectly.** `setCommunicationMode` changes top-level mode, but serialized state uses `preferences.messageMode`. They are not kept in sync.
4. **Profile changes leave a stale generated message.** A direct probe switched to the Teen profile and observed top-level `word` mode, a generated message still marked `sentence`, and stored preference still `sentence`.
5. **Remote timestamps are rewritten.** `saveStoredState` always replaces `updatedAt` with the current local time, even when applying a remote state. This weakens the intended conflict comparison.
6. **Whole-state last-writer-wins synchronization.** Arrays/maps are not merged per profile or per change. Concurrent edits can overwrite each other; device clocks influence the winner.
7. **Failure can be labeled Synced.** Initial reconciliation calls `saveCloudState` without checking its boolean result, then sets Synced. Read failures also collapse into null, which looks like missing data.
8. **Pending snapshots can become stale.** A debounced write captures an earlier full state and is not consistently canceled when remote state is applied.
9. **Storage failures are ignored by callers.** The helper reports a write failure, but the UI can still imply local safety.
10. **Validation is partial.** Malformed values are shallowly merged and then trusted. TypeScript interfaces do not validate localStorage or Firestore at runtime.
11. **`setProfiles` is outside the relevant-change predicate.** A future profile-edit flow relying on it could fail to persist as expected.

Reset Local Preferences writes the entire default stored state. It therefore resets more than preferences, while not actually clearing all storage layers or runtime selection. If cloud sync is active, the reset can also be propagated. The success wording about “all cached states” is inaccurate.

**Decision:** Use one local persistence owner with validation. Either implement real profile scoping or use one honest user profile. Keep cloud backup optional and disabled by default until its failure and recovery behavior is demonstrated.

## 13. UI/UX audit

The current board has a large two-row header, horizontally scrolling categories, a category banner, large symbol cards, and one permanent right-hand column containing message construction, mode controls, speech/reset controls, and a large microphone diagnostics panel.

It is not a screen with multiple active sidebars, camera panels, and recommendation scoring rails. The caregiver dashboard is a separate route. The problem is still excessive administrative/technical emphasis and poor priority of the communication output.

### Keep on the main screen

- A compact identity/language header and persistent SOS.
- One large current message.
- Speak, Stop, Repeat, and a simple Clear/undo action.
- Explicit microphone control and plain live/final transcript.
- Three complete sentence choices.
- Stable category navigation and large symbols.

### Remove from the main screen

- Pro/Clinical-Grade branding claims.
- Local Storage, synchronization, and network badges unless a failure needs action.
- Symbol usage counts, Quick badges without quick access, and repeated category metadata.
- “Active Construction,” “Synthesize,” and other technical labels.
- The word/sentence mode choice in the primary flow.
- Detailed recognition alternatives, constructor names, match type, and error diagnostics.
- A mandatory welcome detour during ordinary use.

### Move into Settings, where genuinely useful

- Install instructions.
- Voice/rate choice and availability checks.
- History retention, clear-data controls, and optional backup.
- Technical diagnostics and optional AI configuration.
- Camera/emotion options only if retained as a separate experiment; presently they should be hidden or removed because they do not support the live communication flow.

### Actual visual findings

Desktop spacing and text hierarchy are reasonably polished. However, large empty regions appear beside a small category vocabulary while the right column stacks several panels. The most important output is not the central focus.

At 390px width, the board’s category region expanded its grid track to approximately 1,435px, creating roughly 1,451px of document width. Both the left content and message aside inherited the wide track. This is a genuine responsive defect, not merely a preference for a different layout. The message followed the symbol section and began below the initial screen in the tested state.

The icons are small vector interface symbols rather than a validated AAC pictogram collection. Some mappings are weak: Goodbye uses a badge/check-like icon; Mother and Father use nearly identical person/check variants; Breathing maps a “Lungs” name to a wind icon. Familiarity must be tested with users rather than inferred from icon names.

Typography has useful Urdu line spacing, but pervasive heavy weight, uppercase micro-labels, and metadata compete with symbols. Bilingual presentation is useful; forcing every technical label onto the main screen is not.

## 14. Accessibility audit

### Strengths

- Native buttons and links provide basic keyboard activation.
- Symbols and categories expose pressed state.
- Symbol cards are large; several principal actions explicitly use 48–64px minimum heights.
- Urdu text frequently has `lang="ur"` and `dir="rtl"`.
- Message changes have a polite live region; emergency status has an assertive live region.
- Backspace, Escape, and Ctrl+Space shortcuts exist on the board.
- A global focus style exists, and zoom is not disabled.

### Gaps

| Area | Finding |
|---|---|
| Mobile access | Confirmed major horizontal overflow on the board |
| Small targets | Measured 16 × 16px individual-removal buttons, 26px-high sync button, and 32px-high settings language buttons |
| Range inputs | Speed/pitch inputs measured 8px element height and had no associated label or accessible name; actual thumb hit area also needs device testing |
| Grid semantics | `role="grid"` contains buttons directly, without row/gridcell structure or grid keyboard behavior |
| Radio semantics | Word/Sentence buttons use radio roles without radio-group arrow-key/roving-focus behavior |
| Focus | Some controls combine `outline-none` with `focus-visible:ring-3`, a utility absent from the compiled CSS |
| Dynamic focus | No intentional focus placement after route navigation or message-item removal |
| Live transcript | No interim results and no dedicated live transcript announcement |
| Urdu interface | Text blocks are RTL, but there is no full Urdu UI mode or mirrored application layout |
| Language metadata | Mixed English/Urdu live-region text is not split into language-marked spans |
| Reduced motion | No active `prefers-reduced-motion` rule was present in compiled CSS; bouncing/pinging/pulsing elements remain |
| High contrast | Preference field exists but has no active consumer or settings control |
| Hidden loading text | Transparency/pointer-event hiding does not remove the old loading text from accessibility exposure |
| Emergency semantics | Reused symbol card announces Select/Remove despite its action being immediate speech |

White text on some bright category backgrounds, very small muted text, and disabled-state styling need a measured contrast review. No full WCAG conformance claim is justified by this audit. The more immediate confirmed barriers are mobile overflow, undersized secondary actions, labels, semantics, focus, and motion.

**Decision:** Fix the demonstrated barriers before adding specialized access methods. Basic keyboard support, readable bilingual text, stable placement, and sufficiently large targets are the appropriate FYP baseline.

## 15. Test quality

**Existing automated application tests: zero found.**

There is no test script, test runner configuration, component suite, browser suite, rules-emulator test suite, or recorded accessibility/phrase-evaluation suite in the supplied project. Third-party dependency tests do not count as your tests. The Settings Test Speech Output button is a manual demo action, not an automated assertion.

### What passing checks demonstrate

- TypeScript: declared code relationships type-check under the configured compiler.
- ESLint: no enabled lint errors; eight warnings remain.
- Build: the production bundle can be generated.
- Byte match: the archived build is consistent with the current source and supplied dependencies.

None proves that meanings are preserved, Urdu is spoken correctly, Stop works through all timing windows, or offline cold-start works.

### Audit probes are not an existing test suite

Read-only execution of the real generator/parser/store established concrete examples in this report. Browser inspection confirmed message behavior and layout. These checks do not create repository tests or provide a coverage percentage.

### Highest-value missing tests

1. A reviewed bilingual intent corpus: positives, negation, ambiguity, mixed input, repeated selection, contradictions, and unknown phrases.
2. Three-candidate invariants: correct count for supported intents, complete language pairs, distinct choices, no added facts, and no automatic speech.
3. Recognition lifecycle: interim/final results, permission denial, empty speech, exact commands, stale sessions, and unmount cleanup.
4. TTS cancellation: stop during English, stop between languages, new message during delay, route change, missing Urdu voice, and Repeat.
5. Persistence: first change, reload, profile boundaries, invalid data, unavailable storage, and reset semantics.
6. Production PWA cold-start and update scenarios.
7. Firebase rule ownership/schema tests only if cloud backup remains.
8. Keyboard, mobile overflow, labels, focus, contrast, and Urdu rendering checks.

Do not aim for a coverage percentage by testing trivial JSX or generated UI wrappers. Prioritize the points where the user’s intended message can be lost or changed.

## 16. Security / privacy audit

### Confirmed concerns

- **Unnecessary content retention:** ordinary and emergency message content is logged into a persistent history by default, with no opt-in retention control.
- **Transcript console exposure:** raw recognition alternatives are logged. On shared/debugged devices this exposes personal communication unnecessarily.
- **Automatic cloud transfer when configured:** the full stored state, including communication history and custom phrases, can be uploaded without a separate in-product cloud opt-in.
- **Shared-device access:** anyone using the browser can navigate to Caregiver and read the shared history. Profiles do not separate it.
- **Persistent Firestore cache:** resetting local preferences does not clear this separate cache or anonymous authentication state.
- **Shallow data validation:** local/cloud values are trusted after limited checks; malformed stored data can disrupt the application.
- **Overbroad future cache boundary:** the worker’s all-GET runtime policy would be unsafe for future sensitive endpoints unless explicitly changed.

### Firebase rules

The supplied rules correctly require authenticated UID ownership and default-deny other paths. They also bound the list sizes of history, custom phrases, and profiles, and reject timestamps more than one hour in the future.

They do not validate every nested field, language text length, permitted preference values, count-map size, or an allowlist of top-level fields. They allow arbitrary extra fields. There is no supplied rule test suite. Deployment and project-side restrictions were not verified.

This is **not evidence of an openly readable database**. It is an incomplete but useful ownership boundary whose real deployment remains unknown.

### Audio, camera, and HTML

- No application audio recorder or audio persistence flow was found.
- No active camera capture or frame storage flow was found.
- Browser speech recognition may still transmit audio to the browser provider; “we do not store audio” is not equivalent to “audio never leaves the device.” See [MDN’s recognition limitations](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).
- Message text is rendered through React text expressions, not raw HTML.
- `components/ui/chart.tsx` uses `dangerouslySetInnerHTML` for chart CSS. It is not imported by the live application, and no communication-text-to-HTML path was found. This should not be misreported as an active transcript XSS vulnerability.
- The unused sidebar helper writes an open/closed cookie; it is not an active communication-data leak.

### Other boundaries

Google Fonts is an active third-party asset dependency. The unused gesture module references external model/WASM hosts, but those are not part of the current active camera flow. There is no custom application API endpoint to assess for authentication or injection today.

The included Firebase debug log records an initialization/CLI failure and local environment paths. It is not proof of successful deployment and does not belong in the final handover package. No credential value was found in the inspected log scan.

**Decision:** Default to ephemeral transcripts and no message history. Retain only useful preferences/custom phrases locally. Make any retention or cloud backup explicit, bounded, profile-scoped, and accurately erasable.

## 17. Dependency / code quality audit

### Dependencies

There are 53 generic UI component files. Import tracing from the application entry found only **Button and Badge** used by the live sections. The other 51 do not represent active features.

Candidates for removal after dependency/import review include unused Radix primitives, form libraries/resolvers, charts, carousel, calendar/date helpers, OTP, drawers, resizable panels, command-menu support, and unused theme/toast infrastructure. MediaPipe camera utilities and face detection have no active imports; the tasks-vision integration is only in the unreachable gesture prototype.

Do not remove packages merely because they look unfamiliar. Remove them alongside their unused local wrappers, then verify the remaining import graph and build.

Firebase’s browser bundle is approximately **403.75kB uncompressed / 123.93kB gzip**. It is imported through the active sync path even when Firebase is not configured. The full emitted JavaScript is approximately **795kB uncompressed / 241kB gzip**, plus **112.88kB CSS / 18.32kB gzip**. These are build-output sizes, not measured network-transfer totals including fonts.

### Version/configuration observations

- The lockfile/supplied dependencies resolve Vite **7.3.2**, React **19.2.5**, Firebase **12.12.0**, TypeScript **5.9.3**, Tailwind **3.4.19**, and tailwind-merge **3.5.0**.
- Documentation naming Vite 7.2.4 does not describe the resolved build exactly.
- No evidence justifies replacing this stack as “outdated architecture.” The priority is internal consistency, not a framework upgrade.
- No dependency vulnerability-advisory scan was performed; this report does not claim the dependency tree is vulnerability-free.
- `kimi-plugin-inspect-react` is a development inspection plugin enabled in the build configuration. It has no necessary role in AAC communication; retain only if deliberately needed for development and review its production inclusion.
- Raising the chunk warning threshold to 1000 does not reduce bundle weight.
- `components.json` points its Tailwind config setting at `postcss.config.js`, which is inconsistent with the actual `tailwind.config.js` and may mislead future component-generation tooling.

### Styling

The source does **not** contain a huge application CSS file: `index.css` is 169 lines; the unused Vite starter `App.css` is 43 lines. The maintenance issue is large repeated Tailwind class strings, unused UI scaffolding, and duplicated category colors/tokens.

The compiled CSS does not contain utilities referenced by active source, including `h-13`, `h-4.5`, `focus-visible:ring-3`, `ring-3`, `shadow-xs`, and `shadow-2xs`. These are not configured custom utilities in this Tailwind 3 setup. Some have other visual fallbacks, but their intended effect is absent. This directly matters for size/focus assumptions.

### Dead or redundant code

- `components/aac/AACBoard.tsx`: unreachable older board with a nonfunctional Speak Placeholder button.
- `lib/messageBuilder.ts`: unused competing builder and ID scheme.
- `lib/urduCommands.ts`: unused competing command parser.
- `lib/gestureDetection.ts`: unused hand prototype with external models.
- `features/suggestions/index.ts`: unused suggestion interface.
- `App.css`: unimported starter styles.
- Numerous unused UI primitives, thin feature re-exports, and unused preference fields.

The gesture prototype’s reported confidence values are fixed constants assigned after geometry checks, not calibrated confidence in the communication meaning. It should not be presented as validated sign-language translation or emotion understanding.

## 18. Final product gap

| Target stage | Current state | Missing work |
|---|---|---|
| Voice or symbols | Symbols exist; voice is limited commands | Language-aware dictation, interim/final text, shared input representation |
| Intent understanding | Phrase lookup and substring command matching | Verified intent normalization, negation, specificity, ambiguity and conflict handling |
| Three complete bilingual sentences | Absent | Candidate catalog/engine, bilingual review, validation and stable display |
| User selects one | Absent as a candidate stage | Explicit selected-candidate state and invalidation when input changes |
| Large screen message | Bilingual preview exists in a side column | Central, responsive selected-message display |
| TTS | Browser integration exists | Reliable Stop/Repeat, missing-Urdu behavior, accurate language semantics, physical verification |
| Offline core | Local logic exists; shell caching incomplete | Guaranteed shell/asset availability after a verified preparation flow |
| Optional online improvement | Absent | Small server adapter only if justified after local reliability |

The system is closer on **display, symbols, routing, and basic speech wiring** than on intelligence. Adding three buttons to the present generator would not close the gap: three copies or variations of an incorrectly inferred intent would still be wrong.

For unsupported or ambiguous input, the system must preserve the input and ask for clarification. Do not force three confident sentences when there is insufficient evidence to know what the user means.

## 19. Keep / remove / rebuild matrix

“Rebuild” below means replace the feature’s behavior within this application, not start a new repository.

| Component / feature | Current status | Keep | Modify | Remove | Rebuild | Reason |
|---|---|:---:|:---:|:---:|:---:|---|
| React/TypeScript/Vite foundation | Buildable | ✓ | — | — | — | Suitable for the target scope |
| Router and page structure | Functional | ✓ | ✓ | — | — | Make communication the normal entry flow |
| Zustand approach | Appropriate, inconsistent state model | ✓ | — | — | ✓ | One clear input/candidate/selection model |
| Phrase catalog | 28 bilingual phrases | ✓ | ✓ | — | — | Expand daily intents and review Urdu/content |
| Symbol cards | Large but cluttered/abstract icons | ✓ | ✓ | — | — | Improve recognition and remove metadata |
| Categories | Useful but overflowing | ✓ | ✓ | — | — | Stable, accessible mobile navigation |
| Main board layout | Two-column prototype | ✓ | ✓ | — | — | Center communication and fix overflow |
| Active message generator | Independent concatenation | — | — | — | ✓ | Does not understand combined intent |
| Three-sentence suggestions | Missing | — | — | — | ✓ | Core requirement |
| Voice capability/errors | Partial reusable support | ✓ | ✓ | — | — | Useful adapter groundwork |
| Voice interpretation | Commands and unsafe substrings | — | — | — | ✓ | Must preserve actual communication |
| TTS hook | Functional wiring, timing/fallback risks | ✓ | ✓ | — | — | Preserve browser support, repair ownership |
| Emergency phrases | Three useful predefined messages | ✓ | ✓ | — | — | Repair stop/display/selection behavior |
| Distress-beacon presentation | Misleading toggle | — | — | ✓ | — | No real separate alarm lifecycle |
| Profile placeholders | Shared state, little adaptation | — | ✓ | — | — | Use one profile or implement honest scoping |
| Custom phrases | Stored but not usable | ✓ | ✓ | — | — | Small reviewed editor and catalog integration, if retained |
| Caregiver analytics dashboard | Selection counts/history | — | — | ✓ | — | Not needed for the main FYP goal |
| Persistent message history | Automatic/shared | — | ✓ | — | — | Disable by default; retain only if justified |
| Local persistence | Useful but shallow/fragile | ✓ | — | — | ✓ | Simplify and validate |
| Firebase backup | Optional, flawed synchronization | — | ✓ | — | — | Defer; retain only with a real backup requirement |
| PWA/install support | Incomplete offline guarantee | ✓ | ✓ | — | — | Essential practical reliability improvement |
| Emotion-prior controls | No functional effect | — | — | ✓ | — | Misleading complexity |
| Gesture/camera prototype | Unreachable experiment | — | — | ✓ | — | Out of minimum communication scope |
| Word-mode switch | Literal concatenation | — | — | ✓ | — | Conflicts with the specified main output |
| Legacy board/builders/parser | Unreachable duplicates | — | — | ✓ | — | Prevent editing the wrong implementation |
| Unused UI components/packages | Large scaffold | — | — | ✓ | — | Reduce maintenance and styling surface |
| Gemini endpoint | Missing | — | — | — | Optional | Only after local pipeline passes evaluation |

## 20. Final recommended architecture

Use the existing single React application, a small local domain layer, browser adapters, and at most one optional server endpoint.

```text
AAC symbols ──────────────┐
                         ├─→ Normalized input
Mic → live/final text ────┘       ↓
                         Local intent resolver
                         • supported intent
                         • explicit details/negation
                         • uncertainty/conflict
                                ↓
                         Reviewed bilingual catalog
                                ↓
                         Three complete candidates
                                ↑
                  Optional server enhancement
                    → validation → local fallback
                                ↓
                         User selects one
                                ↓
                         Selected message display
                                ↓
                         One speech controller
                         Speak / Stop / Repeat

SOS → reviewed emergency messages → display + explicit selection/speech
       independent of AI and cloud

Persistence → preferences and optional custom phrases only by default
```

### Keep responsibilities small

1. **Catalog:** stable intent IDs, symbols, daily categories, aliases, and three reviewed English/Urdu alternatives for each supported intent. Prefer neutral Urdu forms where possible.
2. **Resolver:** map symbols and text to supported intents without losing negation or adding facts. Handle a small defined set of combinations; do not promise unrestricted language understanding.
3. **Candidate service:** provide the local result immediately, validate optional online results, and reject outdated responses.
4. **Store:** raw/interim/final input, selected symbol IDs, resolved intent, candidate list, selected candidate ID, language, and small capability/status state. Derive display text rather than maintaining conflicting copies.
5. **Speech controller:** own the full utterance sequence and every pending callback; Cancel invalidates the whole session.
6. **Persistence:** one initialization/subscription point, explicit schema, small data scope, clear reset behavior. Keep Firebase out of the communication dependency chain.

Changing input should invalidate or clearly mark a previously selected candidate. A late network response must not silently change the message the user already selected.

Use three equivalent complete alternatives for a supported clear intent. For ambiguity, offer a simple clarification or let the user correct the transcript. User selection is not a substitute for preserving intent upstream.

Do not introduce microservices, vector databases, agent frameworks, model training, cloud event pipelines, or recommendation analytics for this scope.

## 21. Minimum final feature set

### MUST HAVE

- Large symbol board with a small useful daily vocabulary, including Water, bathroom, help, pain location/headache, comfort, Yes/No, and stopping/refusal.
- Verified local bilingual intent-to-sentence behavior.
- Three concise complete alternatives for supported intents.
- Explicit candidate selection before normal speech.
- Large selected-message display.
- Speak, Stop, Repeat, and Clear/undo.
- English/Urdu speech-input mode selection, interim/final transcript, and preservation of normal speech in supported browsers.
- Useful AAC operation when microphone support or internet is unavailable.
- Honest Urdu TTS availability and fallback behavior.
- Persistent predefined offline SOS messages.
- Mobile layout without page overflow, keyboard access, usable focus, large targets, reduced motion, and readable Urdu.
- Minimal validated local settings and no transcript/history collection by default.
- Tests and a documented bilingual/device evaluation.

### SHOULD HAVE

- A small editable transcript field for correction when recognition is wrong.
- A few practical Roman Urdu aliases for the same supported intents.
- A simple caregiver-managed custom phrase editor with both languages required.
- Verified installability/offline shell behavior and locally available essential fonts.
- General, Communication, Accessibility, and Advanced settings sections.
- A small language/content review record and task-completion evaluation with appropriate users/caregivers.

### OPTIONAL

- Gemini enhancement behind a protected server endpoint, with local fallback.
- Multiple truly isolated profiles if there is a real shared-device need.
- Explicitly enabled encrypted-in-transit cloud backup with recovery/deletion behavior verified.
- Opt-in bounded communication history if users actually need it.

### REMOVE

- Permanent analytics and cloud-status controls on the communication screen.
- Word concatenation as the main “intelligent” output.
- Emotion-prior controls without a demonstrated use.
- Camera/gesture work from the core delivery scope.
- Fake confidence, unsupported clinical claims, and profile-calibration claims.
- Redundant emergency actions, legacy boards/builders/parsers, and unused UI scaffolding.

## 22. Implementation roadmap — five major steps

This is a scope plan only. It contains no implementation code or implementation prompts. Paths marked **new** are proposed module boundaries, not existing files.

### Step 1 — Establish the correct local communication model

**Objective:** Replace concatenation with verified intent handling and three bilingual complete candidates.

**Affected modules:**

- `app/src/data/phrases.ts`
- `app/src/utils/messageGeneration.ts`
- `app/src/store/communicationStore.ts`
- `app/src/types/aac.ts`
- `app/src/types/index.ts`
- `app/src/features/suggestions/index.ts`
- **New:** `app/src/features/communication/intentResolver.ts`
- **New:** `app/src/data/intents.ts`, if separating phrase assets from sentence alternatives improves clarity.
- Remove the unused `app/src/lib/messageBuilder.ts` after useful content is reviewed.

**Do not touch:** Firebase, service worker, camera code, framework versions, or visual restyling beyond what is needed to expose the new state.

**Tests required:** Table-driven English/Urdu cases for every supported intent; negation; unknown text; conflicting symbols; repeated input; custom-phrase validity; exactly three distinct complete language pairs for clear supported intents; invalidation of old selection.

**Acceptance criteria:** Water and Headache each return three reviewed messages; No + Water never becomes a positive request for water without clarification; ambiguous input is preserved; no candidate is spoken automatically; there is one authoritative sentence source.

### Step 2 — Repair voice input, speech output, and emergency behavior

**Objective:** Feed real communication text into the local engine and make speech cancellation reliable.

**Affected modules:**

- `app/src/components/aac/VoiceCommandPanel.tsx` — replace its command-diagnostics role with transcript input.
- `app/src/features/communication/voiceCommands.ts`
- `app/src/hooks/useSpeechSynthesis.ts`
- `app/src/sections/CommunicationBoardSection.tsx`
- `app/src/sections/EmergencySection.tsx`
- `app/src/sections/SettingsSection.tsx` — voice availability and truthful language labels.
- **New:** `app/src/hooks/useSpeechRecognition.ts`, if needed to keep browser lifecycle out of the UI.
- Retire `app/src/lib/urduCommands.ts`.

**Do not touch:** Cloud synchronization architecture, analytics, camera models, or an online AI API.

**Tests required:** Mock recognizer lifecycle; English/Urdu locale switching; interim/final input; exact whole-utterance controls; negated sentences; recognition failure; cancellation between languages; delayed callbacks after Clear/navigation; Repeat; missing Urdu voice. Separately run real-device microphone and audible TTS checks.

**Acceptance criteria:** Normal speech remains visible and influences candidates; live transcript appears while supported recognition is active; Stop cancels all scheduled speech; Repeat speaks the last explicitly selected message; no silent non-Urdu voice substitution; SOS works without AI and its stop control actually stops output.

### Step 3 — Simplify the main screen and make access reliable

**Objective:** Deliver the intended communication-first screen and four simple settings sections.

**Affected modules:**

- `app/src/sections/CommunicationBoardSection.tsx`
- `app/src/sections/HeaderSection.tsx`
- `app/src/components/layout/MainLayout.tsx`
- `app/src/components/aac/CategoryTabs.tsx`
- `app/src/components/aac/SymbolCard.tsx`
- `app/src/components/aac/SelectedMessagePreview.tsx`
- `app/src/components/aac/iconMap.tsx`
- `app/src/sections/SettingsSection.tsx`
- `app/src/sections/ProfileSection.tsx`
- `app/src/app/AppRouter.tsx`, `app/src/app/pages/WelcomePage.tsx`
- `app/src/index.css`, `app/tailwind.config.js`
- **New:** `app/src/components/aac/SentenceSuggestions.tsx`
- Retire the unused `AACBoard.tsx`, main-flow `ModeToggle.tsx`, and unnecessary caregiver route/page/section together.

**Do not touch:** The tested intent contract, add new inference mechanisms, or change the speech engine merely for visual preferences.

**Tests required:** 320/390px mobile and desktop layouts; 200% zoom; keyboard completion of a full communication task; focus after removal/navigation; label and semantic checks; all active targets against the chosen minimum; reduced-motion checks; Urdu wrapping; manual icon-recognition review.

**Acceptance criteria:** No horizontal page overflow; selected message and speech actions remain easy to reach; exactly three meaningful choices for supported input; no diagnostic rail; no misleading clinical/AI claims; Urdu remains readable; all important controls meet the approximately 44px minimum, preferably larger for AAC.

### Step 4 — Make local persistence and offline startup trustworthy

**Objective:** Preserve only necessary data, eliminate state/sync ambiguity, and prove the core works after internet loss.

**Affected modules:**

- `app/src/lib/storage.ts`
- `app/src/hooks/useOfflineSync.ts`
- `app/src/lib/firebase.ts` and `app/firestore.rules` only if backup is retained.
- `app/src/store/communicationStore.ts`
- `app/src/types/aac.ts`
- `app/src/components/layout/MainLayout.tsx` or `app/src/main.tsx` for a single persistence owner.
- `app/src/sections/HeaderSection.tsx`
- `app/public/sw.js`, `app/public/manifest.json`, `app/index.html`
- `app/src/hooks/usePWAInstall.ts`
- `app/vite.config.ts`, `app/firebase.json`, `app/package.json`, `app/package-lock.json` only for the chosen cache/build approach and dependency cleanup.
- `app/README.md`

**Do not touch:** Phrase semantics, add cloud accounts/sharing, or expand analytics. If cloud is not a real requirement, disable/defer it rather than building a complex conflict system.

**Tests required:** First preference change and reload; invalid/legacy storage; blocked/quota-limited storage; reset scope; profile isolation if retained; no default transcript/history persistence; cold offline reload after the documented preparation; board/SOS route fallback; interrupted install; update from previous build; API/cache separation. If cloud remains, add rules and failed/conflicting sync tests.

**Acceptance criteria:** One persistence owner; accurate error/status reporting; communication works independently of Firebase; the offline procedure works on the demonstration device; no personal API response enters the shell cache; stored data and reset behavior match the UI wording.

### Step 5 — Optional online enhancement and final evidence

**Objective:** Add only a justified AI enhancement, then evaluate and document the final complete flow.

**Affected modules:**

- `app/src/features/suggestions/index.ts`
- **New:** `app/src/features/suggestions/onlineSuggestions.ts`
- **New, only if Firebase Functions is selected:** `app/functions/src/index.ts`, `app/functions/package.json`, and `app/functions/tsconfig.json`.
- `app/firebase.json` only if that endpoint is hosted there.
- `app/src/sections/SettingsSection.tsx`
- `app/.env.example` for non-secret client configuration only; server secrets stay outside the client.
- `app/package.json` / lockfile for test scripts and genuinely required dependencies.
- **New test locations:** `app/tests/communication/`, `app/tests/browser/`, and `app/tests/rules/` if applicable.
- `app/README.md` plus a small evaluation-results document.

The endpoint location is a recommendation, not evidence that Functions already exists. A separate small backend is also acceptable; choose one, not both. If AI adds no demonstrated value, omit the endpoint and complete the evaluation work in this step.

**Do not touch:** The working offline path, add model training/camera features, redesign the UI again, or send stored history to the model.

**Tests required:** Timeout, server failure, malformed/duplicate/missing-language output, altered negation/facts, oversized input, stale response, no auto-speech, client bundle secret check, and rate/size limits. Finish end-to-end and physical device evaluation for both languages.

**Acceptance criteria:** Removing internet or disabling AI leaves core communication intact; only validated candidates appear; the selected message never changes silently; keys are server-only; the final report distinguishes automated results, device observations, user evaluation, and limitations.

## 23. Risk list before implementation

1. **Meaning reversal:** loose matching can turn refusal or absence of pain into an affirmative request. Resolve before adding broader voice use.
2. **Stale speech:** delayed bilingual callbacks can speak an outdated message. Establish one cancellation owner.
3. **Forced certainty:** requiring three suggestions must not pressure the engine to invent meaning for unknown input.
4. **Urdu quality:** grammatical gender, translation equivalence, script rendering, and actual device voice support all need review.
5. **Offline overclaim:** cached HTML alone is not a cached working application; recognition/TTS have separate availability limits.
6. **False profile isolation:** shared data currently appears under whichever profile is selected.
7. **Data loss during cleanup:** legacy storage and custom phrases need an explicit preserve/migrate/reset policy before changing the schema.
8. **Sync status deception:** success labels can conceal failed writes. Cloud should not be trusted until failure paths are tested.
9. **Wrong-file implementation:** the unused board and duplicate builders make it easy to fix code that is never executed.
10. **Scope expansion:** camera, emotion inference, clinical dashboards, and model training can consume the time needed for the core communication workflow.
11. **Unvalidated symbols:** technically correct icons may not be understandable to the intended users.
12. **Secret/cache leakage when AI is added:** a future client key or GET-cached response would introduce a risk that is not currently present.
13. **Polish mistaken for evidence:** attractive UI, “Clinical-Grade” wording, and a passing build must not replace meaningful evaluation.

## 24. Final verdict

**This project is worth improving. Do not rebuild it from scratch.**

The current application already provides a workable shell, typed data, useful bilingual phrases, symbol/category controls, message display, browser speech wiring, routing, and a starting point for local/PWA behavior. Replacing the whole repository would discard useful work without solving the difficult intent and reliability problems.

The part that needs a genuine rebuild is the **communication behavior**: input representation, intent handling, three-sentence generation, explicit candidate selection, and consistent state transitions. Voice interpretation needs replacement; TTS and persistence need substantial repair.

As a planning estimate, **roughly half to two-thirds of the active frontend structure and presentation code can be adapted**. This is an engineering judgment, not a measured reuse percentage. The offline phrase catalog is largely reusable after review and expansion; the intelligence pipeline is largely missing; the many unused UI files should not be counted as valuable reuse.

**Do not waste time on:** new dashboards, recommendation-score visualizations, camera/emotion inference, generalized sign-language translation, model training, complex caregiver cloud synchronization, changing frameworks, or keeping unused components to make the repository look larger.

**The safest path to a useful final FYP is:** a small reviewed bilingual intent catalog, three complete choices, trustworthy user selection and speech, simple mobile-accessible controls, reliable offline AAC/SOS, minimal private data retention, and honest evaluation on the intended devices. Add Gemini only if it measurably improves that already-working system.

The strongest final presentation is not “we implemented many AI features.” It is evidence that a user can communicate a real need clearly, choose the intended message, stop or repeat it reliably, and continue using AAC when the network fails.
