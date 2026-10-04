import type { LandmarkPoint, FrameExtractionResult } from './signTypes';

export interface RawHandData {
  landmarks: Array<{ x: number; y: number; z: number }>;
  handedness: string; // 'Left' or 'Right'
  score: number;
}

export const LANDMARKS_PER_HAND = 21;
export const COORDS_PER_LANDMARK = 3;
export const FEATURES_PER_HAND = LANDMARKS_PER_HAND * COORDS_PER_LANDMARK; // 63
export const TOTAL_FRAME_FEATURES = FEATURES_PER_HAND * 2; // 126

export type CameraFacingMode = 'user' | 'environment' | 'direct';

export interface HandFeatureExtractionOptions {
  /**
   * Camera orientation:
   * - 'user': front-facing selfie camera (MediaPipe 'Left' maps to physical Right)
   * - 'environment': rear-facing camera
   * - 'direct': unadjusted MediaPipe label (backward compatible)
   * @default 'direct'
   */
  cameraFacing?: CameraFacingMode;
  /**
   * Whether to apply wrist-relative translation and palm-scale normalization.
   * @default false
   */
  normalize?: boolean;
}

/**
 * Resolves the physical hand ('Left' | 'Right') from MediaPipe's output.
 *
 * MediaPipe HandLandmarker (@mediapipe/tasks-vision) analyzes 3D anatomical hand
 * geometry and outputs:
 * - 'Left' for a human's physical anatomical left hand
 * - 'Right' for a human's physical anatomical right hand
 *
 * Both hands map directly to their respective feature slots:
 * - Physical Left  -> slot 0..62
 * - Physical Right -> slot 63..125
 */
export function resolvePhysicalHandedness(
  mediapipeHandedness: string,
  cameraFacing: CameraFacingMode = 'user'
): 'Left' | 'Right' {
  void cameraFacing;
  const isMpLeft = (mediapipeHandedness || '').toLowerCase().includes('left');
  return isMpLeft ? 'Left' : 'Right';
}

/**
 * Normalizes 21 3D hand landmarks:
 * 1. Translate relative to wrist (landmark 0 becomes 0, 0, 0)
 * 2. Scale by Euclidean distance from wrist (0) to middle finger MCP (9)
 *
 * Formula:
 *   scale = max(hypot(x9 - x0, y9 - y0, z9 - z0), 1e-4)
 *   x'_i = (x_i - x_0) / scale
 *   y'_i = (y_i - y_0) / scale
 *   z'_i = (z_i - z_0) / scale
 */
export function normalizeHandLandmarks(
  landmarks: Array<{ x: number; y: number; z: number }>
): LandmarkPoint[] {
  if (!landmarks || landmarks.length < LANDMARKS_PER_HAND) {
    return [];
  }
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const dx = middleMcp.x - wrist.x;
  const dy = middleMcp.y - wrist.y;
  const dz = middleMcp.z - wrist.z;
  const palmDist = Math.hypot(dx, dy, dz);
  const scale = palmDist > 1e-4 ? palmDist : 1e-4;

  return landmarks.map((lm) => ({
    x: (lm.x - wrist.x) / scale,
    y: (lm.y - wrist.y) / scale,
    z: (lm.z - wrist.z) / scale,
  }));
}

/**
 * Extracts a 126-feature frame vector from detected hands:
 * - Indices 0..62: Left hand (21 landmarks × [x, y, z])
 * - Indices 63..125: Right hand (21 landmarks × [x, y, z])
 * - Absent hand is padded with zeros (63 zeros)
 */
export function extractHandFeatures(
  hands: RawHandData[],
  options: HandFeatureExtractionOptions = {}
): FrameExtractionResult {
  const { cameraFacing = 'direct', normalize = false } = options;
  const features = new Float32Array(TOTAL_FRAME_FEATURES); // initialized with 0.0

  let leftHand: RawHandData | null = null;
  let rightHand: RawHandData | null = null;

  for (const hand of hands) {
    if (!hand.landmarks || hand.landmarks.length < LANDMARKS_PER_HAND) {
      continue;
    }
    const resolvedHand = resolvePhysicalHandedness(hand.handedness, cameraFacing);
    if (resolvedHand === 'Left' && (!leftHand || hand.score > leftHand.score)) {
      leftHand = hand;
    } else if (resolvedHand === 'Right' && (!rightHand || hand.score > rightHand.score)) {
      rightHand = hand;
    }
  }

  // 1. Fill Left Hand slot (indices 0..62)
  let leftHandDisplayPoints: LandmarkPoint[] | undefined;
  if (leftHand) {
    leftHandDisplayPoints = [];
    const sourcePoints = normalize ? normalizeHandLandmarks(leftHand.landmarks) : leftHand.landmarks;
    for (let i = 0; i < LANDMARKS_PER_HAND; i++) {
      const srcLm = sourcePoints[i];
      const origLm = leftHand.landmarks[i];
      const offset = i * COORDS_PER_LANDMARK;
      features[offset] = srcLm.x;
      features[offset + 1] = srcLm.y;
      features[offset + 2] = srcLm.z;
      leftHandDisplayPoints.push({ x: origLm.x, y: origLm.y, z: origLm.z });
    }
  }

  // 2. Fill Right Hand slot (indices 63..125)
  let rightHandDisplayPoints: LandmarkPoint[] | undefined;
  if (rightHand) {
    rightHandDisplayPoints = [];
    const sourcePoints = normalize ? normalizeHandLandmarks(rightHand.landmarks) : rightHand.landmarks;
    for (let i = 0; i < LANDMARKS_PER_HAND; i++) {
      const srcLm = sourcePoints[i];
      const origLm = rightHand.landmarks[i];
      const offset = FEATURES_PER_HAND + i * COORDS_PER_LANDMARK;
      features[offset] = srcLm.x;
      features[offset + 1] = srcLm.y;
      features[offset + 2] = srcLm.z;
      rightHandDisplayPoints.push({ x: origLm.x, y: origLm.y, z: origLm.z });
    }
  }

  const hasLeft = leftHand !== null;
  const hasRight = rightHand !== null;
  const handCount = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);

  return {
    features,
    hasLeftHand: hasLeft,
    hasRightHand: hasRight,
    leftHandLandmarks: leftHandDisplayPoints,
    rightHandLandmarks: rightHandDisplayPoints,
    handCount,
  };
}

/**
 * Convenience helper explicitly configured for selfie webcam capture with normalization.
 */
export function extractPhysicalHandFeatures(
  hands: RawHandData[],
  options: HandFeatureExtractionOptions = { cameraFacing: 'user', normalize: true }
): FrameExtractionResult {
  return extractHandFeatures(hands, {
    cameraFacing: options.cameraFacing ?? 'user',
    normalize: options.normalize ?? true,
  });
}
