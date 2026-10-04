import { useEffect, useState, useSyncExternalStore } from 'react';
import { RecognitionController, createBrowserRecognition } from '@/features/communication/recognitionController';
export function useSpeechRecognition(onComplete:(text:string)=>void) {
  const [controller]=useState(()=>new RecognitionController(createBrowserRecognition,onComplete));
  useEffect(()=>{controller.setOnComplete(onComplete);},[controller,onComplete]);
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>()=>controller.abort(),[controller]);
  return {...state,start:controller.start,stop:controller.stop,abort:controller.abort,reset:controller.reset};
}
