import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { getCameraController } from '@/features/camera/cameraController';
import type { CameraController, VideoElementPort } from '@/features/camera/cameraController';

export function useCamera(customController?: CameraController) {
  const controller = customController ?? getCameraController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  const setVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoElementRef.current = node;
      controller.attachVideo(node as unknown as VideoElementPort);
    },
    [controller]
  );

  useEffect(() => {
    return () => {
      controller.stop();
      controller.detachVideo();
    };
  }, [controller]);

  const start = useCallback(() => controller.start(), [controller]);
  const stop = useCallback(() => controller.stop(), [controller]);
  const switchCamera = useCallback(() => controller.switchCamera(), [controller]);

  return {
    ...state,
    start,
    stop,
    switchCamera,
    setVideoRef,
    canSwitch: state.devices.length > 1,
  };
}
