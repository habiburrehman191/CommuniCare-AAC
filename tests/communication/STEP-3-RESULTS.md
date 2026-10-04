# Step 3 UI/UX verification

Implemented only Roadmap Step 3 using Ayesha-Eman-FYP-Complete-Audit.md and the completed Step 1/2 source.

## Design and behavior

- The root route opens /board. A single vertical communication flow replaces the dashboard and construction rail.
- Compact header: identity, active profile, spoken language, Settings, and SOS. Sticky on normal-height screens; static in short landscape so controls do not cover content.
- Large bilingual current message; explicit Speak/Stop, Repeat when available, reviewable last spoken text, Clear and undo.
- Microphone area keeps the existing lifecycle and exact command handling, English/Urdu mode, live/final transcripts, and editable correction.
- SentenceSuggestions displays the semantic engine's existing 1–3 candidates. No automatic selection or speech. Selected card has a check and pressed state.
- Full 52-symbol catalog and nine categories, with large bilingual buttons. Visual icon overrides distinguish More, Less, Now, And, Hot, Cold, and other previously reused icons without altering vocabulary or semantic data.
- Local SOS uses the existing emergency controller. The header language now applies consistently to emergency speech; localOnly remains enforced. Changing header language cancels current speech.
- General / Communication / Accessibility / Advanced settings: one mounted panel at a time; arrow/Home/End navigation with roving tab focus.
- Technical help, install, backup, saved-data controls, and optional emotion preference appear only in Advanced.
- Existing highContrast preference is connected to the new visual tokens. No schema changes.

## Verification results

- npm test: 344 passed, 0 failed. Original 322 Step 1/2 tests retained; 22 new UI tests.
- npm run typecheck: application and test TypeScript checks passed.
- npm run lint: 0 errors, 8 pre-existing warnings in unused scaffold UI components.
- npm run build: passed, 1774 modules, final build 5.00 seconds.
- Browser: Microsoft Edge, actual rendered app using viewport override. No application-origin console errors; the user's Grammarly extension logged unrelated errors and briefly injected an overflowing overlay during typing. Once the overlay dismissed, the populated app had no document overflow. No overflow-hiding CSS was used.
- Final populated board, all four settings panels, profiles, and selected emergency messages checked at 320, 375, 390, 430, 768, 1024, 1440, and 2048 CSS pixels.
- Narrow landscape: 568 × 320 checked for board, all settings panels, profiles, and SOS.
- No horizontal document overflow, clipped communication cards, or app button/select/header-link targets smaller than 44 × 44 in the final measured states. High contrast checkbox is contained in a full-size clickable label.
- All nine categories checked at 320 pixels.
- Keyboard checks: Enter selects a candidate without speaking; Go to Speak focuses the message heading; Clear restores focus; Settings arrow navigation selects and focuses the next tab; route navigation focuses main.
- Correction to “I do not want water.” invalidates the old sentence and shows negative English/Urdu candidates.
- High contrast toggle checked in-browser and restored to its previous setting.
- All speech ranges expose accessible names. Urdu message/card text has lang=ur and dir=rtl. Reduced motion and forced-color selection styles are covered by CSS checks.
- Color contrast calculations: primary button text 6.64:1; muted text on microphone surface 5.51:1; control boundaries 3.10:1 or greater on that surface; SOS text 6.05:1.
- Temporary viewport override reset; preview left open at /board.

## Scope verification

A byte comparison against the Step 3 starting snapshot found no modifications to src/features/communication, src/store, src/data, src/types, src/hooks, src/lib, or public. The original semantic/recognition/speech/persistence/Firebase/PWA implementations are unchanged. Existing sync/install hook calls were moved from the header to the persistent MainLayout so Advanced can access their results through context, without creating extra hook instances.

Modified:
- index.html (title/description only)
- scripts/test.mjs
- src/app/AppRouter.tsx
- src/components/aac/CategoryTabs.tsx
- src/components/aac/iconMap.tsx
- src/components/aac/SelectedMessagePreview.tsx
- src/components/aac/SymbolCard.tsx
- src/components/aac/VoiceCommandPanel.tsx
- src/components/layout/MainLayout.tsx
- src/index.css
- src/sections/CommunicationBoardSection.tsx
- src/sections/EmergencySection.tsx
- src/sections/HeaderSection.tsx
- src/sections/index.ts
- src/sections/ProfileSection.tsx
- src/sections/SettingsSection.tsx
- tests/communication/store.test.ts (selection assertion follows the extracted sentence component; behavior coverage preserved)

Added:
- src/components/aac/SentenceSuggestions.tsx
- src/components/aac/RepeatMessageDetails.tsx
- src/components/layout/AppServices.ts
- tests/communication/ui.test.ts
- tests/communication/STEP-3-RESULTS.md

Removed:
- src/app/pages/CaregiverDashboardPage.tsx
- src/app/pages/WelcomePage.tsx
- src/components/aac/AACBoard.tsx
- src/components/aac/ModeToggle.tsx
- src/sections/CaregiverDashboardSection.tsx

## Limits

Browser verification used desktop Edge viewport emulation, not physical mobile hardware or a screen reader. Native browser zoom could not be confirmed under the viewport override; the specified CSS-width reflow checks passed. Reduced motion was verified in CSS, not by changing the user's OS preference. Live microphone/audio hardware behavior was not re-evaluated in Step 3; the preserved mocked Step 2 lifecycle/cancellation tests passed. Urdu font availability and installed speech voices retain their existing device dependencies. Independent Urdu/AAC-user usability evaluation remains outstanding.

Stopped after Step 3.
