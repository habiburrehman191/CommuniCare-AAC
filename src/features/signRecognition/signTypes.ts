export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export type Handedness = 'Left' | 'Right';

export interface ExtractedHand {
  handedness: Handedness;
  score: number;
  landmarks: LandmarkPoint[];
}

export type SignRecognitionState =
  | 'loading'
  | 'ready'
  | 'no-hands'
  | 'calibrating'
  | 'countdown'
  | 'recording'
  | 'analyzing'
  | 'collecting'
  | 'uncertain'
  | 'no-sign'
  | 'detected'
  | 'unavailable';

export interface DetectionCandidate {
  label: string;
  confidence: number;
  englishMessage: string;
  urduMessage: string;
  timestamp: number;
}

export interface PredictionResult {
  label: string;
  confidence: number;
  top2?: { label: string; confidence: number };
  top3: Array<{ label: string; confidence: number }>;
  margin?: number;
}

export interface RecognitionMetrics {
  top1: { label: string; confidence: number } | null;
  top2: { label: string; confidence: number } | null;
  countdownDurationMs: number;
  captureDurationMs: number;
  inferenceDurationMs: number;
  totalDurationMs: number;
}

export interface FrameExtractionResult {
  features: Float32Array;
  hasLeftHand: boolean;
  hasRightHand: boolean;
  leftHandLandmarks?: LandmarkPoint[];
  rightHandLandmarks?: LandmarkPoint[];
  handCount: number;
}

export interface SignRecognitionSnapshot {
  state: SignRecognitionState;
  isModelReady: boolean;
  isTrackingActive: boolean;
  detectedSign: string | null;
  confidence: number;
  candidate: DetectionCandidate | null;
  overlayLandmarks: {
    left?: LandmarkPoint[];
    right?: LandmarkPoint[];
  } | null;
  bufferFillRatio: number;
  error: string | null;
  statusMessage?: string;
  isRecognizing?: boolean;
  isRecording?: boolean;
  countdown?: number | null;
  recordingCount?: number;
  metrics?: RecognitionMetrics | null;
}

