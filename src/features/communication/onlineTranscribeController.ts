import { sendAudioForTranscription } from './onlineTranscribe';
import type { TranscribeResult } from './onlineTranscribe';

export interface MediaRecorderPort {
  state: 'inactive' | 'recording' | 'paused';
  mimeType: string;
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface MediaStreamTrackPort {
  stop(): void;
}

export interface MediaStreamPort {
  getTracks(): MediaStreamTrackPort[];
}

export type OnlineTranscribeStatus = 'idle' | 'recording' | 'transcribing' | 'error';

export interface OnlineTranscribeSnapshot {
  status: OnlineTranscribeStatus;
  error: string | null;
}

export interface ControllerDeps {
  getAudioStream?: () => Promise<MediaStreamPort>;
  createRecorder?: (stream: MediaStreamPort) => MediaRecorderPort;
  transcribeAudio?: (blob: Blob, signal: AbortSignal) => Promise<TranscribeResult>;
}

export class OnlineTranscribeController {
  private session = 0;
  private state: OnlineTranscribeSnapshot = { status: 'idle', error: null };
  private listeners = new Set<() => void>();
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRecorder: MediaRecorderPort | null = null;
  private currentStream: MediaStreamPort | null = null;
  private activeAbort: AbortController | null = null;
  private onTranscript: (text: string) => void;

  private getAudioStream: () => Promise<MediaStreamPort>;
  private createRecorder: (stream: MediaStreamPort) => MediaRecorderPort;
  private transcribeAudio: (blob: Blob, signal: AbortSignal) => Promise<TranscribeResult>;

  constructor(onTranscript: (text: string) => void, deps?: ControllerDeps) {
    this.onTranscript = onTranscript;
    this.getAudioStream = deps?.getAudioStream ?? createBrowserAudioStream;
    this.createRecorder = deps?.createRecorder ?? createBrowserMediaRecorder;
    this.transcribeAudio = deps?.transcribeAudio ?? ((blob, signal) => sendAudioForTranscription(blob, signal));
  }

  setOnTranscript = (onTranscript: (text: string) => void) => {
    this.onTranscript = onTranscript;
  };

  getSnapshot = (): OnlineTranscribeSnapshot => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<OnlineTranscribeSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  private clearTimer() {
    if (this.maxTimer !== null) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
  }

  start = async (): Promise<boolean> => {
    if (this.state.status === 'recording' || this.state.status === 'transcribing') {
      return false;
    }
    const token = ++this.session;
    this.clearTimer();

    let stream: MediaStreamPort;
    try {
      stream = await this.getAudioStream();
    } catch (err: unknown) {
      if (token !== this.session) return false;
      const isDenied = (err as { name?: string })?.name === 'NotAllowedError' || (err as { name?: string })?.name === 'PermissionDeniedError';
      const isUnsupported = !isDenied && ((err as { message?: string })?.message?.includes('not supported') || (typeof navigator !== 'undefined' && !navigator.mediaDevices?.getUserMedia));
      const errorMsg = isDenied
        ? 'Microphone permission was denied. You can type or use symbols.'
        : isUnsupported
        ? 'Audio recording is not supported in this browser. Please type or use symbols.'
        : 'The microphone is unavailable. Check your input device.';
      this.publish({
        status: 'error',
        error: errorMsg,
      });
      return false;
    }

    if (token !== this.session) {
      stream.getTracks().forEach(t => t.stop());
      return false;
    }

    let recorder: MediaRecorderPort;
    try {
      recorder = this.createRecorder(stream);
    } catch {
      stream.getTracks().forEach(t => t.stop());
      if (token !== this.session) return false;
      this.publish({
        status: 'error',
        error: 'Audio recording is not supported in this browser. Please type or use symbols.',
      });
      return false;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (token !== this.session) return;

      const mimeType = recorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(chunks, { type: mimeType });
      if (audioBlob.size === 0) {
        this.publish({ status: 'error', error: 'No audio recorded. Please try again or type.' });
        return;
      }

      this.publish({ status: 'transcribing', error: null });
      const abortController = new AbortController();
      this.activeAbort = abortController;

      try {
        const res = await this.transcribeAudio(audioBlob, abortController.signal);
        if (token !== this.session) return;
        if (res.transcript) {
          this.publish({ status: 'idle', error: null });
          this.onTranscript(res.transcript);
        } else {
          this.publish({ status: 'error', error: res.error ?? 'Transcription unavailable. Please try again or type.' });
        }
      } catch {
        if (token !== this.session) return;
        this.publish({ status: 'error', error: 'Transcription unavailable. Please try again or type.' });
      } finally {
        if (this.activeAbort === abortController) this.activeAbort = null;
      }
    };

    try {
      recorder.start();
      this.currentRecorder = recorder;
      this.currentStream = stream;
      this.publish({ status: 'recording', error: null });

      // Automatically cap recording at 12 seconds
      this.maxTimer = setTimeout(() => {
        if (token === this.session && recorder.state === 'recording') {
          try {
            recorder.stop();
          } catch {
            /* already stopped */
          }
        }
      }, 12000);

      return true;
    } catch {
      stream.getTracks().forEach(t => t.stop());
      this.publish({ status: 'error', error: 'Failed to start recording.' });
      return false;
    }
  };

  stop = () => {
    this.clearTimer();
    if (this.currentRecorder && this.currentRecorder.state === 'recording') {
      try {
        this.currentRecorder.stop();
      } catch {
        /* ignore */
      }
    }
  };

  cancel = () => {
    this.session++;
    this.clearTimer();
    if (this.currentRecorder && this.currentRecorder.state === 'recording') {
      try {
        this.currentRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.currentRecorder = null;
    this.currentStream?.getTracks().forEach(t => t.stop());
    this.currentStream = null;
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.publish({ status: 'idle', error: null });
  };
}

export function createBrowserAudioStream(): Promise<MediaStreamPort> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('Audio recording not supported'));
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export function createBrowserMediaRecorder(stream: MediaStreamPort): MediaRecorderPort {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder not supported');
  }
  const supportedType = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find(t => MediaRecorder.isTypeSupported?.(t));
  return (supportedType
    ? new MediaRecorder(stream as unknown as MediaStream, { mimeType: supportedType })
    : new MediaRecorder(stream as unknown as MediaStream)) as unknown as MediaRecorderPort;
}
