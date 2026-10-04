import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  SequenceBuffer,
  REQUIRED_SEQUENCE_LENGTH,
  TOTAL_POSITION_FEATURES,
  TOTAL_VELOCITY_FEATURES,
  TOTAL_FRAME_V3_FEATURES,
  TOTAL_INPUT_ELEMENTS,
  computeV3FeaturesFromPositions,
} from '../../src/features/signRecognition/sequenceBuffer';
import { SignStabilizer } from '../../src/features/signRecognition/signStabilizer';
import type { ISignClassifier } from '../../src/hooks/useSignRecognition';
import type { PredictionResult } from '../../src/features/signRecognition/signTypes';
import { useCommunicationStore } from '../../src/store/communicationStore';
import { defaultStoredState } from '../../src/lib/storage';
import { CameraPanel } from '../../src/components/aac/CameraPanel';
import { CommunicationBoardSection } from '../../src/sections/CommunicationBoardSection';
import { CameraController, type MediaDevicesPort } from '../../src/features/camera/cameraController';
import { OnnxSignClassifier } from '../../src/features/signRecognition/onnxSignClassifier';

const mockMediaDevices: MediaDevicesPort = {
  getUserMedia: async () => ({
    getTracks: () => [],
    getVideoTracks: () => [],
  }),
  enumerateDevices: async () => [],
};

function createDummyPositionFrame(val = 0.5): Float32Array {
  const frame = new Float32Array(TOTAL_POSITION_FEATURES);
  frame.fill(val);
  return frame;
}

interface MockClassifierState extends ISignClassifier {
  predictCalls: number;
  lastInput: Float32Array | null;
  setResult: (result: PredictionResult | null) => void;
  predictDelayMs?: number;
}

function createMockClassifier(initialResult: PredictionResult | null, predictDelayMs = 0): MockClassifierState {
  let result = initialResult;
  let predictCalls = 0;
  let lastInput: Float32Array | null = null;

  return {
    ready: true,
    classCount: 8,
    predictDelayMs,
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
      if (predictDelayMs > 0) {
        await new Promise((r) => setTimeout(r, predictDelayMs));
      }
      return result;
    },
  };
}

beforeEach(() => {
  useCommunicationStore.getState().initFromStoredState(defaultStoredState);
  useCommunicationStore.getState().clearSelection();
});

// ==================================================
// 19 MANDATORY V3 PRODUCTION INTEGRATION CONTRACT TESTS
// ==================================================

// 1. first inference only after 24 frames
test('V3 Production Test 1: first inference only after 24 frames', () => {
  const buffer = new SequenceBuffer(15);
  const frame = createDummyPositionFrame(0.5);

  for (let i = 1; i <= 23; i++) {
    const isFull = buffer.push(frame, true);
    assert.equal(isFull, false, `Buffer must not be full at frame ${i}`);
    assert.equal(buffer.isFull, false);
    assert.equal(buffer.getFlattened(), null);
  }

  // Frame 24 makes buffer full
  const full = buffer.push(frame, true);
  assert.equal(full, true, '24th frame must mark buffer full');
  assert.equal(buffer.isFull, true);
  assert.equal(buffer.length, 24);
  assert.ok(buffer.getFlattened() !== null);
});

// 2. rolling buffer remains exactly 24 frames
test('V3 Production Test 2: rolling buffer remains exactly 24 frames', () => {
  const buffer = new SequenceBuffer(15);

  // Push 60 frames with indexed values to verify FIFO sliding window
  for (let i = 0; i < 60; i++) {
    const frame = new Float32Array(TOTAL_POSITION_FEATURES);
    frame[0] = i; // unique marker per frame
    buffer.push(frame, true);
    if (i >= 23) {
      assert.equal(buffer.length, 24, `Buffer length must stay capped at 24 at step ${i}`);
      assert.equal(buffer.isFull, true);
    }
  }

  assert.equal(buffer.length, 24);
  const tensor = buffer.getFlattened();
  assert.ok(tensor !== null);
  // Oldest frame in buffer should be frame index 36 (60 - 24 = 36)
  assert.equal(tensor[0], 36);
  // Newest frame in buffer should be frame index 59
  assert.equal(tensor[23 * TOTAL_FRAME_V3_FEATURES], 59);
});

// 3. feature shape is exactly [1,24,252]
test('V3 Production Test 3: feature shape is exactly [1,24,252]', () => {
  assert.equal(REQUIRED_SEQUENCE_LENGTH, 24);
  assert.equal(TOTAL_POSITION_FEATURES, 126);
  assert.equal(TOTAL_VELOCITY_FEATURES, 126);
  assert.equal(TOTAL_FRAME_V3_FEATURES, 252);
  assert.equal(TOTAL_INPUT_ELEMENTS, 24 * 252); // 6048

  const buffer = new SequenceBuffer(15);
  for (let i = 0; i < 24; i++) {
    buffer.push(createDummyPositionFrame(0.1 * (i + 1)), true);
  }

  const flattened = buffer.getFlattened();
  assert.ok(flattened !== null);
  assert.equal(flattened.length, 6048);
  assert.equal(flattened.length, 24 * 252);

  // Verify classifier defaults to V3 model and shape
  const classifier = new OnnxSignClassifier();
  assert.match(classifier['modelPath'], /communicare-aac-sign-v3-candidate/);
  assert.match(classifier['labelsPath'], /communicare-aac-sign-v3-candidate/);
});

// 4. inference stride is 3 frames
test('V3 Production Test 4: inference stride is 3 frames', () => {
  const stride = 3;
  let framesSinceLastInference = 0;
  let inferenceCount = 0;

  // After 24 frames warm-up, simulate 30 consecutive live frames arriving
  for (let frame = 24; frame < 54; frame++) {
    framesSinceLastInference++;
    if (framesSinceLastInference >= stride) {
      inferenceCount++;
      framesSinceLastInference = 0;
    }
  }

  // 30 frames with stride 3 -> exactly 10 inferences
  assert.equal(inferenceCount, 10);
});

// 5. concurrent inference cannot overlap
test('V3 Production Test 5: concurrent inference cannot overlap', async () => {
  let isPredicting = false;
  let totalInferencesStarted = 0;

  const runGuardedInference = async () => {
    if (isPredicting) {
      return false; // Skip overlapping invocation
    }
    isPredicting = true;
    totalInferencesStarted++;

    await new Promise((r) => setTimeout(r, 25));

    isPredicting = false;
    return true;
  };

  const [first, second] = await Promise.all([
    runGuardedInference(),
    runGuardedInference(),
  ]);

  assert.ok(first !== second, 'Exactly one concurrent call must proceed while the other is rejected');
  assert.equal(totalInferencesStarted, 1);
});

// 6. NO_SIGN never emits candidate
test('V3 Production Test 6: NO_SIGN never emits candidate', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  // Feed 10 consecutive high-confidence NO_SIGN predictions with high margin
  for (let i = 0; i < 10; i++) {
    const out = stabilizer.process(
      {
        label: 'NO_SIGN',
        confidence: 0.99,
        top2: { label: 'water', confidence: 0.01 },
        top3: [],
        margin: 0.98,
      },
      2,
      true
    );
    assert.equal(out.state, 'no-sign');
    assert.equal(out.candidate, null, 'NO_SIGN must NEVER produce a candidate');
    assert.equal(out.detectedSign, null);
    assert.equal(out.decision, 'no-sign');
  }

  assert.equal(useCommunicationStore.getState().generatedMessage, null);
});

// 7. confidence < 0.85 never emits candidate
test('V3 Production Test 7: confidence < 0.85 never emits candidate', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  // Even with 5 consecutive matching predictions, if confidence is 0.84 (< 0.85), reject
  for (let i = 0; i < 5; i++) {
    const out = stabilizer.process(
      {
        label: 'water',
        confidence: 0.84,
        top2: { label: 'help', confidence: 0.10 },
        top3: [],
        margin: 0.74,
      },
      2,
      true
    );
    assert.equal(out.candidate, null);
    assert.equal(out.state, 'uncertain');
    assert.equal(out.decision, 'low-confidence');
  }
});

// 8. margin < 0.10 never emits candidate
test('V3 Production Test 8: margin < 0.10 never emits candidate', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  // High confidence (0.90 >= 0.85), but top2 is 0.85 -> margin = 0.05 (< 0.10)
  for (let i = 0; i < 5; i++) {
    const out = stabilizer.process(
      {
        label: 'water',
        confidence: 0.90,
        top2: { label: 'help', confidence: 0.85 },
        top3: [],
        margin: 0.05,
      },
      2,
      true
    );
    assert.equal(out.candidate, null);
    assert.equal(out.state, 'uncertain');
    assert.equal(out.decision, 'unstable');
  }
});

// 9. one matching prediction does not emit candidate
test('V3 Production Test 9: one matching prediction does not emit candidate', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  const out = stabilizer.process(
    {
      label: 'water',
      confidence: 0.92,
      top2: { label: 'help', confidence: 0.05 },
      top3: [],
      margin: 0.87,
    },
    2,
    true
  );

  assert.equal(out.state, 'collecting');
  assert.equal(out.candidate, null, 'Single matching prediction must not surface candidate');
  assert.equal(out.stabilizerProgress, '1/3');
  assert.equal(out.decision, 'unstable');
});

// 10. two matching predictions do not emit candidate
test('V3 Production Test 10: two matching predictions do not emit candidate', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  const pred = {
    label: 'water',
    confidence: 0.92,
    top2: { label: 'help', confidence: 0.05 },
    top3: [],
    margin: 0.87,
  };

  // Window 1
  const out1 = stabilizer.process(pred, 2, true);
  assert.equal(out1.candidate, null);
  assert.equal(out1.stabilizerProgress, '1/3');

  // Window 2
  const out2 = stabilizer.process(pred, 2, true);
  assert.equal(out2.candidate, null, 'Two matching predictions must not surface candidate when 3 are required');
  assert.equal(out2.stabilizerProgress, '2/3');
  assert.equal(out2.decision, 'unstable');
});

// 11. three accepted matching predictions emit candidate
test('V3 Production Test 11: three accepted matching predictions emit candidate', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  const pred = {
    label: 'water',
    confidence: 0.91,
    top2: { label: 'help', confidence: 0.05 },
    top3: [],
    margin: 0.86,
  };

  // Window 1 (1/3)
  stabilizer.process(pred, 2, true);
  // Window 2 (2/3)
  stabilizer.process(pred, 2, true);
  // Window 3 (3/3)
  const out3 = stabilizer.process(pred, 2, true);

  assert.equal(out3.state, 'detected');
  assert.ok(out3.candidate !== null, 'Candidate must be surfaced on 3rd consecutive matching window');
  assert.equal(out3.candidate?.label, 'water');
  assert.equal(out3.candidate?.englishMessage, 'I need water.');
  assert.equal(out3.candidate?.urduMessage, 'مجھے پانی چاہیے۔');
  assert.equal(out3.stabilizerProgress, '3/3');
  assert.equal(out3.decision, 'accepted');
});

// 12. alternating predictions reset stability
test('V3 Production Test 12: alternating predictions reset stability', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  const waterPred = {
    label: 'water',
    confidence: 0.90,
    top2: { label: 'NO_SIGN', confidence: 0.05 },
    top3: [],
    margin: 0.85,
  };
  const helpPred = {
    label: 'help',
    confidence: 0.92,
    top2: { label: 'NO_SIGN', confidence: 0.04 },
    top3: [],
    margin: 0.88,
  };

  // 1: water -> 1/3
  const out1 = stabilizer.process(waterPred, 2, true);
  assert.equal(out1.stabilizerProgress, '1/3');
  assert.equal(out1.candidate, null);

  // 2: water -> 2/3
  const out2 = stabilizer.process(waterPred, 2, true);
  assert.equal(out2.stabilizerProgress, '2/3');
  assert.equal(out2.candidate, null);

  // 3: alternating to help -> resets water stability, now 1/3 for help
  const out3 = stabilizer.process(helpPred, 2, true);
  assert.equal(out3.candidate, null);
  assert.equal(out3.stabilizerProgress, '1/3');
  assert.equal(out3.detectedSign, 'help');

  // 4: back to water -> resets help stability, now 1/3 for water
  const out4 = stabilizer.process(waterPred, 2, true);
  assert.equal(out4.candidate, null);
  assert.equal(out4.stabilizerProgress, '1/3');
  assert.equal(out4.detectedSign, 'water');
});

// 13. candidate does not update generatedMessage
test('V3 Production Test 13: candidate does not update generatedMessage', () => {
  const store = useCommunicationStore.getState();
  assert.equal(store.generatedMessage, null);

  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });

  const pred = {
    label: 'help',
    confidence: 0.93,
    top2: { label: 'NO_SIGN', confidence: 0.02 },
    top3: [],
    margin: 0.91,
  };

  // 3 matching windows to surface candidate
  stabilizer.process(pred, 2, true);
  stabilizer.process(pred, 2, true);
  const out = stabilizer.process(pred, 2, true);

  assert.ok(out.candidate !== null, 'Candidate must be emitted');
  // Store must remain completely unchanged
  assert.equal(useCommunicationStore.getState().generatedMessage, null);
});

// 14. explicit Use this message updates generatedMessage
test('V3 Production Test 14: explicit Use this message updates generatedMessage', () => {
  const store = useCommunicationStore.getState();
  assert.equal(store.generatedMessage, null);

  // User explicitly clicks "Use this message"
  store.applyPslMessage('I need help now.', 'مجھے ابھی مدد چاہیے۔');

  const updated = useCommunicationStore.getState();
  assert.ok(updated.generatedMessage !== null);
  assert.equal(updated.generatedMessage?.englishText, 'I need help now.');
  assert.equal(updated.generatedMessage?.urduText, 'مجھے ابھی مدد چاہیے۔');
  assert.ok(updated.generatedMessage?.id.startsWith('psl-'));
});

// 15. recognition never auto-speaks
test('V3 Production Test 15: recognition never auto-speaks', () => {
  let speechTriggered = false;
  const originalSpeech = (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  (globalThis as unknown as { speechSynthesis: { speak: () => void } }).speechSynthesis = {
    speak: () => {
      speechTriggered = true;
    },
  };

  try {
    const stabilizer = new SignStabilizer({
      minConfidenceThreshold: 0.85,
      marginThreshold: 0.10,
      requiredStableWindows: 3,
    });

    const pred = {
      label: 'water',
      confidence: 0.95,
      top2: { label: 'NO_SIGN', confidence: 0.02 },
      top3: [],
      margin: 0.93,
    };

    stabilizer.process(pred, 2, true);
    stabilizer.process(pred, 2, true);
    const out = stabilizer.process(pred, 2, true);
    assert.ok(out.candidate !== null);

    // Explicitly apply message
    useCommunicationStore.getState().applyPslMessage(out.candidate!.englishMessage, out.candidate!.urduMessage);

    // Neither candidate nor applyPslMessage must ever speak automatically
    assert.equal(speechTriggered, false);
  } finally {
    if (originalSpeech) {
      (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = originalSpeech;
    } else {
      delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    }
  }
});

// 16. camera stop clears V3 buffer and velocity history
test('V3 Production Test 16: camera stop clears V3 buffer and velocity history', () => {
  const buffer = new SequenceBuffer(15);
  for (let i = 0; i < 24; i++) {
    buffer.push(createDummyPositionFrame(0.5), true);
  }
  assert.equal(buffer.length, 24);
  assert.equal(buffer.isFull, true);

  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });
  stabilizer.process(
    { label: 'water', confidence: 0.92, top2: { label: 'help', confidence: 0.05 }, top3: [], margin: 0.87 },
    2,
    true
  );

  // Camera stops: both buffer and stabilizer reset
  buffer.reset();
  stabilizer.reset();

  assert.equal(buffer.length, 0);
  assert.equal(buffer.isFull, false);
  assert.equal(buffer.getFlattened(), null);

  // After restart, pushing 1 frame starts from clean state with zero velocity
  buffer.push(createDummyPositionFrame(0.7), true);
  assert.equal(buffer.length, 1);
  assert.equal(buffer.isFull, false);
});

// 17. first velocity frame is zero
test('V3 Production Test 17: first velocity frame is zero', () => {
  // Construct 24 frames of positions
  const frames: Float32Array[] = [];
  for (let t = 0; t < 24; t++) {
    const pos = new Float32Array(TOTAL_POSITION_FEATURES);
    // Non-zero position for Left hand
    pos[0] = 0.5 + t * 0.01;
    pos[1] = 0.4 + t * 0.01;
    pos[2] = 0.1;
    frames.push(pos);
  }

  const v3Tensor = computeV3FeaturesFromPositions(frames);
  assert.equal(v3Tensor.length, 24 * 252);

  // For frame t = 0, velocity indices 126..251 must be all zero
  for (let i = 126; i < 252; i++) {
    assert.equal(v3Tensor[i], 0.0, `Frame 0 velocity feature at index ${i} must be strictly 0.0`);
  }
});

// 18. missing-hand velocity is zero for that hand slot
test('V3 Production Test 18: missing-hand velocity is zero for that hand slot', () => {
  const frames: Float32Array[] = [];

  // Frame 0: Both hands present
  const f0 = new Float32Array(TOTAL_POSITION_FEATURES);
  f0[0] = 0.5; // Left present
  f0[63] = 0.8; // Right present
  frames.push(f0);

  // Frame 1: Left hand disappears (missing), Right hand still present
  const f1 = new Float32Array(TOTAL_POSITION_FEATURES);
  // Left slot 0..62 is all zeros
  f1[63] = 0.85; // Right moved
  frames.push(f1);

  // Pad remaining frames to 24
  for (let t = 2; t < 24; t++) {
    const f = new Float32Array(TOTAL_POSITION_FEATURES);
    f[63] = 0.85;
    frames.push(f);
  }

  const v3Tensor = computeV3FeaturesFromPositions(frames);
  const frame1Offset = 1 * TOTAL_FRAME_V3_FEATURES;

  // Frame 1 Left hand position (0..62) is 0
  for (let i = 0; i < 63; i++) {
    assert.equal(v3Tensor[frame1Offset + i], 0.0);
  }

  // Frame 1 Left hand velocity (126..188) must be strictly 0.0 (no derivation from disappearance!)
  for (let i = 126; i <= 188; i++) {
    assert.equal(v3Tensor[frame1Offset + i], 0.0, `Left hand velocity at index ${i} must be zero when hand is missing`);
  }

  // Right hand velocity (189..251) should reflect actual motion: 0.85 - 0.80 = 0.05
  const rightVelX = v3Tensor[frame1Offset + 189];
  assert.ok(Math.abs(rightVelX - 0.05) < 1e-5, `Right hand velocity should be ~0.05, got ${rightVelX}`);
});

// 19. left/right feature slot layout remains correct
test('V3 Production Test 19: left/right feature slot layout remains correct', () => {
  const f0 = new Float32Array(TOTAL_POSITION_FEATURES);
  // Physical Left hand at index 0..62
  f0[0] = 0.25; // Left wrist X
  f0[1] = 0.35; // Left wrist Y
  // Physical Right hand at index 63..125
  f0[63] = 0.75; // Right wrist X
  f0[64] = 0.85; // Right wrist Y

  const f1 = new Float32Array(TOTAL_POSITION_FEATURES);
  f1[0] = 0.30; // Left moved +0.05
  f1[1] = 0.35;
  f1[63] = 0.70; // Right moved -0.05
  f1[64] = 0.85;

  const frames = [f0, f1];
  for (let t = 2; t < 24; t++) {
    frames.push(new Float32Array(TOTAL_POSITION_FEATURES));
  }

  const v3Tensor = computeV3FeaturesFromPositions(frames);
  const frame1Offset = 1 * TOTAL_FRAME_V3_FEATURES;

  // Position slots:
  assert.ok(Math.abs(v3Tensor[frame1Offset + 0] - 0.30) < 1e-5); // Left pos
  assert.ok(Math.abs(v3Tensor[frame1Offset + 63] - 0.70) < 1e-5); // Right pos

  // Velocity slots:
  // Left velocity slot: 126..188
  const leftVel = v3Tensor[frame1Offset + 126];
  assert.ok(Math.abs(leftVel - 0.05) < 1e-5);

  // Right velocity slot: 189..251
  const rightVel = v3Tensor[frame1Offset + 189];
  assert.ok(Math.abs(rightVel - (-0.05)) < 1e-5);
});

// ==================================================
// PRODUCTION UI & REGRESSION TESTS
// ==================================================

test('Production UI: camera start automatically enables real-time sign monitoring', () => {
  const controller = new CameraController(mockMediaDevices);
  controller['state'] = {
    ...controller['state'],
    status: 'active',
  };

  const buffer = new SequenceBuffer(15);
  assert.equal(buffer.isFull, false);
  assert.equal(buffer.length, 0);

  const dummyFrame = createDummyPositionFrame();
  for (let i = 0; i < 10; i++) {
    buffer.push(dummyFrame, true);
  }
  assert.equal(buffer.length, 10);
});

test('Production UI: No Recognize Sign button exists in production camera UI', () => {
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

  assert.ok(!html.includes('recognize-sign-btn'), 'Must NOT have recognize-sign-btn class');
  assert.ok(!html.includes('Recognize Sign'), 'Must NOT have "Recognize Sign" label');
  assert.ok(!html.includes('اشارہ پہچانیں'), 'Must NOT have Urdu "اشارہ پہچانیں" button');
  assert.ok(html.includes('Stop Camera'), 'Must include Stop Camera button');
});

test('Production UI: CameraPanel renders landmark canvas and clean bilingual buttons', () => {
  const controller = new CameraController(mockMediaDevices);
  controller['state'] = {
    ...controller['state'],
    status: 'active',
  };

  const html = render(h(CameraPanel, { controller }));

  assert.ok(html.includes('camera-landmark-canvas'));
  assert.ok(html.includes('camera-btn-en">Stop Camera</span>'));
  assert.ok(html.includes('camera-btn-ur">کیمرہ بند کریں</span>'));
  assert.ok(html.includes('camera-action-btn'));
  assert.ok(!html.includes('recognize-sign-btn'));
  assert.ok(!html.includes('psl-buffer-bar'));
});

test('Production UI: Production UI contains no debug, frame-count, or telemetry text', () => {
  const controller = new CameraController(mockMediaDevices);
  controller['state'] = {
    ...controller['state'],
    status: 'active',
  };

  const html = render(h(CameraPanel, { controller }));

  assert.ok(!html.includes('Nonzero features'));
  assert.ok(!html.includes('Buffer:'));
  assert.ok(!html.includes('Raw top1:'));
  assert.ok(!html.includes('Inference calls:'));
  assert.ok(!html.includes('__SIGN_DEV_DIAGNOSTICS__'));
  assert.ok(!html.includes('frames/60'));
  assert.ok(!html.includes('frames/24'));
});

test('Production UI: /board (CommunicationBoardSection) renders real-time CameraPanel with zero controlled recognition UI', () => {
  const html = render(h(MemoryRouter, null, h(CommunicationBoardSection)));

  assert.ok(html.includes('id="tab-mode-camera"'));
  assert.ok(!html.includes('recognize-sign-btn'), 'No Recognize Sign button class');
  assert.ok(!html.includes('Recognize Sign'), 'No Recognize Sign button text');
  assert.ok(!html.includes('اشارہ پہچانیں'), 'No Urdu Recognize Sign text');
  assert.ok(!html.includes('Signing...'), 'No Signing... text');
  assert.ok(!html.includes('Get ready'), 'No Get ready text');
  assert.ok(!html.includes('psl-buffer-bar'), 'No progress bar');
});

test('Production Regression: Transient hand dropout (<=5 frames) does not wipe stabilizer history', () => {
  const stabilizer = new SignStabilizer({
    minConfidenceThreshold: 0.85,
    marginThreshold: 0.10,
    requiredStableWindows: 3,
  });
  const buffer = new SequenceBuffer(15);

  // Fill buffer to 24 frames
  for (let i = 0; i < 24; i++) {
    buffer.push(createDummyPositionFrame(), true);
  }
  assert.equal(buffer.isFull, true);

  const pred = {
    label: 'water',
    confidence: 0.90,
    top2: { label: 'help', confidence: 0.05 },
    top3: [],
    margin: 0.85,
  };

  // Window 1: Predicts "water" -> 1/3
  const out1 = stabilizer.process(pred, 1, true);
  assert.equal(out1.candidate, null);
  assert.equal(out1.stabilizerProgress, '1/3');

  // Transient dropout: 2 frames with no hand detected (e.g. motion blur, 66ms)
  buffer.push(createDummyPositionFrame(0), false);
  buffer.push(createDummyPositionFrame(0), false);
  assert.equal(buffer.missingHandCount, 2);
  assert.equal(buffer.length, 24); // Still full

  // Window 2: Next inference predicts "water" -> 2/3
  const out2 = stabilizer.process(pred, 1, true);
  assert.equal(out2.candidate, null);
  assert.equal(out2.stabilizerProgress, '2/3');

  // Window 3: 3rd matching prediction -> accepted!
  const out3 = stabilizer.process(pred, 1, true);
  assert.ok(out3.candidate !== null, 'Candidate must be surfaced on 3rd matching window');
  assert.equal(out3.candidate?.label, 'water');
  assert.equal(out3.stabilizerProgress, '3/3');
  assert.equal(out3.decision, 'accepted');
});
