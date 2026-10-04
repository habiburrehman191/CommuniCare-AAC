import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SpeechController } from '../../src/features/communication/speechController';
import type { SpeechPort } from '../../src/features/communication/speechController';
import { bindSpeechToInput } from '../../src/features/communication/speechBinding';
import { emergencyMessage, speakEmergency } from '../../src/features/communication/emergencySpeech';
import { useCommunicationStore as store } from '../../src/store/communicationStore';
import { initialPhrases } from '../../src/data/phrases';
const voice=(lang:string,localService=true,name=lang)=>({lang,localService,name,voiceURI:name,default:false} as SpeechSynthesisVoice);
class Port implements SpeechPort {
  voices=[voice('en-US'),voice('ur-PK')];spoken:SpeechSynthesisUtterance[]=[];cancels=0;throwSpeak=false;listeners=new Set<()=>void>();
  getVoices=()=>this.voices;
  create=(text:string)=>({text,lang:'',onend:null,onerror:null,onstart:null} as SpeechSynthesisUtterance);
  speak=(u:SpeechSynthesisUtterance)=>{if(this.throwSpeak)throw new Error('failure');this.spoken.push(u);};
  cancel=()=>{this.cancels++;};
  listenVoices=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  end(index=this.spoken.length-1){this.spoken[index].onend?.(new Event('end') as SpeechSynthesisEvent);}
  error(index=this.spoken.length-1){this.spoken[index].onerror?.(new Event('error') as SpeechSynthesisErrorEvent);}
}
const message={englishText:'I need water.',urduText:'مجھے پانی چاہیے۔'};
const second={englishText:'I am in pain.',urduText:'مجھے درد ہے۔'};
test('English then Urdu forms one awaiting session; no auto-speech at creation',async()=>{
  const p=new Port(),c=new SpeechController(p);assert.equal(p.spoken.length,0);
  let done=false;const pending=c.speak(message,'auto').then(r=>{done=true;return r;});assert.equal(p.spoken.length,1);assert.equal(p.spoken[0].lang,'en-US');assert.equal(c.getSnapshot().isSpeaking,true);await Promise.resolve();assert.equal(done,false);
  p.end();assert.equal(p.spoken.length,2);assert.equal(p.spoken[1].lang,'ur-PK');assert.equal(c.getSnapshot().isSpeaking,true);p.end();assert.equal(await pending,'completed');assert.equal(c.getSnapshot().isSpeaking,false);
});
for(const mode of ['en','ur'] as const)test('single speech language '+mode,async()=>{
  const p=new Port(),c=new SpeechController(p);const pending=c.speak(message,mode);assert.equal(p.spoken.length,1);assert.equal(p.spoken[0].lang,mode==='en'?'en-US':'ur-PK');p.end();assert.equal(await pending,'completed');assert.equal(p.spoken.length,1);
});
test('Stop during English invalidates every saved end/error callback',async()=>{
  const p=new Port(),c=new SpeechController(p);const pending=c.speak(message);const end=p.spoken[0].onend,error=p.spoken[0].onerror;c.cancel();
  end?.call(p.spoken[0],new Event('end') as SpeechSynthesisEvent);error?.call(p.spoken[0],new Event('error') as SpeechSynthesisErrorEvent);assert.equal(await pending,'cancelled');assert.equal(p.spoken.length,1);assert.equal(c.getSnapshot().isSpeaking,false);
});
test('Stop during Urdu cancels the full session without restarting either language',async()=>{
  const p=new Port(),c=new SpeechController(p);const pending=c.speak(message);p.end();const end=p.spoken[1].onend;c.cancel();end?.call(p.spoken[0],new Event('end') as SpeechSynthesisEvent);assert.equal(await pending,'cancelled');assert.equal(p.spoken.length,2);
});
test('new speech replaces old speech; duplicate end events cannot skip a language',async()=>{
  const p=new Port(),c=new SpeechController(p);const old=c.speak(message);const end=p.spoken[0].onend;const current=c.speak(second);end?.call(p.spoken[0],new Event('end') as SpeechSynthesisEvent);assert.equal(p.spoken.length,2);assert.equal(await old,'cancelled');
  const next=p.spoken[1].onend;next?.call(p.spoken[0],new Event('end') as SpeechSynthesisEvent);next?.call(p.spoken[0],new Event('end') as SpeechSynthesisEvent);assert.equal(p.spoken.length,3);p.end();assert.equal(await current,'completed');
});
test('route unmount cancels its own speech, not a newer owner',async()=>{
  const p=new Port(),c=new SpeechController(p);const old=c.speak(message,'auto',{},'board');c.cancelOwner('board');assert.equal(await old,'cancelled');
  const next=c.speak(second,'auto',{},'emergency');c.cancelOwner('board');assert.equal(c.getSnapshot().isSpeaking,true);c.cancelOwner('emergency');assert.equal(await next,'cancelled');
});
test('Repeat retains the exact last explicitly spoken pair and original language choice',async()=>{
  const p=new Port(),c=new SpeechController(p);assert.equal(await c.repeat(),'error');const first=c.speak(message,'ur');p.end();await first;
  message.englishText='I need water.';const repeat=c.repeat();assert.equal(p.spoken[1].text,'مجھے پانی چاہیے۔');assert.equal(p.spoken[1].lang,'ur-PK');p.end();assert.equal(await repeat,'completed');
  const test=c.speak(second,'en',{remember:false});p.end();await test;assert.deepEqual(c.getSnapshot().lastMessage,message);
});
test('Repeat works after cancellation and ignores unrelated newly selected text',async()=>{
  const p=new Port(),c=new SpeechController(p);const first=c.speak(message);c.cancel();await first;const repeat=c.repeat();assert.equal(p.spoken[1].text,message.englishText);p.end();p.end();assert.equal(await repeat,'completed');
});
test('missing Urdu never falls back to Hindi, Arabic, English or a misleading name',async()=>{
  const p=new Port();p.voices=[voice('en-US'),voice('hi-IN'),voice('ar-SA'),voice('en-GB',true,'Urdu')];const c=new SpeechController(p);
  assert.equal(await c.speak(message,'auto'),'missing-voice');assert.equal(p.spoken.length,0);assert.match(c.getSnapshot().error!,/Urdu/);assert.equal(await c.speak(message,'ur'),'missing-voice');
  const explicit=c.speak(message,'en');p.end();assert.equal(await explicit,'completed');assert.equal(p.spoken[0].lang,'en-US');
});
test('missing English and unsupported synthesis are surfaced honestly',async()=>{
  const p=new Port();p.voices=[voice('ur-PK')];const c=new SpeechController(p);assert.equal(await c.speak(message,'en'),'missing-voice');assert.match(c.getSnapshot().error!,/English/);
  const absent=new SpeechController(null);assert.equal(await absent.speak(message),'unsupported');assert.equal(absent.getSnapshot().supported,false);
});
test('voice list changes have one listener and allow explicit retry',async()=>{
  const p=new Port();p.voices=[];const c=new SpeechController(p);const unsub1=c.subscribe(()=>{}),unsub2=c.subscribe(()=>{});assert.equal(p.listeners.size,1);assert.equal(await c.speak(message),'missing-voice');
  p.voices=[voice('en_US'),voice('ur_PK')];p.listeners.forEach(fn=>fn());assert.equal(c.getSnapshot().voices.length,2);const request=c.speak(message);p.end();p.end();assert.equal(await request,'completed');unsub1();assert.equal(p.listeners.size,1);unsub2();assert.equal(p.listeners.size,0);
});
test('thrown speech and utterance errors settle and prevent the next language',async()=>{
  const p=new Port(),c=new SpeechController(p);p.throwSpeak=true;assert.equal(await c.speak(message),'error');assert.equal(c.getSnapshot().isSpeaking,false);p.throwSpeak=false;
  const request=c.speak(message);p.error();assert.equal(await request,'error');assert.equal(p.spoken.length,1);assert.equal(c.getSnapshot().isSpeaking,false);
});
test('watchdog cannot resurrect a cancelled session',async ctx=>{
  ctx.mock.timers.enable({apis:['setTimeout']});const p=new Port(),c=new SpeechController(p);const request=c.speak(message);c.cancel();ctx.mock.timers.tick(120001);assert.equal(await request,'cancelled');assert.equal(p.spoken.length,1);
  const hung=c.speak(message);ctx.mock.timers.tick(120001);assert.equal(await hung,'error');assert.equal(c.getSnapshot().isSpeaking,false);
});
test('Clear and input changes synchronously cancel active speech and keep Repeat',async()=>{
  store.getState().clearSelection();const p=new Port(),c=new SpeechController(p);const disconnect=bindSpeechToInput(store.subscribe,c);
  const phrase=initialPhrases.find(p=>p.id==='food-water')!;store.getState().selectSymbol(phrase);store.getState().selectCandidate(store.getState().resolution.candidates[0].id);
  const request=c.speak(store.getState().generatedMessage!);const late=p.spoken[0].onend;store.getState().clearSelection();late?.call(p.spoken[0],new Event('end') as SpeechSynthesisEvent);assert.equal(await request,'cancelled');assert.equal(p.spoken.length,1);assert.deepEqual(c.getSnapshot().lastMessage,message);
  const repeat=c.repeat();store.getState().setCommunicationText('I am not in pain.');assert.equal(await repeat,'cancelled');disconnect();store.getState().clearSelection();
});
test('SOS messages are predefined and never depend on AI or a network call',async()=>{
  const p=new Port(),c=new SpeechController(p);assert.equal(emergencyMessage('food-water'),null);assert.equal(await speakEmergency('unknown','auto',c.speak),'error');assert.equal(p.spoken.length,0);
  for(const id of ['emergency-help','emergency-breathe','emergency-family']){assert.ok(emergencyMessage(id)?.urduText);const request=speakEmergency(id,'auto',c.speak);assert.equal(p.spoken.at(-1)?.voice?.localService,true);p.end();p.end();assert.equal(await request,'completed');}
});
test('SOS refuses remote-only voices even online; explicit local English remains usable',async()=>{
  const p=new Port();p.voices=[voice('en-US'),voice('ur-PK',false)];const c=new SpeechController(p);
  assert.equal(await speakEmergency('emergency-help','auto',c.speak),'missing-voice');assert.equal(p.spoken.length,0);assert.match(c.getSnapshot().error!,/offline Urdu/);
  const request=speakEmergency('emergency-help','en',c.speak);p.end();assert.equal(await request,'completed');
});
test('Emergency Stop does not issue a new request; rapid replacement keeps the chosen message',async()=>{
  const p=new Port(),c=new SpeechController(p);const help=speakEmergency('emergency-help','auto',c.speak);const stale=p.spoken[0].onend;
  const breathing=speakEmergency('emergency-breathe','auto',c.speak);stale?.call(p.spoken[0],new Event('end') as SpeechSynthesisEvent);assert.equal(await help,'cancelled');assert.equal(p.spoken[1].text,emergencyMessage('emergency-breathe')?.englishText);
  c.cancel();assert.equal(await breathing,'cancelled');assert.equal(p.spoken.length,2);
});
test('Emergency Repeat cannot use a remote voice inherited from normal playback',async()=>{
  const p=new Port();p.voices=[voice('ur-PK',false)];const c=new SpeechController(p);const first=c.speak(message,'ur');p.end();await first;assert.equal(await c.repeat('emergency',true),'missing-voice');assert.equal(p.spoken.length,1);
});
test('active UI delegates sequencing, exposes transcript controls, and retires legacy parser',()=>{
  const board=readFileSync('src/sections/CommunicationBoardSection.tsx','utf8'), emergency=readFileSync('src/sections/EmergencySection.tsx','utf8'),panel=readFileSync('src/components/aac/VoiceCommandPanel.tsx','utf8');
  for(const file of [board,emergency]){assert.doesNotMatch(file,/setTimeout|onEnd:/);assert.match(file,/Repeat Last Message/);}
  assert.match(emergency,/if\(isSpeaking\)\{cancel\(\);return;\}/);assert.match(emergency,/onSelect=\{selectSymbol\}/);assert.match(panel,/value="en-US"/);assert.match(panel,/value="ur-PK"/);assert.match(panel,/Live transcript/);assert.match(panel,/Final transcript/);assert.equal(existsSync('src/lib/urduCommands.ts'),false);
});
