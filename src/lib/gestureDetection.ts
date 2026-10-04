export interface GesturePoint {
  x: number;
  y: number;
  z?: number;
}

export interface PrototypeGesture {
  id: 'help' | 'yes' | 'no' | 'clear' | 'water';
  name: string;
  nameUrdu: string;
  meaning: string;
  meaningUrdu: string;
  description: string;
  confidence: number;
}

interface DetectResult {
  landmarks?: GesturePoint[][];
}

export interface GestureDetector {
  detectForVideo: (video: HTMLVideoElement, nowInMs: number) => DetectResult;
  close?: () => void;
}

export async function createGestureDetector(
  onStatus?: (status: string) => void
): Promise<GestureDetector> {
  onStatus?.('Loading gesture engine...');
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );

  onStatus?.('Loading hand model...');

  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
}

export function detectPrototypeGesture(landmarks: GesturePoint[] | undefined): PrototypeGesture | null {
  if (!landmarks || landmarks.length < 21) {
    return null;
  }

  const indexUp = isFingerUp(landmarks, 8, 6);
  const middleUp = isFingerUp(landmarks, 12, 10);
  const ringUp = isFingerUp(landmarks, 16, 14);
  const pinkyUp = isFingerUp(landmarks, 20, 18);

  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const thumbMcp = landmarks[2];
  const indexMcp = landmarks[5];
  const wrist = landmarks[0];

  const thumbSpread = distance(thumbTip, indexMcp) > 0.16;
  const thumbUp = thumbTip.y < thumbIp.y && thumbIp.y < thumbMcp.y && thumbSpread;
  const thumbDown = thumbTip.y > thumbIp.y && thumbIp.y > thumbMcp.y && thumbSpread;
  const thumbTucked = distance(thumbTip, wrist) < 0.2 || distance(thumbTip, thumbMcp) < 0.1;

  if (indexUp && middleUp && ringUp && pinkyUp && thumbSpread) {
    return {
      id: 'help',
      name: 'Open Palm',
      nameUrdu: 'کھلا ہاتھ',
      meaning: 'I need help',
      meaningUrdu: 'مجھے مدد چاہیے',
      description: 'Open palm',
      confidence: 0.9,
    };
  }

  if (!indexUp && !middleUp && !ringUp && !pinkyUp && thumbUp) {
    return {
      id: 'yes',
      name: 'Thumbs Up',
      nameUrdu: 'انگوٹھا اوپر',
      meaning: 'Yes',
      meaningUrdu: 'ہاں',
      description: 'Thumb up',
      confidence: 0.88,
    };
  }

  if (!indexUp && !middleUp && !ringUp && !pinkyUp && thumbDown) {
    return {
      id: 'no',
      name: 'Thumbs Down',
      nameUrdu: 'انگوٹھا نیچے',
      meaning: 'No',
      meaningUrdu: 'نہیں',
      description: 'Thumb down',
      confidence: 0.88,
    };
  }

  if (!indexUp && !middleUp && !ringUp && !pinkyUp && thumbTucked) {
    return {
      id: 'clear',
      name: 'Closed Fist',
      nameUrdu: 'بند مکا',
      meaning: 'Clear message',
      meaningUrdu: 'پیغام صاف کریں',
      description: 'Closed fist',
      confidence: 0.86,
    };
  }

  if (indexUp && !middleUp && !ringUp && !pinkyUp) {
    return {
      id: 'water',
      name: 'Index Finger Up',
      nameUrdu: 'ایک انگلی اوپر',
      meaning: 'I need water',
      meaningUrdu: 'مجھے پانی چاہیے',
      description: 'Index finger up',
      confidence: 0.87,
    };
  }

  return null;
}

function isFingerUp(landmarks: GesturePoint[], tipIndex: number, pipIndex: number) {
  return landmarks[tipIndex].y < landmarks[pipIndex].y - 0.05;
}

function distance(a: GesturePoint, b: GesturePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
