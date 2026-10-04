import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectedMessagePreview } from '../../src/components/aac/SelectedMessagePreview';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecognitionController, createBrowserRecognition } from '../../src/features/communication/recognitionController';
import type { RecognitionPort, RecognitionEvent } from '../../src/features/communication/recognitionController';
import { matchVoiceCommand } from '../../src/features/communication/voiceCommands';
import { resolveVoiceInput } from '../../src/features/communication/voiceInput';
import { useCommunicationStore as store } from '../../src/store/communicationStore';
class Recognition implements RecognitionPort {
  lang='';interimResults=false;continuous=true;maxAlternatives=5;
  onstart:RecognitionPort['onstart']=null;onend:RecognitionPort['onend']=null;
  onresult:RecognitionPort['onresult']=null;onerror:RecognitionPort['onerror']=null;
  starts=0;stops=0;aborts=0;throwStart=false;
  start(){this.starts++;if(this.throwStart)throw new Error('start');}
  stop(){this.stops++;}abort(){this.aborts++;}
  result(rows:[string,boolean][],resultIndex=0){this.onresult?.({resultIndex,results:rows.map(([transcript,isFinal])=>({0:{transcript},1:{transcript:'wrong alternative'},length:2,isFinal}))});}
}
const setup=()=>{const ports:Recognition[]=[];const commits:string[]=[];const c=new RecognitionController(()=>{const p=new Recognition();ports.push(p);return p;},text=>commits.push(text));return {c,ports,commits};};
for(const locale of ['en-US','ur-PK'] as const)test('recognition mode '+locale,()=>{
  const {c,ports}=setup();assert.equal(c.start(locale),true);assert.equal(ports[0].lang,locale);assert.equal(ports[0].interimResults,true);assert.equal(ports[0].continuous,false);assert.equal(ports[0].maxAlternatives,1);c.abort();
});
test('starting window rejects double start and does not restart automatically',()=>{
  const {c,ports}=setup();c.start('en-US');assert.equal(c.start('en-US'),false);assert.equal(ports.length,1);
  ports[0].onstart?.();assert.equal(c.getSnapshot().status,'listening');ports[0].onend?.();assert.equal(ports.length,1);assert.equal(c.getSnapshot().status,'idle');
});
test('interim and final are separate; cumulative final segments are not duplicated',()=>{
  const {c,ports,commits}=setup();c.start('en-US');const p=ports[0];p.onstart?.();
  p.result([['I need',false]]);assert.equal(c.getSnapshot().interim,'I need');assert.deepEqual(commits,[]);
  p.result([['I do not',true],['want water',false]],1);assert.equal(c.getSnapshot().final,'I do not');assert.equal(c.getSnapshot().interim,'want water');
  p.result([['I do not',true],['want water',true]],1);p.onend?.();assert.deepEqual(commits,['I do not want water']);
});
test('stop accepts the final result for this session, once',()=>{
  const {c,ports,commits}=setup();c.start('ur-PK');const p=ports[0];const lateEnd=p.onend;
  c.stop();assert.equal(c.getSnapshot().status,'stopping');assert.equal(p.stops,1);assert.equal(c.start('en-US'),false);
  p.result([['مجھے پانی نہیں چاہیے۔',true]]);p.onend?.();lateEnd?.();assert.deepEqual(commits,['مجھے پانی نہیں چاہیے۔']);
});
test('abort, mode change, reset and unmount invalidate old event closures',()=>{
  const {c,ports,commits}=setup();c.start('en-US');const old=ports[0];const onresult=old.onresult,onend=old.onend,onerror=old.onerror,onstart=old.onstart;
  c.abort();c.start('ur-PK');onstart?.();onresult?.({resultIndex:0,results:[{0:{transcript:'clear message'},isFinal:true,length:1}]});onerror?.({error:'network'});onend?.();
  assert.equal(c.getSnapshot().status,'starting');assert.deepEqual(commits,[]);assert.equal(old.aborts,1);c.reset();assert.equal(c.getSnapshot().final,'');
});
test('unconfirmed suffix is never discarded to execute a command or reverse negation',()=>{
  const {c,ports,commits}=setup();c.start('en-US');ports[0].result([['clear message',true],['no',false]]);ports[0].onend?.();assert.deepEqual(commits,[]);assert.equal(c.getSnapshot().interim,'no');assert.match(c.getSnapshot().error!,/unconfirmed/);
});
for(const code of ['not-allowed','service-not-allowed','no-speech','audio-capture','network','language-not-supported','aborted'])test('recognition failure '+code,()=>{
  const {c,ports,commits}=setup();c.start('en-US');const late=ports[0].onend;ports[0].onerror?.({error:code});late?.();assert.equal(c.getSnapshot().status,'error');assert.ok(c.getSnapshot().error);assert.deepEqual(commits,[]);
});
test('unsupported API and failed startup recover without leaking a session',()=>{
  const unsupported=new RecognitionController(()=>null,()=>{});assert.equal(unsupported.start('en-US'),false);assert.equal(unsupported.getSnapshot().status,'unsupported');
  const p=new Recognition();p.throwStart=true;const c=new RecognitionController(()=>p,()=>{});assert.equal(c.start('en-US'),false);assert.equal(c.getSnapshot().status,'error');p.throwStart=false;assert.equal(c.start('ur-PK'),true);c.abort();
  assert.equal(createBrowserRecognition(),null);
});
test('stopping timeout releases hung browser sessions',ctx=>{
  ctx.mock.timers.enable({apis:['setTimeout']});const {c,ports}=setup();c.start('en-US');c.stop();ctx.mock.timers.tick(5001);assert.equal(c.getSnapshot().status,'error');assert.equal(ports[0].aborts,1);c.abort();
});
test('safe exact commands in English, Urdu and Roman Urdu',()=>{
  for(const [text,command] of [['speak message','speak'],['stop speaking','stop'],['repeat message','repeat'],['clear message','clear'],['remove last symbol','remove-last'],['open emergency board','emergency'],['پیغام بولیں','speak'],['بولنا بند کریں','stop'],['paigham dohrayen','repeat'],['paigham saaf karein','clear']])assert.equal(matchVoiceCommand(text),command);
  for(const text of ['do not clear message','please do not stop speaking','I want to speak message','stop speaking?','speak message no','unknown','h','no','stop','help','پانی نہیں چاہیے','clear message and speak message'])assert.equal(matchVoiceCommand(text),null);
});
const inputs:[string,string,string][]=[
  ['I do not want water.','I do not want water.','مجھے پانی نہیں چاہیے۔'],
  ['I am not in pain.','I am not in pain.','مجھے درد نہیں ہے۔'],
  ['مجھے پانی نہیں چاہیے۔','I do not want water.','مجھے پانی نہیں چاہیے۔'],
  ['mujhe pani nahi chahiye','I do not want water.','مجھے پانی نہیں چاہیے۔'],
  ['mera sar dard kar raha hai','I have a headache.','میرے سر میں درد ہے۔'],
  ['mujhe dard nahi hai','I am not in pain.','مجھے درد نہیں ہے۔'],
  ['I need water and food','I need water and I need food.','مجھے پانی چاہیے اور مجھے کھانا چاہیے۔'],
];
for(const [text,en,ur]of inputs)test('voice semantic parity: '+text,()=>{
  const r=resolveVoiceInput(text);assert.equal(r.status,'clear');assert.equal(r.candidates[0].english,en);assert.equal(r.candidates[0].urdu,ur);assert.equal(r.input.text,text);
});
test('unknown speech is preserved with no label/substrings guessed',()=>{
  for(const text of ['I feel lonely','I do not want water tomorrow','I cannot breathe','unknown','pani nahi maybe','I need water?','breathing']){const r=resolveVoiceInput(text);assert.equal(r.status,'unsupported');assert.equal(r.input.text,text);assert.deepEqual(r.candidates,[]);}
});
test('final speech enters the existing store as input, never as selected output or a command',()=>{
  store.getState().clearSelection();store.getState().setCommunicationText('mujhe pani nahi chahiye');const s=store.getState();assert.equal(s.communicationText,'mujhe pani nahi chahiye');assert.equal(s.generatedMessage,null);assert.equal(s.selectedCandidateId,null);
  s.selectCandidate(s.resolution.candidates[0].id);assert.equal(store.getState().generatedMessage?.englishText,'I do not want water.');
  store.getState().setCommunicationText('clear message');assert.equal(store.getState().communicationText,'clear message');assert.equal(store.getState().generatedMessage,null);
  const saved=store.getState().getFullStoredState();assert.ok(!('communicationText' in saved));store.getState().clearSelection();
});
// Compile-check the result event seam used by browser and mocks.
const event:RecognitionEvent={resultIndex:0,results:[]};void event;

test('ordinary contractions retain negation and original transcript',()=>{
  for(const text of ["I don't want water.","I don’t want water.","I'm not in pain."]){const r=resolveVoiceInput(text);assert.equal(r.status,'clear');assert.equal(r.intent?.negated,true);assert.equal(r.input.text,text);}
});

test('a selected voice sentence renders in the real preview without symbol chips',()=>{
  const html=renderToStaticMarkup(createElement(SelectedMessagePreview,{symbols:[],mode:'sentence',generatedMessage:{id:'voice',selectedPhraseIds:[],englishText:'I do not want water.',urduText:'مجھے پانی نہیں چاہیے۔',mode:'sentence',createdAt:'2026-09-13'}}));
  assert.match(html,/I do not want water\./);assert.match(html,/مجھے پانی نہیں چاہیے۔/);assert.doesNotMatch(html,/Tap symbols to build a message/);
});

test('a late start event cannot undo Stop or remove its timeout',ctx=>{
  ctx.mock.timers.enable({apis:['setTimeout']});const {c,ports}=setup();c.start('en-US');const lateStart=ports[0].onstart;c.stop();lateStart?.();assert.equal(c.getSnapshot().status,'stopping');ctx.mock.timers.tick(5001);assert.equal(c.getSnapshot().status,'error');assert.equal(ports[0].aborts,1);
});
test('startup timeout aborts a recognizer that never starts',ctx=>{
  ctx.mock.timers.enable({apis:['setTimeout']});const {c,ports}=setup();c.start('ur-PK');ctx.mock.timers.tick(10001);assert.equal(c.getSnapshot().status,'error');assert.equal(ports[0].aborts,1);
});

test('natural English affirmative phrases map to canonical intents',()=>{
  const naturalEnglish: [string, string][] = [
    ['I want water', 'food-water'],
    ['Can I have water', 'food-water'],
    ['I am thirsty', 'food-water'],
    ['I need food', 'food-hungry'],
    ['I am hungry', 'food-hungry'],
    ['I want to eat', 'actions-eat'],
    ['I need medicine', 'health-medicine'],
    ['I need a doctor', 'health-doctor'],
    ['I want to go to the hospital', 'health-hospital'],
    ['I feel sick', 'health-sick'],
    ['I feel cold', 'health-cold'],
    ['I feel hot', 'health-hot'],
    ['I am tired', 'emotions-tired'],
    ['I have pain', 'health-pain'],
    ['My head hurts', 'health-headache'],
    ['My stomach hurts', 'health-stomach-pain'],
    ['I need help', 'emergency-help'],
    ['I want to go home', 'places-home'],
    ['Call my mother', 'family-mother'],
    ['Call my father', 'family-father'],
    ['I feel scared', 'emotions-scared'],
    ['I feel sad', 'emotions-sad'],
    ['I feel happy', 'emotions-happy'],
    ['I need the bathroom', 'basic-bathroom'],
  ];
  for (const [text, expectedId] of naturalEnglish) {
    const r = resolveVoiceInput(text);
    assert.equal(r.status, 'clear', `Expected clear for: ${text}`);
    assert.ok(r.candidates.length > 0, `Expected candidates for: ${text}`);
    assert.equal(r.intent?.negated, false, `Expected non-negated for: ${text}`);
    assert.ok(r.canonicalIds?.includes(expectedId) || r.intent?.concepts.includes(expectedId), `Expected ${expectedId} for: ${text}`);
  }
});

test('natural English negation maps to verified negative intents without losing negation',()=>{
  const naturalNegatives = [
    'I don\'t want water',
    'I do not want food',
    'I don\'t need medicine',
    'I don\'t have pain',
    'I am not sick',
    'I don\'t want to go home',
  ];
  for (const text of naturalNegatives) {
    const r = resolveVoiceInput(text);
    assert.equal(r.status, 'clear', `Expected clear for: ${text}`);
    assert.equal(r.intent?.negated, true, `Expected negated for: ${text}`);
    assert.ok(r.candidates.length > 0);
  }
});

test('Roman Urdu normalization and coverage across AAC categories',()=>{
  const romanPhrases: [string, string][] = [
    ['paani chahye', 'food-water'],
    ['pani do', 'food-water'],
    ['mujhe bhook lagi hai', 'food-hungry'],
    ['mujhe dawa chahiye', 'health-medicine'],
    ['doctor ko dikhana hai', 'health-doctor'],
    ['hospital jana hai', 'health-hospital'],
    ['meri tabiyat kharab hai', 'health-sick'],
    ['mujhe sardi lag rahi hai', 'health-cold'],
    ['mujhe garmi lag rahi hai', 'health-hot'],
    ['main thak gaya hoon', 'emotions-tired'],
    ['washroom jana hai', 'basic-bathroom'],
    ['mujhe madad chahiye', 'emergency-help'],
    ['ami ko bulao', 'family-mother'],
    ['abu ko bulao', 'family-father'],
    ['mujhe ghar jana hai', 'places-home'],
    ['mujhe dar lag raha hai', 'emotions-scared'],
    ['main udaas hoon', 'emotions-sad'],
    ['main khush hoon', 'emotions-happy'],
  ];
  for (const [text, expectedId] of romanPhrases) {
    const r = resolveVoiceInput(text);
    assert.equal(r.status, 'clear', `Expected clear for: ${text}`);
    assert.equal(r.intent?.negated, false, `Expected affirmative for: ${text}`);
    assert.ok(r.canonicalIds?.includes(expectedId) || r.intent?.concepts.includes(expectedId), `Expected ${expectedId} for: ${text}`);
  }
});

test('Roman Urdu negation produces verified negative intent',()=>{
  const romanNegatives: string[] = [
    'pani nahi chahiye',
    'paani nahin chahye',
    'khana nahi chahiye',
    'bhook nahi hai',
    'dawa nahi chahiye',
    'dard nahi hai',
    'sar dard nahi hai',
    'ghar nahi jana',
    'garmi nahi lag rahi',
    'sardi nahi lag rahi',
  ];
  for (const text of romanNegatives) {
    const r = resolveVoiceInput(text);
    assert.equal(r.status, 'clear', `Expected clear for: ${text}`);
    assert.equal(r.intent?.negated, true, `Expected negated for: ${text}`);
    assert.ok(r.candidates.length > 0, `Expected candidates for: ${text}`);
  }
});

test('Urdu recognition ur-PK performs single controlled fallback to ur and does not loop',()=>{
  const {c,ports}=setup();
  c.start('ur-PK');
  assert.equal(ports.length, 1);
  assert.equal(ports[0].lang, 'ur-PK');
  // First failure on ur-PK with network triggers fallback to 'ur'
  ports[0].onerror?.({error: 'network'});
  assert.equal(ports.length, 2);
  assert.equal(ports[1].lang, 'ur');
  // Second failure on 'ur' halts without looping
  ports[1].onerror?.({error: 'network'});
  assert.equal(ports.length, 2);
  assert.equal(c.getSnapshot().status, 'error');
  assert.match(c.getSnapshot().error!, /Urdu voice recognition is unavailable in this browser/);
  c.abort();
});

test('interim text on onend is preserved in final for user review instead of silently dropped',()=>{
  const {c,ports,commits}=setup();
  c.start('en-US');
  ports[0].onstart?.();
  ports[0].result([['I want water', false]]);
  ports[0].onend?.();
  assert.deepEqual(commits, []); // Not auto-committed
  assert.equal(c.getSnapshot().final, 'I want water'); // Preserved in final!
  assert.equal(c.getSnapshot().interim, 'I want water');
  assert.match(c.getSnapshot().error!, /unconfirmed/);
});

test('voice input resolution keeps selectedCandidateId null until explicit user selection',()=>{
  store.getState().clearSelection();
  store.getState().setCommunicationText('I want water');
  const s = store.getState();
  assert.equal(s.resolution.status, 'clear');
  assert.ok(s.resolution.candidates.length > 0);
  assert.equal(s.selectedCandidateId, null);
  assert.equal(s.generatedMessage, null);
  // User explicitly selects candidate
  s.selectCandidate(s.resolution.candidates[0].id);
  assert.equal(store.getState().selectedCandidateId, s.resolution.candidates[0].id);
  assert.ok(store.getState().generatedMessage);
  store.getState().clearSelection();
});

test('16 Communication Benchmark Cases (Section A)', () => {
  const cases: [string, string, string][] = [
    // English
    ['I need water', 'food-water', 'English need water'],
    ['I am hungry', 'food-hungry', 'English hungry'],
    ['Please help me', 'emergency-help', 'English please help me'],
    ['I want to go home', 'places-home', 'English go home'],

    // Urdu
    ['مجھے پانی چاہیے', 'food-water', 'Urdu water'],
    ['مجھے بھوک لگی ہے', 'food-hungry', 'Urdu hungry'],
    ['میری مدد کریں', 'emergency-help', 'Urdu help'],
    ['مجھے گھر جانا ہے', 'places-home', 'Urdu home'],

    // Roman Urdu
    ['mujhe pani chahiye', 'food-water', 'Roman Urdu water'],
    ['mujhe bhook lagi hai', 'food-hungry', 'Roman Urdu hungry'],
    ['meri madad karein', 'emergency-help', 'Roman Urdu help'],
    ['mujhe ghar jana hai', 'places-home', 'Roman Urdu home'],

    // Mixed Urdu / English
    ['mujhe water chahiye', 'food-water', 'Mixed water'],
    ['please meri help karein', 'emergency-help', 'Mixed please help'],
    ['mujhe medicine chahiye', 'health-medicine', 'Mixed medicine'],
    ['I want pani', 'food-water', 'Mixed I want pani'],
  ];

  for (const [text, expected, label] of cases) {
    const r = resolveVoiceInput(text);
    assert.equal(r.status, 'clear', `Expected clear status for [${label}]: "${text}"`);
    assert.ok(
      r.canonicalIds?.includes(expected) || r.intent?.concepts.includes(expected),
      `Expected ${expected} for [${label}]: "${text}", got: ${JSON.stringify(r.canonicalIds || r.intent?.concepts)}`
    );
    assert.equal(r.intent?.negated, false, `Expected affirmative for [${label}]: "${text}"`);
    assert.ok(r.candidates.length > 0, `Expected candidates for [${label}]: "${text}"`);
  }
});

test('Section 5: Roman Urdu phonetic variations and strict negation preservation', () => {
  const variations: [string, string][] = [
    ['mjhe paani chahye', 'food-water'],
    ['mjhe bhukh lagi hai', 'food-hungry'],
    ['maddad karein', 'emergency-help'],
    ['dawai chahiye', 'health-medicine'],
    ['ghar jana hai', 'places-home'],
    ['ammi ko bulao', 'family-mother'],
    ['abbu ko bulao', 'family-father'],
  ];

  for (const [text, expected] of variations) {
    const r = resolveVoiceInput(text);
    assert.equal(r.status, 'clear', `Expected clear for: "${text}"`);
    assert.ok(
      r.canonicalIds?.includes(expected) || r.intent?.concepts.includes(expected),
      `Expected ${expected} for "${text}", got: ${JSON.stringify(r.canonicalIds || r.intent?.concepts)}`
    );
    assert.equal(r.intent?.negated, false, `Expected non-negated for "${text}"`);
  }

  // Strict negation verification: "mujhe pani nahi chahiye" must NEVER resolve to affirmative water
  const neg = resolveVoiceInput('mujhe pani nahi chahiye');
  assert.equal(neg.status, 'clear');
  assert.equal(neg.intent?.negated, true, 'Negation must be strictly preserved');
  for (const cand of neg.candidates) {
    assert.doesNotMatch(cand.english, /^I need water/i, 'Negative must not produce "I need water"');
    assert.doesNotMatch(cand.urdu, /^مجھے پانی چاہیے$/u, 'Negative must not produce affirmative Urdu');
    assert.match(cand.english, /not|don't|refusing|no/i, 'Candidate must express negative');
  }

  // Unknown speech remains unsupported without hallucinated intent
  const unknown = resolveVoiceInput('xyz completely unknown random utterance 12345');
  assert.equal(unknown.status, 'unsupported');
  assert.equal(unknown.intent, null);
  assert.equal(unknown.candidates.length, 0);
});

