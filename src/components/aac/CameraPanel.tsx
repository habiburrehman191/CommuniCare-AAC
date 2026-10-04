import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, Check, Sparkles, X } from 'lucide-react';
import { useCamera } from '@/hooks/useCamera';
import type { CameraController } from '@/features/camera/cameraController';
import { useSignRecognition, type UseSignRecognitionOptions } from '@/hooks/useSignRecognition';
import { useCommunicationStore } from '@/store/communicationStore';
import type { LandmarkPoint } from '@/features/signRecognition/signTypes';

interface Props {
  controller?: CameraController;
  signOptions?: Partial<UseSignRecognitionOptions>;
}

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function CameraPanel({ controller, signOptions }: Props) {
  const {
    status,
    error,
    start,
    stop,
    switchCamera,
    canSwitch,
    setVideoRef,
  } = useCamera(controller);

  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      setVideoNode(node);
      setVideoRef(node);
    },
    [setVideoRef]
  );

  const isActive = status === 'active';
  const isRequesting = status === 'requesting';

  const signRecognition = useSignRecognition({
    videoElement: videoNode,
    isActive,
    ...signOptions,
  });

  const applyPslMessage = useCommunicationStore((s) => s.applyPslMessage);

  // Diagnostic Landmark Overlay Drawing (real-time 30 FPS)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!isActive || !signRecognition.overlayLandmarks) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (videoNode && videoNode.videoWidth > 0 && videoNode.videoHeight > 0) {
      if (canvas.width !== videoNode.videoWidth || canvas.height !== videoNode.videoHeight) {
        canvas.width = videoNode.videoWidth;
        canvas.height = videoNode.videoHeight;
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;

    const drawHand = (points: LandmarkPoint[], pointColor: string, lineColor: string) => {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

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
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    if (signRecognition.overlayLandmarks.left) {
      drawHand(signRecognition.overlayLandmarks.left, '#38bdf8', 'rgba(14, 165, 233, 0.7)');
    }
    if (signRecognition.overlayLandmarks.right) {
      drawHand(signRecognition.overlayLandmarks.right, '#34d399', 'rgba(16, 185, 129, 0.7)');
    }
  }, [isActive, signRecognition.overlayLandmarks, videoNode]);

  const handleUseMessage = () => {
    if (!signRecognition.candidate) return;
    applyPslMessage(
      signRecognition.candidate.englishMessage,
      signRecognition.candidate.urduMessage
    );
    signRecognition.clearCandidate();
  };

  return (
    <section className="camera-surface" aria-labelledby="camera-heading">
      <div className="camera-heading">
        <div className="camera-title-wrap">
          <h2 id="camera-heading">Basic AAC Sign Recognition</h2>
          <span className="sr-only">PSL Sign Recognition</span>
          <span lang="ur" dir="rtl" className="urdu-sublabel">
            بنیادی اشاروں کی پہچان (PSL)
          </span>
        </div>
        <p className="quiet-hint">
          <span>Live hand tracking and basic AAC sign recognition run privately on this device.</span>{' '}
          <span lang="ur" dir="rtl" className="urdu-hint">
            لائیو ہینڈ ٹریکنگ اور بنیادی اشاروں کی پہچان اسی ڈیوائس پر نجی طور پر چلتی ہے۔
          </span>
        </p>
      </div>

      <div
        className={`camera-preview-container ${isActive ? 'active' : ''}`}
        aria-live="polite"
      >
        <video
          ref={handleVideoRef}
          autoPlay
          playsInline
          muted
          aria-label="Live camera preview for sign recognition"
          className={`camera-video ${isActive ? 'visible' : 'hidden'}`}
        />

        {isActive && (
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="camera-landmark-canvas"
          />
        )}

        {!isActive && (
          <div className="camera-placeholder" aria-hidden="true">
            <Camera className="camera-placeholder-icon" />
            <p className="camera-placeholder-text">
              {isRequesting ? 'Opening camera…' : 'Camera is off · Start to recognize Pakistan Sign Language'}
            </p>
          </div>
        )}
      </div>

      {isActive && (
        <div className="psl-recognition-area" role="region" aria-label="PSL Recognition Results">
          <div className="psl-status-header">
            <div className={`psl-status-row psl-status-pill state-${signRecognition.state}`} role="status">
              <span className="psl-status-text">
                {signRecognition.statusMessage || (
                  signRecognition.state === 'loading'
                    ? 'Loading PSL Model…'
                    : signRecognition.state === 'calibrating'
                    ? 'Basic sign recognition model is being calibrated.'
                    : signRecognition.state === 'no-hands'
                    ? 'No hands detected'
                    : signRecognition.state === 'unavailable'
                    ? 'Sign recognition unavailable'
                    : 'Ready for your sign'
                )}
              </span>
            </div>
          </div>

          {signRecognition.candidate && (
            <div className="psl-detection-card" role="alert" aria-live="assertive">
              <div className="psl-card-header">
                <div className="psl-badge psl-badge-detected">
                  <Sparkles className="psl-icon-sm" aria-hidden="true" />
                  <span>Detected Sign: {signRecognition.candidate.label.toUpperCase()}</span>
                </div>
                <span className="psl-confidence-pill">
                  {Math.round(signRecognition.candidate.confidence * 100)}% match
                </span>
              </div>

              <div className="psl-message-box">
                <p className="psl-message-en">{signRecognition.candidate.englishMessage}</p>
                <p className="psl-message-ur" lang="ur" dir="rtl">
                  {signRecognition.candidate.urduMessage}
                </p>
              </div>

              <div className="psl-actions-row">
                <button
                  type="button"
                  className="action-button primary-button psl-use-btn"
                  onClick={handleUseMessage}
                  aria-label="Use this message"
                >
                  <Check className="psl-icon-sm" aria-hidden="true" />
                  <span className="psl-btn-en">Use this message</span>
                  <span lang="ur" dir="rtl" className="psl-btn-ur">
                    یہ پیغام استعمال کریں
                  </span>
                </button>
                <button
                  type="button"
                  className="action-button psl-dismiss-btn"
                  onClick={signRecognition.clearCandidate}
                  aria-label="Dismiss sign candidate"
                  title="Dismiss"
                >
                  <X className="psl-icon-sm" aria-hidden="true" />
                  <span>Dismiss</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="camera-controls">
        {isActive && (
          <div className="camera-active-actions">
            <button
              type="button"
              className="action-button stop-button camera-action-btn"
              onClick={stop}
              aria-label="Stop Camera"
            >
              <CameraOff aria-hidden="true" />
              <span className="camera-btn-en">Stop Camera</span>
              <span lang="ur" dir="rtl" className="camera-btn-ur">
                کیمرہ بند کریں
              </span>
            </button>

            {canSwitch && (
              <button
                type="button"
                className="action-button camera-action-btn"
                onClick={switchCamera}
                aria-label="Switch Camera"
              >
                <RefreshCw aria-hidden="true" />
                <span className="camera-btn-en">Switch Camera</span>
                <span lang="ur" dir="rtl" className="camera-btn-ur">
                  کیمرہ تبدیل کریں
                </span>
              </button>
            )}
          </div>
        )}

        {!isActive && (
          <button
            type="button"
            className="action-button primary-button camera-action-btn"
            onClick={start}
            disabled={status === 'unsupported' || isRequesting}
            aria-label="Start Camera for Sign Language"
          >
            <Camera aria-hidden="true" />
            <span className="camera-btn-en">{isRequesting ? 'Opening camera…' : 'Start Camera'}</span>
            <span lang="ur" dir="rtl" className="camera-btn-ur">
              {isRequesting ? 'کھول رہا ہے…' : 'کیمرہ شروع کریں'}
            </span>
          </button>
        )}
      </div>

      <div className="camera-status-area" role="status" aria-live="polite">
        <p className="camera-status-text">
          {isRequesting
            ? 'Requesting camera access…'
            : isActive
            ? 'Camera live · Hand tracking active'
            : status === 'error'
            ? 'Camera needs attention'
            : status === 'unsupported'
            ? 'Camera not supported'
            : 'Camera off'}
        </p>

        {error && (
          <p className="input-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <p className="privacy-notice camera-privacy" role="note">
        <span>
          Camera processing will be local to this device. CommuniCare does not record or upload camera video.
        </span>{' '}
        <span lang="ur" dir="rtl">
          کیمرہ ویڈیو صرف اسی ڈیوائس پر استعمال ہوگی۔ CommuniCare ویڈیو کو ریکارڈ یا اپ لوڈ نہیں کرتا۔
        </span>
      </p>
    </section>
  );
}
