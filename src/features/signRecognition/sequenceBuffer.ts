import { TOTAL_FRAME_FEATURES } from './handFeatureExtractor';

export const REQUIRED_SEQUENCE_LENGTH = 24;
export const TOTAL_POSITION_FEATURES = TOTAL_FRAME_FEATURES; // 126
export const TOTAL_VELOCITY_FEATURES = 126;
export const TOTAL_FRAME_V3_FEATURES = TOTAL_POSITION_FEATURES + TOTAL_VELOCITY_FEATURES; // 252
export const TOTAL_INPUT_ELEMENTS = REQUIRED_SEQUENCE_LENGTH * TOTAL_FRAME_V3_FEATURES; // 24 * 252 = 6048

/**
 * Checks whether landmark points exist in the given hand slot.
 * Hand coordinates are wrist-normalized non-zero coordinates when tracked.
 */
export function isHandSlotPresent(framePos: Float32Array, startIdx: number, endIdx: number): boolean {
  for (let i = startIdx; i <= endIdx; i++) {
    if (Math.abs(framePos[i]) > 1e-5) return true;
  }
  return false;
}

/**
 * Computes the V3 feature tensor from 24 consecutive frames of 126 position features:
 * - 24 consecutive frames
 * - 252 Float32 features per frame: 126 position (0..125) + 126 velocity (126..251)
 * - Physical Left hand position: indices 0..62
 * - Physical Right hand position: indices 63..125
 * - Velocity[t] = position[t] - position[t-1]
 * - First frame (t=0): velocity is all zeros
 * - Missing hand: position slot is zero, velocity slot is strictly zero
 * - Never derives non-zero velocity from hand disappearance or sudden appearance
 */
export function computeV3FeaturesFromPositions(framesPos: Float32Array[]): Float32Array {
  const T = REQUIRED_SEQUENCE_LENGTH;
  const D_POS = TOTAL_POSITION_FEATURES; // 126
  const D_TOTAL = TOTAL_FRAME_V3_FEATURES; // 252
  const output = new Float32Array(T * D_TOTAL);

  for (let t = 0; t < T; t++) {
    const pos = framesPos[t];
    const offset = t * D_TOTAL;

    // 1. Position features: indices 0..125
    output.set(pos, offset);

    // 2. Velocity features: indices 126..251
    if (t > 0) {
      const prevPos = framesPos[t - 1];

      // Physical Left hand: position 0..62, velocity 126..188
      const leftPresentNow = isHandSlotPresent(pos, 0, 62);
      const leftPresentPrev = isHandSlotPresent(prevPos, 0, 62);
      if (leftPresentNow && leftPresentPrev) {
        for (let i = 0; i < 63; i++) {
          output[offset + D_POS + i] = pos[i] - prevPos[i];
        }
      }

      // Physical Right hand: position 63..125, velocity 189..251
      const rightPresentNow = isHandSlotPresent(pos, 63, 125);
      const rightPresentPrev = isHandSlotPresent(prevPos, 63, 125);
      if (rightPresentNow && rightPresentPrev) {
        for (let i = 63; i < 126; i++) {
          output[offset + D_POS + i] = pos[i] - prevPos[i];
        }
      }
    }
  }

  return output;
}

export class SequenceBuffer {
  private buffer: Float32Array[] = [];
  private consecutiveMissingHands = 0;
  private readonly maxMissingHandsThreshold: number;

  constructor(maxMissingHandsThreshold = 15) {
    this.maxMissingHandsThreshold = maxMissingHandsThreshold;
  }

  /**
   * Pushes a new frame feature vector into the buffer.
   * If tracking was lost for too long, automatically resets.
   * Returns true if buffer contains a full 24-frame window.
   */
  push(features: Float32Array, hasHands: boolean): boolean {
    if (!hasHands) {
      this.consecutiveMissingHands++;
      if (this.consecutiveMissingHands > this.maxMissingHandsThreshold) {
        this.reset();
        return false;
      }
    } else {
      this.consecutiveMissingHands = 0;
    }

    if (this.buffer.length >= REQUIRED_SEQUENCE_LENGTH) {
      this.buffer.shift();
    }
    this.buffer.push(features);
    return this.buffer.length === REQUIRED_SEQUENCE_LENGTH;
  }

  /**
   * Returns flattened 1D Float32Array of size 24 * 252 = 6048 elements.
   * Computes velocity across consecutive frames according to the V3 contract.
   */
  getFlattened(): Float32Array | null {
    if (this.buffer.length !== REQUIRED_SEQUENCE_LENGTH) {
      return null;
    }

    // If pre-computed 252 features per frame were pushed directly
    if (this.buffer[0].length === TOTAL_FRAME_V3_FEATURES) {
      const flattened = new Float32Array(TOTAL_INPUT_ELEMENTS);
      for (let i = 0; i < REQUIRED_SEQUENCE_LENGTH; i++) {
        flattened.set(this.buffer[i], i * TOTAL_FRAME_V3_FEATURES);
      }
      return flattened;
    }

    // Default: 126 position features pushed per frame -> compute V3 [24, 252] features
    return computeV3FeaturesFromPositions(this.buffer);
  }

  get length(): number {
    return this.buffer.length;
  }

  get isFull(): boolean {
    return this.buffer.length === REQUIRED_SEQUENCE_LENGTH;
  }

  get fillRatio(): number {
    return Math.min(1, this.buffer.length / REQUIRED_SEQUENCE_LENGTH);
  }

  get missingHandCount(): number {
    return this.consecutiveMissingHands;
  }

  reset(): void {
    this.buffer = [];
    this.consecutiveMissingHands = 0;
  }
}
