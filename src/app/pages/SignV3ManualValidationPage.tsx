import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Check,
  Volume2,
  X,
  AlertTriangle,
  RotateCcw,
  ShieldAlert,
  Activity,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Download,
} from 'lucide-react';
import * as ort from 'onnxruntime-web';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { useCamera } from '@/hooks/useCamera';
import {
  extractHandFeatures,
  type RawHandData,
} from '@/features/signRecognition/handFeatureExtractor';
import { COMMUNICARE_AAC_SIGN_MAPPINGS } from '@/features/signRecognition/pslMappings';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const SIGN_CLASSES = ['water', 'help', 'hungry', 'need', 'want', 'hello', 'thankyou'] as const;
type SignClass = typeof SIGN_CLASSES[number];

const NO_SIGN_PRESETS = [
  'Hands resting on table',
  'Typing on keyboard',
  'Using mouse / trackpad',
  'Holding phone',
  'Touching face / chin',
  'Adjusting hair',
  'Adjusting glasses',
  'Pointing at screen',
  'Open resting palm',
  'Closed fist',
  'Casual waving',
  'Reaching for object',
  'Hands entering camera',
  'Hands leaving camera',
  'Random finger motion / fidgeting',
  'Aborted / partial gesture',
  'One hand visible resting',
  'Two hands visible resting',
];

interface ManualTestRecord {
  id: string;
  timestamp: number;
  signer: string;
  trialType: 'real' | 'nosign';
  expectedSign?: SignClass;
  noSignAction?: string;
  predictedSign: string | null;
  candidateSurfaced: boolean;
  confidence: number;
  margin: number;
  recognitionLatencyMs: number | null;
  trialLatencyMs: number | null;
  isCorrect: boolean;
}

export function SignV3ManualValidationPage() {
  const { status, start, stop, setVideoRef } = useCamera();
  const isActive = status === 'active';

  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Model & MediaPipe State
  const [isLandmarkerReady, setIsLandmarkerReady] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sessionRef = useRef<ort.InferenceSession | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);

  // Calibration Parameters (Locked V3)
  const confidenceThreshold = 0.85;
  const marginThreshold = 0.10;
  const requiredConsecutiveWindows = 3;
  const inferenceStrideFrames = 3;
  const cooldownMs = 500;

  // Telemetry
  const [top1Class, setTop1Class] = useState<string>('NO_SIGN');
  const [top1Confidence, setTop1Confidence] = useState<number>(0);
  const [top2Class, setTop2Class] = useState<string>('-');
  const [top2Confidence, setTop2Confidence] = useState<number>(0);
  const [currentMargin, setCurrentMargin] = useState<number>(0);
  const [consecutiveAcceptedCount, setConsecutiveAcceptedCount] = useState<number>(0);
  const [lastInferenceTimeMs, setLastInferenceTimeMs] = useState<number>(0);

  // Phase 2O Dev Telemetry State
  const [cameraFps, setCameraFps] = useState<number>(0);
  const [mediaPipeFps, setMediaPipeFps] = useState<number>(0);
  const [mediaPipeDurationMs, setMediaPipeDurationMs] = useState<number>(0);
  const [bufferSize, setBufferSize] = useState<number>(0);
  const [warmUpTimeMs, setWarmUpTimeMs] = useState<number | null>(null);
  const [timeBetweenInferencesMs, setTimeBetweenInferencesMs] = useState<number>(0);
  const [stabilityResetReason, setStabilityResetReason] = useState<string>('idle');
  const [handMissingCount, setHandMissingCount] = useState<number>(0);
  const [candidateSurfacedTimestamp, setCandidateSurfacedTimestamp] = useState<string | null>(null);
  const [activeTrialStartTime, setActiveTrialStartTime] = useState<number | null>(null);
  const [isTrialArmed, setIsTrialArmed] = useState<boolean>(false);

  // Candidate State
  const [surfacedCandidate, setSurfacedCandidate] = useState<{
    label: SignClass;
    confidence: number;
    margin: number;
    recognitionLatencyMs: number;
    trialLatencyMs: number | null;
  } | null>(null);
  const [confirmedMessage, setConfirmedMessage] = useState<{
    english: string;
    urdu: string;
  } | null>(null);

  // Manual Test Logging State
  const [selectedSigner, setSelectedSigner] = useState<string>('signer-01');
  const [testMode, setTestMode] = useState<'real' | 'nosign'>('real');
  const [selectedExpectedSign, setSelectedExpectedSign] = useState<SignClass>('water');
  const [selectedNoSignAction, setSelectedNoSignAction] = useState<string>(NO_SIGN_PRESETS[0]);
  const [testRecords, setTestRecords] = useState<ManualTestRecord[]>([]);

  // Rolling 24-frame position buffer & timing refs
  const positionBufferRef = useRef<Float32Array[]>([]);
  const frameCountRef = useRef<number>(0);
  const consecutiveAcceptedRef = useRef<string[]>([]);
  const lastSurfacedTimestampRef = useRef<number>(0);
  const gestureStartTimeRef = useRef<number>(0);
  const frameTimestampsRef = useRef<number[]>([]);
  const mpTimestampsRef = useRef<number[]>([]);
  const cameraStartRef = useRef<number>(0);
  const warmUpRecordedRef = useRef<number | null>(null);
  const lastInferenceTimestampRef = useRef<number>(0);
  const missingHandFramesRef = useRef<number>(0);
  const candidateAlreadySurfacedRef = useRef<boolean>(false);

  const handleVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      setVideoNode(node);
      setVideoRef(node);
    },
    [setVideoRef]
  );

  // 1. Initialize MediaPipe HandLandmarker
  useEffect(() => {
    let cancelled = false;
    async function loadLandmarker() {
      try {
        const vision = await FilesetResolver.forVisionTasks('/wasm/mediapipe');
        if (cancelled) return;
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/mediapipe/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setIsLandmarkerReady(true);
      } catch (err) {
        console.error('Failed to load MediaPipe HandLandmarker:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadLandmarker();
    return () => {
      cancelled = true;
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // 2. Load V3 ONNX Model
  useEffect(() => {
    let cancelled = false;
    async function loadOnnxModel() {
      try {
        const modelRes = await fetch('/models/communicare-aac-sign-v3-candidate/model.onnx');
        if (!modelRes.ok) {
          throw new Error(`Failed to fetch model.onnx: ${modelRes.statusText}`);
        }
        const modelBuffer = await modelRes.arrayBuffer();
        if (cancelled) return;

        const session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        if (cancelled) return;

        sessionRef.current = session;
        setIsModelReady(true);
      } catch (err) {
        console.error('Failed to load V3 candidate model:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadOnnxModel();
    return () => {
      cancelled = true;
    };
  }, []);

  // 3. Feature computation: 24 frames of 126 position + 126 velocity = 252 features/frame
  const computeV3FeatureTensor = useCallback((framesPos: Float32Array[]): Float32Array => {
    const T = 24;
    const D_POS = 126;
    const D_TOTAL = 252;
    const output = new Float32Array(T * D_TOTAL);

    const isLeftPresent = (f: Float32Array): boolean => {
      for (let i = 0; i < 63; i++) {
        if (Math.abs(f[i]) > 1e-5) return true;
      }
      return false;
    };

    const isRightPresent = (f: Float32Array): boolean => {
      for (let i = 63; i < 126; i++) {
        if (Math.abs(f[i]) > 1e-5) return true;
      }
      return false;
    };

    for (let t = 0; t < T; t++) {
      const pos = framesPos[t];
      const offset = t * D_TOTAL;

      // Fill position features (0..125)
      output.set(pos, offset);

      // Fill velocity features (126..251)
      if (t > 0) {
        const prevPos = framesPos[t - 1];
        const leftPresentNow = isLeftPresent(pos);
        const leftPresentPrev = isLeftPresent(prevPos);
        if (leftPresentNow && leftPresentPrev) {
          for (let i = 0; i < 63; i++) {
            output[offset + D_POS + i] = pos[i] - prevPos[i];
          }
        }

        const rightPresentNow = isRightPresent(pos);
        const rightPresentPrev = isRightPresent(prevPos);
        if (rightPresentNow && rightPresentPrev) {
          for (let i = 63; i < 126; i++) {
            output[offset + D_POS + i] = pos[i] - prevPos[i];
          }
        }
      }
    }

    return output;
  }, []);

  // 4. Main Camera & Live Recognition Loop
  useEffect(() => {
    if (!isActive || !videoNode || !isLandmarkerReady || !isModelReady) return;

    let animId: number;
    let lastTimestamp = 0;
    const frameIntervalMs = 1000 / 30; // 30 FPS target
    let inferenceRunning = false;

    if (cameraStartRef.current === 0) {
      cameraStartRef.current = performance.now();
    }

    const labels = ['water', 'help', 'hungry', 'need', 'want', 'hello', 'thankyou', 'NO_SIGN'];

    const loop = async (now: number) => {
      animId = requestAnimationFrame(loop);

      if (now - lastTimestamp < frameIntervalMs) return;
      lastTimestamp = now;

      // Track Camera FPS
      const frameNow = performance.now();
      frameTimestampsRef.current.push(frameNow);
      frameTimestampsRef.current = frameTimestampsRef.current.filter((t) => frameNow - t <= 1000);
      setCameraFps(frameTimestampsRef.current.length);

      const landmarker = landmarkerRef.current;
      const session = sessionRef.current;
      if (!landmarker || !session || videoNode.readyState < 2) return;

      // A. Hand tracking with MediaPipe
      const mpStart = performance.now();
      const result = landmarker.detectForVideo(videoNode, now);
      const mpEnd = performance.now();
      const mpDuration = Math.round(mpEnd - mpStart);
      setMediaPipeDurationMs(mpDuration);

      mpTimestampsRef.current.push(mpEnd);
      mpTimestampsRef.current = mpTimestampsRef.current.filter((t) => mpEnd - t <= 1000);
      setMediaPipeFps(mpTimestampsRef.current.length);

      // Hand presence & missing-hand tracking
      const detectedHands = result.landmarks?.length ?? 0;
      if (detectedHands === 0) {
        missingHandFramesRef.current++;
      } else {
        missingHandFramesRef.current = 0;
      }
      setHandMissingCount(missingHandFramesRef.current);

      const canvas = canvasRef.current;

      // Draw landmarks on video overlay canvas
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== videoNode.videoWidth || canvas.height !== videoNode.videoHeight) {
            canvas.width = videoNode.videoWidth || 640;
            canvas.height = videoNode.videoHeight || 480;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const w = canvas.width;
          const h = canvas.height;

          if (result.landmarks) {
            for (const lms of result.landmarks) {
              ctx.strokeStyle = '#22c55e';
              ctx.lineWidth = 2;
              for (const [p1Idx, p2Idx] of HAND_CONNECTIONS) {
                const p1 = lms[p1Idx];
                const p2 = lms[p2Idx];
                if (p1 && p2) {
                  ctx.beginPath();
                  ctx.moveTo(p1.x * w, p1.y * h);
                  ctx.lineTo(p2.x * w, p2.y * h);
                  ctx.stroke();
                }
              }
              ctx.fillStyle = '#ef4444';
              for (const lm of lms) {
                ctx.beginPath();
                ctx.arc(lm.x * w, lm.y * h, 3, 0, 2 * Math.PI);
                ctx.fill();
              }
            }
          }
        }
      }

      // B. Extract wrist-normalized position vector
      const rawHands: RawHandData[] = (result.landmarks || []).map((lms, idx) => ({
        landmarks: lms,
        handedness: result.handedness?.[idx]?.[0]?.categoryName ?? 'Right',
        score: result.handedness?.[idx]?.[0]?.score ?? 0.8,
      }));

      const extraction = extractHandFeatures(rawHands, { cameraFacing: 'user', normalize: true });
      const currentPos = new Float32Array(extraction.features);

      // C. Buffer management (24 frames)
      positionBufferRef.current.push(currentPos);
      if (positionBufferRef.current.length > 24) {
        positionBufferRef.current.shift();
      }

      setBufferSize(positionBufferRef.current.length);
      if (positionBufferRef.current.length === 24 && warmUpRecordedRef.current === null && cameraStartRef.current > 0) {
        const warmUpElapsed = Math.round(performance.now() - cameraStartRef.current);
        warmUpRecordedRef.current = warmUpElapsed;
        setWarmUpTimeMs(warmUpElapsed);
      }

      frameCountRef.current++;

      // D. V3 Inference every 3 frames (~100 ms)
      if (positionBufferRef.current.length === 24 && frameCountRef.current % inferenceStrideFrames === 0) {
        if (inferenceRunning) return;
        inferenceRunning = true;
        const infStart = performance.now();

        const infInterval = lastInferenceTimestampRef.current > 0 ? Math.round(now - lastInferenceTimestampRef.current) : 100;
        lastInferenceTimestampRef.current = now;
        setTimeBetweenInferencesMs(infInterval);

        try {
          const v3Features = computeV3FeatureTensor(positionBufferRef.current);
          const inputTensor = new ort.Tensor('float32', v3Features, [1, 24, 252]);
          const inputName = session.inputNames[0] || 'input_frames';
          const outputName = session.outputNames[0] || 'probabilities';

          const runResults = await session.run({ [inputName]: inputTensor });
          const probs = runResults[outputName].data as Float32Array;
          const infDuration = performance.now() - infStart;
          setLastInferenceTimeMs(Math.round(infDuration));

          const indexed = Array.from(probs).map((p, idx) => ({
            label: labels[idx],
            prob: p,
          }));
          indexed.sort((a, b) => b.prob - a.prob);

          const top1 = indexed[0];
          const top2 = indexed[1];
          const margin = top1.prob - top2.prob;

          setTop1Class(top1.label);
          setTop1Confidence(top1.prob);
          setTop2Class(top2.label);
          setTop2Confidence(top2.prob);
          setCurrentMargin(margin);

          // Acceptance Check:
          // 1. top1 != NO_SIGN
          // 2. top1 confidence >= 0.85
          // 3. margin >= 0.10
          const accepted = top1.label !== 'NO_SIGN' && top1.prob >= confidenceThreshold && margin >= marginThreshold;

          if (accepted) {
            const rec = consecutiveAcceptedRef.current;
            if (rec.length > 0 && rec[rec.length - 1] === top1.label) {
              rec.push(top1.label);
              setStabilityResetReason('none (matching window)');
            } else {
              if (rec.length > 0) {
                setStabilityResetReason(`class_mismatch (${rec[rec.length - 1]} -> ${top1.label})`);
              } else {
                setStabilityResetReason('none (new window sequence)');
              }
              consecutiveAcceptedRef.current = [top1.label];
              gestureStartTimeRef.current = performance.now();
            }
          } else {
            let reason = 'idle';
            if (top1.label === 'NO_SIGN') {
              reason = 'top1_is_nosign';
            } else if (top1.prob < confidenceThreshold) {
              reason = `low_confidence (${(top1.prob * 100).toFixed(1)}% < ${(confidenceThreshold * 100).toFixed(0)}%)`;
            } else if (margin < marginThreshold) {
              reason = `low_margin (${(margin * 100).toFixed(1)}% < ${(marginThreshold * 100).toFixed(0)}%)`;
            }
            setStabilityResetReason(reason);
            consecutiveAcceptedRef.current = [];
            gestureStartTimeRef.current = 0;
            candidateAlreadySurfacedRef.current = false;
          }

          const currentCount = consecutiveAcceptedRef.current.length;
          setConsecutiveAcceptedCount(Math.min(currentCount, requiredConsecutiveWindows));

          // Stability rule: 3 consecutive matching accepted windows
          if (currentCount >= requiredConsecutiveWindows) {
            const nowMs = performance.now();
            if (nowMs - lastSurfacedTimestampRef.current >= cooldownMs && !candidateAlreadySurfacedRef.current) {
              const recLatency = gestureStartTimeRef.current > 0 ? Math.round(nowMs - gestureStartTimeRef.current) : 200;
              const trLatency = activeTrialStartTime ? Math.round(nowMs - activeTrialStartTime) : null;
              setSurfacedCandidate({
                label: top1.label as SignClass,
                confidence: top1.prob,
                margin,
                recognitionLatencyMs: recLatency,
                trialLatencyMs: trLatency,
              });
              setCandidateSurfacedTimestamp(new Date().toLocaleTimeString());
              lastSurfacedTimestampRef.current = nowMs;
              candidateAlreadySurfacedRef.current = true;
            }
          }
        } catch (e) {
          console.error('Inference error:', e);
        } finally {
          inferenceRunning = false;
        }
      }
    };

    animId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [
    isActive,
    videoNode,
    isLandmarkerReady,
    isModelReady,
    computeV3FeatureTensor,
    confidenceThreshold,
    marginThreshold,
    requiredConsecutiveWindows,
    inferenceStrideFrames,
    cooldownMs,
    activeTrialStartTime,
  ]);

  // Explicit state reset actions
  const handleResetRecognitionState = useCallback(() => {
    setSurfacedCandidate(null);
    consecutiveAcceptedRef.current = [];
    setConsecutiveAcceptedCount(0);
    gestureStartTimeRef.current = 0;
    candidateAlreadySurfacedRef.current = false;
    positionBufferRef.current = [];
    setBufferSize(0);
    setStabilityResetReason('manual_reset');
    lastSurfacedTimestampRef.current = 0;
    setActiveTrialStartTime(null);
    setIsTrialArmed(false);
  }, []);

  const handleArmTrial = useCallback(() => {
    handleResetRecognitionState();
    setActiveTrialStartTime(performance.now());
    setIsTrialArmed(true);
  }, [handleResetRecognitionState]);

  // Log a manual test attempt
  const logAttempt = useCallback(
    (isReal: boolean) => {
      const id = `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const candidateActive = surfacedCandidate !== null;
      const predicted = candidateActive ? surfacedCandidate.label : top1Class !== 'NO_SIGN' ? top1Class : null;
      const conf = candidateActive ? surfacedCandidate.confidence : top1Confidence;
      const marg = candidateActive ? surfacedCandidate.margin : currentMargin;
      const recLat = candidateActive ? surfacedCandidate.recognitionLatencyMs : null;
      const trLat = candidateActive
        ? surfacedCandidate.trialLatencyMs
        : activeTrialStartTime
        ? Math.round(performance.now() - activeTrialStartTime)
        : null;

      let correct = false;
      if (isReal) {
        correct = candidateActive && surfacedCandidate.label === selectedExpectedSign;
      } else {
        // For NO_SIGN, pass means NO candidate surfaced!
        correct = !candidateActive;
      }

      const rec: ManualTestRecord = {
        id,
        timestamp: Date.now(),
        signer: selectedSigner,
        trialType: isReal ? 'real' : 'nosign',
        expectedSign: isReal ? selectedExpectedSign : undefined,
        noSignAction: isReal ? undefined : selectedNoSignAction,
        predictedSign: predicted,
        candidateSurfaced: candidateActive,
        confidence: conf,
        margin: marg,
        recognitionLatencyMs: recLat,
        trialLatencyMs: trLat,
        isCorrect: correct,
      };

      setTestRecords((prev) => [rec, ...prev]);

      // Complete reset after recording trial
      setSurfacedCandidate(null);
      consecutiveAcceptedRef.current = [];
      setConsecutiveAcceptedCount(0);
      gestureStartTimeRef.current = 0;
      candidateAlreadySurfacedRef.current = false;
      setActiveTrialStartTime(null);
      setIsTrialArmed(false);
      setStabilityResetReason('trial_recorded_reset');
    },
    [
      surfacedCandidate,
      top1Class,
      top1Confidence,
      currentMargin,
      selectedSigner,
      selectedExpectedSign,
      selectedNoSignAction,
      activeTrialStartTime,
    ]
  );

  // AAC Action Handlers
  const handleUseMessage = () => {
    if (!surfacedCandidate) return;
    const mapping = COMMUNICARE_AAC_SIGN_MAPPINGS[surfacedCandidate.label];
    if (mapping) {
      setConfirmedMessage({
        english: mapping.englishMessage,
        urdu: mapping.urduMessage,
      });
    }
  };

  const handleSpeak = () => {
    if (!confirmedMessage) return;
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(confirmedMessage.english);
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    }
  };

  // Dev-only export function for validation session
  const handleExportValidationResults = useCallback(() => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yyyymmdd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `communicare-v3-manual-validation-${yyyymmdd}-${hhmmss}.json`;

    const realTrials = testRecords.filter((r) => r.trialType === 'real');
    const noSignTrialsList = testRecords.filter((r) => r.trialType === 'nosign');

    const realSignAttempts = realTrials.length;
    const correct = realTrials.filter((r) => r.isCorrect).length;
    const wrong = realTrials.filter((r) => r.candidateSurfaced && !r.isCorrect).length;
    const missed = realTrials.filter((r) => !r.candidateSurfaced).length;
    const signAccuracy = realSignAttempts > 0 ? (correct / realSignAttempts) * 100 : 0;

    const allSurfaced = testRecords.filter((r) => r.candidateSurfaced);
    const correctSurfaced = allSurfaced.filter((r) => r.isCorrect);
    const candidatePrecision = allSurfaced.length > 0 ? (correctSurfaced.length / allSurfaced.length) * 100 : 100;
    const candidateRecall = realSignAttempts > 0 ? (correct / realSignAttempts) * 100 : 100;

    const noSignTrialsCount = noSignTrialsList.length;
    const validNoSignTrials = noSignTrialsCount;
    const falseCandidates = noSignTrialsList.filter((r) => r.candidateSurfaced).length;
    const noSignFalseActivationRate = noSignTrialsCount > 0 ? (falseCandidates / noSignTrialsCount) * 100 : 0;

    const recLats = testRecords
      .map((r) => r.recognitionLatencyMs)
      .filter((l): l is number => l !== null && l !== undefined);
    recLats.sort((a, b) => a - b);

    const meanRecognitionLatency =
      recLats.length > 0 ? Math.round(recLats.reduce((a, b) => a + b, 0) / recLats.length) : null;

    let medianRecognitionLatency: number | null = null;
    let p95RecognitionLatency: number | null = null;
    let maximumRecognitionLatency: number | null = null;

    if (recLats.length > 0) {
      const mid = Math.floor(recLats.length / 2);
      medianRecognitionLatency =
        recLats.length % 2 !== 0 ? recLats[mid] : Math.round((recLats[mid - 1] + recLats[mid]) / 2);
      const p95Idx = Math.min(Math.floor(recLats.length * 0.95), recLats.length - 1);
      p95RecognitionLatency = recLats[p95Idx];
      maximumRecognitionLatency = recLats[recLats.length - 1];
    }

    const perSignResults: Record<string, {
      attempts: number;
      correct: number;
      wrong: number;
      missed: number;
      accuracy: number;
    }> = {};

    for (const sign of SIGN_CLASSES) {
      const signTrials = realTrials.filter((r) => r.expectedSign === sign);
      const sAttempts = signTrials.length;
      const sCorrect = signTrials.filter((r) => r.isCorrect).length;
      const sWrong = signTrials.filter((r) => r.candidateSurfaced && !r.isCorrect).length;
      const sMissed = signTrials.filter((r) => !r.candidateSurfaced).length;
      perSignResults[sign] = {
        attempts: sAttempts,
        correct: sCorrect,
        wrong: sWrong,
        missed: sMissed,
        accuracy: sAttempts > 0 ? Number(((sCorrect / sAttempts) * 100).toFixed(1)) : 0,
      };
    }

    const signers = ['signer-01', 'signer-02', 'signer-03', 'signer-04'];
    const perSignerResults: Record<string, {
      attempts: number;
      correct: number;
      wrong: number;
      missed: number;
      accuracy: number;
    }> = {};

    for (const s of signers) {
      const sTrials = realTrials.filter((r) => r.signer === s);
      const sAttempts = sTrials.length;
      const sCorrect = sTrials.filter((r) => r.isCorrect).length;
      const sWrong = sTrials.filter((r) => r.candidateSurfaced && !r.isCorrect).length;
      const sMissed = sTrials.filter((r) => !r.candidateSurfaced).length;
      perSignerResults[s] = {
        attempts: sAttempts,
        correct: sCorrect,
        wrong: sWrong,
        missed: sMissed,
        accuracy: sAttempts > 0 ? Number(((sCorrect / sAttempts) * 100).toFixed(1)) : 0,
      };
    }

    const formattedTrials = testRecords.map((r) => {
      if (r.trialType === 'real') {
        return {
          id: r.id,
          timestamp: r.timestamp,
          trialType: 'real' as const,
          signer: r.signer,
          expectedSign: r.expectedSign,
          predictedSign: r.predictedSign,
          correct: r.isCorrect,
          candidateSurfaced: r.candidateSurfaced,
          confidence: Number(r.confidence.toFixed(4)),
          margin: Number(r.margin.toFixed(4)),
          trialLatencyMs: r.trialLatencyMs,
          recognitionLatencyMs: r.recognitionLatencyMs,
        };
      } else {
        return {
          id: r.id,
          timestamp: r.timestamp,
          trialType: 'nosign' as const,
          signer: r.signer,
          action: r.noSignAction,
          candidateSurfaced: r.candidateSurfaced,
          predictedSign: r.predictedSign,
          confidence: Number(r.confidence.toFixed(4)),
          margin: Number(r.margin.toFixed(4)),
          latencyMs: r.recognitionLatencyMs ?? r.trialLatencyMs,
          validTrial: true,
          excludedTrial: false,
        };
      }
    });

    const exportPayload = {
      exportTimestamp: now.toISOString(),
      evaluationDisclaimer:
        'Validation results only — not training data. Must NEVER be loaded into training/data/ or used for retraining.',
      model: 'communicare-aac-sign-v3-candidate',
      architecture: 'Conv1D(48) + GRU(64)',
      calibration: {
        confidence: 0.85,
        margin: 0.10,
        stability: 3,
        stride: 3,
      },
      summary: {
        realSignAttempts,
        correct,
        wrong,
        missed,
        signAccuracy: Number(signAccuracy.toFixed(2)),
        candidatePrecision: Number(candidatePrecision.toFixed(2)),
        candidateRecall: Number(candidateRecall.toFixed(2)),
        perSignResults,
        perSignerResults,
        noSignTrials: noSignTrialsCount,
        validNoSignTrials,
        falseCandidates,
        noSignFalseActivationRate: Number(noSignFalseActivationRate.toFixed(2)),
        meanRecognitionLatency,
        medianRecognitionLatency,
        p95RecognitionLatency,
        maximumRecognitionLatency,
      },
      trials: formattedTrials,
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [testRecords]);

  // Summary Metrics Calculation
  const realRecords = testRecords.filter((r) => r.trialType === 'real');
  const noSignRecords = testRecords.filter((r) => r.trialType === 'nosign');

  const realAttempts = realRecords.length;
  const correctReal = realRecords.filter((r) => r.isCorrect).length;
  const wrongReal = realRecords.filter((r) => r.candidateSurfaced && !r.isCorrect).length;
  const missedReal = realRecords.filter((r) => !r.candidateSurfaced).length;
  const realAccuracy = realAttempts > 0 ? (correctReal / realAttempts) * 100 : 0;

  const noSignTrials = noSignRecords.length;
  const falseCandidates = noSignRecords.filter((r) => r.candidateSurfaced).length;
  const falseActRate = noSignTrials > 0 ? (falseCandidates / noSignTrials) * 100 : 0;

  const allSurfaced = testRecords.filter((r) => r.candidateSurfaced);
  const correctSurfaced = allSurfaced.filter((r) => r.isCorrect);
  const precision = allSurfaced.length > 0 ? (correctSurfaced.length / allSurfaced.length) * 100 : 100;
  const recall = realAttempts > 0 ? (correctReal / realAttempts) * 100 : 100;

  const recLatencies = testRecords
    .filter((r) => r.recognitionLatencyMs !== null)
    .map((r) => r.recognitionLatencyMs!);
  const avgRecognitionLatency =
    recLatencies.length > 0 ? Math.round(recLatencies.reduce((a, b) => a + b, 0) / recLatencies.length) : null;

  const trialLatencies = testRecords
    .filter((r) => r.trialLatencyMs !== null)
    .map((r) => r.trialLatencyMs!);
  const avgTrialLatency =
    trialLatencies.length > 0 ? Math.round(trialLatencies.reduce((a, b) => a + b, 0) / trialLatencies.length) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                DEV TEST SURFACE
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                PHASE 2O DIAGNOSTICS
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
              V3 Live-Camera Validation &amp; Latency Diagnosis
            </h1>
            <p className="text-sm text-slate-400">
              Candidate B (Conv1D(48)+GRU(64)) | Calibration: Th $\ge 0.85$, Mg $\ge 0.10$, Stab $= 3/3$, Stride $= 3$ frames (100ms)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleResetRecognitionState}
              className="px-3 py-2 rounded-lg font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset State
            </button>
            <button
              onClick={isActive ? stop : start}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-xs transition-colors ${
                isActive
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {isActive ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
              {isActive ? 'Stop Camera' : 'Start Camera'}
            </button>
          </div>
        </div>

        {loadError && (
          <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{loadError}</p>
          </div>
        )}

        {/* Phase 2O Temporary Telemetry Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 block font-medium">Camera Render</span>
            <span className="text-lg font-bold text-white font-mono">{cameraFps} FPS</span>
            <span className="text-[10px] text-slate-500 block">Target: 30 FPS</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 block font-medium">MediaPipe Vision</span>
            <span className="text-lg font-bold text-emerald-400 font-mono">{mediaPipeFps} FPS</span>
            <span className="text-[10px] text-slate-500 block">{mediaPipeDurationMs} ms / frame</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 block font-medium">Frame Buffer</span>
            <span className="text-lg font-bold text-cyan-400 font-mono">{bufferSize} / 24</span>
            <span className="text-[10px] text-slate-500 block">Warm-up: {warmUpTimeMs ? `${warmUpTimeMs}ms` : 'active'}</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 block font-medium">Inference Cadence</span>
            <span className="text-lg font-bold text-blue-400 font-mono">{timeBetweenInferencesMs} ms</span>
            <span className="text-[10px] text-slate-500 block">ONNX: {lastInferenceTimeMs} ms</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 block font-medium">Hand Tracking</span>
            <span className={`text-lg font-bold font-mono ${handMissingCount === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {handMissingCount === 0 ? 'Present' : `0 hands (${handMissingCount}f)`}
            </span>
            <span className="text-[10px] text-slate-500 block">Missing hands slot = 0</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 block font-medium">Stability Reset Reason</span>
            <span className="text-xs font-mono text-amber-300 font-semibold block truncate" title={stabilityResetReason}>
              {stabilityResetReason}
            </span>
            <span className="text-[10px] text-slate-500 block">Surfaced: {candidateSurfacedTimestamp ?? 'none'}</span>
          </div>
        </div>

        {/* Main Grid: Camera & Telemetry */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Camera Viewport (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="relative aspect-[4/3] bg-slate-900 rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center">
              <video
                ref={handleVideoRef}
                playsInline
                muted
                autoPlay
                className={`absolute inset-0 w-full h-full object-cover transform -scale-x-100 ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none transform -scale-x-100"
              />

              {!isActive && (
                <div className="flex flex-col items-center text-slate-500 gap-2">
                  <Camera className="w-12 h-12 stroke-[1.5]" />
                  <p className="text-sm font-medium">Camera is inactive. Click Start Camera to begin.</p>
                </div>
              )}

              {/* Status Badges Overlay */}
              {isActive && (
                <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold backdrop-blur-md ${
                      top1Class === 'NO_SIGN'
                        ? 'bg-slate-900/80 text-slate-300 border border-slate-700'
                        : 'bg-amber-500/80 text-amber-950 font-bold border border-amber-400'
                    }`}
                  >
                    {top1Class === 'NO_SIGN' ? 'Watching for a sign…' : `Detected: ${top1Class}`}
                  </span>
                  <span className="px-2 py-1 rounded text-xs font-mono bg-slate-900/80 text-slate-300 border border-slate-700">
                    MP: {mediaPipeDurationMs}ms | ONNX: {lastInferenceTimeMs}ms
                  </span>
                  {isTrialArmed && (
                    <span className="px-2 py-1 rounded text-xs font-bold bg-blue-600 text-white animate-pulse">
                      TRIAL ARMED
                    </span>
                  )}
                </div>
              )}

              {/* Stability Bar Overlay */}
              {isActive && (
                <div className="absolute bottom-3 left-3 right-3 bg-slate-900/90 backdrop-blur-md rounded-lg p-2.5 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 font-medium">Stability:</span>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3].map((step) => (
                        <div
                          key={step}
                          className={`w-6 h-2 rounded-full transition-all duration-150 ${
                            consecutiveAcceptedCount >= step
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                              : 'bg-slate-700'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-mono text-emerald-400 font-bold">
                      {consecutiveAcceptedCount} / {requiredConsecutiveWindows}
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 font-mono">
                    Top 1: <strong className="text-white">{top1Class}</strong> ({(top1Confidence * 100).toFixed(1)}%) | Margin: {(currentMargin * 100).toFixed(1)}%
                  </div>
                </div>
              )}
            </div>

            {/* Surfaced Candidate Notification Card */}
            {surfacedCandidate && (
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 shadow-xl space-y-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500 text-slate-950">
                        CANDIDATE SURFACED
                      </span>
                      <span className="text-xs font-mono text-emerald-300">
                        Recognition Latency: {surfacedCandidate.recognitionLatencyMs}ms
                      </span>
                      {surfacedCandidate.trialLatencyMs && (
                        <span className="text-xs font-mono text-blue-300">
                          | Trial Elapsed: {surfacedCandidate.trialLatencyMs}ms
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-white mt-1 capitalize">
                      {surfacedCandidate.label}
                    </h3>
                    <p className="text-sm text-emerald-300">
                      Confidence: {(surfacedCandidate.confidence * 100).toFixed(1)}% | Margin: {(surfacedCandidate.margin * 100).toFixed(1)}%
                    </p>
                  </div>
                  <button
                    onClick={() => setSurfacedCandidate(null)}
                    className="p-1 rounded text-slate-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={handleUseMessage}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Use This Message
                  </button>
                </div>
              </div>
            )}

            {/* Confirmed AAC Message Preview */}
            {confirmedMessage && (
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                  Confirmed AAC Message (Requires Explicit Confirmation)
                </span>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-bold text-white">{confirmedMessage.english}</p>
                    <p className="text-md font-arabic text-emerald-400" dir="rtl">{confirmedMessage.urdu}</p>
                  </div>
                  <button
                    onClick={handleSpeak}
                    className="p-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 text-xs font-medium"
                  >
                    <Volume2 className="w-4 h-4" />
                    Speak
                  </button>
                </div>
              </div>
            )}

            {/* Latency Components Dissection (Phase 2O) */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
              <h4 className="font-semibold text-white flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-blue-400" />
                Latency Components Dissection (Phase 2O)
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                <div className="p-2 bg-slate-800/60 rounded">
                  <span className="text-slate-400 block text-[10px]">A. Warm-up (24f):</span>
                  <span className="text-white font-bold">{warmUpTimeMs ? `${warmUpTimeMs} ms` : '~800 ms (rolling)'}</span>
                </div>
                <div className="p-2 bg-slate-800/60 rounded">
                  <span className="text-slate-400 block text-[10px]">B. MediaPipe/Frame:</span>
                  <span className="text-white font-bold">{mediaPipeDurationMs} ms</span>
                </div>
                <div className="p-2 bg-slate-800/60 rounded">
                  <span className="text-slate-400 block text-[10px]">C. ONNX Inference:</span>
                  <span className="text-white font-bold">{lastInferenceTimeMs} ms</span>
                </div>
                <div className="p-2 bg-slate-800/60 rounded">
                  <span className="text-slate-400 block text-[10px]">D. Stability Delay (3w):</span>
                  <span className="text-white font-bold">{timeBetweenInferencesMs * 2} ms (2 strides)</span>
                </div>
                <div className="p-2 bg-slate-800/60 rounded">
                  <span className="text-slate-400 block text-[10px]">E. Cooldown:</span>
                  <span className="text-white font-bold">{cooldownMs} ms</span>
                </div>
                <div className="p-2 bg-slate-800/60 rounded">
                  <span className="text-slate-400 block text-[10px]">F. User Reaction Gap:</span>
                  <span className="text-amber-400 font-bold">~3000–4500 ms (manual click)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Telemetry & Manual Logging (5 Cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Live Model Telemetry */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                Live V3 Telemetry &amp; Locked Calibration
              </h3>

              <div className="space-y-2 text-xs">
                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>Top 1: <strong className="text-white capitalize">{top1Class}</strong></span>
                    <span className="font-mono">{(top1Confidence * 100).toFixed(1)}% (Req $\ge 85\%$)</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-100 ${
                        top1Confidence >= confidenceThreshold ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min(top1Confidence * 100, 100)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>Runner-up: <span className="capitalize">{top2Class}</span></span>
                    <span className="font-mono">{(top2Confidence * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Top1–Top2 Margin:</span>
                    <span className={`font-mono font-bold ${currentMargin >= marginThreshold ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {(currentMargin * 100).toFixed(1)}% (Req $\ge 10\%$)
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex justify-between text-slate-400 text-[11px]">
                  <span>Model: Candidate B (Conv1D+GRU)</span>
                  <span>Stride: 3 frames (100ms)</span>
                </div>
              </div>
            </div>

            {/* Manual Test Execution Controls */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-400" />
                  Record Validation Trial
                </h3>
                <button
                  onClick={handleArmTrial}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                    isTrialArmed
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {isTrialArmed ? 'Trial Armed' : 'Arm / Start Timer'}
                </button>
              </div>

              {/* Signer Selector */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">Current Signer</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {['signer-01', 'signer-02', 'signer-03', 'signer-04'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSelectedSigner(s)}
                      className={`py-1 text-xs rounded font-medium transition-colors ${
                        selectedSigner === s
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {s.replace('signer-', 'S')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Test Mode Selector */}
              <div className="flex rounded-lg bg-slate-800 p-0.5 text-xs">
                <button
                  onClick={() => setTestMode('real')}
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${
                    testMode === 'real' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Real Sign Attempt
                </button>
                <button
                  onClick={() => setTestMode('nosign')}
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${
                    testMode === 'nosign' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  NO_SIGN Action
                </button>
              </div>

              {testMode === 'real' ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Expected Sign</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {SIGN_CLASSES.map((sign) => (
                        <button
                          key={sign}
                          onClick={() => setSelectedExpectedSign(sign)}
                          className={`py-1 text-xs rounded capitalize transition-colors ${
                            selectedExpectedSign === sign
                              ? 'bg-emerald-600 text-white font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {sign}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => logAttempt(true)}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-md"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Record Real Sign Attempt
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">NO_SIGN Action</label>
                    <select
                      value={selectedNoSignAction}
                      onChange={(e) => setSelectedNoSignAction(e.target.value)}
                      className="w-full bg-slate-800 text-xs text-white rounded p-2 border border-slate-700"
                    >
                      {NO_SIGN_PRESETS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => logAttempt(false)}
                    className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    Record NO_SIGN Trial
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Validation Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">Real Attempts</span>
            <span className="text-lg font-bold text-white">{realAttempts}</span>
            <span className="text-[10px] text-slate-500 block">({correctReal} correct, {wrongReal} wrong, {missedReal} missed)</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">Sign Accuracy</span>
            <span className="text-lg font-bold text-emerald-400">{realAccuracy.toFixed(1)}%</span>
            <span className="text-[10px] text-slate-500 block">Real signs correctly surfaced</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">Candidate Precision</span>
            <span className="text-lg font-bold text-blue-400">{precision.toFixed(1)}%</span>
            <span className="text-[10px] text-slate-500 block">Correct / all surfaced</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">Candidate Recall</span>
            <span className="text-lg font-bold text-cyan-400">{recall.toFixed(1)}%</span>
            <span className="text-[10px] text-slate-500 block">Correct / real attempts</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">NO_SIGN Trials</span>
            <span className="text-lg font-bold text-white">{noSignTrials}</span>
            <span className="text-[10px] text-slate-500 block">({falseCandidates} false activations)</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">False Act Rate</span>
            <span className={`text-lg font-bold ${falseActRate <= 20 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {falseActRate.toFixed(1)}%
            </span>
            <span className="text-[10px] text-slate-500 block">Target: &lt; 20%</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">Recognition Latency</span>
            <span className="text-lg font-bold text-emerald-400">{avgRecognitionLatency ? `${avgRecognitionLatency}ms` : '-'}</span>
            <span className="text-[10px] text-slate-500 block">Algorithmic (~200ms)</span>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[11px] text-slate-400 font-medium block">Mean Trial Elapsed</span>
            <span className="text-lg font-bold text-white">{avgTrialLatency ? `${avgTrialLatency}ms` : '-'}</span>
            <span className="text-[10px] text-slate-500 block">Total Prep + Sign</span>
          </div>
        </div>

        {/* Recorded Trials Table */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                Trial Log ({testRecords.length} total)
              </h3>
              <p className="text-[11px] text-amber-400 font-medium mt-0.5">
                Validation results only — not training data.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportValidationResults}
                disabled={testRecords.length === 0}
                className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors ${
                  testRecords.length > 0
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                Export Validation Results (JSON)
              </button>
              {testRecords.length > 0 && (
                <button
                  onClick={() => setTestRecords([])}
                  className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1.5 rounded flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear Log
                </button>
              )}
            </div>
          </div>

          {testRecords.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">
              No trials recorded yet. Perform a sign or NO_SIGN activity and click "Record Real Sign Attempt" or "Record NO_SIGN Trial".
            </p>
          ) : (
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-xs text-left">
                <thead className="text-[11px] text-slate-400 bg-slate-800/50 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Signer</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Expected / Action</th>
                    <th className="py-2 px-3">Candidate Surfaced</th>
                    <th className="py-2 px-3">Predicted</th>
                    <th className="py-2 px-3">Confidence</th>
                    <th className="py-2 px-3">Margin</th>
                    <th className="py-2 px-3">Rec Latency</th>
                    <th className="py-2 px-3">Trial Latency</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {testRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/30">
                      <td className="py-1.5 px-3 font-mono text-slate-300">{r.signer}</td>
                      <td className="py-1.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          r.trialType === 'real' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-300'
                        }`}>
                          {r.trialType.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-white">
                        {r.expectedSign || r.noSignAction}
                      </td>
                      <td className="py-1.5 px-3 font-semibold">
                        {r.candidateSurfaced ? (
                          <span className="text-emerald-400">YES</span>
                        ) : (
                          <span className="text-slate-400">NO</span>
                        )}
                      </td>
                      <td className="py-1.5 px-3 capitalize text-slate-200">
                        {r.predictedSign || '-'}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-slate-300">
                        {(r.confidence * 100).toFixed(1)}%
                      </td>
                      <td className="py-1.5 px-3 font-mono text-slate-300">
                        {(r.margin * 100).toFixed(1)}%
                      </td>
                      <td className="py-1.5 px-3 font-mono text-emerald-400">
                        {r.recognitionLatencyMs ? `${r.recognitionLatencyMs}ms` : '-'}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-slate-300">
                        {r.trialLatencyMs ? `${r.trialLatencyMs}ms` : '-'}
                      </td>
                      <td className="py-1.5 px-3">
                        {r.isCorrect ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
                            <XCircle className="w-3.5 h-3.5" /> Fail
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
