import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { useCommunicationStore as store } from '../../src/store/communicationStore';
import { initialPhrases } from '../../src/data/phrases';
import { generateCommunicationMessage } from '../../src/utils/messageGeneration';
import { defaultStoredState } from '../../src/lib/storage';
const phrase=(id:string)=>initialPhrases.find(p=>p.id===id)!;
const choose=()=>{const id=store.getState().resolution.candidates[0].id;store.getState().selectCandidate(id);return id;};
beforeEach(()=>{store.getState().clearSelection();store.setState({customPhrases:[],phraseHistory:[],communicationMode:'sentence'});});
test('input and generation never select a sentence or speak',()=>{
  let speechCalls=0;
  Object.defineProperty(globalThis,'speechSynthesis',{configurable:true,value:{speak:()=>speechCalls++}});
  store.getState().selectSymbol(phrase('food-water'));
  assert.equal(store.getState().resolution.candidates.length,3);
  assert.equal(store.getState().selectedCandidateId,null);assert.equal(store.getState().generatedMessage,null);
  store.getState().generateMessage();assert.equal(store.getState().generatedMessage,null);
  choose();assert.equal(store.getState().generatedMessage?.englishText,'I need water.');
  assert.equal(speechCalls,0);assert.deepEqual(store.getState().phraseHistory,[]);
});
test('only current valid candidate can become output',()=>{
  store.getState().selectSymbol(phrase('food-water'));store.getState().selectCandidate('made-up');assert.equal(store.getState().generatedMessage,null);
  const old=choose();store.getState().selectSymbol(phrase('basic-no'));
  assert.equal(store.getState().generatedMessage,null);assert.equal(store.getState().selectedCandidateId,null);
  store.getState().selectCandidate(old);assert.equal(store.getState().generatedMessage,null);
  choose();assert.equal(store.getState().generatedMessage?.englishText,'I do not want water.');
});
for(const action of ['remove','removeLast','clear','mode','profile','preferences','hydrate','generate','toggle'] as const) test('selection invalidation: '+action,()=>{
  store.getState().selectSymbol(phrase('food-water'));choose();
  const s=store.getState();
  if(action==='remove')s.removeSymbol('food-water');
  if(action==='removeLast')s.removeLastSymbol();
  if(action==='clear')s.clearSelection();
  if(action==='mode')s.setCommunicationMode('word');
  if(action==='profile')s.setActiveProfile({...s.profiles[0],communicationPreference:'word'});
  if(action==='preferences')s.updatePreferences({messageMode:'word'});
  if(action==='hydrate')s.initFromStoredState({...defaultStoredState,profiles:s.profiles});
  if(action==='generate')s.generateMessage();
  if(action==='toggle')s.selectSymbol(phrase('food-water'));
  assert.equal(store.getState().generatedMessage,null);assert.equal(store.getState().selectedCandidateId,null);
});
test('legacy word mode cannot bypass the engine',()=>{
  const s=store.getState();s.setCommunicationMode('word');s.selectSymbol(phrase('food-water'));s.selectSymbol(phrase('health-pain'));
  assert.equal(store.getState().resolution.status,'clarification');assert.equal(store.getState().generatedMessage,null);
  assert.equal(generateCommunicationMessage(store.getState().selectedSymbols,'word'),null);
  s.clearSelection();s.selectSymbol(phrase('food-water'));choose();assert.equal(store.getState().generatedMessage?.englishText,'I need water.');
  assert.equal(store.getState().generatedMessage?.mode,'word');
});
test('custom add/delete and hydration cannot retain stale output',()=>{
  const custom={...phrase('food-water'),id:'custom-water',isCustom:true};
  store.getState().addCustomPhrase(custom);assert.equal(store.getState().customPhrases.length,1);
  store.getState().selectSymbol(custom);choose();assert.ok(store.getState().generatedMessage);
  store.getState().deleteCustomPhrase(custom.id);assert.equal(store.getState().generatedMessage,null);assert.equal(store.getState().selectedSymbols.length,0);
  store.getState().addCustomPhrase({...custom,sentenceUrdu:'wrong'});assert.equal(store.getState().customPhrases.length,0);
  store.getState().initFromStoredState({...defaultStoredState,customPhrases:[custom]});store.getState().selectSymbol(custom);choose();
  store.getState().initFromStoredState({...defaultStoredState,customPhrases:[{...custom,sentenceUrdu:'wrong'}]});
  assert.equal(store.getState().generatedMessage,null);assert.equal(store.getState().resolution.status,'empty'); // Hydration now clears stale input at the persistence boundary.
});
test('runtime candidates and selection are not persisted',()=>{
  store.getState().selectSymbol(phrase('food-water'));choose();
  const persisted=store.getState().getFullStoredState();
  for(const key of ['resolution','selectedCandidateId','generatedMessage','selectedSymbols'])assert.ok(!(key in persisted));
});
test('active board exposes explicit selection, custom catalog, and speech guard',()=>{
  const board=readFileSync('src/sections/CommunicationBoardSection.tsx','utf8');
  assert.match(board, /onSelect=\{selectCandidate\}/);
  const suggestions=readFileSync('src/components/aac/SentenceSuggestions.tsx','utf8');
  assert.match(suggestions, /onClick=\{\(\)=>onSelect\(candidate.id\)\}/);
  assert.match(board,/disabled=\{!generatedMessage \|\| !isSupported\}/);
  assert.match(board,/validCustomPhrases\(customPhrases\)/);
  assert.doesNotMatch(board,/<ModeToggle/);
  const emergency=readFileSync('src/sections/EmergencySection.tsx','utf8');
  assert.match(emergency,/onSelect=\{selectSymbol\}/);
  assert.doesNotMatch(emergency,/onSelect=\{\(\) => triggerUrgentSpeak/);
  assert.equal(existsSync('src/lib/messageBuilder.ts'),false);
});
