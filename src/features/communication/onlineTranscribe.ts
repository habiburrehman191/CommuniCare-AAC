export interface TranscribeResult {
  transcript?: string;
  error?: string;
}

/**
 * Sends short recorded audio to the CommuniCare server transcription endpoint.
 * Audio is never persisted, never logged, and speech synthesis is never triggered.
 */
export async function sendAudioForTranscription(
  audioBlob: Blob,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
  lang = 'ur-PK'
): Promise<TranscribeResult> {
  if (signal.aborted) return { error: 'Transcription cancelled' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10000);

  try {
    const response = await transport(`/api/transcribe?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': audioBlob.type || 'audio/webm',
      },
      body: audioBlob,
    });

    if (signal.aborted || controller.signal.aborted) return { error: 'Transcription cancelled' };
    if (!response.ok) {
      return { error: 'Transcription unavailable. Please try again or type.' };
    }

    const text = await response.text();
    if (!text || signal.aborted || controller.signal.aborted) {
      return { error: 'Transcription unavailable. Please try again or type.' };
    }

    const data = JSON.parse(text);
    if (!data || typeof data.transcript !== 'string' || !data.transcript.trim()) {
      return { error: 'Transcription unavailable. Please try again or type.' };
    }

    return { transcript: data.transcript.trim() };
  } catch {
    return { error: 'Transcription unavailable. Please try again or type.' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
