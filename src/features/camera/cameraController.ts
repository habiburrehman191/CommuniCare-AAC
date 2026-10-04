export type CameraStatus = 'idle' | 'requesting' | 'active' | 'stopping' | 'error' | 'unsupported';

export interface MediaStreamTrackPort {
  id?: string;
  kind?: string;
  label?: string;
  stop(): void;
}

export interface MediaStreamPort {
  getTracks(): MediaStreamTrackPort[];
  getVideoTracks(): MediaStreamTrackPort[];
}

export interface MediaDeviceInfoPort {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
}

export interface MediaDevicesPort {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamPort>;
  enumerateDevices?(): Promise<MediaDeviceInfoPort[]>;
}

export interface VideoElementPort {
  srcObject: MediaStreamPort | null;
  play?: () => Promise<void>;
  pause?: () => void;
}

export interface CameraSnapshot {
  status: CameraStatus;
  error: string | null;
  stream: MediaStreamPort | null;
  devices: MediaDeviceInfoPort[];
  activeDeviceId: string | null;
}

export function mapCameraError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Please allow camera access in your browser settings to use video.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another application or is unavailable.';
    case 'OverconstrainedError':
      return 'Requested camera settings are unavailable on this device.';
    case 'SecurityError':
      return 'Camera access is blocked by browser security settings.';
    default:
      return 'Unable to start camera. Please check your device and browser settings.';
  }
}

export class CameraController {
  private session = 0;
  private state: CameraSnapshot;
  private listeners = new Set<() => void>();
  private port: MediaDevicesPort | null;
  private videoElement: VideoElementPort | null = null;

  constructor(port: MediaDevicesPort | null) {
    this.port = port;
    this.state = {
      status: 'idle',
      error: null,
      stream: null,
      devices: [],
      activeDeviceId: null,
    };
  }

  getSnapshot = (): CameraSnapshot => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<CameraSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  attachVideo = (element: VideoElementPort | null) => {
    this.videoElement = element;
    if (this.videoElement) {
      this.videoElement.srcObject = this.state.stream;
      if (this.state.stream) {
        this.videoElement.play?.().catch(() => {});
      }
    }
  };

  detachVideo = () => {
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
  };

  start = async (deviceId?: string): Promise<'active' | 'error' | 'unsupported' | 'cancelled'> => {
    if (!this.port || typeof this.port.getUserMedia !== 'function') {
      this.publish({
        status: 'unsupported',
        error: 'Camera is not supported in this browser.',
        stream: null,
      });
      return 'unsupported';
    }

    // Stop any existing stream cleanly before requesting a new one
    if (this.state.stream) {
      this.state.stream.getTracks().forEach((track) => track.stop());
      if (this.videoElement) {
        this.videoElement.srcObject = null;
      }
    }

    this.session++;
    const token = this.session;
    const targetDeviceId = deviceId ?? this.state.activeDeviceId;

    this.publish({
      status: 'requesting',
      error: null,
      stream: null,
      activeDeviceId: targetDeviceId,
    });

    const constraints: MediaStreamConstraints = {
      video: targetDeviceId
        ? { deviceId: { exact: targetDeviceId } }
        : { facingMode: 'user' },
      audio: false,
    };

    try {
      const stream = await this.port.getUserMedia(constraints);

      // Guard against stale response if stopped or session changed while awaiting permission
      if (token !== this.session) {
        stream.getTracks().forEach((track) => track.stop());
        return 'cancelled';
      }

      let videoDevices = this.state.devices;
      if (typeof this.port.enumerateDevices === 'function') {
        try {
          const all = await this.port.enumerateDevices();
          videoDevices = all.filter((d) => d.kind === 'videoinput');
        } catch {
          /* ignore device enumeration errors */
        }
      }

      if (token !== this.session) {
        stream.getTracks().forEach((track) => track.stop());
        return 'cancelled';
      }

      if (this.videoElement) {
        this.videoElement.srcObject = stream;
        this.videoElement.play?.().catch(() => {});
      }

      this.publish({
        status: 'active',
        error: null,
        stream,
        devices: videoDevices,
        activeDeviceId: targetDeviceId,
      });

      return 'active';
    } catch (err: unknown) {
      if (token !== this.session) {
        return 'cancelled';
      }

      const errorMsg = mapCameraError(err);
      this.publish({
        status: 'error',
        error: errorMsg,
        stream: null,
      });

      return 'error';
    }
  };

  stop = () => {
    this.session++;
    if (this.state.stream) {
      this.state.stream.getTracks().forEach((track) => track.stop());
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.publish({
      status: 'idle',
      error: null,
      stream: null,
    });
  };

  switchCamera = async () => {
    if (this.state.devices.length <= 1) return;
    const currentIndex = this.state.devices.findIndex(
      (d) => d.deviceId === this.state.activeDeviceId
    );
    const nextIndex = (currentIndex + 1) % this.state.devices.length;
    const nextDevice = this.state.devices[nextIndex];
    if (nextDevice) {
      await this.start(nextDevice.deviceId);
    }
  };

  destroy = () => {
    this.stop();
    this.detachVideo();
    this.listeners.clear();
  };
}

export function createBrowserMediaDevices(): MediaDevicesPort | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }
  return navigator.mediaDevices;
}

let sharedController: CameraController | undefined;

export function setCameraControllerForTesting(controller?: CameraController) {
  sharedController = controller;
}

export function getCameraController(): CameraController {
  if (!sharedController) {
    sharedController = new CameraController(createBrowserMediaDevices());
  }
  return sharedController;
}
