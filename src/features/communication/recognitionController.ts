export type RecognitionLocale = 'en-US' | 'ur-PK' | 'ur';
export interface RecognitionResult { isFinal: boolean; length: number; [index:number]: {transcript:string; confidence?:number} }
export interface RecognitionEvent { resultIndex:number; results:ArrayLike<RecognitionResult> }
export interface RecognitionPort {
  lang:string; interimResults:boolean; continuous:boolean; maxAlternatives:number;
  start():void; stop():void; abort():void;
  onstart:(()=>void)|null; onend:(()=>void)|null;
  onresult:((event:RecognitionEvent)=>void)|null;
  onerror:((event:{error?:string})=>void)|null;
}
export type RecognitionStatus = 'idle' | 'starting' | 'listening' | 'stopping' | 'error' | 'unsupported';
export interface RecognitionSnapshot {status:RecognitionStatus; interim:string; final:string; error:string|null}
export const recognitionError = (code:string) => ({
  'not-allowed':'Microphone permission was denied. You can type or use symbols.',
  'service-not-allowed':'The browser blocked recognition. You can type or use symbols.',
  'no-speech':'No speech was detected. Please try again or type your message.',
  'audio-capture':'The microphone is unavailable. Check your input device.',
  'network':'The browser recognition service is unavailable. Use typing or symbols.',
  'language-not-supported':'The selected recognition language is unavailable. Choose another mode or type.',
  'aborted':'Listening was interrupted. Start again when ready.',
  'timeout':'The browser did not finish listening. Please try again.',
}[code] ?? 'Speech recognition failed. Please try again or type your message.');

/** One manually started utterance per session. No automatic restart or alternative guessing. */
export class RecognitionController {
  private session=0;
  private current:RecognitionPort|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private state:RecognitionSnapshot={status:'idle',interim:'',final:'',error:null};
  private listeners=new Set<()=>void>();
  private create:()=>RecognitionPort|null;
  private complete:(text:string)=>void;
  private fallbackAttempted=false;
  constructor(create:()=>RecognitionPort|null, complete:(text:string)=>void) {this.create=create;this.complete=complete;}
  setOnComplete=(complete:(text:string)=>void)=>{this.complete=complete;};
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<RecognitionSnapshot>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private clearTimer(){if(this.timer!==null)clearTimeout(this.timer);this.timer=null;}
  private detach(){this.clearTimer();const port=this.current;this.current=null;if(port){port.onstart=null;port.onend=null;port.onresult=null;port.onerror=null;}return port;}
  abort=()=>{this.session++;this.fallbackAttempted=false;const port=this.detach();try{port?.abort();}catch{/* already ended */}this.publish({status:'idle',interim:'',error:null});};
  reset=()=>{this.abort();this.publish({final:''});};
  start=(locale:RecognitionLocale, isFallback=false)=>{
    if(this.current)return false; // Includes the starting/stopping windows.
    if(!isFallback)this.fallbackAttempted=false;
    const token=++this.session;
    let port:RecognitionPort|null;
    try{port=this.create();}catch{this.publish({status:'error',error:recognitionError('start')});return false;}
    if(!port){this.publish({status:'unsupported',error:'Speech recognition is unavailable. Type a message or use symbols.'});return false;}
    this.current=port;
    const active=()=>token===this.session && this.current===port;
    const fail=(code:string)=>{
      if(!active())return;
      if(locale==='ur-PK' && !this.fallbackAttempted && (code==='network'||code==='language-not-supported')){
        this.fallbackAttempted=true;
        this.session++;
        this.detach();
        try{port.abort();}catch{/* fallback cleanup */}
        if(this.start('ur',true))return;
      }
      this.session++;
      this.detach();
      try{port.abort();}catch{/* optional browser cleanup */}
      const isUrdu = locale==='ur-PK'||locale==='ur';
      const isUnavailable = code==='network'||code==='language-not-supported';
      const errorMsg = isUrdu && isUnavailable
        ? 'Urdu voice recognition is unavailable in this browser. Use Urdu typing or switch to Roman Urdu.'
        : recognitionError(code);
      this.publish({status:'error',error:errorMsg});
    };
    port.lang=locale;port.interimResults=true;port.continuous=false;port.maxAlternatives=1;
    this.publish({status:'starting',interim:'',final:'',error:null});
    if(!active())return false;
    this.timer=setTimeout(()=>fail('timeout'),10000);
    port.onstart=()=>{if(!active() || this.state.status!=='starting')return;this.clearTimer();this.publish({status:'listening'});};
    port.onresult=event=>{
      if(!active())return;
      const final:string[]=[], interim:string[]=[];
      // results is a cumulative list; replacing by index avoids duplicated final segments.
      for(let i=0;i<event.results.length;i++){
        const result=event.results[i], text=result?.[0]?.transcript?.trim();
        if(text)(result.isFinal?final:interim).push(text);
      }
      this.publish({final:final.join(' '),interim:interim.join(' ')});
    };
    port.onerror=event=>fail(event.error ?? 'unknown');
    port.onend=()=>{
      if(!active())return;
      const text=this.state.final;
      const interim=this.state.interim;
      const incomplete=!!interim.trim();
      this.session++;this.detach();
      if(incomplete){
        const preserved=text.trim()?text:interim.trim();
        this.publish({status:'idle',final:preserved,interim:interim.trim(),error:'Recognition ended with unconfirmed words. Please review or type the complete message.'});
        return;
      }
      this.publish({status:'idle',interim:''});
      if(text.trim())this.complete(text);
      else this.publish({error:recognitionError('no-speech')});
    };
    try{port.start();return true;}catch{fail('start');return false;}
  };
  stop=()=>{
    if(!this.current || this.state.status==='stopping')return;
    const port=this.current,token=this.session;
    this.clearTimer();this.publish({status:'stopping'});
    // stop allows the current final result to arrive; abort invalidates it immediately.
    this.timer=setTimeout(()=>{if(token!==this.session)return;this.abort();this.publish({status:'error',error:recognitionError('timeout')});},5000);
    try{port.stop();}catch{this.abort();this.publish({status:'error',error:recognitionError('stop')});}
  };
}
export function createBrowserRecognition():RecognitionPort|null {
  if(typeof window==='undefined')return null;
  const win=window as Window & {SpeechRecognition?:new()=>RecognitionPort;webkitSpeechRecognition?:new()=>RecognitionPort};
  const Constructor=win.SpeechRecognition ?? win.webkitSpeechRecognition;
  return Constructor?new Constructor():null;
}
