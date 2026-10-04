import { useEffect, useState, useSyncExternalStore } from 'react';
import { OnlineTranscribeController } from '@/features/communication/onlineTranscribeController';
import type { ControllerDeps } from '@/features/communication/onlineTranscribeController';

export function useOnlineTranscribe(onTranscript: (text: string) => void, deps?: ControllerDeps) {
  const [controller] = useState(() => new OnlineTranscribeController(onTranscript, deps));
  useEffect(() => {
    controller.setOnTranscript(onTranscript);
  }, [controller, onTranscript]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.cancel(), [controller]);
  return {
    ...state,
    start: controller.start,
    stop: controller.stop,
    cancel: controller.cancel,
  };
}
