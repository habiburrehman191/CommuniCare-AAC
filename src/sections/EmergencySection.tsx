import { RepeatMessageDetails } from '@/components/aac/RepeatMessageDetails';
import { AlertTriangle, ArrowLeft, Volume2, Square } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCallback, useState } from 'react';
import { SymbolCard } from '@/components/aac/SymbolCard';
import { emergencyPhrases } from '@/data/phrases';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { useCommunicationStore } from '@/store/communicationStore';
import type { Phrase } from '@/types';
import { emergencyMessage, speakEmergency } from '@/features/communication/emergencySpeech';

export function EmergencySection() {
  const [selectedPhrase,setSelectedPhrase]=useState<Phrase|null>(null);
  const addHistoryItem=useCommunicationStore(state=>state.addHistoryItem);
  const {speakMessage,isSpeaking,cancel,repeat,canRepeat,lastMessage,error}=useSpeechSynthesis();
  const selectSymbol=useCallback((phrase:Phrase)=>{
    cancel();
    setSelectedPhrase(emergencyPhrases.find(p=>p.id===phrase.id) ?? null);
  },[cancel]);
  const triggerUrgentSpeak=useCallback(async(phrase:Phrase,language:'auto'|'en'|'ur'=useCommunicationStore.getState().preferences.preferredVoiceLang)=>{
    selectSymbol(phrase);
    const result=await speakEmergency(phrase.id,language,speakMessage);
    const message=emergencyMessage(phrase.id);
    if(result==='completed' && message)addHistoryItem({id:'emergency-'+Date.now(),...message,mode:'sentence',timestamp:new Date().toISOString()});
  },[selectSymbol,speakMessage,addHistoryItem]);
  const alarmActive=isSpeaking;
  const urgentStatusText=selectedPhrase ? selectedPhrase.sentenceEnglish : '';
  const triggerDistressBeacon=()=>{
    if(isSpeaking){cancel();return;}
    const help=emergencyPhrases.find(p=>p.id==='emergency-help');
    if(help)void triggerUrgentSpeak(help);
  };

  return <div className="emergency-flow">
    <Link to="/board" className="back-link"><ArrowLeft aria-hidden="true"/>Back to communication</Link>
    <div className="emergency-heading"><div><p className="eyebrow">SOS</p><h1>Get help quickly</h1><p>Select a message or press Speak SOS Help.</p></div><button type="button" className="action-button danger-button sos-speak" onClick={triggerDistressBeacon}><AlertTriangle aria-hidden="true"/>{alarmActive?'Stop Speaking':'Speak SOS Help'}</button></div>
    <section className="message-surface emergency-message" aria-label="Selected emergency message">
      <div className="section-heading"><h2>Your emergency message</h2><span>{isSpeaking?'Speaking…':''}</span></div>
      <div className="message-preview" aria-live="polite"><p className="message-english">{selectedPhrase?urgentStatusText:'Choose a message below.'}</p><p className="message-urdu" lang="ur" dir="rtl">{selectedPhrase?selectedPhrase.sentenceUrdu:'نیچے سے پیغام منتخب کریں۔'}</p></div>
      <div className="action-row">{selectedPhrase&&<><button type="button" className="action-button danger-button" onClick={()=>{void triggerUrgentSpeak(selectedPhrase);}}><Volume2 aria-hidden="true"/>Speak Selected Emergency</button><button type="button" className="action-button" onClick={()=>{void triggerUrgentSpeak(selectedPhrase,'en');}}>Speak English Only</button><button type="button" className="action-button" onClick={()=>{void triggerUrgentSpeak(selectedPhrase,'ur');}}>Speak Urdu Only</button></>}
      {isSpeaking&&<button type="button" className="action-button stop-button" onClick={cancel}><Square aria-hidden="true"/>Stop Speaking</button>}
      {canRepeat&&<button type="button" className="action-button" title={lastMessage?.englishText} onClick={()=>{void repeat(true);}}>Repeat Last Message</button>}</div>
      <RepeatMessageDetails message={lastMessage}/>
      {error&&<p role="status" className="clarification">{error}</p>}
      <p className="quiet-hint emergency-note">Messages stay visible without internet. Speech uses installed local voices only. SOS does not call or contact anyone.</p>
    </section>
    <section aria-label="Available emergency phrases"><h2 className="section-title">Choose an urgent message</h2><div className="emergency-grid">{emergencyPhrases.map(phrase=><div key={phrase.id} className="emergency-option"><SymbolCard phrase={phrase} onSelect={selectSymbol} isSelected={selectedPhrase?.id===phrase.id}/><button type="button" className="action-button danger-outline" disabled={isSpeaking} onClick={()=>{void triggerUrgentSpeak(phrase);}}><Volume2 aria-hidden="true"/>Speak This Message</button></div>)}</div></section>
  </div>;
}
