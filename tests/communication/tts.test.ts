
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTtsHandler, escapeXml } from '../../server/tts';
import { OnlineAudioPlayer } from '../../src/features/communication/onlineSpeech';
import type { OnlineAudioPort, HTMLAudioElementPort } from '../../src/features/communication/onlineSpeech';
import { SpeechController } from '../../src/features/communication/speechController';
import type { SpeechPort } from '../../src/features/communication/speechController';
import { useCommunicationStore as store } from '../../src/store/communicationStore';
import { speakEmergency } from '../../src/features/communication/emergencySpeech';

const testOrigin = 'http://localhost:8787';
const fakeAudioBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]); // RIFF...WAVE

const makeRequest = (
  body: unknown,
  options: { method?: string; origin?: string; contentType?: string } = {}
) => {
  const method = options.method ?? 'POST';
  const origin = options.origin ?? testOrigin;
  const contentType = options.contentType ?? 'application/json';
  const headers: Record<string, string> = {
    origin,
    'content-type': contentType,
  };
  let bodyContent: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
    bodyContent = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(origin + '/api/tts', {
    method,
    headers,
    ...(bodyContent !== undefined ? { body: bodyContent } : {}),
  });
};

const makeMockFetch = (status = 200, audio = fakeAudioBytes) => {
  return async (): Promise<Response> => {
    if (status !== 200) {
      return new Response(JSON.stringify({ error: 'Azure failure' }), { status });
    }
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
      },
    });
  };
};

const voice = (lang: string, localService = true, name = lang) =>
  ({ lang, localService, name, voiceURI: name, default: false }) as SpeechSynthesisVoice;

class MockSpeechPort implements SpeechPort {
  voices: SpeechSynthesisVoice[] = [];
  spoken: SpeechSynthesisUtterance[] = [];
  cancels = 0;
  listeners = new Set<()=>void>();
  getVoices = () => this.voices;
  create = (text: string) => ({ text, lang: '', onend: null, onerror: null, onstart: null } as SpeechSynthesisUtterance);
  speak = (u: SpeechSynthesisUtterance) => { this.spoken.push(u); };
  cancel = () => { this.cancels++; };
  listenVoices = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  end(index = this.spoken.length - 1) {
    this.spoken[index]?.onend?.(new Event('end') as SpeechSynthesisEvent);
  }
}

class MockAudioElement implements HTMLAudioElementPort {
  src = '';
  played = false;
  paused = false;
  onended: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  play = async () => {
    this.played = true;
  };
  pause = () => {
    this.paused = true;
  };
  finish() {
    this.onended?.(new Event('ended'));
  }
  triggerError() {
    this.onerror?.(new Event('error'));
  }
}

class MockOnlineAudioPort implements OnlineAudioPort {
  fetched: { text: string; signal: AbortSignal }[] = [];
  createdAudios: MockAudioElement[] = [];
  createdUrls: string[] = [];
  revokedUrls: string[] = [];
  throwOnFetch = false;
  blobToReturn = new Blob([fakeAudioBytes], { type: 'audio/wav' });

  fetchAudio = async (text: string, signal: AbortSignal): Promise<Blob> => {
    this.fetched.push({ text, signal });
    if (this.throwOnFetch) {
      throw new Error('Network error');
    }
    return this.blobToReturn;
  };
  createAudio = () => {
    const audio = new MockAudioElement();
    this.createdAudios.push(audio);
    return audio;
  };
  createObjectUrl = () => {
    const url = 'blob:test-' + Math.random();
    this.createdUrls.push(url);
    return url;
  };
  revokeObjectUrl = (url: string) => {
    this.revokedUrls.push(url);
  };
}

// ==========================================
// SERVER TESTS (1-17)
// ==========================================

test('SERVER 1: POST /api/tts valid Urdu request returns 200 with audio/wav', async () => {
  let capturedBody = '';
  let capturedHeaders: Record<string, string> = {};
  const mockFetch: typeof fetch = async (_url, init) => {
    capturedBody = String(init?.body ?? '');
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(fakeAudioBytes, { status: 200, headers: { 'Content-Type': 'audio/wav' } });
  };

  const handler = createTtsHandler({
    azureKey: 'test-key',
    azureRegion: 'eastus',
    origin: testOrigin,
    fetch: mockFetch,
  });

  const req = makeRequest({ text: 'مجھے پانی چاہیے', language: 'ur' });
  const res = await handler(req);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'audio/wav');
  assert.equal(capturedHeaders['Ocp-Apim-Subscription-Key'], 'test-key');
  assert.equal(capturedHeaders['X-Microsoft-OutputFormat'], 'riff-24khz-16bit-mono-pcm');
  assert.match(capturedBody, /<voice name="ur-PK-UzmaNeural">مجھے پانی چاہیے<\/voice>/);
});

test('SERVER 2: Wrong method → rejected with 405', async () => {
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin });
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const res = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }, { method }));
    assert.equal(res.status, 405);
  }
});

test('SERVER 3: Wrong origin → rejected with 403', async () => {
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin });
  const res = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }, { origin: 'https://evil.com' }));
  assert.equal(res.status, 403);
});

test('SERVER 4: Wrong content type → rejected with 415', async () => {
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin });
  const res = await handler(makeRequest('raw text', { contentType: 'text/plain' }));
  assert.equal(res.status, 415);
});

test('SERVER 5: language != ur → rejected with 400', async () => {
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin });
  for (const lang of ['en', 'fr', 'hi', 'ur-PK', '']) {
    const res = await handler(makeRequest({ text: 'hello', language: lang }));
    assert.equal(res.status, 400);
  }
});

test('SERVER 6: Empty text → rejected with 400', async () => {
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin });
  for (const empty of ['', '   ', '\n\t']) {
    const res = await handler(makeRequest({ text: empty, language: 'ur' }));
    assert.equal(res.status, 400);
  }
});

test('SERVER 7: Oversized text/body → rejected', async () => {
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin });
  // Text exceeds 500 characters
  const longText = 'ا'.repeat(501);
  const resText = await handler(makeRequest({ text: longText, language: 'ur' }));
  assert.equal(resText.status, 400);

  // Body exceeds 4096 bytes
  const oversizedBody = JSON.stringify({ text: 'ا'.repeat(4000), language: 'ur', extra: 'x'.repeat(1000) });
  const resBody = await handler(makeRequest(oversizedBody));
  assert.equal(resBody.status, 413);
});

test('SERVER 8: Missing AZURE_SPEECH_KEY → safe 503', async () => {
  const handler = createTtsHandler({ azureKey: undefined, azureRegion: 'eastus', origin: testOrigin });
  const res = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }));
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.error, 'TTS service not configured');
});

test('SERVER 9: Missing or invalid region → safe failure 503', async () => {
  const h1 = createTtsHandler({ azureKey: 'key', azureRegion: undefined, origin: testOrigin });
  const r1 = await h1(makeRequest({ text: 'ٹیسٹ', language: 'ur' }));
  assert.equal(r1.status, 503);

  const h2 = createTtsHandler({ azureKey: 'key', azureRegion: 'eastus/injection', origin: testOrigin });
  const r2 = await h2(makeRequest({ text: 'ٹیسٹ', language: 'ur' }));
  assert.equal(r2.status, 503);
});

test('SERVER 10: Azure network failure → safe failure 502/503', async () => {
  const mockFetch: typeof fetch = async () => {
    throw new Error('Connection refused');
  };
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin, fetch: mockFetch });
  const res = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }));
  assert.ok(res.status === 502 || res.status === 503);
  const data = await res.json();
  assert.ok(data.error);
});

test('SERVER 11: Azure timeout → safe failure 503', async () => {
  const mockFetch: typeof fetch = async (_url, init) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
    });
  };
  const handler = createTtsHandler({
    azureKey: 'k',
    azureRegion: 'eastus',
    origin: testOrigin,
    fetch: mockFetch,
    timeout: 20,
  });
  const res = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }));
  assert.equal(res.status, 503);
});

test('SERVER 12: Azure non-200 response → safe failure', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const handler = createTtsHandler({
      azureKey: 'k',
      azureRegion: 'eastus',
      origin: testOrigin,
      fetch: makeMockFetch(status),
    });
    const res = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }));
    assert.ok(res.status === 502 || res.status === 503);
  }
});

test('SERVER 13: SSML XML-escapes user text correctly', async () => {
  let capturedBody = '';
  const mockFetch: typeof fetch = async (_url, init) => {
    capturedBody = String(init?.body ?? '');
    return new Response(fakeAudioBytes, { status: 200, headers: { 'Content-Type': 'audio/wav' } });
  };
  const handler = createTtsHandler({ azureKey: 'k', azureRegion: 'eastus', origin: testOrigin, fetch: mockFetch });

  const rawText = `Urdu & English <tag> "quotes" and 'apostrophes'`;
  await handler(makeRequest({ text: rawText, language: 'ur' }));

  assert.ok(capturedBody.includes('&amp;'));
  assert.ok(capturedBody.includes('&lt;tag&gt;'));
  assert.ok(capturedBody.includes('&quot;quotes&quot;'));
  assert.ok(capturedBody.includes('&apos;apostrophes&apos;'));
  assert.ok(!capturedBody.includes('<tag>'));
  assert.equal(escapeXml(`A & B < C > D " E ' F`), `A &amp; B &lt; C &gt; D &quot; E &apos; F`);
});

test('SERVER 14: Successful audio returns audio/wav', async () => {
  const handler = createTtsHandler({
    azureKey: 'k',
    azureRegion: 'eastus',
    origin: testOrigin,
    fetch: makeMockFetch(200),
  });
  const res = await handler(makeRequest({ text: 'مجھے مدد چاہیے', language: 'ur' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'audio/wav');
});

test('SERVER 15: Cache-Control no-store', async () => {
  const handler = createTtsHandler({
    azureKey: 'k',
    azureRegion: 'eastus',
    origin: testOrigin,
    fetch: makeMockFetch(200),
  });
  const res = await handler(makeRequest({ text: 'مجھے مدد چاہیے', language: 'ur' }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Cache-Control') ?? '', /no-store/);
});

test('SERVER 16: No key, message text, or audio in server logs', async () => {
  const secretKey = 'super-secret-azure-key-12345';
  const sensitiveText = 'انتہائی حساس پیغام';
  const logged: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(' '));

  try {
    const handler = createTtsHandler({
      azureKey: secretKey,
      azureRegion: 'eastus',
      origin: testOrigin,
      fetch: makeMockFetch(500),
    });
    await handler(makeRequest({ text: sensitiveText, language: 'ur' }));

    const logDump = logged.join('\n');
    assert.doesNotMatch(logDump, new RegExp(secretKey));
    assert.doesNotMatch(logDump, new RegExp(sensitiveText));
    assert.doesNotMatch(logDump, /RIFF/);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test('SERVER 17: Rate limiting works (10/min per IP, 60/min global)', async () => {
  let time = 1000000;
  const handler = createTtsHandler({
    azureKey: 'k',
    azureRegion: 'eastus',
    origin: testOrigin,
    fetch: makeMockFetch(200),
    now: () => time,
  });

  for (let i = 0; i < 10; i++) {
    const res = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }), '192.168.1.1');
    assert.equal(res.status, 200);
  }
  const blocked = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }), '192.168.1.1');
  assert.equal(blocked.status, 429);

  // Different IP succeeds
  const otherIp = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }), '192.168.1.2');
  assert.equal(otherIp.status, 200);

  // Advances 1 minute -> rate limit resets
  time += 61000;
  const resetRes = await handler(makeRequest({ text: 'ٹیسٹ', language: 'ur' }), '192.168.1.1');
  assert.equal(resetRes.status, 200);
});

// ==========================================
// CLIENT TESTS (18-33)
// ==========================================

const bilingualMessage = { englishText: 'I need water.', urduText: 'مجھے پانی چاہیے۔' };
const urduExactMessage = { englishText: '', urduText: 'مجھے پانی چاہیے۔' };

test('CLIENT 18: English local speech never calls /api/tts', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const pending = c.speak(bilingualMessage, 'en');
  p.end();
  assert.equal(await pending, 'completed');
  assert.equal(onlinePort.fetched.length, 0);
  assert.equal(p.spoken.length, 1);
});

test('CLIENT 19: Existing local Urdu voice prevents Azure fallback', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US'), voice('ur-PK')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const pending = c.speak(bilingualMessage, 'ur');
  p.end();
  assert.equal(await pending, 'completed');
  assert.equal(onlinePort.fetched.length, 0);
  assert.equal(p.spoken.length, 1);
  assert.equal(p.spoken[0].lang, 'ur-PK');
});

test('CLIENT 20: missing-voice for Urdu triggers /api/tts', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')]; // no Urdu voice
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const pending = c.speak(urduExactMessage, 'ur');
  await Promise.resolve(); // allow microtasks
  assert.equal(onlinePort.fetched.length, 1);
  assert.equal(onlinePort.fetched[0].text, 'مجھے پانی چاہیے۔');
  assert.equal(c.getSnapshot().isSpeaking, true);

  onlinePort.createdAudios[0].finish();
  assert.equal(await pending, 'completed');
  assert.equal(c.getSnapshot().isSpeaking, false);
});

test('CLIENT 21: Fallback occurs only after explicit Speak Message action', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  // Simply setting text or confirming does not trigger speech
  store.getState().setCommunicationText('مجھے پانی چاہیے');
  store.getState().confirmExactText('ur');
  assert.equal(onlinePort.fetched.length, 0);

  // Explicit speak triggers it
  const pending = c.speak(store.getState().generatedMessage!, 'ur');
  await Promise.resolve();
  assert.equal(onlinePort.fetched.length, 1);
  onlinePort.createdAudios[0].finish();
  await pending;
});

test('CLIENT 22: generatedMessage.urduText is sent unchanged', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const exactText = 'براہ کرم میری مدد کیجیے!';
  const message = { englishText: '', urduText: exactText };
  const pending = c.speak(message, 'ur');
  await Promise.resolve();
  assert.equal(onlinePort.fetched[0].text, exactText);
  onlinePort.createdAudios[0].finish();
  await pending;
});

test('CLIENT 23: communicationText alone never triggers TTS', async () => {
  const onlinePort = new MockOnlineAudioPort();
  store.getState().setCommunicationText('مجھے پانی چاہیے');
  assert.equal(onlinePort.fetched.length, 0);
  assert.equal(store.getState().generatedMessage, null);
});

test('CLIENT 24: exact confirmation does not auto-speak', async () => {
  const onlinePort = new MockOnlineAudioPort();
  store.getState().setCommunicationText('کچھ مدد');
  store.getState().confirmExactText('ur');
  assert.ok(store.getState().generatedMessage);
  assert.equal(onlinePort.fetched.length, 0);
});

test('CLIENT 25: cancellation aborts request', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const pending = c.speak(urduExactMessage, 'ur');
  await Promise.resolve();
  assert.equal(onlinePort.fetched.length, 1);
  const signal = onlinePort.fetched[0].signal;
  assert.equal(signal.aborted, false);

  c.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(await pending, 'cancelled');
  assert.equal(c.getSnapshot().isSpeaking, false);
});

test('CLIENT 26: Stop stops Azure Audio immediately', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const pending = c.speak(urduExactMessage, 'ur');
  await Promise.resolve();
  const audio = onlinePort.createdAudios[0];
  assert.equal(audio.played, true);
  assert.equal(audio.paused, false);

  c.cancel();
  assert.equal(audio.paused, true);
  assert.equal(await pending, 'cancelled');
});

test('CLIENT 27: stale response cannot play', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  let delayedResolve!: (b: Blob) => void;
  onlinePort.fetchAudio = async () => new Promise<Blob>((resolve) => { delayedResolve = resolve; });

  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const oldCall = c.speak(urduExactMessage, 'ur');
  c.cancel();
  assert.equal(await oldCall, 'cancelled');

  // Stale response arrives late
  delayedResolve(new Blob([fakeAudioBytes]));
  await Promise.resolve();
  assert.equal(onlinePort.createdAudios.length, 0); // Audio element was never created
});

test('CLIENT 28: new speech replaces old online playback', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const firstCall = c.speak(urduExactMessage, 'ur');
  await Promise.resolve();
  const firstAudio = onlinePort.createdAudios[0];

  const secondCall = c.speak({ englishText: '', urduText: 'دوسرا پیغام' }, 'ur');
  await Promise.resolve();
  assert.equal(await firstCall, 'cancelled');
  assert.equal(firstAudio.paused, true);

  const secondAudio = onlinePort.createdAudios[1];
  assert.equal(secondAudio.played, true);
  secondAudio.finish();
  assert.equal(await secondCall, 'completed');
});

test('CLIENT 29: object URL is revoked', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  const pending = c.speak(urduExactMessage, 'ur');
  await Promise.resolve();
  assert.equal(onlinePort.createdUrls.length, 1);
  const createdUrl = onlinePort.createdUrls[0];

  onlinePort.createdAudios[0].finish();
  await pending;
  assert.ok(onlinePort.revokedUrls.includes(createdUrl));
});

test('CLIENT 30: failed online TTS keeps message visible', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  onlinePort.throwOnFetch = true;
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  store.getState().setCommunicationText('مجھے پانی چاہیے');
  store.getState().confirmExactText('ur');
  const message = store.getState().generatedMessage!;

  const result = await c.speak(message, 'ur');
  assert.equal(result, 'error');
  assert.match(c.getSnapshot().error!, /Online Urdu speech/);
  // Message remains in store
  assert.deepEqual(store.getState().generatedMessage, message);
});

test('CLIENT 31: no Hindi or English pronunciation fallback', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US'), voice('hi-IN'), voice('ar-SA')]; // Hindi present, no Urdu
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  // Missing local Urdu must not speak Hindi or English locally
  const pending = c.speak(urduExactMessage, 'ur');
  await Promise.resolve();
  assert.equal(p.spoken.length, 0); // 0 utterances sent to browser SpeechSynthesis
  assert.equal(onlinePort.fetched.length, 1); // went to online Urdu TTS
  onlinePort.createdAudios[0].finish();
  await pending;
});

test('CLIENT 32: existing canonical bilingual speech remains correct', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')];
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  // Speaking canonical bilingual in 'auto' with missing Urdu voice returns missing-voice locally
  const result = await c.speak(bilingualMessage, 'auto');
  assert.equal(result, 'missing-voice');
  assert.equal(onlinePort.fetched.length, 0);
  assert.match(c.getSnapshot().error!, /Urdu/);

  // Explicit English speaks locally
  const enCall = c.speak(bilingualMessage, 'en');
  p.end();
  assert.equal(await enCall, 'completed');
  assert.equal(p.spoken.length, 1);
  assert.equal(p.spoken[0].lang, 'en-US');
});

test('CLIENT 33: SOS never calls /api/tts', async () => {
  const p = new MockSpeechPort();
  p.voices = [voice('en-US')]; // no local Urdu voice
  const onlinePort = new MockOnlineAudioPort();
  const online = new OnlineAudioPlayer(onlinePort);
  const c = new SpeechController(p, online);

  // emergency speech sets localOnly: true
  const result = await speakEmergency('emergency-help', 'auto', c.speak);
  assert.equal(result, 'missing-voice');
  assert.equal(onlinePort.fetched.length, 0); // Azure NEVER called

  const urduResult = await speakEmergency('emergency-help', 'ur', c.speak);
  assert.equal(urduResult, 'missing-voice');
  assert.equal(onlinePort.fetched.length, 0); // Azure NEVER called

  // With a local voice spoken previously, SOS Repeat preserves localOnly
  p.voices = [voice('en-US'), voice('ur-PK')];
  const first = c.speak(bilingualMessage, 'ur');
  p.end();
  await first;

  // Now remove local Urdu voice: repeat with localOnly must report missing-voice, never Azure
  p.voices = [voice('en-US')];
  const repeatResult = await c.repeat('emergency', true);
  assert.equal(repeatResult, 'missing-voice');
  assert.equal(onlinePort.fetched.length, 0);
});
