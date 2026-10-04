import { useEffect } from 'react';
import { useCommunicationStore } from '@/store/communicationStore';
import { emptyPersonalization } from '@/features/signature/types';
import { onlineSuggestions } from '@/features/suggestions/onlineSuggestions';
export function useContextualSuggestions(busy:boolean){
 const resolution=useCommunicationStore(s=>s.resolution),selected=useCommunicationStore(s=>s.selectedCandidateId);
 const signature=useCommunicationStore(s=>s.signature),profile=useCommunicationStore(s=>s.activeProfile?.id);
 const preferences=signature.profiles[profile??'default']??emptyPersonalization();
 useEffect(()=>{
  if(!signature.aiEnabled||busy||selected||resolution.status!=='clear'||resolution.intent?.kind==='emergency'||resolution.candidates.some(c=>c.source==='gemini')||!navigator.onLine)return;
  const controller=new AbortController(),timer=setTimeout(()=>{
   void onlineSuggestions(resolution,preferences.context,preferences.style,controller.signal).then(pairs=>{
    if(!controller.signal.aborted)useCommunicationStore.getState().applyEnhanced(resolution,pairs);
   });
  },350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[resolution.input,selected,signature.aiEnabled,preferences.context,preferences.style,busy,resolution]);
}
