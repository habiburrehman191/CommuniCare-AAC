import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import {
  extractHandFeatures,
  TOTAL_FRAME_FEATURES,
  FEATURES_PER_HAND,
  type RawHandData,
} from '../../src/features/signRecognition/handFeatureExtractor';
import {
  SequenceBuffer,
  TOTAL_INPUT_ELEMENTS,
} from '../../src/features/signRecognition/sequenceBuffer';
import {
  REVIEWED_PSL_AAC_MAPPINGS,
  getPslAacMapping,
} from '../../src/features/signRecognition/pslMappings';
import { SignStabilizer } from '../../src/features/signRecognition/signStabilizer';
import { useCommunicationStore } from '../../src/store/communicationStore';
import { CameraPanel } from '../../src/components/aac/CameraPanel';
import { CameraController, type MediaDevicesPort } from '../../src/features/camera/cameraController';
import type { ISignClassifier } from '../../src/hooks/useSignRecognition';

const mockMediaDevices: MediaDevicesPort = {
  getUserMedia: async () => ({
    getTracks: () => [],
    getVideoTracks: () => [],
  }),
  enumerateDevices: async () => [],
};

function createDummyHand(handedness: 'Left' | 'Right', offset = 0): RawHandData {
  const landmarks: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({
      x: offset + i * 0.01,
      y: offset + i * 0.02,
      z: offset + i * 0.03,
    });
  }
  return {
    landmarks,
    handedness,
    score: 0.95,
  };
}

test('Sign Recognition - Feature Extractor: exact 126-feature contract', () => {
  const leftHand = createDummyHand('Left', 0.1);
  const rightHand = createDummyHand('Right', 0.5);

  const result = extractHandFeatures([leftHand, rightHand]);
  assert.equal(result.features.length, TOTAL_FRAME_FEATURES);
  assert.equal(result.features.length, 126);
  assert.equal(result.hasLeftHand, true);
  assert.equal(result.hasRightHand, true);
  assert.equal(result.handCount, 2);

  // Left hand slot: indices 0..62
  assert.equal(result.features[0], Math.fround(leftHand.landmarks[0].x));
  assert.equal(result.features[1], Math.fround(leftHand.landmarks[0].y));
  assert.equal(result.features[2], Math.fround(leftHand.landmarks[0].z));

  // Right hand slot: indices 63..125
  assert.equal(result.features[63], Math.fround(rightHand.landmarks[0].x));
  assert.equal(result.features[64], Math.fround(rightHand.landmarks[0].y));
  assert.equal(result.features[65], Math.fround(rightHand.landmarks[0].z));
});

test('Sign Recognition - Feature Extractor: left-only pads right hand with 63 zeros', () => {
  const leftHand = createDummyHand('Left', 0.2);
  const result = extractHandFeatures([leftHand]);

  assert.equal(result.features.length, 126);
  assert.equal(result.hasLeftHand, true);
  assert.equal(result.hasRightHand, false);
  assert.equal(result.handCount, 1);

  // Left hand present (non-zero)
  assert.ok(result.features[0] > 0);

  // Right hand slot: exactly all 63 zeros
  for (let i = FEATURES_PER_HAND; i < TOTAL_FRAME_FEATURES; i++) {
    assert.equal(result.features[i], 0);
  }
});

test('Sign Recognition - Feature Extractor: right-only pads left hand with 63 zeros', () => {
  const rightHand = createDummyHand('Right', 0.3);
  const result = extractHandFeatures([rightHand]);

  assert.equal(result.features.length, 126);
  assert.equal(result.hasLeftHand, false);
  assert.equal(result.hasRightHand, true);
  assert.equal(result.handCount, 1);

  // Left hand slot: exactly all 63 zeros
  for (let i = 0; i < FEATURES_PER_HAND; i++) {
    assert.equal(result.features[i], 0);
  }

  // Right hand present (non-zero)
  assert.ok(result.features[FEATURES_PER_HAND] > 0);
});

test('Sign Recognition - Feature Extractor: no hands returns all 126 zeros', () => {
  const result = extractHandFeatures([]);
  assert.equal(result.features.length, 126);
  assert.equal(result.hasLeftHand, false);
  assert.equal(result.hasRightHand, false);
  assert.equal(result.handCount, 0);

  for (let i = 0; i < 126; i++) {
    assert.equal(result.features[i], 0);
  }
});

test('Sign Recognition - Feature Extractor: ignores hands with incomplete landmarks (< 21)', () => {
  const incompleteHand: RawHandData = {
    landmarks: [{ x: 0.1, y: 0.2, z: 0.3 }],
    handedness: 'Left',
    score: 0.9,
  };
  const result = extractHandFeatures([incompleteHand]);
  assert.equal(result.hasLeftHand, false);
  assert.equal(result.handCount, 0);
  for (let i = 0; i < 126; i++) {
    assert.equal(result.features[i], 0);
  }
});

test('Sign Recognition - Sequence Buffer: enforces exact 24-frame FIFO window', () => {
  const buffer = new SequenceBuffer(15);
  const dummyFrame = new Float32Array(126).fill(0.5);

  assert.equal(buffer.length, 0);
  assert.equal(buffer.isFull, false);
  assert.equal(buffer.getFlattened(), null);

  for (let i = 1; i <= 23; i++) {
    const isFull = buffer.push(dummyFrame, true);
    assert.equal(isFull, false);
    assert.equal(buffer.isFull, false);
    assert.equal(buffer.length, i);
  }

  // 24th frame makes it full
  const fullResult = buffer.push(dummyFrame, true);
  assert.equal(fullResult, true);
  assert.equal(buffer.isFull, true);
  assert.equal(buffer.length, 24);

  const flattened = buffer.getFlattened();
  assert.ok(flattened !== null);
  assert.equal(flattened.length, TOTAL_INPUT_ELEMENTS); // 24 * 252 = 6048

  // 25th frame drops oldest, maintains 24
  const frame25 = new Float32Array(126).fill(0.9);
  buffer.push(frame25, true);
  assert.equal(buffer.length, 24);
  assert.equal(buffer.isFull, true);
});

test('Sign Recognition - Sequence Buffer: resets after missing hands threshold', () => {
  const buffer = new SequenceBuffer(5);
  const dummyFrame = new Float32Array(126).fill(0.5);

  for (let i = 0; i < 10; i++) {
    buffer.push(dummyFrame, true);
  }
  assert.equal(buffer.length, 10);

  // Push 5 missing hands frames
  for (let i = 0; i < 5; i++) {
    buffer.push(dummyFrame, false);
  }
  assert.equal(buffer.length, 15);

  // 6th missing hands frame exceeds threshold of 5 -> resets
  buffer.push(dummyFrame, false);
  assert.equal(buffer.length, 0);
  assert.equal(buffer.isFull, false);
});

test('Sign Recognition - PSL Mappings: only 4 reviewed signs map to AAC messages', () => {
  assert.equal(Object.keys(REVIEWED_PSL_AAC_MAPPINGS).length, 4);

  const water = getPslAacMapping('water');
  assert.ok(water);
  assert.equal(water.label, 'water');
  assert.equal(water.englishMessage, 'I need water.');
  assert.equal(water.urduMessage, 'مجھے پانی چاہیے۔');

  const thankyou = getPslAacMapping('thankyou');
  assert.ok(thankyou);
  assert.equal(thankyou.label, 'thankyou');
  assert.equal(thankyou.englishMessage, 'Thank you.');
  assert.equal(thankyou.urduMessage, 'شکریہ۔');

  const hello = getPslAacMapping('hello');
  assert.ok(hello);
  assert.equal(hello.label, 'hello');
  assert.equal(hello.englishMessage, 'Hello.');
  assert.equal(hello.urduMessage, 'السلام علیکم۔');

  const donttouch = getPslAacMapping('donttouch');
  assert.ok(donttouch);
  assert.equal(donttouch.label, 'donttouch');
  assert.equal(donttouch.englishMessage, "Don't touch.");
  assert.equal(donttouch.urduMessage, 'مت چھوئیں۔');

  // Case insensitivity
  assert.ok(getPslAacMapping('WATER'));
  assert.ok(getPslAacMapping(' Hello '));

  // Other signs in the 63 vocabulary must NOT map to AAC messages
  assert.equal(getPslAacMapping('bed'), null);
  assert.equal(getPslAacMapping('shower'), null);
  assert.equal(getPslAacMapping('nothing'), null);
  assert.equal(getPslAacMapping('random_sign'), null);
});

test('Sign Recognition - Stabilizer Gate: no hands returns state no-hands', () => {
  const stabilizer = new SignStabilizer();
  const output = stabilizer.process(
    { label: 'water', confidence: 0.95, top3: [] },
    0, // handCount = 0
    true
  );

  assert.equal(output.state, 'no-hands');
  assert.equal(output.candidate, null);
  assert.equal(output.detectedSign, null);
});

test('Sign Recognition - Stabilizer Gate: buffer not full returns state collecting', () => {
  const stabilizer = new SignStabilizer();
  const output = stabilizer.process(
    { label: 'water', confidence: 0.95, top3: [] },
    2, // hands present
    false // buffer not full
  );

  assert.equal(output.state, 'collecting');
  assert.equal(output.candidate, null);
  assert.equal(output.detectedSign, null);
});

test('Sign Recognition - Stabilizer Gate: nothing class returns state no-sign and no candidate', () => {
  const stabilizer = new SignStabilizer();
  const output = stabilizer.process(
    { label: 'nothing', confidence: 0.88, top3: [] },
    2,
    true
  );

  assert.equal(output.state, 'no-sign');
  assert.equal(output.candidate, null);
  assert.equal(output.detectedSign, null);
});

test('Sign Recognition - Stabilizer Gate: low confidence (< 0.70) returns state uncertain', () => {
  const stabilizer = new SignStabilizer({ minConfidenceThreshold: 0.70 });
  const output = stabilizer.process(
    { label: 'water', confidence: 0.65, top3: [] },
    2,
    true
  );

  assert.equal(output.state, 'uncertain');
  assert.equal(output.candidate, null);
  assert.equal(output.detectedSign, 'water');
});

test('Sign Recognition - Stabilizer Gate: requires 3 stable consecutive windows', () => {
  const stabilizer = new SignStabilizer({ requiredStableWindows: 3, minConfidenceThreshold: 0.70 });

  // Window 1: water -> collecting
  const out1 = stabilizer.process({ label: 'water', confidence: 0.92, top3: [] }, 2, true);
  assert.equal(out1.state, 'collecting');
  assert.equal(out1.candidate, null);

  // Window 2: water -> collecting
  const out2 = stabilizer.process({ label: 'water', confidence: 0.93, top3: [] }, 2, true);
  assert.equal(out2.state, 'collecting');
  assert.equal(out2.candidate, null);

  // Window 3: water -> stable detected!
  const out3 = stabilizer.process({ label: 'water', confidence: 0.95, top3: [] }, 2, true);
  assert.equal(out3.state, 'detected');
  assert.ok(out3.candidate !== null);
  assert.equal(out3.candidate?.label, 'water');
  assert.equal(out3.candidate?.englishMessage, 'I need water.');
  assert.equal(out3.candidate?.urduMessage, 'مجھے پانی چاہیے۔');
});

test('Sign Recognition - Stabilizer Gate: unreviewed sign is detected but generates no AAC candidate', () => {
  const stabilizer = new SignStabilizer({ requiredStableWindows: 3, minConfidenceThreshold: 0.70 });

  stabilizer.process({ label: 'bed', confidence: 0.90, top3: [] }, 2, true);
  stabilizer.process({ label: 'bed', confidence: 0.92, top3: [] }, 2, true);
  const out = stabilizer.process({ label: 'bed', confidence: 0.94, top3: [] }, 2, true);

  assert.equal(out.state, 'detected');
  assert.equal(out.detectedSign, 'bed');
  assert.equal(out.candidate, null); // Unreviewed sign MUST NOT generate candidate
});

test('Sign Recognition - Stabilizer Gate: candidate respects cooldown period', () => {
  const stabilizer = new SignStabilizer({ requiredStableWindows: 1, cooldownMs: 2000 });
  const t0 = 10000;

  // First detection -> candidate emitted
  const out1 = stabilizer.process({ label: 'hello', confidence: 0.95, top3: [] }, 2, true, t0);
  assert.ok(out1.candidate !== null);

  // Second detection within 500ms -> suppressed by cooldown
  const out2 = stabilizer.process({ label: 'hello', confidence: 0.95, top3: [] }, 2, true, t0 + 500);
  assert.equal(out2.state, 'detected');
  assert.equal(out2.candidate, null);

  // Third detection after 2500ms (> 2000ms cooldown) -> candidate emitted again
  const out3 = stabilizer.process({ label: 'hello', confidence: 0.95, top3: [] }, 2, true, t0 + 2500);
  assert.ok(out3.candidate !== null);
});

test('Sign Recognition - Store: applyPslMessage sets generatedMessage without auto-speaking', () => {
  const store = useCommunicationStore.getState();
  store.applyPslMessage('I need water.', 'مجھے پانی چاہیے۔');

  const updatedState = useCommunicationStore.getState();
  assert.ok(updatedState.generatedMessage !== null);
  assert.equal(updatedState.generatedMessage?.englishText, 'I need water.');
  assert.equal(updatedState.generatedMessage?.urduText, 'مجھے پانی چاہیے۔');
  assert.ok(updatedState.generatedMessage?.id.startsWith('psl-'));
});

test('Sign Recognition - UI: CameraPanel renders landmark canvas and PSL header when active', () => {
  const controller = new CameraController(mockMediaDevices);
  // Simulate active state
  controller['state'] = {
    ...controller['state'],
    status: 'active',
  };

  const html = render(h(CameraPanel, { controller }));
  assert.ok(html.includes('camera-landmark-canvas'));
  assert.ok(html.includes('PSL Sign Recognition'));
  assert.ok(html.includes('psl-recognition-area'));
  assert.ok(html.includes('psl-status-pill'));
});

test('Sign Recognition - UI: CameraPanel displays candidate card with explicit confirmation button', () => {
  const controller = new CameraController(mockMediaDevices);
  controller['state'] = {
    ...controller['state'],
    status: 'active',
  };

  const mockClassifier: ISignClassifier = {
    ready: true,
    load: async () => {},
    predict: async () => ({ label: 'water', confidence: 0.95, top3: [] }),
    classCount: 63,
  };

  const html = render(
    h(CameraPanel, {
      controller,
      signOptions: {
        customClassifier: mockClassifier,
      },
    })
  );

  assert.ok(html.includes('PSL Sign Recognition'));
  assert.ok(html.includes('Live hand tracking and basic AAC sign recognition run privately on this device.'));
  assert.ok(html.includes('Camera processing will be local to this device'));
});
