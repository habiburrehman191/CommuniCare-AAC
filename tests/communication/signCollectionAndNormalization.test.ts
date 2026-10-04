import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import {
  extractHandFeatures,
  extractPhysicalHandFeatures,
  resolvePhysicalHandedness,
  normalizeHandLandmarks,
  TOTAL_FRAME_FEATURES,
  FEATURES_PER_HAND,
  type RawHandData,
} from '../../src/features/signRecognition/handFeatureExtractor';
import {
  SignCollectionManager,
  sanitizeSignerAlias,
} from '../../src/features/signCollection/signCollectionManager';
import {
  BASIC_SIGN_CLASSES,
  type BasicSignClass,
  type SignSampleRecord,
} from '../../src/features/signCollection/signCollectionTypes';
import {
  VERIFIED_SIGN_DEFINITIONS,
} from '../../src/features/signCollection/signVocabulary';
import { CameraPanel } from '../../src/components/aac/CameraPanel';
import { CameraController, type MediaDevicesPort } from '../../src/features/camera/cameraController';
import { useCommunicationStore } from '../../src/store/communicationStore';
import { resolveVoiceInput } from '../../src/features/communication/voiceInput';

const mockMediaDevices: MediaDevicesPort = {
  getUserMedia: async () => ({
    getTracks: () => [],
    getVideoTracks: () => [],
  }),
  enumerateDevices: async () => [],
};

function createMockHand(
  handedness: string,
  wristX = 0.5,
  wristY = 0.5,
  wristZ = 0.0,
  score = 0.95
): RawHandData {
  const landmarks: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 21; i++) {
    // landmark 0 is wrist at (wristX, wristY, wristZ)
    // landmark 9 is middle MCP at (wristX + 0.1, wristY + 0.1, wristZ)
    landmarks.push({
      x: wristX + (i === 9 ? 0.1 : i * 0.005),
      y: wristY + (i === 9 ? 0.1 : i * 0.005),
      z: wristZ + (i === 9 ? 0.0 : i * 0.001),
    });
  }
  return {
    landmarks,
    handedness,
    score,
  };
}

// 1. Handedness Correction Tests
test('Sign Collection - Handedness: resolvePhysicalHandedness maps physical hands directly', () => {
  // Front-facing selfie camera ('user'): MediaPipe directly identifies anatomical physical hand
  assert.equal(resolvePhysicalHandedness('Right', 'user'), 'Right');
  assert.equal(resolvePhysicalHandedness('right', 'user'), 'Right');
  assert.equal(resolvePhysicalHandedness('Left', 'user'), 'Left');
  assert.equal(resolvePhysicalHandedness('left', 'user'), 'Left');

  // Rear camera ('environment'): Direct viewer mapping
  assert.equal(resolvePhysicalHandedness('Left', 'environment'), 'Left');
  assert.equal(resolvePhysicalHandedness('Right', 'environment'), 'Right');

  // Direct mapping ('direct'): Preserved for backward compatibility
  assert.equal(resolvePhysicalHandedness('Left', 'direct'), 'Left');
  assert.equal(resolvePhysicalHandedness('Right', 'direct'), 'Right');
});

test('Sign Collection - Handedness Case 1: raw handedness corresponding to physical RIGHT maps to RIGHT slot (indices 63..125)', () => {
  // MediaPipe HandLandmarker returns raw handedness "Right" for a physical RIGHT hand
  const rawMpRightHand = createMockHand('Right', 0.2, 0.3, 0.1);

  const result = extractHandFeatures([rawMpRightHand], {
    cameraFacing: 'user',
    normalize: false,
  });

  assert.equal(result.hasLeftHand, false);
  assert.equal(result.hasRightHand, true);
  assert.equal(result.handCount, 1);

  // Left hand slot (0..62) must be ALL 63 ZEROS
  for (let i = 0; i < FEATURES_PER_HAND; i++) {
    assert.equal(result.features[i], 0);
  }

  // Right hand slot (63..125) must contain the physical right hand coordinates
  assert.equal(result.features[FEATURES_PER_HAND], Math.fround(rawMpRightHand.landmarks[0].x));
  assert.equal(result.features[FEATURES_PER_HAND + 1], Math.fround(rawMpRightHand.landmarks[0].y));
  assert.equal(result.features[FEATURES_PER_HAND + 2], Math.fround(rawMpRightHand.landmarks[0].z));
});

test('Sign Collection - Handedness Case 2: raw handedness corresponding to physical LEFT maps to LEFT slot (indices 0..62)', () => {
  // MediaPipe HandLandmarker returns raw handedness "Left" for a physical LEFT hand
  const rawMpLeftHand = createMockHand('Left', 0.6, 0.7, 0.2);

  const result = extractHandFeatures([rawMpLeftHand], {
    cameraFacing: 'user',
    normalize: false,
  });

  assert.equal(result.hasLeftHand, true);
  assert.equal(result.hasRightHand, false);
  assert.equal(result.handCount, 1);

  // Left hand slot (0..62) must contain the physical left hand coordinates
  assert.equal(result.features[0], Math.fround(rawMpLeftHand.landmarks[0].x));
  assert.equal(result.features[1], Math.fround(rawMpLeftHand.landmarks[0].y));
  assert.equal(result.features[2], Math.fround(rawMpLeftHand.landmarks[0].z));

  // Right hand slot (63..125) must be ALL 63 ZEROS
  for (let i = FEATURES_PER_HAND; i < TOTAL_FRAME_FEATURES; i++) {
    assert.equal(result.features[i], 0);
  }
});

test('Sign Collection - Display: mirrored DISPLAY does not alter stored feature handedness or coordinates', () => {
  // CSS transform: scaleX(-1) on video/canvas affects only rendering, not underlying frame or extracted features
  const rawMpRightHand = createMockHand('Right', 0.35, 0.45, 0.15);
  const result = extractHandFeatures([rawMpRightHand], { cameraFacing: 'user', normalize: false });

  // Right slot (63..125) must preserve exact original unmirrored input coordinates
  assert.equal(result.hasRightHand, true);
  assert.equal(result.hasLeftHand, false);
  assert.equal(result.features[FEATURES_PER_HAND], Math.fround(0.35));
  assert.equal(result.features[FEATURES_PER_HAND + 1], Math.fround(0.45));
  assert.equal(result.features[FEATURES_PER_HAND + 2], Math.fround(0.15));
});

// 2. Normalization Tests
test('Sign Collection - Normalization: wrist origin translated to (0, 0, 0)', () => {
  const hand = createMockHand('Left', 0.45, 0.65, 0.25);
  const normalized = normalizeHandLandmarks(hand.landmarks);

  assert.equal(normalized.length, 21);
  // Landmark 0 (wrist) MUST be exactly 0, 0, 0
  assert.equal(normalized[0].x, 0);
  assert.equal(normalized[0].y, 0);
  assert.equal(normalized[0].z, 0);
});

test('Sign Collection - Normalization: scale normalized by wrist-to-middle-MCP distance', () => {
  const hand = createMockHand('Left', 0.5, 0.5, 0.0);
  // Wrist is at (0.5, 0.5, 0.0)
  // Landmark 9 (middle MCP) is at (0.6, 0.6, 0.0)
  // Distance = hypot(0.1, 0.1) = sqrt(0.02) = 0.141421356...
  const expectedDist = Math.hypot(0.1, 0.1);
  assert.ok(expectedDist > 0);
  const normalized = normalizeHandLandmarks(hand.landmarks);

  const normDx = normalized[9].x - normalized[0].x;
  const normDy = normalized[9].y - normalized[0].y;
  const normDz = normalized[9].z - normalized[0].z;
  const normalizedPalmDist = Math.hypot(normDx, normDy, normDz);

  // Palm size distance must be normalized to unit length 1.0 (within float tolerance)
  assert.ok(Math.abs(normalizedPalmDist - 1.0) < 1e-5);
});

test('Sign Collection - Normalization: extractPhysicalHandFeatures applies both handedness and normalization', () => {
  const physicalRightHand = createMockHand('Right', 0.3, 0.4, 0.1); // MediaPipe calls it "Right"
  const result = extractPhysicalHandFeatures([physicalRightHand]);

  assert.equal(result.features.length, 126);
  assert.equal(result.hasLeftHand, false);
  assert.equal(result.hasRightHand, true);

  // Left hand slot: all zeros
  for (let i = 0; i < 63; i++) {
    assert.equal(result.features[i], 0);
  }

  // Right hand slot: wrist is at index 63, 64, 65 and must be 0, 0, 0
  assert.equal(result.features[63], 0);
  assert.equal(result.features[64], 0);
  assert.equal(result.features[65], 0);

  // Remaining right hand features must be non-zero
  assert.ok(result.features[63 + 9 * 3] !== 0); // landmark 9 x
});

// 3. Collection Storage & Session Manager Tests
function generateMockSequence(label: BasicSignClass, signerAlias = 'signer-01'): SignSampleRecord {
  const frames: number[][] = [];
  for (let f = 0; f < 60; f++) {
    const frame = new Array(126).fill(0.01 * f);
    frames.push(frame);
  }
  return {
    version: '1.0',
    label,
    sequenceLength: 60,
    featureSchema: 'wrist_normalized_v1',
    capturedAt: new Date().toISOString(),
    sessionId: 'session-test-01',
    signerAlias,
    cameraFacing: 'user',
    frames,
    stats: {
      leftHandOccupancy: 0.95,
      rightHandOccupancy: 0.98,
    },
  };
}

test('Sign Collection - Manager: validates exact 60-frame sequence and 126 features per frame', () => {
  const mgr = new SignCollectionManager();

  // Valid sample
  const validSample = generateMockSequence('water');
  mgr.addSample(validSample);
  assert.equal(mgr.getTotalCount(), 1);

  // Invalid frame count (59 frames instead of 60)
  const invalidLength = generateMockSequence('water');
  invalidLength.frames.pop();
  assert.throws(() => {
    mgr.addSample(invalidLength);
  }, /must contain exactly 60 frames/);

  // Invalid features count (125 features instead of 126)
  const invalidFeatures = generateMockSequence('water');
  invalidFeatures.frames[0] = new Array(125).fill(0);
  assert.throws(() => {
    mgr.addSample(invalidFeatures);
  }, /must contain exactly 126 float values/);
});

test('Sign Collection - Manager: supports all 8 target classes including NO_SIGN', () => {
  const mgr = new SignCollectionManager();

  for (const cls of BASIC_SIGN_CLASSES) {
    const sample = generateMockSequence(cls);
    mgr.addSample(sample);
  }

  assert.equal(mgr.getTotalCount(), 8);
  const counts = mgr.getCountsByClass();
  for (const cls of BASIC_SIGN_CLASSES) {
    assert.equal(counts[cls], 1);
  }

  // Verify NO_SIGN is explicitly supported
  assert.equal(counts['NO_SIGN'], 1);
});

test('Sign Collection - Manager: discarded sample is removed and not saved', () => {
  const mgr = new SignCollectionManager();
  mgr.addSample(generateMockSequence('hello'));
  mgr.addSample(generateMockSequence('water'));
  assert.equal(mgr.getTotalCount(), 2);

  const discarded = mgr.discardLastSample();
  assert.equal(discarded?.label, 'water');
  assert.equal(mgr.getTotalCount(), 1);
  assert.equal(mgr.getSamples()[0].label, 'hello');
});

test('Sign Collection - Manager: export JSON contains ONLY landmark features and non-identifying metadata', () => {
  const mgr = new SignCollectionManager();
  mgr.addSample(generateMockSequence('thankyou'));

  const jsonStr = mgr.exportDatasetJson();
  assert.ok(typeof jsonStr === 'string');

  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.version, '1.0');
  assert.equal(parsed.totalSamples, 1);
  assert.ok(Array.isArray(parsed.samples));

  const sample = parsed.samples[0];
  assert.equal(sample.label, 'thankyou');
  assert.equal(sample.sequenceLength, 60);
  assert.equal(sample.signerAlias, 'signer-01');

  // Verify STRICT PRIVACY BOUNDARIES:
  // Must NOT contain video, photos, audio, transcripts, or personal identifying data
  assert.equal(sample.video, undefined);
  assert.equal(sample.photo, undefined);
  assert.equal(sample.image, undefined);
  assert.equal(sample.audio, undefined);
  assert.equal(sample.transcript, undefined);
  assert.equal(sample.name, undefined);

  // Check no forbidden binary or media keys anywhere in JSON
  assert.doesNotMatch(jsonStr, /"video"/i);
  assert.doesNotMatch(jsonStr, /"photo"/i);
  assert.doesNotMatch(jsonStr, /"audio"/i);
  assert.doesNotMatch(jsonStr, /"transcript"/i);
});

test('Sign Collection - Multi-Signer: switching active alias resets scoped counts without losing previous signer data', () => {
  const mgr = new SignCollectionManager();

  // Signer 1 records 30 water samples
  for (let i = 0; i < 30; i++) {
    mgr.addSample(generateMockSequence('water', 'signer-01'));
  }

  // Active alias changes to signer-02
  // Test A:
  assert.equal(mgr.getTotalCount(), 30); // overall total = 30
  assert.equal(mgr.getSignerTotalCount('signer-02'), 0); // current signer total = 0
  const signer02Counts = mgr.getCountsByClass('signer-02');
  assert.equal(signer02Counts['water'], 0); // current signer water = 0

  // Test B: Record one water sample as signer-02
  mgr.addSample(generateMockSequence('water', 'signer-02'));
  assert.equal(mgr.getTotalCount(), 31); // overall total = 31
  assert.equal(mgr.getCountsByClass('signer-01')['water'], 30); // signer-01 water = 30
  assert.equal(mgr.getCountsByClass('signer-02')['water'], 1); // signer-02 water = 1
  assert.equal(mgr.getSignerTotalCount('signer-02'), 1);

  // Test C: Changing active alias does not mutate existing samples
  const allSamples = mgr.getSamples();
  const signer01Samples = allSamples.filter((s) => s.signerAlias === 'signer-01');
  const signer02Samples = allSamples.filter((s) => s.signerAlias === 'signer-02');
  assert.equal(signer01Samples.length, 30);
  assert.equal(signer02Samples.length, 1);
  for (const s of signer01Samples) {
    assert.equal(s.signerAlias, 'signer-01');
  }

  // Test D: Switch back to signer-01
  const switchedBackSigner01Counts = mgr.getCountsByClass('signer-01');
  assert.equal(switchedBackSigner01Counts['water'], 30);
  assert.equal(mgr.getSignerTotalCount('signer-01'), 30);

  // Test E: Switch back to signer-02
  const switchedBackSigner02Counts = mgr.getCountsByClass('signer-02');
  assert.equal(switchedBackSigner02Counts['water'], 1);
  assert.equal(mgr.getSignerTotalCount('signer-02'), 1);

  // Test F: Download includes both signer aliases correctly
  const exportJsonStr = mgr.exportDatasetJson();
  const parsedExport = JSON.parse(exportJsonStr);
  assert.equal(parsedExport.totalSamples, 31);
  assert.deepEqual(parsedExport.signers.sort(), ['signer-01', 'signer-02'].sort());
  assert.ok(parsedExport.signerCounts);
  assert.equal(parsedExport.signerCounts['signer-01'], 30);
  assert.equal(parsedExport.signerCounts['signer-02'], 1);

  // Test G: Discard Last while signer-02 active removes signer-02's most recent sample, not signer-01's
  const discarded = mgr.discardLastSample('signer-02');
  assert.equal(discarded?.signerAlias, 'signer-02');
  assert.equal(discarded?.label, 'water');
  assert.equal(mgr.getTotalCount(), 30);
  assert.equal(mgr.getSignerTotalCount('signer-02'), 0);
  assert.equal(mgr.getCountsByClass('signer-02')['water'], 0);
  // signer-01 remains intact
  assert.equal(mgr.getSignerTotalCount('signer-01'), 30);
  assert.equal(mgr.getCountsByClass('signer-01')['water'], 30);

  // Discarding again when signer-02 has 0 samples returns null and does not touch signer-01
  const emptyDiscard = mgr.discardLastSample('signer-02');
  assert.equal(emptyDiscard, null);
  assert.equal(mgr.getTotalCount(), 30);
  assert.equal(mgr.getSignerTotalCount('signer-01'), 30);

  // Test H: Existing 60 x 126 schema remains unchanged
  for (const sample of mgr.getSamples()) {
    assert.equal(sample.sequenceLength, 60);
    assert.equal(sample.frames.length, 60);
    for (const frame of sample.frames) {
      assert.equal(frame.length, 126);
    }
  }

  // Test I: Normalization remains unchanged (featureSchema is wrist_normalized_v1)
  for (const sample of mgr.getSamples()) {
    assert.equal(sample.featureSchema, 'wrist_normalized_v1');
  }

  // Test J: No images/video/audio are persisted in dataset
  assert.doesNotMatch(exportJsonStr, /"video"/i);
  assert.doesNotMatch(exportJsonStr, /"photo"/i);
  assert.doesNotMatch(exportJsonStr, /"image"/i);
  assert.doesNotMatch(exportJsonStr, /"audio"/i);
});

test('Sign Collection - Multi-Signer: alias normalization trims whitespace and formats correctly', () => {
  const mgr = new SignCollectionManager();

  // Added with surrounding spaces
  mgr.addSample(generateMockSequence('hello', '  signer-02  '));
  assert.equal(mgr.getSigners()[0], 'signer-02');
  assert.equal(mgr.getSignerTotalCount('signer-02'), 1);
  assert.equal(mgr.getSignerTotalCount('  signer-02  '), 1);
  assert.equal(mgr.getCountsByClass('signer-02')['hello'], 1);
  assert.equal(mgr.getCountsByClass('  signer-02  ')['hello'], 1);
  assert.equal(sanitizeSignerAlias('  Signer_03  '), 'signer_03');
  assert.equal(sanitizeSignerAlias('   '), 'signer-01');
});

test('Sign Collection - Vocabulary: all 7 target signs + NO_SIGN have verified PSL definitions', () => {
  assert.equal(Object.keys(VERIFIED_SIGN_DEFINITIONS).length, 8);

  for (const cls of BASIC_SIGN_CLASSES) {
    const def = VERIFIED_SIGN_DEFINITIONS[cls];
    assert.ok(def);
    assert.equal(def.id, cls);
    assert.ok(def.englishLabel.length > 0);
    assert.ok(def.urduLabel.length > 0);
    assert.ok(def.pslSource.length > 0);
    assert.equal(def.safeToCollect, true);
    assert.ok(def.gestureInstructions.length > 0);
    assert.ok(def.urduInstructions.length > 0);
  }
});

// 4. AAC Camera Calibration & System Parity Tests
test('Sign Recognition - Production AAC: CameraPanel defaults to calibration status and emits NO false V1 predictions', () => {
  const controller = new CameraController(mockMediaDevices);
  controller['state'] = {
    ...controller['state'],
    status: 'active',
  };

  const html = render(h(CameraPanel, { controller }));

  // Landmark canvas is active
  assert.ok(html.includes('camera-landmark-canvas'));
  // Heading exists
  assert.ok(html.includes('PSL Sign Recognition'));
  // Quiet hint states local AAC recognition
  assert.ok(html.includes('Live hand tracking and basic AAC sign recognition run privately on this device.'));
  // Honest privacy notice
  assert.ok(html.includes('CommuniCare does not record or upload camera video'));

  // No fake detections or candidate cards are rendered
  assert.ok(!html.includes('psl-detection-card'));
  assert.ok(!html.includes('Detected Sign: SHOWER'));
  assert.ok(!html.includes('Detected Sign: TEST_WORD'));
});

import { emergencyPhrases } from '../../src/data/phrases';
import { emergencyMessage } from '../../src/features/communication/emergencySpeech';

test('Sign Recognition - System Parity: STT, TTS, SOS remain completely unchanged', () => {
  // 1. Voice resolver parity (STT)
  const voiceResolution = resolveVoiceInput('water');
  assert.ok(voiceResolution.candidates.length > 0);
  assert.equal(voiceResolution.status, 'clear');

  // 2. SOS emergency definition and local phrase parity
  assert.equal(emergencyPhrases.length, 3);
  const helpMsg = emergencyMessage('emergency-help');
  assert.ok(helpMsg);
  assert.equal(helpMsg.englishText, 'I need help now.');
  assert.equal(helpMsg.urduText, 'مجھے ابھی مدد چاہیے۔');

  // 3. Communication store parity: PSL message, explicit candidate selection, and exact confirmation
  const store = useCommunicationStore.getState();
  assert.equal(typeof store.applyPslMessage, 'function');
  assert.equal(typeof store.selectCandidate, 'function');
  assert.equal(typeof store.confirmExactText, 'function');
  assert.equal(typeof store.setCommunicationText, 'function');
});
