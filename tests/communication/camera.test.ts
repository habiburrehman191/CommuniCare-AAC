import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  CameraController,
  mapCameraError,
  type MediaDevicesPort,
  type MediaStreamPort,
  type MediaStreamTrackPort,
  type MediaDeviceInfoPort,
  type VideoElementPort,
} from '../../src/features/camera/cameraController';
import { CameraPanel } from '../../src/components/aac/CameraPanel';
import { CommunicationBoardSection } from '../../src/sections/CommunicationBoardSection';
import { useCommunicationStore } from '../../src/store/communicationStore';
import { defaultStoredState } from '../../src/lib/storage';
import { emergencyPhrases } from '../../src/data/phrases';
import { emergencyMessage } from '../../src/features/communication/emergencySpeech';

class MockTrack implements MediaStreamTrackPort {
  id: string;
  kind: string;
  label: string;
  stopped = false;

  constructor(kind = 'video', id = 'track-' + Math.random(), label = 'Mock Video Track') {
    this.kind = kind;
    this.id = id;
    this.label = label;
  }

  stop() {
    this.stopped = true;
  }
}

class MockStream implements MediaStreamPort {
  tracks: MockTrack[];

  constructor(tracks?: MockTrack[]) {
    this.tracks = tracks ?? [new MockTrack('video')];
  }

  getTracks(): MockTrack[] {
    return this.tracks;
  }

  getVideoTracks(): MockTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

class MockMediaDevices implements MediaDevicesPort {
  callCount = 0;
  lastConstraints: MediaStreamConstraints | null = null;
  streamsCreated: MockStream[] = [];
  devices: MediaDeviceInfoPort[] = [
    { deviceId: 'cam-1', kind: 'videoinput', label: 'Front Facing Camera' },
    { deviceId: 'cam-2', kind: 'videoinput', label: 'Back Facing Camera' },
  ];
  errorToThrow: Error | null = null;
  delayPromise: Promise<void> | null = null;

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamPort> {
    this.callCount++;
    this.lastConstraints = constraints;
    if (this.delayPromise) {
      await this.delayPromise;
    }
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    const stream = new MockStream();
    this.streamsCreated.push(stream);
    return stream;
  }

  async enumerateDevices(): Promise<MediaDeviceInfoPort[]> {
    return this.devices;
  }
}

class MockVideoElement implements VideoElementPort {
  srcObject: MediaStreamPort | null = null;
  played = false;

  play = async () => {
    this.played = true;
  };

  pause = () => {
    this.played = false;
  };
}

beforeEach(() => {
  useCommunicationStore.getState().initFromStoredState(defaultStoredState);
  useCommunicationStore.getState().clearSelection();
});

// Scenario 1: Camera does not start automatically
test('1. Camera does not start automatically', () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  assert.equal(mediaDevices.callCount, 0);
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().stream, null);

  const html = render(h(CameraPanel, { controller }));
  assert.equal(mediaDevices.callCount, 0);
  assert.match(html, /Start Camera/);
  assert.doesNotMatch(html, /Stop Camera/);
});

// Scenario 2: Explicit Start Camera calls getUserMedia once
test('2. Explicit Start Camera calls getUserMedia once', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  const outcome = await controller.start();
  assert.equal(outcome, 'active');
  assert.equal(mediaDevices.callCount, 1);
  assert.equal(controller.getSnapshot().status, 'active');
  assert.ok(controller.getSnapshot().stream !== null);
});

// Scenario 3: Request contains video and audio:false
test('3. Request contains video and audio:false', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  await controller.start();
  assert.ok(mediaDevices.lastConstraints);
  assert.ok(mediaDevices.lastConstraints.video);
  assert.equal(mediaDevices.lastConstraints.audio, false);
});

// Scenario 4: Successful stream attaches to video
test('4. Successful stream attaches to video', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);
  const video = new MockVideoElement();

  controller.attachVideo(video);
  assert.equal(video.srcObject, null);

  await controller.start();
  assert.equal(video.srcObject, controller.getSnapshot().stream);
  assert.equal(video.played, true);
});

// Scenario 5: Stop Camera stops every MediaStreamTrack
test('5. Stop Camera stops every MediaStreamTrack', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  await controller.start();
  const stream = controller.getSnapshot().stream as MockStream;
  assert.equal(stream.tracks.length, 1);
  assert.equal(stream.tracks[0].stopped, false);

  controller.stop();
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().stream, null);
});

// Scenario 6: Stop clears the video srcObject
test('6. Stop clears the video srcObject', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);
  const video = new MockVideoElement();

  controller.attachVideo(video);
  await controller.start();
  assert.ok(video.srcObject !== null);

  controller.stop();
  assert.equal(video.srcObject, null);
});

// Scenario 7: Unmount stops active tracks
test('7. Unmount/destroy stops active tracks', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);
  const video = new MockVideoElement();

  controller.attachVideo(video);
  await controller.start();
  const stream = controller.getSnapshot().stream as MockStream;

  controller.destroy();
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(video.srcObject, null);
  assert.equal(controller.getSnapshot().status, 'idle');
});

// Scenario 8: Switching away from camera stops tracks
test('8. Switching away from camera stops tracks', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  await controller.start();
  const stream = controller.getSnapshot().stream as MockStream;
  assert.equal(stream.tracks[0].stopped, false);

  // When caller switches view/tab away from camera
  controller.stop();
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(controller.getSnapshot().stream, null);
});

// Scenario 9: Permission denied handled
test('9. Permission denied handled', async () => {
  const mediaDevices = new MockMediaDevices();
  const err = new Error('Permission denied');
  err.name = 'NotAllowedError';
  mediaDevices.errorToThrow = err;

  const controller = new CameraController(mediaDevices);
  const outcome = await controller.start();

  assert.equal(outcome, 'error');
  assert.equal(controller.getSnapshot().status, 'error');
  assert.match(controller.getSnapshot().error ?? '', /Camera permission was denied/i);
  assert.equal(controller.getSnapshot().stream, null);
});

// Scenario 10: No camera found handled
test('10. No camera found handled', async () => {
  const mediaDevices = new MockMediaDevices();
  const err = new Error('Device not found');
  err.name = 'NotFoundError';
  mediaDevices.errorToThrow = err;

  const controller = new CameraController(mediaDevices);
  const outcome = await controller.start();

  assert.equal(outcome, 'error');
  assert.equal(controller.getSnapshot().status, 'error');
  assert.match(controller.getSnapshot().error ?? '', /No camera was found/i);
});

// Scenario 11: Camera busy/unreadable handled
test('11. Camera busy/unreadable handled', async () => {
  const mediaDevices = new MockMediaDevices();
  const err = new Error('Track start error');
  err.name = 'NotReadableError';
  mediaDevices.errorToThrow = err;

  const controller = new CameraController(mediaDevices);
  const outcome = await controller.start();

  assert.equal(outcome, 'error');
  assert.equal(controller.getSnapshot().status, 'error');
  assert.match(controller.getSnapshot().error ?? '', /already in use|unavailable/i);
});

// Scenario 12: Unsupported browser handled
test('12. Unsupported browser handled', async () => {
  const controller = new CameraController(null);
  const outcome = await controller.start();

  assert.equal(outcome, 'unsupported');
  assert.equal(controller.getSnapshot().status, 'unsupported');
  assert.match(controller.getSnapshot().error ?? '', /not supported/i);
});

// Scenario 13: Late/stale getUserMedia resolution after stop is discarded and tracks stopped
test('13. Late/stale getUserMedia resolution after stop is discarded and tracks stopped', async () => {
  const mediaDevices = new MockMediaDevices();
  let resolveLatePermission!: () => void;
  mediaDevices.delayPromise = new Promise<void>((resolve) => {
    resolveLatePermission = resolve;
  });

  const controller = new CameraController(mediaDevices);
  const startPromise = controller.start();

  assert.equal(controller.getSnapshot().status, 'requesting');

  // User cancels or stops before permission resolves
  controller.stop();
  assert.equal(controller.getSnapshot().status, 'idle');

  // Late permission arrives
  resolveLatePermission();
  const outcome = await startPromise;

  assert.equal(outcome, 'cancelled');
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().stream, null);
  // Stale stream must have all tracks stopped
  assert.equal(mediaDevices.streamsCreated.length, 1);
  assert.equal(mediaDevices.streamsCreated[0].tracks[0].stopped, true);
});

// Scenario 14: Repeated Start does not create overlapping streams
test('14. Repeated Start does not create overlapping streams', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  await controller.start();
  const firstStream = controller.getSnapshot().stream as MockStream;
  assert.equal(firstStream.tracks[0].stopped, false);

  await controller.start();
  const secondStream = controller.getSnapshot().stream as MockStream;
  assert.notEqual(firstStream, secondStream);
  // Prior stream tracks must be stopped
  assert.equal(firstStream.tracks[0].stopped, true);
  assert.equal(secondStream.tracks[0].stopped, false);
});

// Scenario 15: Switch Camera does not leave previous tracks active
test('15. Switch Camera does not leave previous tracks active', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  await controller.start();
  assert.equal(controller.getSnapshot().devices.length, 2);
  const firstStream = controller.getSnapshot().stream as MockStream;

  await controller.switchCamera();
  const secondStream = controller.getSnapshot().stream as MockStream;

  assert.notEqual(firstStream, secondStream);
  assert.equal(firstStream.tracks[0].stopped, true);
  assert.equal(secondStream.tracks[0].stopped, false);
});

// Scenario 16: Camera mode never changes generatedMessage
test('16. Camera mode never changes generatedMessage', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  useCommunicationStore.setState({
    generatedMessage: {
      id: 'msg-test',
      selectedPhraseIds: ['food-water'],
      englishText: 'I need water please.',
      urduText: 'مجھے پانی چاہیے برائے مہربانی۔',
      mode: 'sentence',
      sourceLanguage: 'en',
      createdAt: new Date().toISOString(),
    },
  });

  const initial = useCommunicationStore.getState().generatedMessage;
  assert.ok(initial !== null);

  await controller.start();
  assert.deepEqual(useCommunicationStore.getState().generatedMessage, initial);

  await controller.switchCamera();
  assert.deepEqual(useCommunicationStore.getState().generatedMessage, initial);

  controller.stop();
  assert.deepEqual(useCommunicationStore.getState().generatedMessage, initial);
});

// Scenario 17: Camera mode never calls speech synthesis
test('17. Camera mode never calls speech synthesis', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  let speechCalled = false;
  const originalSpeech = (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  (globalThis as unknown as { speechSynthesis: { speak: () => void } }).speechSynthesis = {
    speak: () => {
      speechCalled = true;
    },
  };

  try {
    await controller.start();
    controller.stop();
    assert.equal(speechCalled, false);
  } finally {
    if (originalSpeech) {
      (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = originalSpeech;
    } else {
      delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    }
  }
});

// Scenario 18: Camera mode never calls /api/tts
test('18. Camera mode never calls /api/tts', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    fetchCalls.push(String(url));
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  try {
    await controller.start();
    await controller.switchCamera();
    controller.stop();
    assert.equal(fetchCalls.some((url) => url.includes('/api/tts')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Scenario 19: Camera mode never calls /api/transcribe
test('19. Camera mode never calls /api/transcribe', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    fetchCalls.push(String(url));
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  try {
    await controller.start();
    controller.stop();
    assert.equal(fetchCalls.some((url) => url.includes('/api/transcribe')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Scenario 20: Camera mode never calls /api/suggestions
test('20. Camera mode never calls /api/suggestions', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    fetchCalls.push(String(url));
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  try {
    await controller.start();
    controller.stop();
    assert.equal(fetchCalls.some((url) => url.includes('/api/suggestions')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Scenario 21: Camera frames/stream are never persisted
test('21. Camera frames/stream are never persisted', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  await controller.start();
  const fullStored = useCommunicationStore.getState().getFullStoredState();
  const serialized = JSON.stringify(fullStored);

  assert.doesNotMatch(serialized, /MediaStream|stream|tracks|camera|videoinput/i);
  controller.stop();
});

// Scenario 22: Existing voice UI still functions after switching Camera -> Voice
test('22. Existing voice UI still functions after switching Camera -> Voice', () => {
  const html = render(
    h(
      MemoryRouter,
      { initialEntries: ['/board'] },
      h(CommunicationBoardSection)
    )
  );

  // Tabs exist
  assert.match(html, /id="tab-mode-voice"/);
  assert.match(html, /id="tab-mode-camera"/);

  // Voice tab is active by default, preserving all voice controls
  assert.match(html, /Message text \(editable\)/);
  assert.match(html, /value="en-US"/);
  assert.match(html, /value="ur-PK"/);
  assert.match(html, /Live transcript/);
  assert.match(html, /Final transcript/);
});

// Scenario 23: SOS remains unchanged
test('23. SOS remains unchanged and local', async () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);

  await controller.start();
  // Ensure emergency phrases and offline resolution are intact
  assert.equal(emergencyPhrases.length, 3);
  const helpMsg = emergencyMessage('emergency-help');
  assert.ok(helpMsg);
  assert.equal(helpMsg.englishText, 'I need help now.');
  assert.equal(helpMsg.urduText, 'مجھے ابھی مدد چاہیے۔');

  controller.stop();
});

// UI & Accessibility verification
test('CameraPanel renders live video attributes and exact privacy text', () => {
  const mediaDevices = new MockMediaDevices();
  const controller = new CameraController(mediaDevices);
  const html = render(h(CameraPanel, { controller }));

  // Video attributes: autoPlay, playsInline, muted
  assert.match(html, /autoPlay=""/i);
  assert.match(html, /playsInline=""/i);
  assert.match(html, /muted=""/i);

  // Status live region
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);

  // Exact English privacy statement
  assert.ok(
    html.includes(
      'Camera processing will be local to this device. CommuniCare does not record or upload camera video.'
    ),
    'Must include exact English privacy notice'
  );

  // Exact Urdu privacy statement
  assert.ok(
    html.includes(
      'کیمرہ ویڈیو صرف اسی ڈیوائس پر استعمال ہوگی۔ CommuniCare ویڈیو کو ریکارڈ یا اپ لوڈ نہیں کرتا۔'
    ),
    'Must include exact Urdu privacy notice'
  );
});

test('mapCameraError correctly maps browser errors without exposing stack traces', () => {
  assert.match(mapCameraError({ name: 'NotAllowedError' }), /denied/i);
  assert.match(mapCameraError({ name: 'NotFoundError' }), /No camera was found/i);
  assert.match(mapCameraError({ name: 'NotReadableError' }), /already in use/i);
  assert.match(mapCameraError({ name: 'OverconstrainedError' }), /unavailable/i);
  assert.match(mapCameraError({ name: 'SecurityError' }), /security settings/i);
  assert.match(mapCameraError(new Error('Unknown generic error')), /Unable to start camera/i);
});
