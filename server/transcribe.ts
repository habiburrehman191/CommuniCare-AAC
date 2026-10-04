import { Buffer } from 'node:buffer';

export interface TranscribeOptions {
  apiKey?: string;
  model?: string;
  origin: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeout?: number;
}

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const allowedMimes = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/mpeg',
]);

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2 MB strict limit

interface InteractionContent {
  type?: string;
  text?: unknown;
}

interface InteractionStep {
  type?: string;
  content?: InteractionContent[];
}

interface InteractionResponse {
  status?: string;
  steps?: InteractionStep[];
  error?: {
    code?: string | number;
    status?: string;
    message?: string;
  };
}

export function createTranscribeHandler(options: TranscribeOptions) {
  const calls = new Map<string, { count: number; at: number }>();
  let globalCount = 0, globalAt = 0;

  return async (request: Request, ip = 'local'): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    if (request.headers.get('origin') !== options.origin) return json(403, { error: 'Forbidden origin' });

    const rawType = request.headers.get('content-type') ?? '';
    const baseMime = rawType.split(';')[0].trim().toLowerCase();
    if (!allowedMimes.has(baseMime)) return json(415, { error: 'Unsupported audio media type' });
    const validatedMime = rawType.trim() || baseMime;

    const now = (options.now ?? Date.now)();
    if (now - globalAt >= 60000) { globalCount = 0; globalAt = now; calls.clear(); }
    const entry = calls.get(ip);
    const current = entry && now - entry.at < 60000 ? entry : { count: 0, at: now };
    if (current.count >= 10 || globalCount >= 60 || (!calls.has(ip) && calls.size >= 1000)) {
      return json(429, { error: 'Rate limit exceeded' });
    }
    current.count++; globalCount++; calls.set(ip, current);

    try {
      const contentLength = Number(request.headers.get('content-length'));
      if (contentLength > MAX_AUDIO_BYTES) return json(413, { error: 'Audio payload exceeds 2 MB limit' });

      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: 'Audio body cannot be empty' });

      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_AUDIO_BYTES) {
          await reader.cancel();
          return json(413, { error: 'Audio payload exceeds 2 MB limit' });
        }
        chunks.push(part.value);
      }
      if (bytes === 0) return json(400, { error: 'Audio body cannot be empty' });

      const audioBuffer = Buffer.concat(chunks);
      const model = options.model ?? 'gemini-3.5-transcribe';
      if (!options.apiKey || !model || !/^gemini-[a-zA-Z0-9.-]+$/.test(model)) {
        return json(503, { error: 'Transcription service not configured' });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeout ?? 8000);
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });

      try {
        if (request.signal.aborted) return json(503, { error: 'Request aborted' });

        const upstream = await (options.fetch ?? fetch)(
          'https://generativelanguage.googleapis.com/v1beta/interactions',
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': options.apiKey,
            },
            body: JSON.stringify({
              model,
              input: [
                {
                  type: 'audio',
                  data: audioBuffer.toString('base64'),
                  mime_type: validatedMime,
                },
              ],
              generation_config: {
                transcription_config: {
                  language_codes: ['ur-PK'],
                  mode: 'verbatim',
                },
              },
              store: false,
            }),
          }
        );

        if (controller.signal.aborted) return json(503, { error: 'Transcription request timed out' });

        const outputReader = upstream.body?.getReader();
        if (!outputReader) {
          console.error(`[CommuniCare Server] Transcription empty response: status=${upstream.status}, model=${model}`);
          return json(502, { error: 'Malformed provider response' });
        }

        let text = '', outputBytes = 0;
        const outputDecoder = new TextDecoder();
        while (true) {
          const chunk = await outputReader.read();
          if (chunk.done) break;
          outputBytes += chunk.value.byteLength;
          if (outputBytes > 30000) {
            await outputReader.cancel();
            return json(502, { error: 'Response too large' });
          }
          text += outputDecoder.decode(chunk.value, { stream: true });
        }
        text += outputDecoder.decode();
        if (controller.signal.aborted) return json(503, { error: 'Transcription request timed out' });

        if (!upstream.ok) {
          let errCode = 'unknown';
          try {
            const errObj = JSON.parse(text);
            errCode = String(errObj?.error?.status ?? errObj?.error?.code ?? errObj?.error?.message ?? 'unknown');
          } catch {
            /* ignore malformed body */
          }
          console.error(`[CommuniCare Server] Transcription upstream failure: status=${upstream.status}, model=${model}, code=${errCode}`);
          if (upstream.status === 429) return json(503, { error: 'Upstream quota exceeded' });
          if (upstream.status >= 500) return json(502, { error: 'Provider service error' });
          return json(502, { error: 'Provider error' });
        }

        let response: InteractionResponse;
        try {
          response = JSON.parse(text);
        } catch {
          console.error(`[CommuniCare Server] Transcription JSON parse failure: model=${model}`);
          return json(502, { error: 'Malformed provider response' });
        }

        if (response.status && response.status !== 'completed') {
          console.error(`[CommuniCare Server] Interaction uncompleted: status=${response.status}, model=${model}`);
          return json(502, { error: 'Interaction not completed' });
        }

        if (!Array.isArray(response.steps) || response.steps.length === 0) {
          console.error(`[CommuniCare Server] Interaction missing steps: model=${model}`);
          return json(502, { error: 'Malformed provider response' });
        }

        const modelOutputSteps = response.steps.filter((s) => s && s.type === 'model_output');
        if (modelOutputSteps.length === 0) {
          console.error(`[CommuniCare Server] Interaction missing model_output step: model=${model}`);
          return json(502, { error: 'Malformed provider response' });
        }

        let transcript = '';
        for (const step of modelOutputSteps) {
          if (Array.isArray(step.content)) {
            for (const content of step.content) {
              if (content && content.type === 'text' && typeof content.text === 'string') {
                transcript += content.text;
              }
            }
          }
        }

        transcript = transcript.trim();
        if (!transcript) return json(422, { error: 'No speech recognized in audio' });
        if (transcript.length > 500) return json(502, { error: 'Transcript exceeded maximum allowable length' });

        return json(200, { transcript });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
      }
    } catch {
      return json(503, { error: 'Transcription request failed' });
    }
  };
}
