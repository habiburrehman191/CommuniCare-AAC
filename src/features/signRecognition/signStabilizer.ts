import type {
  PredictionResult,
  DetectionCandidate,
  SignRecognitionState,
} from './signTypes';
import { getPslAacMapping } from './pslMappings';

export interface StabilizerConfig {
  minConfidenceThreshold?: number; // default 0.85
  marginThreshold?: number;        // default 0.10
  requiredStableWindows?: number;   // default 3
  cooldownMs?: number;              // default 500 ms (~15 frames)
}

export type StabilizerDecision =
  | 'warming-up'
  | 'no-sign'
  | 'low-confidence'
  | 'unstable'
  | 'accepted'
  | 'error';

export interface StabilizerOutput {
  state: SignRecognitionState;
  candidate: DetectionCandidate | null;
  detectedSign: string | null;
  confidence: number;
  statusMessage: string;
  decision?: StabilizerDecision;
  stabilizerProgress?: string;
}

export class SignStabilizer {
  private readonly minConfidence: number;
  private readonly marginThreshold: number;
  private readonly requiredWindows: number;
  private readonly cooldownMs: number;

  private recentPredictions: string[] = [];
  private lastCandidateTime = 0;
  private lastCandidateLabel: string | null = null;

  constructor(config?: StabilizerConfig) {
    this.minConfidence = config?.minConfidenceThreshold ?? 0.85;
    this.marginThreshold = config?.marginThreshold ?? 0.10;
    this.requiredWindows = config?.requiredStableWindows ?? 3;
    this.cooldownMs = config?.cooldownMs ?? 500;
  }

  process(
    prediction: PredictionResult | null,
    handCount: number,
    isBufferFull: boolean,
    now = Date.now()
  ): StabilizerOutput {
    const progressZero = `0/${this.requiredWindows}`;

    // 1. Hand-presence check
    if (handCount === 0) {
      this.recentPredictions = [];
      return {
        state: 'no-hands',
        statusMessage: 'No hands detected',
        candidate: null,
        detectedSign: null,
        confidence: 0,
        decision: 'warming-up',
        stabilizerProgress: progressZero,
      };
    }

    // 2. Buffer fill check (warm-up before full window available)
    if (!isBufferFull) {
      this.recentPredictions = [];
      return {
        state: 'collecting',
        statusMessage: 'Watching for a sign...',
        candidate: null,
        detectedSign: null,
        confidence: 0,
        decision: 'warming-up',
        stabilizerProgress: progressZero,
      };
    }

    if (!prediction) {
      return {
        state: 'uncertain',
        statusMessage: 'Watching for a sign...',
        candidate: null,
        detectedSign: null,
        confidence: 0,
        decision: 'unstable',
        stabilizerProgress: progressZero,
      };
    }

    const { label, confidence, top2 } = prediction;

    // 3. 'NO_SIGN' / 'nothing' rejection class gate
    const isRejectionClass =
      label === 'NO_SIGN' ||
      label.toLowerCase() === 'no_sign' ||
      label.toLowerCase() === 'no sign' ||
      label.toLowerCase() === 'nothing';

    if (isRejectionClass) {
      this.recentPredictions = [];
      return {
        state: 'no-sign',
        statusMessage: 'Ready for your sign',
        candidate: null,
        detectedSign: null,
        confidence,
        decision: 'no-sign',
        stabilizerProgress: progressZero,
      };
    }

    // 4. Confidence threshold check (must be >= 0.85)
    if (confidence < this.minConfidence) {
      this.recentPredictions = [];
      return {
        state: 'uncertain',
        statusMessage: 'Watching for a clear sign...',
        candidate: null,
        detectedSign: label,
        confidence,
        decision: 'low-confidence',
        stabilizerProgress: progressZero,
      };
    }

    // 5. Margin threshold check (top1 - top2 must be >= 0.10)
    const margin =
      prediction.margin !== undefined
        ? prediction.margin
        : top2
        ? confidence - top2.confidence
        : confidence;

    if (margin < this.marginThreshold) {
      this.recentPredictions = [];
      return {
        state: 'uncertain',
        statusMessage: 'Watching for a clear sign...',
        candidate: null,
        detectedSign: label,
        confidence,
        decision: 'unstable',
        stabilizerProgress: progressZero,
      };
    }

    // 6. Temporal stability window tracking
    // If a different label is predicted, reset stability
    if (
      this.recentPredictions.length > 0 &&
      this.recentPredictions[this.recentPredictions.length - 1] !== label
    ) {
      this.recentPredictions = [];
    }

    this.recentPredictions.push(label);
    if (this.recentPredictions.length > this.requiredWindows) {
      this.recentPredictions.shift();
    }

    const isStable =
      this.recentPredictions.length >= this.requiredWindows &&
      this.recentPredictions.every((p) => p === label);

    const progressStr = `${this.recentPredictions.length}/${this.requiredWindows}`;

    if (!isStable) {
      return {
        state: 'collecting',
        statusMessage: 'Watching for a sign...',
        candidate: null,
        detectedSign: label,
        confidence,
        decision: 'unstable',
        stabilizerProgress: progressStr,
      };
    }

    // 7. Checked stable sign detected
    const mapping = getPslAacMapping(label);

    // Cooldown check for repetitive candidate emission
    const isCooldownActive =
      this.lastCandidateLabel === label &&
      now - this.lastCandidateTime < this.cooldownMs;

    let candidate: DetectionCandidate | null = null;
    if (mapping && !isCooldownActive) {
      candidate = {
        label: mapping.label,
        confidence,
        englishMessage: mapping.englishMessage,
        urduMessage: mapping.urduMessage,
        timestamp: now,
      };
      this.lastCandidateTime = now;
      this.lastCandidateLabel = label;
    }

    const displayTitle = mapping ? mapping.displayTitle : (label.charAt(0).toUpperCase() + label.slice(1));

    return {
      state: 'detected',
      statusMessage: `Detected: ${displayTitle} — ${Math.round(confidence * 100)}%`,
      candidate,
      detectedSign: label,
      confidence,
      decision: 'accepted',
      stabilizerProgress: progressStr,
    };
  }

  clearCandidate(): void {
    this.lastCandidateLabel = null;
    this.recentPredictions = [];
  }

  reset(): void {
    this.recentPredictions = [];
    this.lastCandidateLabel = null;
    this.lastCandidateTime = 0;
  }
}
