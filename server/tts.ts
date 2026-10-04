import { Buffer } from 'node:buffer';

export interface TtsOptions {
  azureKey?: string;
  azureRegion?: string;
  azureVoice?: string;
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

export function escapeXml(unsafe: string): string {
  return unsafe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const MAX_BODY_BYTES = 4096;
const MAX_TEXT_LENGTH = 500;
const MAX_AUDIO_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB limit

export function createTtsHandler(options: TtsOptions) {
  const calls = new Map<string, { count: number; at: number }>();
  let globalCount = 0;
  let globalAt = 0;

  return async (request: Request, ip = 'local'): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    if (request.headers.get('origin') !== options.origin) return json(403, { error: 'Forbidden origin' });

    const rawType = request.headers.get('content-type') ?? '';
    const baseMime = rawType.split(';')[0].trim().toLowerCase();
    if (baseMime !== 'application/json') return json(415, { error: 'Unsupported media type' });

    const now = (options.now ?? Date.now)();
    if (now - globalAt >= 60000) {
      globalCount = 0;
      globalAt = now;
      calls.clear();
    }
    const entry = calls.get(ip);
    const current = entry && now - entry.at < 60000 ? entry : { count: 0, at: now };
    if (current.count >= 10 || globalCount >= 60 || (!calls.has(ip) && calls.size >= 1000)) {
      return json(429, { error: 'Rate limit exceeded' });
    }
    current.count++;
    globalCount++;
    calls.set(ip, current);

    try {
      const contentLength = Number(request.headers.get('content-length'));
      if (contentLength > MAX_BODY_BYTES) return json(413, { error: 'Payload exceeds limit' });

      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: 'Request body cannot be empty' });

      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          return json(413, { error: 'Payload exceeds limit' });
        }
        chunks.push(part.value);
      }
      if (bytes === 0) return json(400, { error: 'Request body cannot be empty' });

      const bodyText = Buffer.concat(chunks).toString('utf8');
      let data: unknown;
      try {
        data = JSON.parse(bodyText);
      } catch {
        return json(400, { error: 'Malformed JSON' });
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return json(400, { error: 'Invalid payload' });
      }

      const keys = Object.keys(data as object).sort();
      if (keys.join(',') !== 'language,text') {
        return json(400, { error: 'Invalid request fields' });
      }

      const reqData = data as { language: unknown; text: unknown };
      if (reqData.language !== 'ur') {
        return json(400, { error: 'Unsupported language' });
      }
      if (typeof reqData.text !== 'string') {
        return json(400, { error: 'Text must be a string' });
      }

      const trimmedText = reqData.text.trim();
      if (!trimmedText) {
        return json(400, { error: 'Text cannot be empty' });
      }
      if (trimmedText.length > MAX_TEXT_LENGTH) {
        return json(400, { error: 'Text exceeds maximum allowable length' });
      }

      const key = options.azureKey;
      const region = options.azureRegion;
      const voice = options.azureVoice ?? 'ur-PK-UzmaNeural';

      if (!key || !region || !/^[a-z0-9-]+$/i.test(region) || !/^[a-zA-Z0-9-]+$/.test(voice)) {
        return json(503, { error: 'TTS service not configured' });
      }

      const endpoint = `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ur-PK"><voice name="${escapeXml(voice)}">${escapeXml(trimmedText)}</voice></speak>`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeout ?? 8000);
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });

      try {
        if (request.signal.aborted) return json(503, { error: 'Request aborted' });

        const upstream = await (options.fetch ?? fetch)(endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/ssml+xml; charset=utf-8',
            'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
            'User-Agent': 'CommuniCare-AAC',
          },
          body: ssml,
        });

        if (controller.signal.aborted) return json(503, { error: 'TTS request timed out' });

        if (!upstream.ok) {
          console.error(`[CommuniCare Server] Azure TTS upstream failure: status=${upstream.status}`);
          if (upstream.status === 429) return json(503, { error: 'Upstream quota exceeded' });
          if (upstream.status >= 500) return json(502, { error: 'Provider service error' });
          return json(502, { error: 'Provider error' });
        }

        const audioReader = upstream.body?.getReader();
        if (!audioReader) {
          console.error(`[CommuniCare Server] Azure TTS empty body: status=${upstream.status}`);
          return json(502, { error: 'Malformed provider response' });
        }

        const audioChunks: Uint8Array[] = [];
        let audioBytes = 0;
        while (true) {
          const part = await audioReader.read();
          if (part.done) break;
          audioBytes += part.value.byteLength;
          if (audioBytes > MAX_AUDIO_RESPONSE_BYTES) {
            await audioReader.cancel();
            return json(502, { error: 'Audio response exceeds maximum allowed size' });
          }
          audioChunks.push(part.value);
        }

        if (audioBytes === 0) {
          return json(502, { error: 'Empty audio received from provider' });
        }

        const audioBuffer = Buffer.concat(audioChunks);
        return new Response(audioBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'audio/wav',
            'Cache-Control': 'no-store, private',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
      }
    } catch {
      return json(503, { error: 'TTS request failed' });
    }
  };
}
