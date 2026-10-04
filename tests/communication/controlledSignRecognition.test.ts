import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import {
  ControlledSignRecognizer,
} from '../../src/features/signRecognition/controlledSignRecognizer';
import type { ISignClassifier } from '../../src/hooks/useSignRecognition';
import type { PredictionResult } from '../../src/features/signRecognition/signTypes';
import { TOTAL_FRAME_FEATURES } from '../../src/features/signRecognition/handFeatureExtractor';
import { useCommunicationStore } from '../../src/store/communicationStore';
import { defaultStoredState } from '../../src/lib/storage';
import { CameraPanel } from '../../src/components/aac/CameraPanel';
import { CameraController, type MediaDevicesPort } from '../../src/features/camera/cameraController';

const mockMediaDevices: MediaDevicesPort = {
  getUserMedia: async () => ({
    getTracks: () => [],
    getVideoTracks: () => [],
  }),
  enumerateDevices: async () => [],
};

function createDummyFrame(val = 0.5): Float32Array {
  const frame = new Float32Array(TOTAL_FRAME_FEATURES);
  frame.fill(val);
  return frame;
}

interface MockClassifierState extends ISignClassifier {
  predictCalls: number;
  lastInput: Float32Array | null;
  setResult: (result: PredictionResult | null) => void;
}

function createMockClassifier(initialResult: PredictionResult | null): MockClassifierState {
  let result = initialResult;
  let predictCalls = 0;
  let lastInput: Float32Array | null = null;

  return {
    ready: true,
    classCount: 8,
    get predictCalls() {
      return predictCalls;
    },
    get lastInput() {
      return lastInput;
    },
    setResult(newResult: PredictionResult | null) {
      result = newResult;
    },
    load: async () => {},
    predict: async (flattened: Float32Array) => {
      predictCalls++;
      lastInput = new Float32Array(flattened);
      return result;
    },
  };
}

beforeEach(() => {
  useCommunicationStore.getState().initFromStoredState(defaultStoredState);
  useCommunicationStore.getState().clearSelection();
});

// A. Recognition does not start automatically when camera starts
test('Phase 2F - Requirement A: recognition does not start automatically when camera is active', () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.95,
    top3: [{ label: 'water', confidence: 0.95 }],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
  });

  assert.equal(recognizer.state, 'ready');
  assert.equal(recognizer.statusMessage, 'Camera ready');
  assert.equal(recognizer.isRecognizing, false);
  assert.equal(recognizer.isRecording, false);

  // Simulate 100 continuous camera frames arriving while camera is active
  const dummyFrame = createDummyFrame();
  for (let i = 0; i < 100; i++) {
    const accepted = recognizer.addFrame(dummyFrame);
    assert.equal(accepted, false, 'Frames must not be captured when not in recording phase');
  }

  // Model inference must NEVER have been called automatically
  assert.equal(mockClassifier.predictCalls, 0);
  assert.equal(recognizer.capturedFramesCount, 0);
  assert.equal(recognizer.candidate, null);
  assert.equal(recognizer.state, 'ready');
});

// B. Recognize Sign explicitly begins capture
test('Phase 2F - Requirement B: Recognize Sign explicitly begins countdown then capture', async () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.92,
    top3: [{ label: 'water', confidence: 0.92 }],
  });

  const states: string[] = [];
  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 10,
    countdownStepDurationMs: 10,
    onStateChange: (snap) => {
      states.push(`${snap.state}:${snap.statusMessage}`);
    },
  });

  const started = recognizer.startRecognition();
  assert.equal(started, true);
  assert.equal(recognizer.isRecognizing, true);
  assert.equal(recognizer.state, 'countdown');
  assert.equal(recognizer.statusMessage, 'Get ready...');

  // Wait for countdown sequence (Get ready -> 3 -> 2 -> 1 -> Signing...)
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(recognizer.state, 'recording');
  assert.equal(recognizer.isRecording, true);
  assert.equal(recognizer.statusMessage, 'Signing... 0/60');
  assert.ok(states.some((s) => s.includes('Get ready...')));
  assert.ok(states.some((s) => s.includes('3')));
  assert.ok(states.some((s) => s.includes('2')));
  assert.ok(states.some((s) => s.includes('1')));
  assert.ok(states.some((s) => s.includes('Signing... 0/60')));
});

// C. Frames before countdown completion are not included
test('Phase 2F - Requirement C: frames arriving during countdown are discarded and never recorded', async () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.90,
    top3: [],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 50,
    countdownStepDurationMs: 50,
  });

  recognizer.startRecognition();
  assert.equal(recognizer.state, 'countdown');

  // Push frames during countdown
  const dummyFrame = createDummyFrame(0.123);
  for (let i = 0; i < 20; i++) {
    const accepted = recognizer.addFrame(dummyFrame);
    assert.equal(accepted, false, 'Frame during countdown must be discarded');
  }

  assert.equal(recognizer.capturedFramesCount, 0);

  // Wait for countdown to finish
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(recognizer.state, 'recording');

  // Now frame is accepted
  const accepted = recognizer.addFrame(dummyFrame);
  assert.equal(accepted, true);
  assert.equal(recognizer.capturedFramesCount, 1);
});

// D. Exactly 60 frames are used
test('Phase 2F - Requirement D: exactly 60 frames are collected and trigger analysis', async () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.95,
    top3: [],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
    sequenceLength: 60,
  });

  recognizer.startRecognition();
  assert.equal(recognizer.state, 'recording');

  const dummyFrame = createDummyFrame();

  // Push frames 1 to 59
  for (let i = 1; i <= 59; i++) {
    const ok = recognizer.addFrame(dummyFrame);
    assert.equal(ok, true);
    assert.equal(recognizer.capturedFramesCount, i);
    assert.equal(recognizer.state, 'recording');
    assert.equal(recognizer.statusMessage, `Signing... ${i}/60`);
  }

  // 60th frame completes the sequence
  const finalFrameOk = recognizer.addFrame(dummyFrame);
  assert.equal(finalFrameOk, true);
  assert.equal(recognizer.capturedFramesCount, 60);
  assert.equal(recognizer.state, 'analyzing');
  assert.equal(recognizer.statusMessage, 'Analyzing...');

  // Further frames are rejected while analyzing
  const extraFrameOk = recognizer.addFrame(dummyFrame);
  assert.equal(extraFrameOk, false);

  await recognizer.waitForInference();
  assert.equal(recognizer.state, 'detected');
});

// E. Only one inference call occurs per recognition attempt
test('Phase 2F - Requirement E: only one inference call occurs per recognition attempt', async () => {
  const mockClassifier = createMockClassifier({
    label: 'help',
    confidence: 0.93,
    top3: [],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
  });

  recognizer.startRecognition();
  const dummyFrame = createDummyFrame();

  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }

  await recognizer.waitForInference();

  assert.equal(mockClassifier.predictCalls, 1, 'Inference must be called exactly once');
  assert.equal(recognizer.isRecognizing, false);
});

// F. NO_SIGN produces no candidate
test('Phase 2F - Requirement F: NO_SIGN produces no candidate and displays rejection message', async () => {
  const mockClassifier = createMockClassifier({
    label: 'NO_SIGN',
    confidence: 0.99,
    top3: [{ label: 'NO_SIGN', confidence: 0.99 }],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
  });

  recognizer.startRecognition();
  const dummyFrame = createDummyFrame();
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }

  await recognizer.waitForInference();

  assert.equal(recognizer.state, 'no-sign');
  assert.equal(recognizer.statusMessage, 'No communication sign detected');
  assert.equal(recognizer.candidate, null);
  assert.equal(recognizer.detectedSign, null);
  assert.equal(useCommunicationStore.getState().generatedMessage, null);
});

// G. Low-confidence result produces no candidate
test('Phase 2F - Requirement G: low-confidence result (< 0.70) produces no candidate', async () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.64, // Below 0.70 threshold
    top3: [{ label: 'water', confidence: 0.64 }],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    minConfidenceThreshold: 0.70,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
  });

  recognizer.startRecognition();
  const dummyFrame = createDummyFrame();
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }

  await recognizer.waitForInference();

  assert.equal(recognizer.state, 'uncertain');
  assert.equal(recognizer.statusMessage, 'Sign unclear — try again');
  assert.equal(recognizer.candidate, null);
  assert.equal(useCommunicationStore.getState().generatedMessage, null);
});

// H. Accepted result becomes candidate only
test('Phase 2F - Requirement H: accepted result creates candidate with bilingual message and detected status', async () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.88,
    top3: [
      { label: 'water', confidence: 0.88 },
      { label: 'thankyou', confidence: 0.10 },
    ],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
  });

  recognizer.startRecognition();
  const dummyFrame = createDummyFrame();
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }

  await recognizer.waitForInference();

  assert.equal(recognizer.state, 'detected');
  assert.equal(recognizer.statusMessage, 'Detected: Water — 88%');
  assert.ok(recognizer.candidate !== null);
  assert.equal(recognizer.candidate?.label, 'water');
  assert.equal(recognizer.candidate?.confidence, 0.88);
  assert.equal(recognizer.candidate?.englishMessage, 'I need water.');
  assert.equal(recognizer.candidate?.urduMessage, 'مجھے پانی چاہیے۔');
});

// I. Candidate does not automatically update generatedMessage
test('Phase 2F - Requirement I: candidate does NOT automatically update generatedMessage', async () => {
  const mockClassifier = createMockClassifier({
    label: 'thankyou',
    confidence: 0.94,
    top3: [{ label: 'thankyou', confidence: 0.94 }],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
  });

  recognizer.startRecognition();
  const dummyFrame = createDummyFrame();
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }

  await recognizer.waitForInference();

  assert.ok(recognizer.candidate !== null);
  // Communication store must still be completely untouched
  assert.equal(useCommunicationStore.getState().generatedMessage, null);
});

// J. Use this message explicitly updates generatedMessage
test('Phase 2F - Requirement J: explicit applyPslMessage updates generatedMessage', async () => {
  const mockClassifier = createMockClassifier({
    label: 'hello',
    confidence: 0.91,
    top3: [{ label: 'hello', confidence: 0.91 }],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
  });

  recognizer.startRecognition();
  const dummyFrame = createDummyFrame();
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }

  await recognizer.waitForInference();

  const candidate = recognizer.candidate;
  assert.ok(candidate !== null);

  // User explicitly clicks "Use this message"
  useCommunicationStore.getState().applyPslMessage(candidate.englishMessage, candidate.urduMessage);
  recognizer.clearCandidate();

  const storeState = useCommunicationStore.getState();
  assert.ok(storeState.generatedMessage !== null);
  assert.equal(storeState.generatedMessage?.englishText, 'Hello.');
  assert.equal(storeState.generatedMessage?.urduText, 'السلام علیکم۔');
  assert.ok(storeState.generatedMessage?.id.startsWith('psl-'));
  assert.equal(recognizer.candidate, null);
  assert.equal(recognizer.state, 'ready');
});

// K. No automatic speech
test('Phase 2F - Requirement K: recognition and candidate confirmation never auto-speak', async () => {
  let speakCalls = 0;
  const originalSpeech = (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  (globalThis as unknown as { speechSynthesis: { speak: () => void } }).speechSynthesis = {
    speak: () => {
      speakCalls++;
    },
  };

  try {
    const mockClassifier = createMockClassifier({
      label: 'water',
      confidence: 0.95,
      top3: [],
    });

    const recognizer = new ControlledSignRecognizer({
      classifier: mockClassifier,
      getReadyDurationMs: 0,
      countdownStepDurationMs: 0,
    });

    recognizer.startRecognition();
    const dummyFrame = createDummyFrame();
    for (let i = 0; i < 60; i++) {
      recognizer.addFrame(dummyFrame);
    }
    await recognizer.waitForInference();

    assert.ok(recognizer.candidate !== null);
    assert.equal(speakCalls, 0, 'Must not speak on prediction');

    // Use message
    useCommunicationStore
      .getState()
      .applyPslMessage(recognizer.candidate.englishMessage, recognizer.candidate.urduMessage);

    assert.equal(speakCalls, 0, 'Must not speak on candidate confirmation');
  } finally {
    if (originalSpeech) {
      (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = originalSpeech;
    } else {
      delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    }
  }
});

// L. Second recognition cannot start while first capture/inference is active
test('Phase 2F - Requirement L: second recognition attempt is blocked while capture/inference is active', () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.95,
    top3: [],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 100,
    countdownStepDurationMs: 100,
  });

  const firstAttempt = recognizer.startRecognition();
  assert.equal(firstAttempt, true);
  assert.equal(recognizer.isRecognizing, true);

  // Attempting second start while active must return false and be blocked
  const secondAttempt = recognizer.startRecognition();
  assert.equal(secondAttempt, false);

  recognizer.cancel();
  assert.equal(recognizer.isRecognizing, false);
});

// M. Camera remains live between attempts
test('Phase 2F - Requirement M: multiple sequential recognitions run cleanly without stopping camera', async () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.85,
    top3: [{ label: 'water', confidence: 0.85 }],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
  });

  const dummyFrame = createDummyFrame();

  // Attempt 1: Water
  recognizer.startRecognition();
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }
  await recognizer.waitForInference();
  assert.equal(recognizer.candidate?.label, 'water');
  assert.equal(mockClassifier.predictCalls, 1);

  // User dismisses or starts new attempt
  recognizer.clearCandidate();
  assert.equal(recognizer.state, 'ready');

  // Attempt 2: Help (camera preview was never reset or stopped)
  mockClassifier.setResult({
    label: 'help',
    confidence: 0.92,
    top3: [{ label: 'help', confidence: 0.92 }],
  });

  const secondStarted = recognizer.startRecognition();
  assert.equal(secondStarted, true);
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }
  await recognizer.waitForInference();
  assert.equal(recognizer.candidate?.label, 'help');
  assert.equal(mockClassifier.predictCalls, 2);
});

// N. Feature shape remains exactly 60 × 126
test('Phase 2F - Requirement N: input passed to classifier is exactly Float32Array of shape [1, 60, 126] (7560 elements)', async () => {
  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.95,
    top3: [],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 0,
    countdownStepDurationMs: 0,
    sequenceLength: 60,
  });

  recognizer.startRecognition();

  // Create frames with known values to verify exact flattening order
  for (let f = 0; f < 60; f++) {
    const frame = new Float32Array(126);
    frame[0] = f * 1.0; // Left hand wrist X
    frame[63] = f * 2.0; // Right hand wrist X
    recognizer.addFrame(frame);
  }

  await recognizer.waitForInference();

  assert.ok(mockClassifier.lastInput !== null);
  assert.equal(mockClassifier.lastInput.length, 60 * 126); // Exactly 7560
  assert.ok(mockClassifier.lastInput instanceof Float32Array);

  // Verify frame ordering preserved across the 60 frames
  for (let f = 0; f < 60; f++) {
    const offset = f * 126;
    assert.equal(mockClassifier.lastInput[offset], f * 1.0);
    assert.equal(mockClassifier.lastInput[offset + 63], f * 2.0);
  }
});

// O. Diagnostic metrics recording
test('Phase 2F - Diagnostic metrics: records top1, top2, countdown, capture, and inference durations', async () => {
  const mockClassifier = createMockClassifier({
    label: 'hungry',
    confidence: 0.89,
    top2: { label: 'want', confidence: 0.08 },
    top3: [
      { label: 'hungry', confidence: 0.89 },
      { label: 'want', confidence: 0.08 },
    ],
  });

  const recognizer = new ControlledSignRecognizer({
    classifier: mockClassifier,
    getReadyDurationMs: 5,
    countdownStepDurationMs: 5,
  });

  recognizer.startRecognition();
  await new Promise((r) => setTimeout(r, 30));

  const dummyFrame = createDummyFrame();
  for (let i = 0; i < 60; i++) {
    recognizer.addFrame(dummyFrame);
  }

  await recognizer.waitForInference();

  const metrics = recognizer.metrics;
  assert.ok(metrics !== null);
  assert.deepEqual(metrics.top1, { label: 'hungry', confidence: 0.89 });
  assert.deepEqual(metrics.top2, { label: 'want', confidence: 0.08 });
  assert.ok(metrics.countdownDurationMs >= 0);
  assert.ok(metrics.captureDurationMs >= 0);
  assert.ok(metrics.inferenceDurationMs >= 0);
  assert.ok(metrics.totalDurationMs >= 0);
});

// P. UI: CameraPanel does NOT render Recognize Sign button or controlled recording UI (Phase 2G)
test('Phase 2G - UI: CameraPanel does NOT render Recognize Sign button, countdown, or recording bar', () => {
  const controller = new CameraController(mockMediaDevices);
  controller['state'] = {
    ...controller['state'],
    status: 'active',
  };

  const mockClassifier = createMockClassifier({
    label: 'water',
    confidence: 0.95,
    top3: [],
  });

  const html = render(
    h(CameraPanel, {
      controller,
      signOptions: {
        customClassifier: mockClassifier,
      },
    })
  );

  assert.ok(!html.includes('recognize-sign-btn'), 'Recognize Sign button must NOT be rendered');
  assert.ok(!html.includes('Recognize Sign'), 'Button text must NOT include Recognize Sign');
  assert.ok(!html.includes('اشارہ پہچانیں'), 'Urdu label for Recognize Sign must NOT be rendered');
  assert.ok(!html.includes('psl-buffer-bar'), 'Controlled recording progress bar must NOT be rendered');
  assert.ok(!html.includes('Signing...'), 'Signing progress must NOT be rendered');
  assert.ok(!html.includes('Get ready'), 'Countdown must NOT be rendered');
  assert.ok(!html.includes('psl-preview-label'), 'Raw fluctuating prediction label must not be rendered');
  assert.ok(html.includes('Stop Camera'), 'Stop Camera button must be rendered');
});
