import { OnlineAudioPlayer } from './onlineSpeech';

export type SpeechLanguage = 'en' | 'ur';
export type SpeechMode = SpeechLanguage | 'auto';
export interface SpeechMessage {englishText:string; urduText:string}
export interface SpeechOptions {rate?:number;pitch?:number;volume?:number;localOnly?:boolean;remember?:boolean}
export type SpeechResult = 'completed'|'cancelled'|'missing-voice'|'unsupported'|'error';
export interface SpeechPort {
  getVoices():SpeechSynthesisVoice[];
  create(text:string):SpeechSynthesisUtterance;
  speak(utterance:SpeechSynthesisUtterance):void;
  cancel():void;
  listenVoices(listener:()=>void):()=>void;
}
interface SpeechRequest {message:SpeechMessage;mode:SpeechMode;options:SpeechOptions}
export interface SpeechSnapshot {
  supported:boolean;isSpeaking:boolean;voices:SpeechSynthesisVoice[];error:string|null;
  lastMessage:SpeechMessage|null;
}
export const voiceLanguage = (voice:SpeechSynthesisVoice,lang:SpeechLanguage) => voice.lang.toLowerCase().replaceAll('_','-').split('-')[0]===lang;
/** Owns the entire bilingual session; callbacks are guarded even after browser cancel. */
export class SpeechController {
  private state:SpeechSnapshot;
  private listeners=new Set<()=>void>();
  private stopVoices:(()=>void)|null=null;
  private session=0;
  private owner:string|null=null;
  private utterance:SpeechSynthesisUtterance|null=null;
  private settle:((result:SpeechResult)=>void)|null=null;
  private watchdog:ReturnType<typeof setTimeout>|null=null;
  private last:SpeechRequest|null=null;
  private port:SpeechPort|null;
  private onlineSpeech:OnlineAudioPlayer|null;
  private onlineAudioAbort:AbortController|null=null;

  constructor(port:SpeechPort|null, onlineSpeech:OnlineAudioPlayer|null=null){
    this.port=port;
    this.onlineSpeech=onlineSpeech;
    this.state={supported:!!port || !!onlineSpeech,isSpeaking:false,voices:port?.getVoices() ?? [],error:null,lastMessage:null};
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{
    this.listeners.add(listener);
    if(this.listeners.size===1 && this.port){this.stopVoices=this.port.listenVoices(this.refreshVoices);this.refreshVoices();}
    return()=>{this.listeners.delete(listener);if(!this.listeners.size){this.stopVoices?.();this.stopVoices=null;}};
  };
  private publish(patch:Partial<SpeechSnapshot>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  refreshVoices=()=>{this.publish({voices:this.port?.getVoices() ?? []});};
  private release(){
    if(this.watchdog!==null)clearTimeout(this.watchdog);this.watchdog=null;
    if(this.utterance){this.utterance.onstart=null;this.utterance.onend=null;this.utterance.onerror=null;this.utterance=null;}
    if(this.onlineAudioAbort){this.onlineAudioAbort.abort();this.onlineAudioAbort=null;}
    this.onlineSpeech?.stop();
  }
  clearError=()=>{if(this.state.error)this.publish({error:null});};
  cancel=()=>{
    this.session++;this.release();this.owner=null;
    const settle=this.settle;this.settle=null;
    try{this.port?.cancel();}catch{/* Session invalidation still prevents later work. */}
    this.publish({isSpeaking:false,error:null});settle?.('cancelled');
  };
  cancelOwner=(owner:string)=>{if(this.owner===owner)this.cancel();};
  speak=(message:SpeechMessage,mode:SpeechMode='auto',options:SpeechOptions={},owner='default'):Promise<SpeechResult>=>{
    this.cancel();
    this.publish({error:null});
    if(!this.port && !this.onlineSpeech){this.publish({error:'Speech output is unavailable. The message remains on screen.'});return Promise.resolve('unsupported');}
    const languages:SpeechLanguage[]=mode==='auto'?['en','ur']:[mode];
    const voices=this.port ? this.port.getVoices() : [];
    const segments=languages.map(lang=>({lang,text:lang==='en'?message.englishText:message.urduText,voice:voices.filter(v=>voiceLanguage(v,lang) && (!options.localOnly || v.localService)).sort((a,b)=>Number(b.localService)-Number(a.localService))[0]}));
    // Validate the entire plan before speaking either language. Never substitute another language.
    const missing=segments.find(s=>!s.voice);
    if(missing){
      // Azure fallback occurs only when requested language === "ur" AND local SpeechController result === "missing-voice"
      if(mode==='ur' && missing.lang==='ur' && !options.localOnly && this.onlineSpeech){
        if(!message.urduText.trim()){this.publish({error:'The selected message is missing text for this language.'});return Promise.resolve('error');}
        const token=this.session;this.owner=owner;
        const request:SpeechRequest={message:{englishText:message.englishText,urduText:message.urduText},mode,options:{...options}};
        return new Promise(resolve=>{
          this.settle=resolve;
          this.publish({isSpeaking:true,error:null,voices});
          const abortCtrl=new AbortController();
          this.onlineAudioAbort=abortCtrl;

          this.onlineSpeech!.play(message.urduText.trim(), abortCtrl.signal).then(result=>{
            if(token!==this.session)return;
            this.release();this.owner=null;this.session++;
            const done=this.settle;this.settle=null;
            if(result==='completed'){
              if(options.remember!==false){this.last=request;this.publish({lastMessage:{...request.message}});}
              this.publish({isSpeaking:false,error:null});
              done?.('completed');
            } else if(result==='cancelled'){
              this.publish({isSpeaking:false});
              done?.('cancelled');
            } else {
              const err = this.onlineSpeech?.getLastError?.() || 'Online Urdu speech could not finish. Please try again or use the displayed message.';
              this.publish({isSpeaking:false,error:err});
              done?.('error');
            }
          }).catch(()=>{
            if(token!==this.session)return;
            this.release();this.owner=null;this.session++;
            const done=this.settle;this.settle=null;
            const err = this.onlineSpeech?.getLastError?.() || 'Online Urdu speech could not start. Please try again or use the displayed message.';
            this.publish({isSpeaking:false,error:err});
            done?.('error');
          });
        });
      }

      this.publish({voices,error:`${options.localOnly?'An installed offline':'An'} ${missing.lang==='ur'?'Urdu':'English'} voice is unavailable. The message remains visible; choose an available language explicitly.`});
      return Promise.resolve('missing-voice');
    }
    if(segments.some(s=>!s.text.trim())){this.publish({error:'The selected message is missing text for this language.'});return Promise.resolve('error');}
    const token=this.session;this.owner=owner;
    const request:SpeechRequest={message:{englishText:message.englishText,urduText:message.urduText},mode,options:{...options}};
    return new Promise(resolve=>{
      this.settle=resolve;this.publish({isSpeaking:true,error:null,voices});
      const finish=(result:SpeechResult,error:string|null=null)=>{
        if(token!==this.session)return;
        this.release();this.owner=null;this.session++;
        const done=this.settle;this.settle=null;
        if(result==='error')try{this.port?.cancel();}catch{/* already invalidated */}
        this.publish({isSpeaking:false,error});done?.(result);
      };
      const next=(index:number)=>{
        if(token!==this.session)return;
        if(index===segments.length){finish('completed');return;}
        const segment=segments[index];
        try{
          const utterance=this.port!.create(segment.text.trim());this.utterance=utterance;
          utterance.lang=segment.voice.lang;utterance.voice=segment.voice;
          const bounded=(value:number|undefined,fallback:number,min:number,max:number)=>Number.isFinite(value)?Math.max(min,Math.min(max,value!)):fallback;
          utterance.rate=bounded(options.rate,1,0.5,1.5);utterance.pitch=bounded(options.pitch,1,0.5,1.5);utterance.volume=bounded(options.volume,1,0,1);
          let ended=false;
          utterance.onend=()=>{if(ended || token!==this.session)return;ended=true;this.release();next(index+1);};
          utterance.onerror=()=>{if(ended || token!==this.session)return;ended=true;finish('error','Speech could not finish. Please try again or use the displayed message.');};
          // Also release a browser session that never emits an end/error event.
          this.watchdog=setTimeout(()=>finish('error','Speech timed out. Please try again.'),120000);
          this.port!.speak(utterance);
          if(token===this.session && options.remember!==false && index===0){this.last=request;this.publish({lastMessage:{...request.message}});}
        }catch{finish('error','Speech could not start. Please try again or use the displayed message.');}
      };
      next(0);
    });
  };
  clearMemory=()=>{this.cancel();this.last=null;this.publish({lastMessage:null});};
  repeat=(owner='default',localOnly=false):Promise<SpeechResult>=>this.last?this.speak(this.last.message,this.last.mode,{...this.last.options,localOnly:localOnly || this.last.options.localOnly},owner):Promise.resolve('error');
}
let shared:SpeechController|undefined;
export function setSpeechControllerForTesting(controller?: SpeechController) {
  shared = controller;
}
export function getSpeechController():SpeechController {
  if(!shared){
    const supported=typeof window!=='undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance!=='undefined';
    const synth=supported?window.speechSynthesis:null;
    const onlinePlayer = typeof window!=='undefined' ? new OnlineAudioPlayer() : null;
    shared=new SpeechController(synth?{
      getVoices:()=>synth.getVoices(),create:text=>new SpeechSynthesisUtterance(text),speak:utterance=>synth.speak(utterance),cancel:()=>synth.cancel(),
      listenVoices:listener=>{synth.addEventListener('voiceschanged',listener);return()=>synth.removeEventListener('voiceschanged',listener);},
    }:null, onlinePlayer);
  }
  return shared;
}
