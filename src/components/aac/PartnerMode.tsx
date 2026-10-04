import { useRef, useState, useEffect } from 'react';
import { Presentation, ArrowLeft, Volume2, Square, RotateCcw, Check, X } from 'lucide-react';
import type { SpeechMessage } from '@/features/communication/speechController';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { useCommunicationStore } from '@/store/communicationStore';
import { resolveIntent } from '@/features/communication/intentResolver';
export function PartnerMode({message}:{message:SpeechMessage & {sourceLanguage?: 'en' | 'ur'}}){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [reply,setReply]=useState<SpeechMessage|null>(null);
 const {speakMessage,cancel,isSpeaking,repeat,canRepeat,error}=useSpeechSynthesis();
 const p=useCommunicationStore(s=>s.preferences),shown=reply??message;
 useEffect(()=>()=>cancel(),[cancel]);
 const back=()=>{cancel();dialog.current?.close();setReply(null);trigger.current?.focus();};
 const answer=(id:string)=>{cancel();const r=resolveIntent({symbolIds:[id]});const c=r.candidates[0];setReply({englishText:c.english,urduText:c.urdu});};
 return <><button ref={trigger} type="button" className="action-button partner-trigger" onClick={()=>{cancel();setReply(null);dialog.current?.showModal();}}><Presentation aria-hidden="true"/>Partner Mode</button>
 <dialog ref={dialog} className="partner-dialog" aria-labelledby="partner-heading" onCancel={e=>{e.preventDefault();back();}}>
  <div className="partner-top"><button className="action-button" type="button" onClick={back}><ArrowLeft aria-hidden="true"/>Back</button><h1 id="partner-heading">A message for you</h1><span>CommuniCare</span></div>
  <div className="partner-message" aria-live="polite">
   {shown.englishText && <p lang="en">{shown.englishText}</p>}
   {shown.urduText && <p lang="ur" dir="rtl">{shown.urduText}</p>}
  </div>
  <div className="partner-actions">{isSpeaking?<button type="button" className="action-button stop-button" onClick={cancel}><Square aria-hidden="true"/>Stop</button>:<button type="button" className="action-button primary-button" onClick={()=>{
    const sourceLang = 'sourceLanguage' in shown ? (shown.sourceLanguage as 'en' | 'ur' | undefined) : undefined;
    const mode = sourceLang ?? p.preferredVoiceLang;
    void speakMessage(shown, mode, {rate:p.speechRate,pitch:p.speechPitch,volume:p.speechVolume});
  }}><Volume2 aria-hidden="true"/>Speak Again</button>}
  <button type="button" className="action-button" disabled={!canRepeat} onClick={()=>{void repeat();}}><RotateCcw aria-hidden="true"/>Repeat</button>
  <button type="button" className="action-button" onClick={()=>answer('basic-yes')}><Check aria-hidden="true"/>Yes <span lang="ur" dir="rtl">ہاں</span></button>
  <button type="button" className="action-button" onClick={()=>answer('basic-no')}><X aria-hidden="true"/>No <span lang="ur" dir="rtl">نہیں</span></button></div>
  {error&&<p role="status">{error}</p>}
 </dialog></>;
}
