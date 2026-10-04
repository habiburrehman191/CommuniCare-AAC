import type { ISignClassifier } from '@/hooks/useSignRecognition';
import type {
  PredictionResult,
  DetectionCandidate,
  SignRecognitionState,
  RecognitionMetrics,
} from './signTypes';
import { getPslAacMapping } from './pslMappings';
import { TOTAL_FRAME_FEATURES } from './handFeatureExtractor';

export interface ControlledSignRecognizerConfig {
  classifier?: ISignClassifier | null;
  minConfidenceThreshold?: number; // default 0.70
  minMarginThreshold?: number;     // default 0.0 (conservative/disabled by default)
  sequenceLength?: number;         // default 60
  getReadyDurationMs?: number;      // default 600ms
  countdownStepDurationMs?: number; // default 700ms
  onStateChange?: (snapshot: ControlledRecognizerSnapshot) => void;
}

export interface ControlledRecognizerSnapshot {
  state: SignRecognitionState;
  statusMessage: string;
  isRecognizing: boolean;
  isRecording: boolean;
  countdown: number | null;
  capturedFramesCount: number;
  bufferFillRatio: number;
  detectedSign: string | null;
  confidence: number;
  candidate: DetectionCandidate | null;
  metrics: RecognitionMetrics | null;
  error: string | null;
}

export class ControlledSignRecognizer {
  private classifier: ISignClassifier | null = null;
  private readonly minConfidenceThreshold: number;
  private readonly minMarginThreshold: number;
  private readonly sequenceLength: number;
  private readonly getReadyDurationMs: number;
  private readonly countdownStepDurationMs: number;
  private readonly onStateChange?: (snapshot: ControlledRecognizerSnapshot) => void;

  private _state: SignRecognitionState = 'ready';
  private _statusMessage = 'Camera ready';
  private _isRecognizing = false;
  private _isRecording = false;
  private _countdown: number | null = null;
  private _detectedSign: string | null = null;
  private _confidence = 0;
  private _candidate: DetectionCandidate | null = null;
  private _metrics: RecognitionMetrics | null = null;
  private _error: string | null = null;

  private capturedFrames: Float32Array[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  private recognitionStartTime = 0;
  private captureStartTime = 0;
  private countdownDurationMs = 0;
  private captureDurationMs = 0;

  private lastInferencePromise: Promise<void> | null = null;

  constructor(config: ControlledSignRecognizerConfig = {}) {
    this.classifier = config.classifier ?? null;
    this.minConfidenceThreshold = config.minConfidenceThreshold ?? 0.70;
    this.minMarginThreshold = config.minMarginThreshold ?? 0.0;
    this.sequenceLength = config.sequenceLength ?? 60;
    this.getReadyDurationMs = config.getReadyDurationMs ?? 600;
    this.countdownStepDurationMs = config.countdownStepDurationMs ?? 700;
    this.onStateChange = config.onStateChange;
  }

  setClassifier(classifier: ISignClassifier | null): void {
    this.classifier = classifier;
  }

  get state(): SignRecognitionState {
    return this._state;
  }

  get statusMessage(): string {
    return this._statusMessage;
  }

  get isRecognizing(): boolean {
    return this._isRecognizing;
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  get countdown(): number | null {
    return this._countdown;
  }

  get capturedFramesCount(): number {
    return this.capturedFrames.length;
  }

  get bufferFillRatio(): number {
    return this.sequenceLength > 0 ? Math.min(1, this.capturedFrames.length / this.sequenceLength) : 0;
  }

  get detectedSign(): string | null {
    return this._detectedSign;
  }

  get confidence(): number {
    return this._confidence;
  }

  get candidate(): DetectionCandidate | null {
    return this._candidate;
  }

  get metrics(): RecognitionMetrics | null {
    return this._metrics;
  }

  get error(): string | null {
    return this._error;
  }

  get snapshot(): ControlledRecognizerSnapshot {
    return {
      state: this._state,
      statusMessage: this._statusMessage,
      isRecognizing: this._isRecognizing,
      isRecording: this._isRecording,
      countdown: this._countdown,
      capturedFramesCount: this.capturedFrames.length,
      bufferFillRatio: this.bufferFillRatio,
      detectedSign: this._detectedSign,
      confidence: this._confidence,
      candidate: this._candidate,
      metrics: this._metrics,
      error: this._error,
    };
  }

  private emit(): void {
    this.onStateChange?.(this.snapshot);
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers = [];
  }

  startRecognition(): boolean {
    if (this._isRecognizing) {
      return false; // Prevent overlapping captures
    }

    if (!this.classifier || !this.classifier.ready) {
      return false;
    }

    this.clearTimers();
    this.capturedFrames = [];
    this._candidate = null;
    this._error = null;
    this._isRecognizing = true;
    this._isRecording = false;

    this.recognitionStartTime = performance.now();

    // Fast path: if durations are 0 (e.g., in unit tests)
    if (this.getReadyDurationMs === 0 && this.countdownStepDurationMs === 0) {
      this.countdownDurationMs = 0;
      this._state = 'recording';
      this._countdown = null;
      this._statusMessage = `Signing... 0/${this.sequenceLength}`;
      this._isRecording = true;
      this.captureStartTime = performance.now();
      this.emit();
      return true;
    }

    // Step 0: "Get ready..."
    this._state = 'countdown';
    this._countdown = null;
    this._statusMessage = 'Get ready...';
    this.emit();

    // Step 1: "3"
    const t1 = setTimeout(() => {
      this._countdown = 3;
      this._statusMessage = '3';
      this.emit();
    }, this.getReadyDurationMs);
    this.timers.push(t1);

    // Step 2: "2"
    const t2 = setTimeout(() => {
      this._countdown = 2;
      this._statusMessage = '2';
      this.emit();
    }, this.getReadyDurationMs + this.countdownStepDurationMs);
    this.timers.push(t2);

    // Step 3: "1"
    const t3 = setTimeout(() => {
      this._countdown = 1;
      this._statusMessage = '1';
      this.emit();
    }, this.getReadyDurationMs + 2 * this.countdownStepDurationMs);
    this.timers.push(t3);

    // Step 4: Begin signing/capture
    const t4 = setTimeout(() => {
      this.countdownDurationMs = performance.now() - this.recognitionStartTime;
      this._state = 'recording';
      this._countdown = null;
      this._statusMessage = `Signing... 0/${this.sequenceLength}`;
      this._isRecording = true;
      this.captureStartTime = performance.now();
      this.emit();
    }, this.getReadyDurationMs + 3 * this.countdownStepDurationMs);
    this.timers.push(t4);

    return true;
  }

  addFrame(features: Float32Array): boolean {
    // Only capture frames when explicitly in recording phase
    if (!this._isRecording || this._state !== 'recording') {
      return false;
    }

    if (this.capturedFrames.length < this.sequenceLength) {
      this.capturedFrames.push(new Float32Array(features));
      const count = this.capturedFrames.length;
      this._statusMessage = `Signing... ${count}/${this.sequenceLength}`;

      if (count === this.sequenceLength) {
        this._isRecording = false;
        this.captureDurationMs = performance.now() - this.captureStartTime;
        this._state = 'analyzing';
        this._statusMessage = 'Analyzing...';
        this.emit();

        // Exactly one model inference call per sequence
        this.lastInferencePromise = this.runInference();
        return true;
      }

      this.emit();
      return true;
    }

    return false;
  }

  async waitForInference(): Promise<void> {
    if (this.lastInferencePromise) {
      await this.lastInferencePromise;
    }
  }

  private async runInference(): Promise<void> {
    if (!this.classifier || this.capturedFrames.length !== this.sequenceLength) {
      this._isRecognizing = false;
      this._isRecording = false;
      this._state = 'uncertain';
      this._statusMessage = 'Sign unclear — try again';
      this.emit();
      return;
    }

    const inferenceStartTime = performance.now();
    const flattened = new Float32Array(this.sequenceLength * TOTAL_FRAME_FEATURES);
    for (let i = 0; i < this.sequenceLength; i++) {
      flattened.set(this.capturedFrames[i], i * TOTAL_FRAME_FEATURES);
    }

    try {
      const prediction = await this.classifier.predict(flattened);
      const inferenceDurationMs = performance.now() - inferenceStartTime;
      const totalDurationMs = performance.now() - this.recognitionStartTime;

      this.processResult(prediction, {
        countdownDurationMs: this.countdownDurationMs,
        captureDurationMs: this.captureDurationMs,
        inferenceDurationMs,
        totalDurationMs,
      });
    } catch (err) {
      this._isRecognizing = false;
      this._isRecording = false;
      this._state = 'unavailable';
      this._error = err instanceof Error ? err.message : String(err);
      this._statusMessage = 'Sign recognition unavailable';
      this.emit();
    }
  }

  private processResult(
    prediction: PredictionResult | null,
    timing: {
      countdownDurationMs: number;
      captureDurationMs: number;
      inferenceDurationMs: number;
      totalDurationMs: number;
    }
  ): void {
    this._isRecognizing = false;
    this._isRecording = false;

    if (!prediction) {
      this._state = 'uncertain';
      this._detectedSign = null;
      this._confidence = 0;
      this._candidate = null;
      this._statusMessage = 'Sign unclear — try again';
      this._metrics = {
        ...timing,
        top1: null,
        top2: null,
      };
      this.emit();
      return;
    }

    const top1 = { label: prediction.label, confidence: prediction.confidence };
    const top2 =
      prediction.top2 ??
      (prediction.top3 && prediction.top3.length > 1 ? prediction.top3[1] : null);

    this._metrics = {
      ...timing,
      top1,
      top2,
    };

    // Development debug logging
    const isNodeDev =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process !== 'undefined' &&
      (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV !== 'production';
    const isViteDev = Boolean(import.meta.env?.DEV);
    const isWindowDebug =
      typeof window !== 'undefined' &&
      Boolean((window as unknown as { __COMMUNICARE_DEBUG__?: boolean }).__COMMUNICARE_DEBUG__);

    if (isNodeDev || isViteDev || isWindowDebug) {
      console.debug('[ControlledSignRecognizer Debug]', {
        top1,
        top2,
        ...timing,
      });
    }

    // 1. Rejection class check: NO_SIGN / nothing
    const labelUpper = prediction.label.toUpperCase();
    const labelLower = prediction.label.toLowerCase();
    const isNoSign =
      labelUpper === 'NO_SIGN' ||
      labelLower === 'no_sign' ||
      labelLower === 'no sign' ||
      labelLower === 'nothing';

    if (isNoSign) {
      this._state = 'no-sign';
      this._detectedSign = null;
      this._confidence = prediction.confidence;
      this._candidate = null;
      this._statusMessage = 'No communication sign detected';
      this.emit();
      return;
    }

    // 2. Minimum confidence threshold check
    if (prediction.confidence < this.minConfidenceThreshold) {
      this._state = 'uncertain';
      this._detectedSign = prediction.label;
      this._confidence = prediction.confidence;
      this._candidate = null;
      this._statusMessage = 'Sign unclear — try again';
      this.emit();
      return;
    }

    // 3. Optional top-1 vs top-2 confidence margin check
    if (this.minMarginThreshold > 0 && top2) {
      const margin = prediction.confidence - top2.confidence;
      if (margin < this.minMarginThreshold) {
        this._state = 'uncertain';
        this._detectedSign = prediction.label;
        this._confidence = prediction.confidence;
        this._candidate = null;
        this._statusMessage = 'Sign unclear — try again';
        this.emit();
        return;
      }
    }

    // 4. AAC vocabulary mapping check
    const mapping = getPslAacMapping(prediction.label);
    if (mapping) {
      this._state = 'detected';
      this._detectedSign = prediction.label;
      this._confidence = prediction.confidence;
      this._candidate = {
        label: mapping.label,
        confidence: prediction.confidence,
        englishMessage: mapping.englishMessage,
        urduMessage: mapping.urduMessage,
        timestamp: Date.now(),
      };
      this._statusMessage = `Detected: ${mapping.displayTitle} — ${Math.round(prediction.confidence * 100)}%`;
      this.emit();
    } else {
      this._state = 'uncertain';
      this._detectedSign = prediction.label;
      this._confidence = prediction.confidence;
      this._candidate = null;
      this._statusMessage = 'Sign unclear — try again';
      this.emit();
    }
  }

  clearCandidate(): void {
    this._candidate = null;
    this._detectedSign = null;
    this._confidence = 0;
    this._state = 'ready';
    this._statusMessage = 'Camera ready';
    this.emit();
  }

  cancel(): void {
    this.clearTimers();
    this.capturedFrames = [];
    this._isRecognizing = false;
    this._isRecording = false;
    this._countdown = null;
    this._state = 'ready';
    this._statusMessage = 'Camera ready';
    this.emit();
  }
}
