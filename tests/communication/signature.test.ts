import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { resolveIntent, validCustomPhrases } from '../../src/features/communication/intentResolver';
import { resolveVoiceInput } from '../../src/features/communication/voiceInput';
import { clarificationFor } from '../../src/features/signature/clarification';
import { contexts, emptyPersonalization, validateSignature } from '../../src/features/signature/types';
import { orderPhrases, quickIds } from '../../src/features/signature/context';
import { reviewedVariants, validEquivalentPairs } from '../../src/features/signature/language';
import { useCommunicationStore as store } from '../../src/store/communicationStore';
import { initialPhrases } from '../../src/data/phrases';
import { defaultStoredState, validateStoredState } from '../../src/lib/storage';
import { onlineSuggestions } from '../../src/features/suggestions/onlineSuggestions';
import { createSuggestionHandler } from '../../server/suggestions';
import { PartnerMode } from '../../src/components/aac/PartnerMode';
import { QuickCommunication, SmartClarification } from '../../src/components/aac/SignatureControls';
const water=()=>resolveIntent({symbolIds:['food-water']});
const base=initialPhrases.find(p=>p.id==='food-water')!;
const studio=()=>({...base,id:'studio-water',isCustom:true,studio:{symbolIds:['food-water'],alternatives:water().candidates.map(({english,urdu})=>({english,urdu})),contexts:['Meal' as const],aliases:['mera mashroob']}});
beforeEach(()=>store.getState().initFromStoredState(defaultStoredState));
for(const ids of [['health-hot','health-cold'],['basic-yes','basic-no'],['food-water','health-pain'],['basic-more','basic-less','food-water'],['actions-go'],['actions-call']])test('clarification choices are complete, explicit and resolvable: '+ids,()=>{
 const input=resolveIntent({symbolIds:ids}),plan=clarificationFor(input)!;assert.ok(plan?.question.urdu);
 const choices=plan.choices.filter(c=>c.ids);assert.ok(choices.length>=2);
 for(const c of choices)assert.equal(resolveIntent({symbolIds:c.ids!}).status,'clear');
 assert.equal(store.getState().generatedMessage,null);
 store.getState().confirmMeaning(choices[0].ids!);assert.equal(store.getState().resolution.status,'clear');assert.equal(store.getState().generatedMessage,null);
});
for(const text of ['go','I want to go','jana hai','مجھے جانا ہے','hot and cold','گرمی اور سردی'])test('typed/speech clarification: '+text,()=>{
 const r=resolveVoiceInput(text),plan=clarificationFor(r)!;assert.ok(plan.choices.some(c=>c.ids));assert.equal(r.input.text,text);
});
test('unknown text stays intact and offers correction rather than invented meaning',()=>{
 const r=resolveVoiceInput('I need a flight to an unknown city');const p=clarificationFor(r)!;assert.ok(p.choices.every(c=>!c.ids));assert.equal(r.input.text,'I need a flight to an unknown city');
});
for(const context of contexts)test('context keeps all vocabulary and essential emergency access: '+context,()=>{
 const ordered=orderPhrases(initialPhrases,context,emptyPersonalization(),true);
 assert.equal(ordered.length,initialPhrases.length);assert.deepEqual(new Set(ordered.map(p=>p.id)),new Set(initialPhrases.map(p=>p.id)));
 for(const id of quickIds)assert.ok(ordered.some(p=>p.id===id));assert.equal(water().candidates[0].english,'I need water.');
});
test('caregiver alternatives, contexts and exact Roman Urdu aliases survive validated reload',()=>{
 const p=studio();assert.equal(validCustomPhrases([p]).length,1);
 store.getState().saveStudioPhrase(p);store.getState().initFromStoredState(store.getState().getFullStoredState());
 const saved=store.getState().customPhrases[0];assert.deepEqual(saved.studio,p.studio);
 const r=resolveVoiceInput('mera mashroob',[saved]);assert.equal(r.status,'clear');assert.deepEqual(r.canonicalIds,['food-water']);assert.equal(r.candidates.length,3);
 assert.equal(resolveVoiceInput('mera mashroob extra meaning',[saved]).status,'unsupported');
});
test('caregiver multi-symbol semantic combination and alternatives preserve explicit roles',()=>{
 const ids=['actions-play','basic-with','family-mother','basic-at','places-school'],r=resolveIntent({symbolIds:ids}),p={...studio(),sentenceEnglish:r.candidates[0].english,sentenceUrdu:r.candidates[0].urdu,studio:{...studio().studio,symbolIds:ids,alternatives:r.candidates.map(({english,urdu})=>({english,urdu}))}};
 assert.equal(validCustomPhrases([p]).length,1);const resolved=resolveIntent({symbolIds:[p.id]},[p]);assert.deepEqual(resolved.intent,r.intent);
});
for(const change of ['negation','duplicate','missing','advice','facts','aliases'] as const)test('studio rejects invalid or changed meaning: '+change,()=>{
 const p=studio();
 if(change==='negation')p.studio.alternatives[0].english='I do not want water.';
 if(change==='duplicate')p.studio.alternatives[1]={...p.studio.alternatives[0]};
 if(change==='missing')p.studio.alternatives[0].urdu='';
 if(change==='advice')p.studio.alternatives[0].english='Take medicine now.';
 if(change==='facts')p.studio.alternatives[0].english='My mother needs water.';
 if(change==='aliases')p.studio.aliases=['mujhe pani nahi chahiye'];
 assert.equal(validCustomPhrases([p]).length,0);
});
test('personalization learns only explicit choices, stays local, is bounded and resets',()=>{
 const s=store.getState();s.confirmMeaning(['food-water']);assert.deepEqual(store.getState().signature.profiles,{});
 s.selectCandidate(store.getState().resolution.candidates[0].id);
 const id=store.getState().activeProfile!.id;assert.equal(store.getState().signature.profiles[id].counts['food-water'],1);
 assert.equal(store.getState().signature.profiles[id].recent[0],'food-water');
 const persisted=validateStoredState(store.getState().getFullStoredState());assert.ok(persisted.signature);assert.equal('communicationText' in persisted,false);
 store.getState().resetPersonalization();assert.deepEqual(store.getState().signature.profiles[id].counts,{});assert.deepEqual(store.getState().signature.profiles[id].recent,[]);
 store.getState().setPersonalizationEnabled(false);store.getState().confirmMeaning(['food-water']);store.getState().selectCandidate(store.getState().resolution.candidates[0].id);assert.deepEqual(store.getState().signature.profiles[id].counts,{});
});
test('personalization rejects malicious keys and never changes selected meaning on context change',()=>{
 const v=validateSignature(JSON.parse('{"profiles":{"__proto__":{"counts":{"constructor":99}}}}'));assert.deepEqual(v.profiles,{});
 store.getState().confirmMeaning(['basic-no','food-water']);store.getState().selectCandidate(store.getState().resolution.candidates[0].id);const before=store.getState().generatedMessage;
 store.getState().setContext('Medical');assert.equal(store.getState().generatedMessage,before);assert.equal(store.getState().resolution.intent?.negated,true);
});
test('polite styles and Social context change wording without adding urgency or facts',()=>{
 store.getState().setContext('Social');store.getState().confirmMeaning(['food-water']);assert.match(store.getState().resolution.candidates[0].english,/^Please/);
 store.getState().setSentenceStyle('urgent');store.getState().confirmMeaning(['food-water']);assert.ok(store.getState().resolution.candidates.every(c=>!c.english.includes('now')));
});
test('Partner and quick communication expose accessible explicit controls without speech-on-render',()=>{
 const message={englishText:'I need water.',urduText:'مجھے پانی چاہیے۔'},html=render(h(PartnerMode,{message}));
 for(const label of ['Partner Mode','<dialog','Speak Again','Stop','Repeat','Yes','No','Back','lang="ur" dir="rtl"'])if(label!=='Stop')assert.ok(html.includes(label));
 assert.doesNotMatch(html,/<dialog[^>]* open/);
 const quick=render(h(MemoryRouter,null,h(QuickCommunication)));for(const label of ['Quick Help','Quick Yes','Quick No','Quick Stop','Quick Bathroom','Quick Water','Quick Pain','Emergency'])assert.ok(quick.includes(label));
 store.getState().confirmMeaning(['health-hot','health-cold']);store.getState().setCommunicationText('hot and cold');assert.match(render(h(SmartClarification,{resolution:resolveVoiceInput('hot and cold')})),/Which complete message/);
});
const origin='https://aac.example',request=(body:unknown,headers:Record<string,string>={})=>new Request(origin+'/api/suggestions',{method:'POST',headers:{origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const payload={symbolIds:['food-water'],context:'Meal',style:'polite'};
const model=(pairs:unknown)=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({candidates:pairs})}]}}]}));
const allowed=()=>reviewedVariants(water().candidates);
test('Gemini server sends only canonical intent, context and reviewed pairs; key is header-only',async()=>{
 let sent='';const handler=createSuggestionHandler({origin,apiKey:'server-test-key',model:'gemini-test',fetch:async(url,options)=>{assert.ok(!String(url).includes('server-test-key'));assert.equal(new Headers(options?.headers).get('x-goog-api-key'),'server-test-key');sent=String(options?.body);return model([allowed().at(-1)!]);}});
 const response=await handler(request(payload));assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);assert.doesNotMatch(sent,/profile-child|history|audio|transcript|camera/);assert.equal((await response.json()).candidates.length,1);
});
for(const bad of [
 [{english:'I do not want water.',urdu:'مجھے پانی نہیں چاہیے۔'}],
 [{english:'Take two pills.',urdu:'دو گولیاں لیں۔'}],
 [{english:'My mother needs water.',urdu:'مجھے پانی چاہیے۔'}],
 [{english:'I need water.',urdu:''}],
 [{english:'I need water.',urdu:'مجھے پانی چاہیے۔',extra:'unsafe'}],
 [allowed()[0],allowed()[0]],
 {english:'I need water.',urdu:'مجھے پانی چاہیے۔'},
])test('Gemini rejects malformed, duplicate, unrelated and meaning-changing output: '+JSON.stringify(bad),async()=>{
 const handler=createSuggestionHandler({origin,apiKey:'test',model:'gemini-test',fetch:async()=>model(bad)});
 const response=await handler(request(payload));assert.equal(response.status,502);assert.deepEqual(await response.json(),{candidates:[]});
});
test('Gemini never licenses urgency or positive wording for a negative intent',()=>{
 const r=resolveIntent({symbolIds:['basic-not','food-water']});assert.deepEqual(validEquivalentPairs([allowed()[0]],reviewedVariants(r.candidates,true)),[]);
 assert.deepEqual(validEquivalentPairs([{english:'I need water now.',urdu:'مجھے ابھی پانی چاہیے۔'}],allowed()),[]);
});
test('server rejects extra/private input, oversized payloads, wrong origin and method',async()=>{
 const handler=createSuggestionHandler({origin});
 assert.equal((await handler(request({...payload,history:['private']}))).status,400);
 assert.equal((await handler(request({...payload,symbolIds:['x'.repeat(5000)]}))).status,413);
 assert.equal((await handler(request(payload,{origin:'https://evil.example'}))).status,403);
 assert.equal((await handler(new Request(origin))).status,405);
 assert.equal((await handler(request({...payload,symbolIds:['health-hot','health-cold']}))).status,422);
});
test('missing key, network, quota and timeout retain empty online output and local choices',async()=>{
 for(const transport of [undefined,async()=>new Response('',{status:429}),async()=>{throw new Error('network');}]){
  const handler=createSuggestionHandler({origin,...(transport?{apiKey:'test',model:'gemini-test',fetch:transport}:{})});
  assert.equal((await handler(request(payload))).status,503);assert.equal(water().candidates.length,3);
 }
 const handler=createSuggestionHandler({origin,apiKey:'test',model:'gemini-test',timeout:5,fetch:async(_url,options)=>new Promise((_resolve,reject)=>options?.signal?.addEventListener('abort',()=>reject(new Error('aborted'))))});
 assert.equal((await handler(request(payload))).status,503);
});
test('endpoint rate budget bounds requests without storing communication content',async()=>{
 const handler=createSuggestionHandler({origin,now:()=>1000});for(let i=0;i<10;i++)await handler(request(payload),'one-client');assert.equal((await handler(request(payload),'one-client')).status,429);
});
test('client falls back for failures, validates output and sends no raw input',async()=>{
 const r=resolveVoiceInput('mujhe pani chahiye'),signal=new AbortController().signal;
 const received=await onlineSuggestions(r,'Meal','polite',signal,async(_url,options)=>{assert.deepEqual(JSON.parse(String(options?.body)),payload);assert.equal(options?.credentials,'omit');return new Response(JSON.stringify({candidates:[allowed().at(-1)!]}));});
 assert.equal(received.length,1);
 for(const response of [new Response('',{status:503}),new Response('malformed'),new Response(JSON.stringify({candidates:[{english:'wrong',urdu:'غلط'}]}))])assert.deepEqual(await onlineSuggestions(r,'Meal','direct',signal,async()=>response),[]);
});
test('stale AI and selected-message responses cannot update the store or speak',()=>{
 store.getState().confirmMeaning(['food-water']);const old=store.getState().resolution;
 store.getState().confirmMeaning(['health-pain']);store.getState().applyEnhanced(old,[allowed().at(-1)!]);assert.equal(store.getState().resolution.candidates[0].english,'I am in pain.');
 store.getState().confirmMeaning(['food-water']);const current=store.getState().resolution;store.getState().selectCandidate(current.candidates[0].id);const selected=store.getState().generatedMessage;store.getState().applyEnhanced(current,[allowed().at(-1)!]);assert.equal(store.getState().generatedMessage,selected);
 store.getState().clearSelection();store.getState().confirmMeaning(['food-water']);const fresh=store.getState().resolution;store.getState().applyEnhanced(fresh,[allowed().at(-1)!]);assert.equal(store.getState().resolution.candidates[0].source,'gemini');assert.equal(store.getState().generatedMessage,null);assert.equal(store.getState().selectedCandidateId,null);
 const disk=JSON.stringify(store.getState().getFullStoredState());assert.ok(!disk.includes('gemini'));assert.ok(!disk.includes('Please, I need water.'));
});
test('already aborted AI sessions never start a network request',async()=>{
 const controller=new AbortController();controller.abort();assert.deepEqual(await onlineSuggestions(water(),'Home','direct',controller.signal,async()=>{throw new Error('must not call');}),[]);
});

test('known sentence and caregiver alias conflicts never guess or expose candidates',()=>{const p=studio();p.studio.aliases=['I am in pain.'];const r=resolveVoiceInput('I am in pain.',[p]);assert.equal(r.status,'clarification');assert.deepEqual(r.candidates,[]);assert.equal(r.intent,null);});

test('SOS intent never invokes Gemini on client or server',async()=>{const r=resolveIntent({symbolIds:['emergency-help']});assert.deepEqual(await onlineSuggestions(r,'Emergency','urgent',new AbortController().signal,async()=>{assert.fail('SOS must remain local');}),[]);const handler=createSuggestionHandler({origin,apiKey:'test',model:'gemini-test',fetch:async()=>{assert.fail('SOS must remain local');}});assert.equal((await handler(request({...payload,symbolIds:['emergency-help']}))).status,422);});
