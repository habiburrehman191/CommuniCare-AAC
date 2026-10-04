import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  extractHandFeatures,
  type RawHandData,
} from '../../src/features/signRecognition/handFeatureExtractor';
import { OnnxSignClassifier } from '../../src/features/signRecognition/onnxSignClassifier';
import { SignStabilizer } from '../../src/features/signRecognition/signStabilizer';
import {
  getPslAacMapping,
} from '../../src/features/signRecognition/pslMappings';
import { useCommunicationStore } from '../../src/store/communicationStore';
import { defaultStoredState } from '../../src/lib/storage';
import { emergencyPhrases } from '../../src/data/phrases';
import { emergencyMessage } from '../../src/features/communication/emergencySpeech';

beforeEach(() => {
  useCommunicationStore.getState().initFromStoredState(defaultStoredState);
  useCommunicationStore.getState().clearSelection();
});

function createMockHand(
  handedness: 'Left' | 'Right',
  wristX = 0.5,
  wristY = 0.5,
  wristZ = 0.0
): RawHandData {
  const landmarks: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({
      x: wristX + (i === 9 ? 0.1 : i * 0.005),
      y: wristY + (i === 9 ? 0.1 : i * 0.005),
      z: wristZ,
    });
  }
  return { landmarks, handedness, score: 0.95 };
}

// A. Model loads correct labels
test('Phase 2E - Requirement A: model loads correct frozen 8 labels in exact order', async () => {
  const labelsPath = join(
    process.cwd(),
    'public',
    'models',
    'communicare-aac-sign-v1',
    'labels.json'
  );
  const raw = await readFile(labelsPath, 'utf8');
  const labels = JSON.parse(raw) as string[];

  const expectedLabels = [
    'water',
    'help',
    'hungry',
    'need',
    'want',
    'hello',
    'thankyou',
    'NO_SIGN',
  ];

  assert.equal(labels.length, 8);
  assert.deepEqual(labels, expectedLabels);

  // Verify classifier can load V1 labels from file when configured
  const classifier = new OnnxSignClassifier({
    modelPath: '/models/communicare-aac-sign-v1/model.onnx',
    labelsPath: '/models/communicare-aac-sign-v1/labels.json',
  });
  // Specified paths point to communicare-aac-sign-v1
  assert.match(classifier['modelPath'], /communicare-aac-sign-v1/);
  assert.match(classifier['labelsPath'], /communicare-aac-sign-v1/);
});

// B. Input is exactly [1, 60, 126]
test('Phase 2E - Requirement B: input tensor shape is exactly [1, 60, 126] float32', async () => {
  const schemaPath = join(
    process.cwd(),
    'public',
    'models',
    'communicare-aac-sign-v1',
    'feature-schema.json'
  );
  const raw = await readFile(schemaPath, 'utf8');
  const schema = JSON.parse(raw);

  assert.equal(schema.schemaName, 'wrist_normalized_v1');
  assert.equal(schema.sequenceLength, 60);
  assert.equal(schema.featuresPerFrame, 126);
  assert.equal(schema.inputDtype, 'float32');
  assert.equal(schema.leftHandSlot, '0-62');
  assert.equal(schema.rightHandSlot, '63-125');

  // Verify metadata contract
  const metadataPath = join(
    process.cwd(),
    'public',
    'models',
    'communicare-aac-sign-v1',
    'model-metadata.json'
  );
  const metaRaw = await readFile(metadataPath, 'utf8');
  const meta = JSON.parse(metaRaw);
  assert.deepEqual(meta.inputShape, [1, 60, 126]);
  assert.deepEqual(meta.outputShape, [1, 8]);
  assert.equal(meta.architecture, 'GRU');
});

// C. NO_SIGN never creates candidate
test('Phase 2E - Requirement C: NO_SIGN never creates candidate or generates message', () => {
  const stabilizer = new SignStabilizer({ minConfidenceThreshold: 0.70 });

  // Simulate multiple consecutive high-confidence NO_SIGN windows
  for (let i = 0; i < 5; i++) {
    const out = stabilizer.process(
      { label: 'NO_SIGN', confidence: 0.99, top3: [{ label: 'NO_SIGN', confidence: 0.99 }] },
      2,
      true
    );
    assert.equal(out.state, 'no-sign');
    assert.equal(out.candidate, null);
    assert.equal(out.detectedSign, null);
  }

  // Also case-insensitive check
  const outLower = stabilizer.process(
    { label: 'no_sign', confidence: 0.95, top3: [] },
    2,
    true
  );
  assert.equal(outLower.state, 'no-sign');
  assert.equal(outLower.candidate, null);

  // Verify mapping is null
  assert.equal(getPslAacMapping('NO_SIGN'), null);
  assert.equal(getPslAacMapping('no_sign'), null);

  // Store message remains unchanged
  assert.equal(useCommunicationStore.getState().generatedMessage, null);
});

// D. Low-confidence result rejected
test('Phase 2E - Requirement D: low-confidence predictions (< 0.70) are rejected as uncertain', () => {
  const stabilizer = new SignStabilizer({ minConfidenceThreshold: 0.70 });

  // 65% confidence on water -> rejected as uncertain
  const out = stabilizer.process(
    { label: 'water', confidence: 0.65, top3: [] },
    2,
    true
  );

  assert.equal(out.state, 'uncertain');
  assert.equal(out.candidate, null);
  assert.equal(out.detectedSign, 'water');
});

// E. Unstable predictions rejected
test('Phase 2E - Requirement E: unstable alternating predictions do not surface candidates', () => {
  const stabilizer = new SignStabilizer({ requiredStableWindows: 3, minConfidenceThreshold: 0.70 });

  // Alternating between water and help
  const out1 = stabilizer.process({ label: 'water', confidence: 0.90, top3: [] }, 2, true);
  assert.equal(out1.candidate, null);

  const out2 = stabilizer.process({ label: 'help', confidence: 0.92, top3: [] }, 2, true);
  assert.equal(out2.candidate, null);

  const out3 = stabilizer.process({ label: 'water', confidence: 0.91, top3: [] }, 2, true);
  assert.equal(out3.candidate, null);

  const out4 = stabilizer.process({ label: 'hello', confidence: 0.93, top3: [] }, 2, true);
  assert.equal(out4.candidate, null);
  assert.equal(out4.state, 'collecting');
});

// F. Stable sign becomes candidate only
test('Phase 2E - Requirement F: 3 consecutive stable predictions surface a candidate with canonical bilingual text', () => {
  const stabilizer = new SignStabilizer({ requiredStableWindows: 3, minConfidenceThreshold: 0.70 });

  stabilizer.process({ label: 'help', confidence: 0.91, top3: [] }, 2, true);
  stabilizer.process({ label: 'help', confidence: 0.93, top3: [] }, 2, true);
  const out3 = stabilizer.process({ label: 'help', confidence: 0.95, top3: [] }, 2, true);

  assert.equal(out3.state, 'detected');
  assert.ok(out3.candidate !== null);
  assert.equal(out3.candidate?.label, 'help');
  assert.equal(out3.candidate?.englishMessage, 'I need help now.');
  assert.equal(out3.candidate?.urduMessage, 'مجھے ابھی مدد چاہیے۔');
  assert.equal(out3.detectedSign, 'help');
});

// G. Candidate does not automatically update generatedMessage
test('Phase 2E - Requirement G: surfacing a candidate does NOT update generatedMessage in store', () => {
  const stabilizer = new SignStabilizer({ requiredStableWindows: 1, minConfidenceThreshold: 0.70 });

  const out = stabilizer.process({ label: 'hungry', confidence: 0.95, top3: [] }, 2, true);
  assert.ok(out.candidate !== null);

  // Store must still have null generatedMessage
  const storeState = useCommunicationStore.getState();
  assert.equal(storeState.generatedMessage, null);
});

// H. Use this message explicitly updates AAC message
test('Phase 2E - Requirement H: explicit applyPslMessage creates generatedMessage with psl- prefix', () => {
  const mapping = getPslAacMapping('hungry');
  assert.ok(mapping !== null);

  useCommunicationStore.getState().applyPslMessage(mapping.englishMessage, mapping.urduMessage);

  const updatedState = useCommunicationStore.getState();
  assert.ok(updatedState.generatedMessage !== null);
  assert.equal(updatedState.generatedMessage?.englishText, 'I need food.');
  assert.equal(updatedState.generatedMessage?.urduText, 'مجھے کھانا چاہیے۔');
  assert.ok(updatedState.generatedMessage?.id.startsWith('psl-'));
  assert.equal(updatedState.generatedMessage?.mode, 'sentence');
});

// I. No automatic speech
test('Phase 2E - Requirement I: candidate surfacing and message application do not trigger speech', () => {
  let speechTriggered = false;
  const originalSpeech = (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  (globalThis as unknown as { speechSynthesis: { speak: () => void } }).speechSynthesis = {
    speak: () => {
      speechTriggered = true;
    },
  };

  try {
    const stabilizer = new SignStabilizer({ requiredStableWindows: 1 });
    const out = stabilizer.process({ label: 'water', confidence: 0.95, top3: [] }, 2, true);
    assert.ok(out.candidate !== null);

    // Apply message
    useCommunicationStore.getState().applyPslMessage(out.candidate!.englishMessage, out.candidate!.urduMessage);

    assert.equal(speechTriggered, false);
  } finally {
    if (originalSpeech) {
      (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = originalSpeech;
    } else {
      delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    }
  }
});

// J. SOS unaffected
test('Phase 2E - Requirement J: SOS remains local and independent', () => {
  assert.equal(emergencyPhrases.length, 3);
  const helpMsg = emergencyMessage('emergency-help');
  assert.ok(helpMsg);
  assert.equal(helpMsg.englishText, 'I need help now.');
  assert.equal(helpMsg.urduText, 'مجھے ابھی مدد چاہیے۔');
});

// K. Left/right normalized slots unchanged
test('Phase 2E - Requirement K: wrist_normalized_v1 slot ordering and math remain exact', () => {
  const leftHand = createMockHand('Left', 0.4, 0.4, 0.0);
  const rightHand = createMockHand('Right', 0.6, 0.6, 0.0);

  const result = extractHandFeatures([leftHand, rightHand], {
    cameraFacing: 'user',
    normalize: true,
  });

  assert.equal(result.features.length, 126);
  assert.equal(result.hasLeftHand, true);
  assert.equal(result.hasRightHand, true);

  // Left hand wrist is landmark 0 at index 0, 1, 2 -> normalized to (0, 0, 0)
  assert.equal(result.features[0], 0);
  assert.equal(result.features[1], 0);
  assert.equal(result.features[2], 0);

  // Right hand wrist is landmark 0 at index 63, 64, 65 -> normalized to (0, 0, 0)
  assert.equal(result.features[63], 0);
  assert.equal(result.features[64], 0);
  assert.equal(result.features[65], 0);

  // Absent hand test: right-only sets left slot (0..62) to all zeros
  const rightOnlyResult = extractHandFeatures([rightHand], {
    cameraFacing: 'user',
    normalize: true,
  });
  for (let i = 0; i < 63; i++) {
    assert.equal(rightOnlyResult.features[i], 0);
  }
});

// L. Old 63-class inference is not used
test('Phase 2E - Requirement L: 8-class model is configurable and old 63-class inference is not used', () => {
  const classifier = new OnnxSignClassifier({
    modelPath: '/models/communicare-aac-sign-v1/model.onnx',
    labelsPath: '/models/communicare-aac-sign-v1/labels.json',
  });
  assert.equal(classifier['modelPath'], '/models/communicare-aac-sign-v1/model.onnx');
  assert.equal(classifier['labelsPath'], '/models/communicare-aac-sign-v1/labels.json');

  // Verify all 7 CommuniCare signs map to verified sentences
  const expectedSigns = ['water', 'help', 'hungry', 'need', 'want', 'hello', 'thankyou'];
  for (const sign of expectedSigns) {
    const mapping = getPslAacMapping(sign);
    assert.ok(mapping !== null, `Expected mapping for ${sign}`);
    assert.ok(mapping.englishMessage.length > 0);
    assert.ok(mapping.urduMessage.length > 0);
  }

  // Verify old unreviewed signs from 63-class model are rejected
  assert.equal(getPslAacMapping('bed'), null);
  assert.equal(getPslAacMapping('shower'), null);
  assert.equal(getPslAacMapping('nothing'), null);
});

// M. Model load failure does not break other AAC functionality
test('Phase 2E - Requirement M: model load failure leaves AAC board, symbols, and store fully usable', async () => {
  // Test that failing classifier or network failure does not crash store
  const brokenClassifier = new OnnxSignClassifier({
    modelPath: '/invalid/nonexistent-model.onnx',
    labelsPath: '/invalid/nonexistent-labels.json',
  });

  await assert.rejects(async () => {
    await brokenClassifier.load();
  });

  // Verify full AAC store operations proceed normally
  const store = useCommunicationStore.getState();
  assert.equal(store.selectedSymbols.length, 0);

  // Symbol selection works
  store.selectSymbol({
    id: 'food-water',
    category: 'Food and Drink',
    labelEnglish: 'Water',
    labelUrdu: 'پانی',
    sentenceEnglish: 'I need water.',
    sentenceUrdu: 'مجھے پانی چاہیے۔',
    iconName: 'Droplets',
    favorite: true,
    emergency: false,
    quickAccess: true,
    usageCount: 0,
  });

  const stateAfterSelect = useCommunicationStore.getState();
  assert.equal(stateAfterSelect.selectedSymbols.length, 1);
  assert.equal(stateAfterSelect.selectedSymbols[0].phraseId, 'food-water');

  // Exact confirmation works
  store.setCommunicationText('Hello friend');
  store.confirmExactText('en');
  const stateAfterExact = useCommunicationStore.getState();
  assert.equal(stateAfterExact.generatedMessage?.englishText, 'Hello friend');
});
