import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useCommunicationStore as store } from '../../src/store/communicationStore';
import { initialPhrases } from '../../src/data/phrases';
import { defaultStoredState, saveStoredState, readStoredState, type StoragePort } from '../../src/lib/storage';
import { RecognitionController, type RecognitionPort } from '../../src/features/communication/recognitionController';
import { SpeechController, type SpeechPort } from '../../src/features/communication/speechController';
import { bindSpeechToInput } from '../../src/features/communication/speechBinding';
import { speakEmergency } from '../../src/features/communication/emergencySpeech';
const phrase=(id:string)=>initialPhrases.find(p=>p.id===id)!;
const choice=()=>{store.getState().selectCandidate(store.getState().resolution.candidates[0].id);return store.getState().generatedMessage!;};
class Speech implements SpeechPort{
 spoken:SpeechSynthesisUtterance[]=[];
 getVoices=()=>['en-US','ur-PK'].map(lang=>({lang,localService:true,name:lang,voiceURI:lang,default:false} as SpeechSynthesisVoice));
 create=(text:string)=>({text} as SpeechSynthesisUtterance);
 speak=(u:SpeechSynthesisUtterance)=>{this.spoken.push(u);};
 cancel=()=>{};
 listenVoices=()=>()=>{};
 end=()=>{const u=this.spoken.at(-1)!;u.onend?.call(u,{} as SpeechSynthesisEvent);};
}
beforeEach(()=>store.getState().initFromStoredState(defaultStoredState));
for(const [locale,text] of [['en-US','I do not want water.'],['ur-PK','مجھے پانی نہیں چاہیے۔'],['ur-PK','mujhe pani nahi chahiye']] as const)test('recognition → semantic refusal → selection → bilingual speech: '+text,async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network unavailable');});
 let port!:RecognitionPort;
 const recognizer=new RecognitionController(()=>port={lang:'',interimResults:false,continuous:false,maxAlternatives:0,start:()=>{},stop:()=>{},abort:()=>{},onstart:null,onresult:null,onend:null,onerror:null},text=>store.getState().setCommunicationText(text));
 const speech=new Speech(),controller=new SpeechController(speech);
 assert.equal(recognizer.start(locale),true);assert.equal(port.lang,locale);port.onstart!();
 port.onresult!({resultIndex:0,results:[{isFinal:false,length:1,0:{transcript:text}}]});
 assert.equal(recognizer.getSnapshot().interim,text);assert.equal(store.getState().resolution.status,'empty');
 port.onresult!({resultIndex:0,results:[{isFinal:true,length:1,0:{transcript:text}}]});port.onend!();
 assert.equal(recognizer.getSnapshot().final,text);assert.equal(store.getState().resolution.intent?.negated,true);
 assert.equal(store.getState().generatedMessage,null);assert.equal(speech.spoken.length,0);
 const selected=choice();assert.equal(selected.englishText,'I do not want water.');
 const pending=controller.speak(selected);assert.equal(speech.spoken[0].text,selected.englishText);
 speech.end();assert.equal(speech.spoken[1].text,selected.urduText);speech.end();assert.equal(await pending,'completed');
 const repeat=controller.repeat();assert.equal(speech.spoken[2].text,selected.englishText);controller.cancel();assert.equal(await repeat,'cancelled');
 assert.deepEqual(store.getState().phraseHistory,[]);
});
test('symbols, ambiguity, selection invalidation, Stop and SOS remain local under network failure',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network unavailable');});
 const speech=new Speech(),controller=new SpeechController(speech),disconnect=bindSpeechToInput(store.subscribe,controller);
 store.getState().selectSymbol(phrase('food-water'));const first=controller.speak(choice());const late=speech.spoken[0].onend;
 store.getState().selectSymbol(phrase('health-pain'));assert.equal(await first,'cancelled');assert.equal(store.getState().resolution.status,'clarification');assert.equal(store.getState().generatedMessage,null);
 late?.call(speech.spoken[0],{} as SpeechSynthesisEvent);assert.equal(speech.spoken.length,1);
 const sos=speakEmergency('emergency-help','auto',controller.speak);assert.match(speech.spoken.at(-1)!.text,/help now/i);controller.cancel();assert.equal(await sos,'cancelled');disconnect();
});
test('custom creation, board resolution, reload and deletion preserve unrelated corrected speech',()=>{
 const custom={...phrase('food-water'),id:'custom-final-water',labelEnglish:'My drink',labelUrdu:'میرا مشروب',isCustom:true};
 store.getState().addCustomPhrase(custom);store.getState().selectSymbol(store.getState().customPhrases[0]);assert.equal(choice().englishText,'I need water.');
 const values=new Map<string,string>(),disk:StoragePort={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}};
 assert.equal(saveStoredState(store.getState().getFullStoredState(),disk),true);
 store.getState().initFromStoredState(readStoredState(disk).state);assert.equal(store.getState().customPhrases[0].labelEnglish,'My drink');assert.equal(store.getState().generatedMessage,null);
 store.getState().setCommunicationText('I am not in pain.');store.getState().deleteCustomPhrase(custom.id);
 assert.equal(store.getState().communicationText,'I am not in pain.');assert.equal(store.getState().resolution.intent?.negated,true);assert.equal(store.getState().customPhrases.length,0);
});
test('duplicate or invalid additions cannot erase an existing custom phrase or chosen sentence',()=>{
 const custom={...phrase('food-water'),id:'custom-duplicate',isCustom:true};
 store.getState().addCustomPhrase(custom);store.getState().selectSymbol(custom);choice();const before=store.getState();
 store.getState().addCustomPhrase({...custom,sentenceUrdu:'wrong'});
 assert.deepEqual(store.getState().customPhrases,before.customPhrases);assert.equal(store.getState().generatedMessage,before.generatedMessage);
});
test('clearing private speech memory settles pending speech and makes Repeat unavailable',async()=>{
 const speech=new Speech(),controller=new SpeechController(speech);store.getState().selectSymbol(phrase('food-water'));const pending=controller.speak(choice());const late=speech.spoken[0].onend;
 controller.clearMemory();assert.equal(await pending,'cancelled');assert.equal(controller.getSnapshot().lastMessage,null);assert.equal(await controller.repeat(),'error');late?.call(speech.spoken[0],{} as SpeechSynthesisEvent);assert.equal(speech.spoken.length,1);
});
