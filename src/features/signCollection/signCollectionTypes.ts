export type BasicSignClass =
  | 'water'
  | 'help'
  | 'hungry'
  | 'need'
  | 'want'
  | 'hello'
  | 'thankyou'
  | 'NO_SIGN';

export const BASIC_SIGN_CLASSES: BasicSignClass[] = [
  'water',
  'help',
  'hungry',
  'need',
  'want',
  'hello',
  'thankyou',
  'NO_SIGN',
];

export interface VerifiedSignDefinition {
  id: BasicSignClass;
  englishLabel: string;
  urduLabel: string;
  conceptDescription: string;
  pslSource: string;
  existingV1Dataset: boolean;
  existingV2Dataset: boolean;
  gestureReferenceAvailable: boolean;
  safeToCollect: boolean;
  gestureInstructions: string;
  urduInstructions: string;
  targetCount: number;
}

export interface SignSampleRecord {
  version: '1.0';
  label: BasicSignClass;
  sequenceLength: 60;
  featureSchema: 'wrist_normalized_v1' | 'raw_v1';
  capturedAt: string; // ISO 8601 string
  sessionId: string;
  signerAlias: string; // Non-identifying alias, e.g. "signer-01"
  cameraFacing: 'user' | 'environment';
  frames: number[][]; // Array of 60 frames, each frame is 126 float numbers
  rawFrames?: number[][]; // Raw MediaPipe [0, 1] coordinates
  normalizedFrames?: number[][]; // Wrist-relative, palm-scale normalized coordinates
  stats: {
    leftHandOccupancy: number; // fraction between 0.0 and 1.0
    rightHandOccupancy: number; // fraction between 0.0 and 1.0
  };
}

export interface SignDatasetExport {
  version: '1.0';
  exportedAt: string;
  totalSamples: number;
  classCounts: Record<BasicSignClass, number>;
  signers: string[];
  signerCounts?: Record<string, number>;
  samples: SignSampleRecord[];
}
