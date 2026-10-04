import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { LandmarkPoint, SignRecognitionSnapshot } from '@/features/signRecognition/signTypes';
import { extractHandFeatures, type RawHandData } from '@/features/signRecognition/handFeatureExtractor';
import { SequenceBuffer } from '@/features/signRecognition/sequenceBuffer';
import { OnnxSignClassifier } from '@/features/signRecognition/onnxSignClassifier';
import { SignStabilizer } from '@/features/signRecognition/signStabilizer';

import type { PredictionResult } from '@/features/signRecognition/signTypes';

export interface ISignClassifier {
  ready: boolean;
  load: () => Promise<void>;
  predict: (flattenedSequence: Float32Array) => Promise<PredictionResult | null>;
  classCount: number;
}

export interface UseSignRecognitionOptions {
  videoElement?: HTMLVideoElement | null;
  isActive?: boolean;
  customClassifier?: ISignClassifier;
  customLandmarker?: {
    detectForVideo: (video: HTMLVideoElement, timestamp: number) => {
      landmarks?: Array<Array<{ x: number; y: number; z: number }>>;
      handedness?: Array<Array<{ categoryName?: string; displayName?: string; score?: number }>>;
    };
    close?: () => void;
  };
  modelPath?: string;
  labelsPath?: string;
  wasmPath?: string;
  handLandmarkerPath?: string;
  targetFps?: number;
  minConfidenceThreshold?: number;
  marginThreshold?: number;
  requiredStableWindows?: number;
  inferenceStrideFrames?: number;
  cooldownMs?: number;
  /**
   * Whether to run sign model inference.
   * Default is true for the CommuniCare AAC Sign V3 model.
   */
  enabled?: boolean;
  /**
   * Legacy V1 flag preserved for backward compatibility.
   * Setting false keeps inference disabled in calibration mode.
   */
  enableV1Inference?: boolean;
}

export interface SignDevDiagnostics {
  model: 'loaded' | 'failed';
  handCount: 0 | 1 | 2;
  featureFrame: 'valid' | 'invalid';
  nonzeroFeatures: number;
  buffer: number;
  bufferFull: boolean;
  framesSinceLastInference: number;
  inferenceCalls: number;
  inferenceRunning: boolean;
  rawTop1: string;
  rawTop1Confidence: number;
  rawTop2: string;
  rawTop2Confidence: number;
  stabilizer: string;
  decision: 'warming-up' | 'no-sign' | 'low-confidence' | 'unstable' | 'accepted' | 'error';
  candidate: string;
}

const INITIAL_SNAPSHOT: SignRecognitionSnapshot = {
  state: 'loading',
  statusMessage: 'Loading PSL Model…',
  isModelReady: false,
  isTrackingActive: false,
  detectedSign: null,
  confidence: 0,
  candidate: null,
  overlayLandmarks: null,
  bufferFillRatio: 0,
  error: null,
};

export function useSignRecognition(options: UseSignRecognitionOptions = {}) {
  const {
    videoElement,
    isActive = false,
    customClassifier,
    customLandmarker,
    modelPath = '/models/communicare-aac-sign-v3-candidate/model.onnx',
    labelsPath = '/models/communicare-aac-sign-v3-candidate/labels.json',
    wasmPath = '/wasm/mediapipe',
    handLandmarkerPath = '/models/mediapipe/hand_landmarker.task',
    targetFps = 30,
    minConfidenceThreshold = 0.85,
    marginThreshold = 0.10,
    requiredStableWindows = 3,
    inferenceStrideFrames = 3,
    cooldownMs = 500,
    enabled = true,
    enableV1Inference,
  } = options;

  const isInitiallyReady = Boolean(customClassifier?.ready);
  const [snapshot, setSnapshot] = useState<SignRecognitionSnapshot>(() => ({
    ...INITIAL_SNAPSHOT,
    isModelReady: isInitiallyReady,
    state: isInitiallyReady ? 'collecting' : 'loading',
    statusMessage: isInitiallyReady ? 'Watching for a sign...' : 'Loading PSL Model…',
  }));

  const classifierRef = useRef<ISignClassifier | null>(null);
  const landmarkerRef = useRef<{
    detectForVideo: (video: HTMLVideoElement, timestamp: number) => {
      landmarks?: Array<Array<{ x: number; y: number; z: number }>>;
      handedness?: Array<Array<{ categoryName?: string; displayName?: string; score?: number }>>;
    };
    close?: () => void;
  } | null>(null);

  const bufferRef = useRef<SequenceBuffer>(new SequenceBuffer(15));
  const stabilizerRef = useRef<SignStabilizer>(
    new SignStabilizer({ minConfidenceThreshold, marginThreshold, requiredStableWindows, cooldownMs })
  );

  const animFrameIdRef = useRef<number | null>(null);
  const lastFrameTimestampRef = useRef<number>(0);
  const framesSinceLastInferenceRef = useRef<number>(0);
  const inferenceCallsCountRef = useRef<number>(0);
  const isPredictingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  const devDiagnosticsRef = useRef<SignDevDiagnostics>({
    model: 'failed',
    handCount: 0,
    featureFrame: 'invalid',
    nonzeroFeatures: 0,
    buffer: 0,
    bufferFull: false,
    framesSinceLastInference: 0,
    inferenceCalls: 0,
    inferenceRunning: false,
    rawTop1: 'none',
    rawTop1Confidence: 0,
    rawTop2: 'none',
    rawTop2Confidence: 0,
    stabilizer: '0/3',
    decision: 'warming-up',
    candidate: 'none',
  });

  const isInferenceEnabled = customClassifier ? true : (enabled && enableV1Inference !== false);

  // Re-configure stabilizer when options change
  useEffect(() => {
    stabilizerRef.current = new SignStabilizer({
      minConfidenceThreshold,
      marginThreshold,
      requiredStableWindows,
      cooldownMs,
    });
  }, [minConfidenceThreshold, marginThreshold, requiredStableWindows, cooldownMs]);

  // 1. Initialize models (MediaPipe HandLandmarker + Classifier)
  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    async function initModels() {
      try {
        setSnapshot((prev) => ({
          ...prev,
          state: 'loading',
          statusMessage: 'Loading PSL Model…',
          error: null,
        }));

        // Init classifier: use customClassifier if provided, else initialize CommuniCare AAC V1 model
        if (customClassifier) {
          if (!customClassifier.ready) {
            await customClassifier.load();
          }
          if (cancelled) return;
          classifierRef.current = customClassifier;
        } else if (isInferenceEnabled) {
          const classifier = new OnnxSignClassifier({ modelPath, labelsPath });
          if (!classifier.ready) {
            await classifier.load();
          }
          if (cancelled) return;
          classifierRef.current = classifier;
        } else {
          classifierRef.current = null;
        }

        // Init MediaPipe HandLandmarker
        if (customLandmarker) {
          landmarkerRef.current = customLandmarker;
        } else {
          const vision = await FilesetResolver.forVisionTasks(wasmPath);
          if (cancelled) return;

          const landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: handLandmarkerPath,
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          if (cancelled) {
            landmarker.close?.();
            return;
          }
          landmarkerRef.current = landmarker;
        }

        if (!cancelled && isMountedRef.current) {
          const defaultState = (!customClassifier && !isInferenceEnabled) ? 'calibrating' : 'collecting';
          const defaultStatus = defaultState === 'calibrating'
            ? 'Basic sign recognition model is being calibrated.'
            : 'Watching for a sign...';

          devDiagnosticsRef.current.model = classifierRef.current?.ready ? 'loaded' : 'failed';

          setSnapshot((prev) => ({
            ...prev,
            isModelReady: true,
            state: defaultState,
            statusMessage: defaultStatus,
            error: null,
          }));
        }
      } catch (err) {
        if (!cancelled && isMountedRef.current) {
          devDiagnosticsRef.current.model = 'failed';
          const msg = err instanceof Error ? err.message : String(err);
          setSnapshot((prev) => ({
            ...prev,
            isModelReady: false,
            state: 'unavailable',
            statusMessage: 'Sign recognition unavailable',
            error: msg,
          }));
        }
      }
    }

    void initModels();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      if (landmarkerRef.current && !customLandmarker) {
        try {
          landmarkerRef.current.close?.();
        } catch {
          // ignore
        }
      }
    };
  }, [customClassifier, customLandmarker, modelPath, labelsPath, wasmPath, handLandmarkerPath, isInferenceEnabled]);

  // 2. Real-time sliding-window tracking loop
  useEffect(() => {
    if (!isActive || !videoElement || !snapshot.isModelReady) {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      bufferRef.current.reset();
      stabilizerRef.current.reset();
      framesSinceLastInferenceRef.current = 0;
      isPredictingRef.current = false;
      setSnapshot((prev) => {
        if (!prev.isTrackingActive && prev.bufferFillRatio === 0 && !prev.candidate) {
          return prev;
        }
        return {
          ...prev,
          isTrackingActive: false,
          overlayLandmarks: null,
          bufferFillRatio: 0,
          detectedSign: null,
          confidence: 0,
          candidate: null,
          state: prev.isModelReady ? ((!customClassifier && !isInferenceEnabled) ? 'calibrating' : 'collecting') : prev.state,
          statusMessage: (!customClassifier && !isInferenceEnabled)
            ? 'Basic sign recognition model is being calibrated.'
            : 'Camera ready',
        };
      });
      return;
    }

    setSnapshot((prev) => ({ ...prev, isTrackingActive: true }));

    const frameIntervalMs = 1000 / targetFps;

    const processFrame = async () => {
      if (!isMountedRef.current || !isActive || !videoElement) {
        return;
      }

      // Check if video is playing and has data
      if (videoElement.readyState >= 2 && !videoElement.paused && !videoElement.ended) {
        const now = performance.now();
        if (now - lastFrameTimestampRef.current >= frameIntervalMs) {
          lastFrameTimestampRef.current = now;

          const landmarker = landmarkerRef.current;
          const classifier = classifierRef.current;

          if (landmarker) {
            try {
              const result = landmarker.detectForVideo(videoElement, now);

              const rawHands: RawHandData[] = [];
              if (result.landmarks && result.handedness) {
                for (let i = 0; i < result.landmarks.length; i++) {
                  const lms = result.landmarks[i];
                  const handednessCategory = result.handedness[i]?.[0];
                  const handednessName =
                    handednessCategory?.categoryName ??
                    (handednessCategory?.displayName || 'Left');
                  const score = handednessCategory?.score ?? 1.0;
                  if (lms && lms.length > 0) {
                    rawHands.push({
                      landmarks: lms,
                      handedness: handednessName,
                      score,
                    });
                  }
                }
              }

              // Extract normalized 126 features (60 x 126 contract)
              const frameResult = extractHandFeatures(rawHands, {
                cameraFacing: 'user',
                normalize: true,
              });

              // Landmark overlay for real-time 30 FPS display
              const overlayLandmarks: {
                left?: LandmarkPoint[];
                right?: LandmarkPoint[];
              } = {};
              if (frameResult.leftHandLandmarks) {
                overlayLandmarks.left = frameResult.leftHandLandmarks;
              }
              if (frameResult.rightHandLandmarks) {
                overlayLandmarks.right = frameResult.rightHandLandmarks;
              }

              // Calibration mode (no classifier)
              if (!classifier) {
                if (isMountedRef.current) {
                  setSnapshot((prev) => ({
                    ...prev,
                    state: frameResult.handCount > 0 ? 'calibrating' : 'no-hands',
                    statusMessage: 'Basic sign recognition model is being calibrated.',
                    detectedSign: null,
                    confidence: 0,
                    candidate: null,
                    overlayLandmarks: frameResult.handCount > 0 ? overlayLandmarks : null,
                    bufferFillRatio: 0,
                  }));
                }
                if (isMountedRef.current && isActive) {
                  animFrameIdRef.current = requestAnimationFrame(processFrame);
                }
                return;
              }

              // Push into rolling 60-frame buffer
              const isBufferFull = bufferRef.current.push(
                frameResult.features,
                frameResult.handCount > 0
              );
              const fillRatio = bufferRef.current.fillRatio;
              framesSinceLastInferenceRef.current++;

              const nonzeroCount = Array.from(frameResult.features).filter((v) => v !== 0).length;
              const isFeatureValid =
                frameResult.features.length === 126 &&
                Array.from(frameResult.features).every(Number.isFinite);

              devDiagnosticsRef.current.model = classifier ? (classifier.ready ? 'loaded' : 'failed') : 'failed';
              devDiagnosticsRef.current.handCount = Math.min(2, Math.max(0, frameResult.handCount)) as 0 | 1 | 2;
              devDiagnosticsRef.current.featureFrame = isFeatureValid ? 'valid' : 'invalid';
              devDiagnosticsRef.current.nonzeroFeatures = nonzeroCount;
              devDiagnosticsRef.current.buffer = bufferRef.current.length;
              devDiagnosticsRef.current.bufferFull = isBufferFull;
              devDiagnosticsRef.current.framesSinceLastInference = framesSinceLastInferenceRef.current;

              // 1. Hand-presence check: if hands dropped out of frame
              if (frameResult.handCount === 0) {
                const isTransientDropout = bufferRef.current.missingHandCount <= 5;
                if (!isTransientDropout) {
                  const output = stabilizerRef.current.process(null, 0, isBufferFull, Date.now());
                  devDiagnosticsRef.current.stabilizer = output.stabilizerProgress ?? '0/3';
                  devDiagnosticsRef.current.decision = 'warming-up';
                  if (isMountedRef.current) {
                    setSnapshot((prev) => ({
                      ...prev,
                      state: output.state,
                      statusMessage: output.statusMessage,
                      detectedSign: null,
                      confidence: 0,
                      overlayLandmarks: null,
                      bufferFillRatio: fillRatio,
                    }));
                  }
                } else {
                  // Transient 1-5 frame flicker (<160ms): clear overlay landmarks, keep temporal stability
                  if (isMountedRef.current) {
                    setSnapshot((prev) => ({
                      ...prev,
                      overlayLandmarks: null,
                      bufferFillRatio: fillRatio,
                    }));
                  }
                }

                if (import.meta.env.DEV && typeof window !== 'undefined') {
                  (window as unknown as { __SIGN_DEV_DIAGNOSTICS__?: SignDevDiagnostics }).__SIGN_DEV_DIAGNOSTICS__ =
                    devDiagnosticsRef.current;
                }

                if (isMountedRef.current && isActive) {
                  animFrameIdRef.current = requestAnimationFrame(processFrame);
                }
                return;
              }

              // 2. Initial warm-up: before 24 frames are available
              if (!isBufferFull) {
                const output = stabilizerRef.current.process(null, frameResult.handCount, false, Date.now());
                devDiagnosticsRef.current.decision = 'warming-up';
                devDiagnosticsRef.current.stabilizer = output.stabilizerProgress ?? '0/3';
                if (isMountedRef.current) {
                  setSnapshot((prev) => ({
                    ...prev,
                    state: output.state,
                    statusMessage: output.statusMessage,
                    overlayLandmarks,
                    bufferFillRatio: fillRatio,
                  }));
                }

                if (import.meta.env.DEV && typeof window !== 'undefined') {
                  (window as unknown as { __SIGN_DEV_DIAGNOSTICS__?: SignDevDiagnostics }).__SIGN_DEV_DIAGNOSTICS__ =
                    devDiagnosticsRef.current;
                }

                if (isMountedRef.current && isActive) {
                  animFrameIdRef.current = requestAnimationFrame(processFrame);
                }
                return;
              }

              // 3. Stride-based sliding-window inference
              if (
                !isPredictingRef.current &&
                framesSinceLastInferenceRef.current >= inferenceStrideFrames
              ) {
                const flattened = bufferRef.current.getFlattened();
                if (flattened) {
                  isPredictingRef.current = true;
                  framesSinceLastInferenceRef.current = 0;
                  inferenceCallsCountRef.current++;
                  devDiagnosticsRef.current.inferenceCalls = inferenceCallsCountRef.current;
                  devDiagnosticsRef.current.inferenceRunning = true;
                  try {
                    const prediction = await classifier.predict(flattened);
                    if (prediction) {
                      devDiagnosticsRef.current.rawTop1 = prediction.label;
                      devDiagnosticsRef.current.rawTop1Confidence = prediction.confidence;
                      devDiagnosticsRef.current.rawTop2 = prediction.top2?.label ?? 'none';
                      devDiagnosticsRef.current.rawTop2Confidence = prediction.top2?.confidence ?? 0;
                    }
                    if (isMountedRef.current) {
                      const output = stabilizerRef.current.process(
                        prediction,
                        frameResult.handCount,
                        true,
                        Date.now()
                      );
                      devDiagnosticsRef.current.stabilizer = output.stabilizerProgress ?? '0/3';
                      devDiagnosticsRef.current.decision = output.decision ?? 'warming-up';
                      if (output.candidate) {
                        devDiagnosticsRef.current.candidate = output.candidate.label;
                      }

                      setSnapshot((prev) => ({
                        ...prev,
                        state: output.state,
                        statusMessage: output.statusMessage,
                        detectedSign: output.detectedSign,
                        confidence: output.confidence,
                        candidate: output.candidate ?? prev.candidate,
                        overlayLandmarks,
                        bufferFillRatio: fillRatio,
                      }));
                    }
                  } catch (err) {
                    devDiagnosticsRef.current.decision = 'error';
                    console.warn('Sign recognition frame error:', err);
                  } finally {
                    isPredictingRef.current = false;
                    devDiagnosticsRef.current.inferenceRunning = false;
                  }
                }
              } else {
                // Intermediate frame: keep current state, update landmark overlay
                if (isMountedRef.current) {
                  setSnapshot((prev) => ({
                    ...prev,
                    overlayLandmarks,
                    bufferFillRatio: fillRatio,
                  }));
                }
              }

              if (import.meta.env.DEV && typeof window !== 'undefined') {
                (window as unknown as { __SIGN_DEV_DIAGNOSTICS__?: SignDevDiagnostics }).__SIGN_DEV_DIAGNOSTICS__ =
                  devDiagnosticsRef.current;
              }
            } catch (err) {
              console.warn('Sign recognition frame error:', err);
            }
          }
        }
      }

      if (isMountedRef.current && isActive) {
        animFrameIdRef.current = requestAnimationFrame(processFrame);
      }
    };

    animFrameIdRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [isActive, videoElement, snapshot.isModelReady, targetFps, customClassifier, isInferenceEnabled, inferenceStrideFrames]);

  const clearCandidate = () => {
    stabilizerRef.current.clearCandidate();
    setSnapshot((prev) => ({
      ...prev,
      candidate: null,
      detectedSign: null,
      confidence: 0,
      statusMessage: 'Ready for your sign',
    }));
  };

  const resetBuffer = () => {
    bufferRef.current.reset();
    stabilizerRef.current.reset();
    framesSinceLastInferenceRef.current = 0;
    setSnapshot((prev) => ({
      ...prev,
      candidate: null,
      detectedSign: null,
      confidence: 0,
      bufferFillRatio: 0,
      state: 'collecting',
      statusMessage: 'Watching for a sign...',
    }));
  };

  return {
    ...snapshot,
    clearCandidate,
    resetBuffer,
  };
}
