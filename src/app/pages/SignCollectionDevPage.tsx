import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Check,
  Download,
  Trash2,
  Play,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { useCamera } from '@/hooks/useCamera';
import {
  extractHandFeatures,
  type RawHandData,
} from '@/features/signRecognition/handFeatureExtractor';
import type { LandmarkPoint } from '@/features/signRecognition/signTypes';
import {
  BASIC_SIGN_CLASSES,
  type BasicSignClass,
  type SignSampleRecord,
} from '@/features/signCollection/signCollectionTypes';
import { VERIFIED_SIGN_DEFINITIONS } from '@/features/signCollection/signVocabulary';
import { SignCollectionManager, sanitizeSignerAlias } from '@/features/signCollection/signCollectionManager';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const manager = new SignCollectionManager();

export function SignCollectionDevPage() {
  const { status, start, stop, setVideoRef } = useCamera();

  const [selectedClass, setSelectedClass] = useState<BasicSignClass>('water');
  const [signerAlias, setSignerAlias] = useState<string>('signer-01');
  const [targetCount, setTargetCount] = useState<number>(30);
  const [datasetRevision, setDatasetRevision] = useState<number>(0);

  const normalizedSigner = sanitizeSignerAlias(signerAlias);

  const currentSignerCounts = useMemo(() => {
    void datasetRevision;
    return manager.getCountsByClass(normalizedSigner);
  }, [normalizedSigner, datasetRevision]);

  const currentSignerTotal = useMemo(() => {
    void datasetRevision;
    return manager.getSignerTotalCount(normalizedSigner);
  }, [normalizedSigner, datasetRevision]);

  const overallTotal = useMemo(() => {
    void datasetRevision;
    return manager.getTotalCount();
  }, [datasetRevision]);

  // Recording State Machine
  const [recState, setRecState] = useState<'idle' | 'countdown' | 'recording' | 'review'>('idle');
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [recordedFrameCount, setRecordedFrameCount] = useState<number>(0);

  // Pending sample buffers (60 frames)
  const pendingRawFramesRef = useRef<number[][]>([]);
  const pendingNormFramesRef = useRef<number[][]>([]);
  const leftHandFramesRef = useRef<number>(0);
  const rightHandFramesRef = useRef<number>(0);
  const [pendingStats, setPendingStats] = useState<{ leftOccupancy: number; rightOccupancy: number } | null>(null);

  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const [isLandmarkerReady, setIsLandmarkerReady] = useState<boolean>(false);
  const [currentHands, setCurrentHands] = useState<{ hasLeft: boolean; hasRight: boolean }>({
    hasLeft: false,
    hasRight: false,
  });


  const isActive = status === 'active';

  const handleVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      setVideoNode(node);
      setVideoRef(node);
    },
    [setVideoRef]
  );

  // Initialize MediaPipe HandLandmarker
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
        console.error('Failed to load MediaPipe HandLandmarker in dev tool:', err);
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

  // Frame processing and recording loop
  useEffect(() => {
    if (!isActive || !videoNode || !isLandmarkerReady) return;

    let animId: number;
    let lastTime = 0;
    const frameIntervalMs = 1000 / 30; // 30 FPS

    const loop = (now: number) => {
      if (videoNode.readyState >= 2 && !videoNode.paused && !videoNode.ended) {
        if (now - lastTime >= frameIntervalMs) {
          lastTime = now;
          const landmarker = landmarkerRef.current;
          if (landmarker) {
            try {
              const res = landmarker.detectForVideo(videoNode, now);
              const rawHands: RawHandData[] = [];
              if (res.landmarks && res.handedness) {
                for (let i = 0; i < res.landmarks.length; i++) {
                  const lms = res.landmarks[i];
                  const handednessCategory = res.handedness[i]?.[0];
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

              // Extract raw unnormalized and normalized features with selfie camera orientation
              const rawResult = extractHandFeatures(rawHands, {
                cameraFacing: 'user',
                normalize: false,
              });
              const normResult = extractHandFeatures(rawHands, {
                cameraFacing: 'user',
                normalize: true,
              });

              setCurrentHands({
                hasLeft: rawResult.hasLeftHand,
                hasRight: rawResult.hasRightHand,
              });



              // Draw landmarks onto canvas
              const canvas = canvasRef.current;
              if (canvas) {
                if (videoNode.videoWidth > 0 && videoNode.videoHeight > 0) {
                  if (canvas.width !== videoNode.videoWidth || canvas.height !== videoNode.videoHeight) {
                    canvas.width = videoNode.videoWidth;
                    canvas.height = videoNode.videoHeight;
                  }
                }
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  const w = canvas.width;
                  const h = canvas.height;

                  const drawHand = (points: LandmarkPoint[], pointColor: string, lineColor: string) => {
                    ctx.strokeStyle = lineColor;
                    ctx.lineWidth = 3;
                    for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
                      const p1 = points[startIdx];
                      const p2 = points[endIdx];
                      if (p1 && p2) {
                        ctx.beginPath();
                        ctx.moveTo(p1.x * w, p1.y * h);
                        ctx.lineTo(p2.x * w, p2.y * h);
                        ctx.stroke();
                      }
                    }
                    for (const pt of points) {
                      ctx.fillStyle = pointColor;
                      ctx.beginPath();
                      ctx.arc(pt.x * w, pt.y * h, 4, 0, 2 * Math.PI);
                      ctx.fill();
                    }
                  };

                  if (rawResult.leftHandLandmarks) {
                    drawHand(rawResult.leftHandLandmarks, '#38bdf8', 'rgba(14, 165, 233, 0.7)');
                  }
                  if (rawResult.rightHandLandmarks) {
                    drawHand(rawResult.rightHandLandmarks, '#34d399', 'rgba(16, 185, 129, 0.7)');
                  }
                }
              }

              // Recording capture branch
              if (recState === 'recording') {
                if (pendingNormFramesRef.current.length < 60) {
                  pendingRawFramesRef.current.push(Array.from(rawResult.features));
                  pendingNormFramesRef.current.push(Array.from(normResult.features));
                  if (rawResult.hasLeftHand) leftHandFramesRef.current++;
                  if (rawResult.hasRightHand) rightHandFramesRef.current++;
                  setRecordedFrameCount(pendingNormFramesRef.current.length);

                  if (pendingNormFramesRef.current.length === 60) {
                    const lOcc = Math.round((leftHandFramesRef.current / 60) * 100);
                    const rOcc = Math.round((rightHandFramesRef.current / 60) * 100);
                    setPendingStats({ leftOccupancy: lOcc, rightOccupancy: rOcc });
                    setRecState('review');
                  }
                }
              }
            } catch (err) {
              console.warn('Frame detection error:', err);
            }
          }
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isActive, videoNode, isLandmarkerReady, recState]);

  // Countdown handler
  useEffect(() => {
    if (recState !== 'countdown') return;

    if (countdownValue > 1) {
      const timer = setTimeout(() => {
        setCountdownValue((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        pendingRawFramesRef.current = [];
        pendingNormFramesRef.current = [];
        leftHandFramesRef.current = 0;
        rightHandFramesRef.current = 0;
        setRecordedFrameCount(0);
        setRecState('recording');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [recState, countdownValue]);

  const handleStartCapture = () => {
    if (!isActive) {
      alert('Please start the camera first.');
      return;
    }
    setCountdownValue(3);
    setRecState('countdown');
  };

  const handleSaveSample = () => {
    if (pendingNormFramesRef.current.length !== 60) {
      alert('Cannot save: sequence must have exactly 60 frames.');
      return;
    }
    const sampleRecord: SignSampleRecord = {
      version: '1.0',
      label: selectedClass,
      sequenceLength: 60,
      featureSchema: 'wrist_normalized_v1',
      capturedAt: new Date().toISOString(),
      sessionId: `session-${Date.now()}`,
      signerAlias: normalizedSigner,
      cameraFacing: 'user',
      frames: pendingNormFramesRef.current,
      rawFrames: pendingRawFramesRef.current,
      normalizedFrames: pendingNormFramesRef.current,
      stats: {
        leftHandOccupancy: (pendingStats?.leftOccupancy ?? 0) / 100,
        rightHandOccupancy: (pendingStats?.rightOccupancy ?? 0) / 100,
      },
    };

    manager.addSample(sampleRecord);
    setDatasetRevision((r) => r + 1);
    setRecState('idle');
    setPendingStats(null);
  };

  const handleDiscardSample = () => {
    pendingRawFramesRef.current = [];
    pendingNormFramesRef.current = [];
    setPendingStats(null);
    setRecState('idle');
  };

  const handleDiscardLastSaved = () => {
    const discarded = manager.discardLastSample(normalizedSigner);
    if (discarded) {
      setDatasetRevision((r) => r + 1);
      alert(`Discarded last saved sample for "${discarded.label}" (${normalizedSigner}).`);
    } else {
      alert(`No samples to discard for signer "${normalizedSigner}".`);
    }
  };

  const handleDownloadDataset = () => {
    const jsonStr = manager.exportDatasetJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `communicare-psl-dataset-${normalizedSigner}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrevClass = () => {
    const idx = BASIC_SIGN_CLASSES.indexOf(selectedClass);
    const nextIdx = (idx - 1 + BASIC_SIGN_CLASSES.length) % BASIC_SIGN_CLASSES.length;
    setSelectedClass(BASIC_SIGN_CLASSES[nextIdx]);
  };

  const handleNextClass = () => {
    const idx = BASIC_SIGN_CLASSES.indexOf(selectedClass);
    const nextIdx = (idx + 1) % BASIC_SIGN_CLASSES.length;
    setSelectedClass(BASIC_SIGN_CLASSES[nextIdx]);
  };

  const currentDef = VERIFIED_SIGN_DEFINITIONS[selectedClass];
  const currentClassCount = currentSignerCounts[selectedClass] || 0;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', fontFamily: 'sans-serif' }}>
      {/* Dev Only Notice */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: 8,
          marginBottom: 20,
          color: '#92400e',
        }}
      >
        <AlertTriangle size={24} />
        <div>
          <strong>DEVELOPMENT TOOL ONLY — CommuniCare AAC Sign Dataset Collector</strong>
          <div style={{ fontSize: '0.85rem', marginTop: 2 }}>
            Collects 60-frame MediaPipe landmark feature sequences for model training. Zero photos, videos, or audio are ever recorded or uploaded.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
        {/* Left Column: Camera Preview and Real-Time Recording */}
        <div>
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4/3',
              background: '#0f172a',
              borderRadius: 12,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <video
              ref={handleVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)',
                display: isActive ? 'block' : 'none',
              }}
            />
            {isActive && (
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  transform: 'scaleX(-1)',
                }}
              />
            )}

            {!isActive && (
              <div style={{ color: '#94a3b8', textAlign: 'center' }}>
                <Camera size={48} style={{ margin: '0 auto 8px', display: 'block' }} />
                <p>Camera is off</p>
              </div>
            )}

            {/* Countdown Overlay */}
            {recState === 'countdown' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.7)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fbbf24',
                }}
              >
                <span style={{ fontSize: '6rem', fontWeight: 'bold' }}>{countdownValue}</span>
                <span style={{ fontSize: '1.2rem' }}>Get ready: perform {currentDef.englishLabel}</span>
              </div>
            )}

            {/* Recording Progress Overlay */}
            {recState === 'recording' && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  right: 12,
                  background: 'rgba(239, 68, 68, 0.9)',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.9rem',
                }}
              >
                <span>RECORDING SEQUENCE: {recordedFrameCount} / 60 frames</span>
                <div style={{ width: 100, height: 8, background: '#7f1d1d', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(recordedFrameCount / 60) * 100}%`,
                      height: '100%',
                      background: '#ffffff',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Camera Controls & Handedness Status */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 12,
            }}
          >
            <div>
              {!isActive ? (
                <button
                  type="button"
                  onClick={start}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    borderRadius: 6,
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  <Camera size={16} /> Start Camera
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stop}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    borderRadius: 6,
                    background: '#dc2626',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  <CameraOff size={16} /> Stop Camera
                </button>
              )}
            </div>

            {/* Handedness Indicators */}
            <div style={{ display: 'flex', gap: 12, fontSize: '0.85rem' }}>
              <span style={{ color: currentHands.hasLeft ? '#0284c7' : '#94a3b8', fontWeight: 600 }}>
                Left Hand: {currentHands.hasLeft ? 'Present' : 'Absent'}
              </span>
              <span style={{ color: currentHands.hasRight ? '#059669' : '#94a3b8', fontWeight: 600 }}>
                Right Hand: {currentHands.hasRight ? 'Present' : 'Absent'}
              </span>
            </div>
          </div>



          {/* Action Row */}
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
            }}
          >
            {recState === 'idle' && (
              <button
                type="button"
                onClick={handleStartCapture}
                disabled={!isActive || !isLandmarkerReady}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  background: isActive ? '#059669' : '#94a3b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  cursor: isActive ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Play size={20} /> Start Sample Recording
              </button>
            )}

            {recState === 'review' && pendingStats && (
              <div>
                <div style={{ marginBottom: 12, fontSize: '0.9rem', color: '#1e293b' }}>
                  <strong>Sequence Captured (60 frames):</strong>
                  <div style={{ marginTop: 4, display: 'flex', gap: 16 }}>
                    <span>Left Hand Occupancy: {pendingStats.leftOccupancy}%</span>
                    <span>Right Hand Occupancy: {pendingStats.rightOccupancy}%</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={handleSaveSample}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#16a34a',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Check size={18} /> Save Sample
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardSample}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Trash2 size={18} /> Discard Sample
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Class Selection, Instruction Guide, & Breakdown */}
        <div>
          {/* Signer Alias & Target Class Header */}
          <div
            style={{
              padding: 16,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Signer Alias (non-identifying)
                </label>
                <input
                  type="text"
                  value={signerAlias}
                  onChange={(e) => setSignerAlias(e.target.value)}
                  placeholder="signer-01"
                  disabled={recState !== 'idle'}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    marginTop: 4,
                    background: recState !== 'idle' ? '#f1f5f9' : '#fff',
                    cursor: recState !== 'idle' ? 'not-allowed' : 'text',
                  }}
                />
              </div>
              <div style={{ width: 100 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Target / Class
                </label>
                <input
                  type="number"
                  value={targetCount}
                  onChange={(e) => setTargetCount(Number(e.target.value) || 30)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    marginTop: 4,
                  }}
                />
              </div>
            </div>

            {/* Target Class Dropdown with Navigation */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Class to Record
                </label>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>
                  {currentClassCount} / {targetCount} samples ({normalizedSigner})
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handlePrevClass}
                  style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                  title="Previous Class"
                >
                  <ChevronLeft size={16} />
                </button>
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value as BasicSignClass)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    fontSize: '1rem',
                    fontWeight: 600,
                  }}
                >
                  {BASIC_SIGN_CLASSES.map((cls) => (
                    <option key={cls} value={cls}>
                      {VERIFIED_SIGN_DEFINITIONS[cls].englishLabel} ({VERIFIED_SIGN_DEFINITIONS[cls].urduLabel}) — {currentSignerCounts[cls] || 0} recorded
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleNextClass}
                  style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                  title="Next Class"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Verified Gesture Guide Card */}
          <div
            style={{
              padding: 16,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#1e3a8a' }}>
                {currentDef.englishLabel}
              </h3>
              <span lang="ur" dir="rtl" style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1e3a8a' }}>
                {currentDef.urduLabel}
              </span>
            </div>
            <p style={{ margin: '6px 0', fontSize: '0.85rem', color: '#334155' }}>
              <strong>PSL Source:</strong> {currentDef.pslSource}
            </p>
            <div style={{ marginTop: 8, padding: 8, background: '#ffffff', borderRadius: 6, fontSize: '0.88rem' }}>
              <p style={{ margin: '0 0 4px', color: '#0f172a' }}>{currentDef.gestureInstructions}</p>
              <p lang="ur" dir="rtl" style={{ margin: 0, color: '#475569' }}>
                {currentDef.urduInstructions}
              </p>
            </div>
          </div>

          {/* Dataset Breakdown Table */}
          <div
            style={{
              padding: 16,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#0f172a' }}>
                  Overall Dataset: {overallTotal} samples
                </h4>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 2 }}>
                  Current Signer ({normalizedSigner}): {currentSignerTotal} samples
                </div>
              </div>
              <button
                type="button"
                onClick={handleDiscardLastSaved}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={12} /> Discard Last
              </button>
            </div>

            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '4px 0' }}>Class</th>
                  <th style={{ padding: '4px 0', textAlign: 'center' }}>Samples</th>
                  <th style={{ padding: '4px 0', width: 120 }}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {BASIC_SIGN_CLASSES.map((cls) => {
                  const cnt = currentSignerCounts[cls] || 0;
                  const pct = Math.min(100, Math.round((cnt / targetCount) * 100));
                  return (
                    <tr
                      key={cls}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: selectedClass === cls ? '#f0fdf4' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedClass(cls)}
                    >
                      <td style={{ padding: '6px 0', fontWeight: selectedClass === cls ? 600 : 400 }}>
                        {cls}
                      </td>
                      <td style={{ padding: '6px 0', textAlign: 'center' }}>
                        {cnt} / {targetCount}
                      </td>
                      <td style={{ padding: '6px 0' }}>
                        <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: cnt >= targetCount ? '#16a34a' : '#3b82f6',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Export and Actions */}
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleDownloadDataset}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  background: '#0f172a',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Download size={16} /> Download Dataset (JSON)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
