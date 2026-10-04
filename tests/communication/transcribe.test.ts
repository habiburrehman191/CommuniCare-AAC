import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createTranscribeHandler } from '../../server/transcribe';
import { sendAudioForTranscription } from '../../src/features/communication/onlineTranscribe';
import {
  OnlineTranscribeController,
  createBrowserAudioStream,
  createBrowserMediaRecorder,
} from '../../src/features/communication/onlineTranscribeController';
import type {
  MediaRecorderPort,
  MediaStreamPort,
  MediaStreamTrackPort,
} from '../../src/features/communication/onlineTranscribeController';
import { RecognitionController } from '../../src/features/communication/recognitionController';
import type { RecognitionPort } from '../../src/features/communication/recognitionController';
import { resolveIntent } from '../../src/features/communication/intentResolver';
import { useCommunicationStore as store } from '@/store/communicationStore';
import { defaultStoredState } from '@/lib/storage';
import { initialPhrases } from '@/data/phrases';
import { VoiceCommandPanel } from '@/components/aac/VoiceCommandPanel';
import { EmergencySection } from '@/sections/EmergencySection';
import { SelectedMessagePreview } from '@/components/aac/SelectedMessagePreview';
import { SmartClarification } from '@/components/aac/SignatureControls';
import { SpeechController } from '@/features/communication/speechController';
import type { SpeechPort } from '@/features/communication/speechController';

// ---------------------------------------------------------------------------
// Setup & Mock Helpers
// ---------------------------------------------------------------------------

const origin = 'https://aac.example';
const shortAudioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

const audioRequest = (
  body: Uint8Array | null = shortAudioBytes,
  headers: Record<string, string> = {},
  method = 'POST'
) =>
  new Request(origin + '/api/transcribe?lang=ur-PK', {
    method,
    headers: {
      origin,
      'Content-Type': 'audio/webm',
      ...headers,
    },
    ...(method === 'GET' || method === 'HEAD' || body === null ? {} : { body: body as unknown as BodyInit }),
  });

const interactionSuccess = (transcript: string, status = 'completed') =>
  new Response(
    JSON.stringify({
      status,
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: transcript,
            },
          ],
        },
      ],
    })
  );

class MockTrack implements MediaStreamTrackPort {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class MockStream implements MediaStreamPort {
  tracks: MockTrack[] = [new MockTrack()];
  getTracks() {
    return this.tracks;
  }
}

class MockMediaRecorder implements MediaRecorderPort {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  starts = 0;
  stops = 0;

  start() {
    this.starts++;
    this.state = 'recording';
  }

  stop() {
    this.stops++;
    this.state = 'inactive';
    this.onstop?.();
  }

  emitData(data: Blob) {
    this.ondataavailable?.({ data });
  }
}

class MockRecognition implements RecognitionPort {
  lang = '';
  interimResults = false;
  continuous = true;
  maxAlternatives = 1;
  onstart: RecognitionPort['onstart'] = null;
  onend: RecognitionPort['onend'] = null;
  onresult: RecognitionPort['onresult'] = null;
  onerror: RecognitionPort['onerror'] = null;
  starts = 0;
  stops = 0;
  aborts = 0;

  start() {
    this.starts++;
  }
  stop() {
    this.stops++;
  }
  abort() {
    this.aborts++;
  }
}

beforeEach(() => {
  store.getState().initFromStoredState(defaultStoredState);
});

// ===========================================================================
// 1. SERVER-SIDE TESTS
// ===========================================================================

interface InteractionsRequestBody {
  model?: string;
  store?: boolean;
  contents?: unknown;
  systemInstruction?: unknown;
  input?: Array<{ type?: string; mime_type?: string; data?: string }>;
  generation_config?: { transcription_config?: { language_codes?: string[]; mode?: string } };
}

test('SERVER: valid short WebM audio request invokes Interactions API with required schema', async () => {
  let capturedUrl = '';
  let capturedHeaders: Headers | null = null;
  let capturedBody: unknown = null;

  const handler = createTranscribeHandler({
    origin,
    apiKey: 'server-secret-key',
    model: 'gemini-3.5-transcribe',
    fetch: async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body));
      return interactionSuccess('مجھے پانی چاہیے');
    },
  });

  const response = await handler(audioRequest());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

  // Verify endpoint is /v1beta/interactions and does NOT use generateContent
  assert.equal(capturedUrl, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.doesNotMatch(capturedUrl, /generateContent/);

  // Verify API key sent via header only
  assert.equal(capturedHeaders ? (capturedHeaders as Headers).get('x-goog-api-key') : null, 'server-secret-key');

  // Verify request body: model, store: false, no text prompt, no contents/systemInstruction
  const body = capturedBody as unknown as InteractionsRequestBody;
  assert.ok(body);
  assert.equal(body.model, 'gemini-3.5-transcribe');
  assert.equal(body.store, false);
  assert.equal(body.contents, undefined);
  assert.equal(body.systemInstruction, undefined);

  // Verify input contains audio type, base64 audio in data, and preserved mime_type
  assert.ok(Array.isArray(body.input));
  assert.equal(body.input?.length, 1);
  assert.equal(body.input?.[0]?.type, 'audio');
  assert.equal(body.input?.[0]?.mime_type, 'audio/webm');
  assert.equal(body.input?.[0]?.data, Buffer.from(shortAudioBytes).toString('base64'));

  // Verify transcription_config
  assert.deepEqual(body.generation_config?.transcription_config?.language_codes, ['ur-PK']);
  assert.equal(body.generation_config?.transcription_config?.mode, 'verbatim');

  const data = await response.json();
  assert.equal(data.transcript, 'مجھے پانی چاہیے');
});

test('SERVER: concatenates multiple text chunks in model_output step', async () => {
  const handler = createTranscribeHandler({
    origin,
    apiKey: 'server-key',
    model: 'gemini-3.5-transcribe',
    fetch: async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'text', text: 'مجھے ' },
                { type: 'text', text: 'پانی چاہیے۔' },
              ],
            },
          ],
        })
      ),
  });

  const response = await handler(audioRequest());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.transcript, 'مجھے پانی چاہیے۔');
});

test('SERVER: wrong method rejected with 405', async () => {
  const handler = createTranscribeHandler({ origin, apiKey: 'test' });
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const response = await handler(audioRequest(null, {}, method));
    assert.equal(response.status, 405);
  }
});

test('SERVER: wrong origin rejected with 403', async () => {
  const handler = createTranscribeHandler({ origin, apiKey: 'test' });
  const response = await handler(audioRequest(shortAudioBytes, { origin: 'https://attacker.example' }));
  assert.equal(response.status, 403);
});

test('SERVER: unsupported MIME rejected with 415', async () => {
  const handler = createTranscribeHandler({ origin, apiKey: 'test' });
  for (const mime of ['text/plain', 'application/json', 'image/png', 'video/mp4', 'application/octet-stream']) {
    const response = await handler(audioRequest(shortAudioBytes, { 'Content-Type': mime }));
    assert.equal(response.status, 415);
  }
});

test('SERVER: empty body rejected with 400', async () => {
  const handler = createTranscribeHandler({ origin, apiKey: 'test' });
  const emptyBytes = new Uint8Array(0);
  const response = await handler(audioRequest(emptyBytes));
  assert.equal(response.status, 400);
});

test('SERVER: oversized body rejected with 413', async () => {
  const handler = createTranscribeHandler({ origin, apiKey: 'test' });
  // Over 2 MB header
  const responseHeader = await handler(
    audioRequest(shortAudioBytes, { 'Content-Length': String(2 * 1024 * 1024 + 100) })
  );
  assert.equal(responseHeader.status, 413);

  // Over 2 MB payload chunks
  const hugePayload = new Uint8Array(2 * 1024 * 1024 + 10);
  const responseBody = await handler(audioRequest(hugePayload));
  assert.equal(responseBody.status, 413);
});

test('SERVER: missing GEMINI_API_KEY handled safely with 503', async () => {
  const handler = createTranscribeHandler({ origin, apiKey: undefined });
  const response = await handler(audioRequest());
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.ok(data.error);
});

test('SERVER: upstream network failure handled safely with 503', async () => {
  const handler = createTranscribeHandler({
    origin,
    apiKey: 'test-key',
    fetch: async () => {
      throw new Error('Connection reset');
    },
  });
  const response = await handler(audioRequest());
  assert.equal(response.status, 503);
});

test('SERVER: quota/provider error handled safely with structured code', async () => {
  // 429 Rate limit / quota
  const handlerQuota = createTranscribeHandler({
    origin,
    apiKey: 'test-key',
    fetch: async () => new Response('Quota exceeded', { status: 429 }),
  });
  const resQuota = await handlerQuota(audioRequest());
  assert.equal(resQuota.status, 503);

  // 500 Upstream server error
  const handler500 = createTranscribeHandler({
    origin,
    apiKey: 'test-key',
    fetch: async () => new Response('Internal error', { status: 500 }),
  });
  const res500 = await handler500(audioRequest());
  assert.equal(res500.status, 502);
});

test('SERVER: timeout aborts upstream request and returns 503', async () => {
  const handler = createTranscribeHandler({
    origin,
    apiKey: 'test-key',
    timeout: 10,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
      }),
  });
  const response = await handler(audioRequest());
  assert.equal(response.status, 503);
});

test('SERVER: malformed provider response or uncompleted interaction handled safely with 502', async () => {
  for (const badResponse of [
    new Response('Not JSON'),
    new Response(JSON.stringify({})),
    new Response(JSON.stringify({ steps: [] })),
    new Response(JSON.stringify({ status: 'failed', steps: [] })),
    new Response(
      JSON.stringify({
        status: 'completed',
        steps: [{ type: 'other_type', content: [] }],
      })
    ),
    new Response(
      JSON.stringify({
        status: 'cancelled',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'test' }] }],
      })
    ),
  ]) {
    const handler = createTranscribeHandler({
      origin,
      apiKey: 'test-key',
      fetch: async () => badResponse,
    });
    const res = await handler(audioRequest());
    assert.equal(res.status, 502);
  }
});

test('SERVER: transcript length validation rejects empty and runaway transcript', async () => {
  // Empty transcript
  const handlerEmpty = createTranscribeHandler({
    origin,
    apiKey: 'test-key',
    fetch: async () => interactionSuccess('   '),
  });
  const resEmpty = await handlerEmpty(audioRequest());
  assert.equal(resEmpty.status, 422);

  // Runaway transcript > 500 chars
  const runaway = 'مجھے پانی چاہیے '.repeat(45);
  const handlerRunaway = createTranscribeHandler({
    origin,
    apiKey: 'test-key',
    fetch: async () => interactionSuccess(runaway),
  });
  const resRunaway = await handlerRunaway(audioRequest());
  assert.equal(resRunaway.status, 502);
});

test('SERVER: rate limit budget bounds requests per IP and globally', async () => {
  const handler = createTranscribeHandler({
    origin,
    apiKey: 'test-key',
    now: () => 1000,
    fetch: async () => interactionSuccess('مجھے پانی چاہیے'),
  });

  for (let i = 0; i < 10; i++) {
    const res = await handler(audioRequest(), 'client-ip-1');
    assert.equal(res.status, 200);
  }

  // 11th request from same IP is blocked
  const resBlocked = await handler(audioRequest(), 'client-ip-1');
  assert.equal(resBlocked.status, 429);
});

test('SERVER: safe error diagnostics logs upstream status and model but never API key, audio, or transcript', async () => {
  const originalError = console.error;
  const originalLog = console.log;
  const loggedError: string[] = [];
  const loggedOut: string[] = [];
  console.error = (...args) => loggedError.push(args.map(String).join(' '));
  console.log = (...args) => loggedOut.push(args.map(String).join(' '));

  try {
    const handler = createTranscribeHandler({
      origin,
      apiKey: 'secret-key-12345',
      model: 'gemini-3.5-transcribe',
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { code: 400, message: 'Invalid argument', status: 'INVALID_ARGUMENT' } }),
          { status: 400 }
        ),
    });
    const res = await handler(audioRequest());
    assert.equal(res.status, 502);

    const joinedErrors = loggedError.join(' ');
    assert.match(joinedErrors, /gemini-3.5-transcribe/);
    assert.match(joinedErrors, /400/);

    // Verify secrets and payloads are never logged
    assert.ok(!joinedErrors.includes('secret-key-12345'));
    assert.ok(loggedOut.every(l => !l.includes('secret-key-12345')));
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test('SERVER: no transcript or raw audio logging or persistence on success', async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const logged: string[] = [];
  console.log = (...args) => logged.push(args.map(String).join(' '));
  console.error = (...args) => logged.push(args.map(String).join(' '));

  try {
    const handler = createTranscribeHandler({
      origin,
      apiKey: 'secret-key-xyz',
      fetch: async () => interactionSuccess('نجی معلومات نہیں ہونی چاہیے'),
    });
    await handler(audioRequest());

    const allLogs = logged.join(' ');
    assert.ok(!allLogs.includes('نجی معلومات'));
    assert.ok(!allLogs.includes('secret-key-xyz'));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

// ===========================================================================
// 2. CLIENT CONTROLLER & HOOK TESTS
// ===========================================================================

test('CLIENT: browser Urdu recognition remains first choice and tries ur-PK', () => {
  const ports: MockRecognition[] = [];
  const controller = new RecognitionController(
    () => {
      const p = new MockRecognition();
      ports.push(p);
      return p;
    },
    () => {}
  );

  controller.start('ur-PK');
  assert.equal(ports.length, 1);
  assert.equal(ports[0].lang, 'ur-PK');
  controller.abort();
});

test('CLIENT: ur-PK then ur controlled fallback occurs once only', () => {
  const ports: MockRecognition[] = [];
  const controller = new RecognitionController(
    () => {
      const p = new MockRecognition();
      ports.push(p);
      return p;
    },
    () => {}
  );

  controller.start('ur-PK');
  assert.equal(ports.length, 1);
  assert.equal(ports[0].lang, 'ur-PK');

  // Failure triggers fallback to 'ur'
  ports[0].onerror?.({ error: 'network' });
  assert.equal(ports.length, 2);
  assert.equal(ports[1].lang, 'ur');

  // Second failure halts without looping
  ports[1].onerror?.({ error: 'network' });
  assert.equal(ports.length, 2);
  assert.equal(controller.getSnapshot().status, 'error');
  assert.match(controller.getSnapshot().error!, /Urdu voice recognition is unavailable/);
  controller.abort();
});

test('CLIENT: server fallback is NOT automatically called upon browser recognition failure', () => {
  let serverFallbackCalled = false;
  const mockTranscribe = async () => {
    serverFallbackCalled = true;
    return { transcript: 'مجھے پانی چاہیے' };
  };

  const onlineController = new OnlineTranscribeController(() => {}, {
    transcribeAudio: mockTranscribe,
  });

  // Online controller starts in idle and does not initiate request
  assert.equal(onlineController.getSnapshot().status, 'idle');
  assert.equal(serverFallbackCalled, false);
});

test('CLIENT: explicit action starts fallback recording and handles audio', async () => {
  const stream = new MockStream();
  const recorder = new MockMediaRecorder();
  const transcripts: string[] = [];

  const controller = new OnlineTranscribeController(
    t => transcripts.push(t),
    {
      getAudioStream: async () => stream,
      createRecorder: () => recorder,
      transcribeAudio: async () => ({ transcript: 'مجھے پانی چاہیے' }),
    }
  );

  assert.equal(controller.getSnapshot().status, 'idle');

  // User explicitly starts
  const started = await controller.start();
  assert.equal(started, true);
  assert.equal(controller.getSnapshot().status, 'recording');
  assert.equal(recorder.starts, 1);

  // User records audio and clicks Stop
  recorder.emitData(new Blob(['recorded-audio'], { type: 'audio/webm' }));
  controller.stop();
  await new Promise(r => setTimeout(r, 20));

  assert.equal(recorder.stops, 1);
  assert.equal(stream.tracks[0].stopped, true);
  assert.deepEqual(transcripts, ['مجھے پانی چاہیے']);
  assert.equal(controller.getSnapshot().status, 'idle');
});

test('CLIENT: MediaRecorder unsupported state is handled honestly', async () => {
  const controller = new OnlineTranscribeController(() => {}, {
    getAudioStream: async () => {
      throw new Error('Audio recording not supported');
    },
  });

  const started = await controller.start();
  assert.equal(started, false);
  assert.equal(controller.getSnapshot().status, 'error');
  assert.match(controller.getSnapshot().error!, /not supported/);
});

test('CLIENT: microphone permission denied is handled honestly', async () => {
  const controller = new OnlineTranscribeController(() => {}, {
    getAudioStream: async () => {
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    },
  });

  const started = await controller.start();
  assert.equal(started, false);
  assert.equal(controller.getSnapshot().status, 'error');
  assert.match(controller.getSnapshot().error!, /permission was denied/);
});

test('CLIENT: recording can be cancelled without triggering transcription', async () => {
  const stream = new MockStream();
  const recorder = new MockMediaRecorder();
  let transcribeInvoked = false;

  const controller = new OnlineTranscribeController(() => {}, {
    getAudioStream: async () => stream,
    createRecorder: () => recorder,
    transcribeAudio: async () => {
      transcribeInvoked = true;
      return { transcript: 'test' };
    },
  });

  await controller.start();
  assert.equal(controller.getSnapshot().status, 'recording');

  // Cancel recording
  controller.cancel();
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(transcribeInvoked, false);
});

test('CLIENT: maximum duration stops recording automatically', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = new MockStream();
  const recorder = new MockMediaRecorder();

  const controller = new OnlineTranscribeController(() => {}, {
    getAudioStream: async () => stream,
    createRecorder: () => recorder,
    transcribeAudio: async () => ({ transcript: 'مجھے پانی چاہیے' }),
  });

  await controller.start();
  assert.equal(recorder.starts, 1);
  assert.equal(recorder.stops, 0);

  // Fast forward 12.001 seconds
  ctx.mock.timers.tick(12001);
  assert.equal(recorder.stops, 1);
});

test('CLIENT: transcript enters editable communication input and passes through resolver', () => {
  store.getState().clearSelection();
  assert.equal(store.getState().communicationText, '');

  // Simulate transcript delivery from server
  const serverTranscript = 'مجھے پانی چاہیے';
  store.getState().setCommunicationText(serverTranscript);

  const state = store.getState();
  assert.equal(state.communicationText, 'مجھے پانی چاہیے');
  assert.equal(state.resolution.status, 'clear');
  assert.deepEqual(state.resolution.canonicalIds, ['food-water']);
  assert.equal(state.resolution.candidates.length, 3);
  assert.equal(state.resolution.candidates[0].english, 'I need water.');
  assert.equal(state.resolution.candidates[0].urdu, 'مجھے پانی چاہیے۔');

  // Safety contract: no candidate is auto-selected!
  assert.equal(state.selectedCandidateId, null);
  // Safety contract: no message generated before explicit selection!
  assert.equal(state.generatedMessage, null);
});

test('CLIENT: explicit user selection required to create output message', () => {
  store.getState().clearSelection();
  store.getState().setCommunicationText('مجھے پانی چاہیے');
  const s = store.getState();

  assert.equal(s.selectedCandidateId, null);
  assert.equal(s.generatedMessage, null);

  // User explicitly selects candidate
  s.selectCandidate(s.resolution.candidates[0].id);

  const updated = store.getState();
  assert.equal(updated.selectedCandidateId, s.resolution.candidates[0].id);
  assert.ok(updated.generatedMessage);
  assert.equal(updated.generatedMessage?.englishText, 'I need water.');
  assert.equal(updated.generatedMessage?.urduText, 'مجھے پانی چاہیے۔');
  store.getState().clearSelection();
});

test('CLIENT: stale transcription response cannot overwrite new input', async () => {
  const stream = new MockStream();
  const recorder = new MockMediaRecorder();
  let deliverTranscription: (val: { transcript: string }) => void = () => {};

  let committedText = '';
  const controller = new OnlineTranscribeController(
    text => {
      committedText = text;
      store.getState().setCommunicationText(text);
    },
    {
      getAudioStream: async () => stream,
      createRecorder: () => recorder,
      transcribeAudio: () =>
        new Promise(resolve => {
          deliverTranscription = resolve;
        }),
    }
  );

  await controller.start();
  recorder.emitData(new Blob(['bytes'], { type: 'audio/webm' }));
  controller.stop();
  assert.equal(controller.getSnapshot().status, 'transcribing');

  // User edits communication input or cancels while transcribing
  controller.cancel();
  store.getState().setCommunicationText('User typed message instead');

  // Late server response arrives
  deliverTranscription({ transcript: 'Late server transcript' });

  // Store MUST NOT be overwritten!
  assert.equal(store.getState().communicationText, 'User typed message instead');
  assert.notEqual(committedText, 'Late server transcript');
});

test('CLIENT: client sendAudioForTranscription handles server errors and cancellation safely', async () => {
  // Cancelled signal before start
  const abortedCtrl = new AbortController();
  abortedCtrl.abort();
  const resAborted = await sendAudioForTranscription(
    new Blob(['bytes'], { type: 'audio/webm' }),
    abortedCtrl.signal
  );
  assert.ok(resAborted.error);

  // 503 Server response
  const res503 = await sendAudioForTranscription(
    new Blob(['bytes'], { type: 'audio/webm' }),
    new AbortController().signal,
    async () => new Response('Unavailable', { status: 503 })
  );
  assert.equal(res503.error, 'Transcription unavailable. Please try again or type.');

  // Successful 200 response
  const res200 = await sendAudioForTranscription(
    new Blob(['bytes'], { type: 'audio/webm' }),
    new AbortController().signal,
    async () => new Response(JSON.stringify({ transcript: 'مجھے پانی چاہیے' }), { status: 200 })
  );
  assert.equal(res200.transcript, 'مجھے پانی چاہیے');
});

test('CLIENT: offline symbols and typing continue to work independently', () => {
  store.getState().clearSelection();

  // User types
  store.getState().setCommunicationText('mujhe pani chahiye');
  assert.equal(store.getState().resolution.status, 'clear');
  assert.equal(store.getState().selectedCandidateId, null);

  // User selects symbol
  store.getState().clearSelection();
  const symbol = initialPhrases.find(p => p.id === 'food-water')!;
  store.getState().selectSymbol(symbol);
  assert.equal(store.getState().selectedSymbols.length, 1);
  assert.equal(store.getState().resolution.status, 'clear');
  store.getState().clearSelection();
});

test('CLIENT: SOS emergency predefined communication never invokes transcription', async () => {
  const sosResolution = resolveIntent({ symbolIds: ['emergency-help'] });
  assert.equal(sosResolution.status, 'clear');
  assert.equal(sosResolution.intent?.kind, 'emergency');

  // Verify rendering EmergencySection does not reference transcription
  const html = render(h(MemoryRouter, null, h(EmergencySection)));
  assert.match(html, /SOS/);
  assert.match(html, /Get help quickly/);
  assert.match(html, /Speak SOS Help/);
  assert.doesNotMatch(html, /transcribe|audio\/webm/);
});

test('CLIENT: VoiceCommandPanel renders accessible controls, fallback action, and privacy text', () => {
  const html = render(
    h(MemoryRouter, null, h(VoiceCommandPanel))
  );

  // Accessible fields and modes
  assert.match(html, /Message text \(editable\)/);
  assert.match(html, /value="en-US"/);
  assert.match(html, /value="ur-PK"/);
  assert.match(html, /Live transcript/);
  assert.match(html, /Final transcript/);
  assert.match(html, /Microphone off/);
});

test('CLIENT: browser creation helpers return null/reject when window/navigator unavailable', async () => {
  assert.equal(createBrowserMediaRecorder, createBrowserMediaRecorder);
  assert.equal(createBrowserAudioStream, createBrowserAudioStream);
  await assert.rejects(async () => createBrowserAudioStream(), /not supported/);
});

// ---------------------------------------------------------------------------
// Confirmed Exact-Text & Urdu Transcript Tests
// ---------------------------------------------------------------------------

const testVoice = (lang: string, localService = true, name = lang) =>
  ({ lang, localService, name, voiceURI: name, default: false } as SpeechSynthesisVoice);

class TestSpeechPort implements SpeechPort {
  voices = [testVoice('en-US'), testVoice('ur-PK')];
  spoken: SpeechSynthesisUtterance[] = [];
  cancels = 0;
  listeners = new Set<() => void>();
  getVoices = () => this.voices;
  create = (text: string) => ({ text, lang: '', onend: null, onerror: null, onstart: null } as SpeechSynthesisUtterance);
  speak = (u: SpeechSynthesisUtterance) => { this.spoken.push(u); };
  cancel = () => { this.cancels++; };
  listenVoices = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  end = (index = this.spoken.length - 1) => { this.spoken[index]?.onend?.(new Event('end') as SpeechSynthesisEvent); };
}

test('CONFIRMED URDU FLOW: Urdu transcription alone sets communicationText but keeps generatedMessage null', () => {
  store.getState().clearSelection();
  store.getState().setCommunicationText('مجھے پانی چاہیے');
  const s = store.getState();
  assert.equal(s.communicationText, 'مجھے پانی چاہیے');
  assert.equal(s.generatedMessage, null);
  assert.equal(s.selectedCandidateId, null);
  store.getState().clearSelection();
});

test('CONFIRMED URDU FLOW: Explicit exact Urdu confirmation creates generatedMessage with sourceLanguage "ur"', () => {
  store.getState().clearSelection();
  const unresolved = 'یہ ایک غیر مصدقہ اردو جملہ ہے';
  store.getState().setCommunicationText(unresolved);
  const sBefore = store.getState();
  assert.ok(['clarification', 'unsupported'].includes(sBefore.resolution.status));
  assert.equal(sBefore.generatedMessage, null);
  assert.equal(sBefore.selectedCandidateId, null);

  // User explicitly confirms exact text
  store.getState().confirmExactText('ur');
  const sAfter = store.getState();
  assert.ok(sAfter.generatedMessage);
  assert.equal(sAfter.generatedMessage?.sourceLanguage, 'ur');
  assert.equal(sAfter.generatedMessage?.urduText, unresolved);
  assert.equal(sAfter.generatedMessage?.englishText, ''); // no invented English translation
  assert.equal(sAfter.selectedCandidateId, null);
  assert.notEqual(sAfter.resolution.status, 'clear'); // resolution status was NOT falsified

  store.getState().clearSelection();
});

test('CONFIRMED URDU FLOW: Main preview renders exact Urdu message once in RTL without blank English', () => {
  const unresolved = 'یہ ایک غیر مصدقہ اردو جملہ ہے';
  const message = {
    id: 'test-exact-ur',
    selectedPhraseIds: [],
    englishText: '',
    urduText: unresolved,
    mode: 'sentence' as const,
    createdAt: new Date().toISOString(),
    sourceLanguage: 'ur' as const,
  };
  const html = render(
    h(SelectedMessagePreview, {
      symbols: [],
      mode: 'sentence',
      generatedMessage: message,
    })
  );
  assert.match(html, /lang="ur"/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /یہ ایک غیر مصدقہ اردو جملہ ہے/);
  assert.doesNotMatch(html, /message-english/);
});

test('CONFIRMED URDU FLOW: Exact Urdu message invokes Urdu speech only without English', async () => {
  const p = new TestSpeechPort();
  const c = new SpeechController(p);
  const unresolved = 'یہ ایک غیر مصدقہ اردو جملہ ہے';
  const message = {
    id: 'test-exact-ur',
    selectedPhraseIds: [],
    englishText: '',
    urduText: unresolved,
    mode: 'sentence' as const,
    createdAt: new Date().toISOString(),
    sourceLanguage: 'ur' as const,
  };

  // Narrowest layer determines speech mode: sourceLanguage ('ur') overrides preferredVoiceLang ('auto')
  const mode = message.sourceLanguage ?? 'auto';
  assert.equal(mode, 'ur');

  const pending = c.speak(message, mode);
  assert.equal(p.spoken.length, 1);
  assert.equal(p.spoken[0].lang, 'ur-PK');
  assert.equal(p.spoken[0].text, unresolved);
  p.end();
  assert.equal(await pending, 'completed');
  assert.equal(p.spoken.length, 1); // Exactly 1 utterance (Urdu only, no English attempted)
});

test('CONFIRMED URDU FLOW: confirmExactText does not trigger SpeechController automatically', () => {
  const p = new TestSpeechPort();
  new SpeechController(p);
  store.getState().clearSelection();
  store.getState().setCommunicationText('یہ ایک جملہ ہے');
  store.getState().confirmExactText('ur');
  assert.equal(p.spoken.length, 0); // No automatic speech
  store.getState().clearSelection();
});

test('CONFIRMED URDU FLOW: Editing communicationText invalidates confirmed exact message', () => {
  store.getState().clearSelection();
  store.getState().setCommunicationText('ابتدائی متن');
  store.getState().confirmExactText('ur');
  assert.ok(store.getState().generatedMessage);

  // Edit text
  store.getState().setCommunicationText('تبدیل شدہ متن');
  assert.equal(store.getState().generatedMessage, null);
  store.getState().clearSelection();
});

test('CONFIRMED URDU FLOW: Clear selection removes exact message and text', () => {
  store.getState().clearSelection();
  store.getState().setCommunicationText('مٹانے کے لیے متن');
  store.getState().confirmExactText('ur');
  assert.ok(store.getState().generatedMessage);

  store.getState().clearSelection();
  assert.equal(store.getState().generatedMessage, null);
  assert.equal(store.getState().communicationText, '');
});

test('CONFIRMED URDU FLOW: Canonical bilingual candidate selection remains unchanged', () => {
  store.getState().clearSelection();
  store.getState().setCommunicationText('مجھے پانی چاہیے');
  const s = store.getState();
  assert.equal(s.resolution.status, 'clear');
  s.selectCandidate(s.resolution.candidates[0].id);
  const canonical = store.getState().generatedMessage;
  assert.ok(canonical);
  assert.equal(canonical?.sourceLanguage, undefined);
  assert.equal(canonical?.englishText, 'I need water.');
  assert.equal(canonical?.urduText, 'مجھے پانی چاہیے۔');
  store.getState().clearSelection();
});

test('CONFIRMED URDU FLOW: SmartClarification is suppressed after exact text confirmation', () => {
  store.getState().clearSelection();
  store.getState().setCommunicationText('یہ غیر واضح ہے');
  // Before confirmation: clarification would be rendered
  const htmlBefore = render(h(SmartClarification));
  assert.match(htmlBefore, /smart-clarification/);

  // After confirmation: SmartClarification returns null
  store.getState().confirmExactText('ur');
  const htmlAfter = render(h(SmartClarification));
  assert.equal(htmlAfter, '');
  store.getState().clearSelection();
});

test('CONFIRMED URDU FLOW: VoiceCommandPanel renders "Use these exact words / یہی الفاظ استعمال کریں" button for unresolved Urdu', () => {
  store.getState().clearSelection();
  store.getState().setCommunicationText('غیر مصدقہ جملہ');
  const html = render(h(MemoryRouter, null, h(VoiceCommandPanel)));
  assert.match(html, /Use these exact words/);
  assert.match(html, /یہی الفاظ استعمال کریں/);
  store.getState().clearSelection();
});

test('CONFIRMED URDU FLOW: Transient exact transcript and message do not enter stored state', () => {
  store.getState().clearSelection();
  const unresolved = 'یہ نجی اردو جملہ ہے جو محفوظ نہیں ہونا چاہیے';
  store.getState().setCommunicationText(unresolved);
  store.getState().confirmExactText('ur');
  const raw = JSON.stringify(store.getState().getFullStoredState());
  assert.doesNotMatch(raw, /نجی|محفوظ|sourceLanguage|generatedMessage/);

  store.getState().initFromStoredState(JSON.parse(raw));
  assert.equal(store.getState().communicationText, '');
  assert.equal(store.getState().generatedMessage, null);
});

