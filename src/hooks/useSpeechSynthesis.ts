import { useCallback, useEffect, useId, useSyncExternalStore } from 'react';
import { getSpeechController } from '@/features/communication/speechController';
import type { SpeechMessage, SpeechMode, SpeechOptions } from '@/features/communication/speechController';
export function useSpeechSynthesis() {
  const controller=getSpeechController();
  const owner=useId();
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>()=>controller.cancelOwner(owner),[controller,owner]);
  const speakMessage=useCallback((message:SpeechMessage,mode:SpeechMode='auto',options:SpeechOptions={})=>controller.speak(message,mode,options,owner),[controller,owner]);
  const repeat=useCallback((localOnly=false)=>controller.repeat(owner,localOnly),[controller,owner]);
  const clearError=useCallback(()=>controller.clearError(),[controller]);
  return {...state,isSupported:state.supported,speakMessage,repeat,cancel:controller.cancel,clearError,canRepeat:!!state.lastMessage};
}
