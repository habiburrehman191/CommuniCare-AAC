export interface HTMLAudioElementPort {
  play(): Promise<void>;
  pause(): void;
  src: string;
  onended: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface OnlineAudioPort {
  fetchAudio(text: string, signal: AbortSignal): Promise<Blob>;
  createAudio(url: string): HTMLAudioElementPort;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
}

export const defaultBrowserOnlineAudioPort: OnlineAudioPort = {
  fetchAudio: async (text: string, signal: AbortSignal): Promise<Blob> => {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        language: 'ur',
      }),
      signal,
    });
    if (!response.ok) {
      if (response.status === 503) {
        throw new Error('Urdu voice is not configured on this server.');
      }
      throw new Error(`TTS service error: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('audio/wav') && !contentType.includes('audio/x-wav')) {
      throw new Error(`Invalid audio response type: ${contentType}`);
    }
    return response.blob();
  },
  createAudio: (url: string) => {
    return new Audio(url) as unknown as HTMLAudioElementPort;
  },
  createObjectUrl: (blob: Blob) => {
    return (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : 'blob:' + Math.random();
  },
  revokeObjectUrl: (url: string) => {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(url);
    }
  },
};

export class OnlineAudioPlayer {
  private currentAbort: AbortController | null = null;
  private currentAudio: HTMLAudioElementPort | null = null;
  private currentUrl: string | null = null;
  private port: OnlineAudioPort;
  private lastError: string | null = null;

  constructor(port: OnlineAudioPort = defaultBrowserOnlineAudioPort) {
    this.port = port;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  isPlaying(): boolean {
    return this.currentAudio !== null || this.currentAbort !== null;
  }

  stop(): void {
    if (this.currentAbort) {
      try {
        this.currentAbort.abort();
      } catch {
        /* ignore */
      }
      this.currentAbort = null;
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.src = '';
      } catch {
        /* ignore */
      }
      this.currentAudio = null;
    }
    if (this.currentUrl) {
      try {
        this.port.revokeObjectUrl(this.currentUrl);
      } catch {
        /* ignore */
      }
      this.currentUrl = null;
    }
  }

  async play(text: string, signal?: AbortSignal): Promise<'completed' | 'cancelled' | 'error'> {
    this.stop();
    this.lastError = null;

    const controller = new AbortController();
    this.currentAbort = controller;

    let onParentAbort: (() => void) | null = null;
    if (signal) {
      if (signal.aborted) {
        this.stop();
        return 'cancelled';
      }
      onParentAbort = () => {
        this.stop();
      };
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const blob = await this.port.fetchAudio(text, controller.signal);
      if (controller.signal.aborted || signal?.aborted) {
        this.stop();
        return 'cancelled';
      }

      const url = this.port.createObjectUrl(blob);
      this.currentUrl = url;

      return await new Promise<'completed' | 'cancelled' | 'error'>((resolve) => {
        let settled = false;
        const finish = (result: 'completed' | 'cancelled' | 'error') => {
          if (settled) return;
          settled = true;
          this.stop();
          resolve(result);
        };

        if (controller.signal.aborted || signal?.aborted) {
          finish('cancelled');
          return;
        }

        const audio = this.port.createAudio(url);
        this.currentAudio = audio;

        audio.onended = () => finish('completed');
        audio.onerror = () => finish('error');

        audio.play().catch(() => finish('error'));
      });
    } catch (err: unknown) {
      if (
        controller.signal.aborted ||
        signal?.aborted ||
        (err as { name?: string })?.name === 'AbortError'
      ) {
        this.stop();
        return 'cancelled';
      }
      const errMsg = (err as { message?: string })?.message || '';
      if (errMsg.includes('not configured')) {
        this.lastError = 'Urdu voice is not configured on this server.';
      }
      this.stop();
      return 'error';
    } finally {
      if (signal && onParentAbort) {
        signal.removeEventListener('abort', onParentAbort);
      }
      this.stop();
    }
  }
}
