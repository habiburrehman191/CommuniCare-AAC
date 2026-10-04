import { emergencyPhrases } from '../../data/phrases';
import type { SpeechMessage, SpeechMode, SpeechOptions, SpeechResult } from './speechController';
export function emergencyMessage(id:string):SpeechMessage|null {
  const phrase=emergencyPhrases.find(p=>p.id===id);
  return phrase ? {englishText:phrase.sentenceEnglish,urduText:phrase.sentenceUrdu} : null;
}
export function speakEmergency(id:string, mode:SpeechMode, speak:(message:SpeechMessage,mode:SpeechMode,options:SpeechOptions)=>Promise<SpeechResult>) {
  const message=emergencyMessage(id);
  return message ? speak(message,mode,{localOnly:true,rate:1,pitch:1,volume:1}) : Promise.resolve<SpeechResult>('error');
}
