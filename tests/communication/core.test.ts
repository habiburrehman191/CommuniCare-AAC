import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPhrases, phraseCategories } from '../../src/data/phrases';
import { intents } from '../../src/data/intents';
import { resolveIntent, customPhraseIntent, validCustomPhrases } from '../../src/features/communication/intentResolver';
import type { Phrase } from '../../src/types';
const resolve = (...symbolIds: string[]) => resolveIntent({symbolIds});
const complete = (result: ReturnType<typeof resolve>) => {
  assert.equal(result.status,'clear');
  assert.ok(result.candidates.length >= 1 && result.candidates.length <= 3);
  assert.equal(new Set(result.candidates.map(c=>c.english)).size,result.candidates.length);
  assert.equal(new Set(result.candidates.map(c=>c.urdu)).size,result.candidates.length);
  for (const c of result.candidates) {
    assert.match(c.english, /^[A-Z].*[.!?]$/u);
    assert.match(c.urdu, /[۔؟]$/u);
    assert.match(c.urdu, /[\u0600-\u06ff]/u);
    assert.ok(c.english.split(' ').length >= 2);
    assert.doesNotMatch(c.english + c.urdu, /undefined|null|NaN|\[object|<[^>]*>/u);
    assert.equal(c.intentKey,result.candidates[0].intentKey);
  }
};
for (const phrase of initialPhrases) test('vocabulary: '+phrase.id, () => {
  assert.ok(intents[phrase.id]);
  const r=resolve(phrase.id);
  if (['operator','location'].includes(intents[phrase.id].kind)) {
    assert.equal(r.status,'clarification'); assert.deepEqual(r.candidates,[]);
  } else {
    complete(r);
    assert.equal(phrase.sentenceEnglish,r.candidates[0].english);
    assert.equal(phrase.sentenceUrdu,r.candidates[0].urdu);
  }
});
test('all nine categories and every semantic definition have a visible symbol',()=>{
  assert.equal(phraseCategories.length,9);
  for(const category of phraseCategories) assert.ok(initialPhrases.some(p=>p.category===category.id));
  assert.deepEqual(new Set(initialPhrases.map(p=>p.id)),new Set(Object.keys(intents)));
});
test('Water and Headache each provide three distinct complete bilingual alternatives',()=>{
  for(const id of ['food-water','health-headache']) {const r=resolve(id);complete(r);assert.equal(r.candidates.length,3);}
  assert.deepEqual(resolve('health-headache').candidates.map(c=>[c.english,c.urdu]),[
    ['I have a headache.','میرے سر میں درد ہے۔'],['My head hurts.','میرے سر میں درد ہو رہا ہے۔'],['I feel pain in my head.','مجھے سر میں درد محسوس ہو رہا ہے۔']]);
});
const combinations: [string[],string,string][] = [
 [['basic-no','food-water'],'I do not want water.','مجھے پانی نہیں چاہیے۔'],
 [['basic-not','health-pain'],'I am not in pain.','مجھے درد نہیں ہے۔'],
 [['basic-no','actions-play'],'I do not want to play.','مجھے کھیلنا نہیں ہے۔'],
 [['health-pain','health-head'],'I have a headache.','میرے سر میں درد ہے۔'],
 [['health-pain','health-stomach','basic-very'],'I have severe stomach pain.','میرے پیٹ میں شدید درد ہے۔'],
 [['actions-drink','food-water'],'I want to drink water.','مجھے پانی پینا ہے۔'],
 [['actions-eat','food-hungry'],'I want to eat food.','مجھے کھانا کھانا ہے۔'],
 [['actions-go','places-home'],'I want to go home.','مجھے گھر جانا ہے۔'],
 [['actions-call','family-mother'],'Call my mother.','امی کو بلائیں۔'],
 [['actions-call','family-mother','family-father','basic-and'],'Call my mother and my father.','امی اور ابو کو بلائیں۔'],
 [['actions-call','family-mother','basic-now'],'Call my mother now.','ابھی امی کو بلائیں۔'],
 [['actions-go','places-home','basic-now'],'I want to go home now.','ابھی مجھے گھر جانا ہے۔'],
 [['basic-no','actions-call','family-father'],'Do not call my father.','ابو کو نہ بلائیں۔'],
 [['actions-play','basic-with','family-mother'],'I want to play with my mother.','مجھے امی کے ساتھ کھیلنا ہے۔'],
 [['actions-play','basic-at','places-school'],'I want to play at school.','مجھے اسکول میں کھیلنا ہے۔'],
 [['actions-play','basic-with','family-father','basic-at','places-outside'],'I want to play with my father outside.','مجھے ابو کے ساتھ باہر کھیلنا ہے۔'],
 [['food-water','basic-more'],'I want more water.','مجھے مزید پانی چاہیے۔'],
 [['food-juice','basic-less'],'I want less juice.','مجھے کم جوس چاہیے۔'],
 [['health-headache','basic-very'],'I have a severe headache.','میرے سر میں شدید درد ہے۔'],
 [['food-water','basic-now'],'I need water now.','ابھی مجھے پانی چاہیے۔'],
 [['emergency-help'],'I need help now.','مجھے ابھی مدد چاہیے۔'],
 [['health-headache','basic-very','emergency-help'],'I have a severe headache and I need help now.','میرے سر میں شدید درد ہے اور مجھے ابھی مدد چاہیے۔'],
 [['actions-drink','food-water','basic-more'],'I want to drink more water.','مجھے مزید پانی پینا ہے۔'],
 [['actions-go','places-home','basic-with','family-mother'],'I want to go home with my mother.','مجھے امی کے ساتھ گھر جانا ہے۔'],
 [['health-pain','emergency-help'],'I am in pain and I need help now.','مجھے درد ہے اور مجھے ابھی مدد چاہیے۔'],
 [['emotions-scared','basic-comfort'],'I feel scared and I need comfort.','مجھے ڈر لگ رہا ہے اور مجھے تسلی چاہیے۔'],
 [['food-water','basic-and','food-hungry'],'I need water and I need food.','مجھے پانی چاہیے اور مجھے کھانا چاہیے۔'],
];
for(const [ids,en,ur] of combinations) test('combination: '+ids.join(' + '),()=>{
  const r=resolve(...ids);complete(r);assert.equal(r.candidates[0].english,en);assert.equal(r.candidates[0].urdu,ur);
  const reversed=resolve(...[...ids].reverse());assert.deepEqual(new Set(reversed.intent?.concepts),new Set(r.intent?.concepts));
});
const ambiguous = [
 ['basic-no','family-mother'],['actions-call','family-mother','family-father'],['food-water','food-juice'],['basic-yes','basic-no'],['emotions-happy','emotions-sad'],
 ['health-hot','health-cold'],['health-headache','health-stomach-pain','health-hot','health-cold','health-sick','health-pain'],
 ['family-mother','food-water'],['family-mother','actions-play'],['places-home','places-school'],
 ['actions-stop','food-water'],['basic-more','basic-less','food-water'],['basic-very','food-water'],
 ['basic-no','food-water','food-hungry','basic-and'],['basic-not','basic-no','health-pain'],
 ['health-head'],['actions-go'],['actions-call'],['basic-more'],['social-please'],['basic-no','emergency-help'],
 ['food-water','basic-with','family-mother'],['actions-drink','health-medicine'],['health-pain','health-head','health-stomach'],
 ['health-pain','health-headache'],['food-water','basic-and'],['basic-no','basic-more','food-water'],
 ['basic-very','social-hello'],['actions-play','basic-with'],['basic-at','places-home'],
];
for (const ids of ambiguous) test('clarification: '+ids.join(' + '),()=>{
  const r=resolve(...ids);assert.equal(r.status,'clarification');assert.deepEqual(r.candidates,[]);assert.deepEqual(r.input.symbolIds,ids);assert.ok(r.clarification?.urdu);
});
for(const [id,d] of Object.entries(intents)) {
  for(const [polarity,rows] of [['positive',d.positive],['negative',d.negative ?? []]] as const) {
    for(const [i,p] of rows.entries()) test('bilingual meaning round trip: '+id+' '+polarity+' '+i,()=>{
      const a=resolveIntent({symbolIds:[],text:p.english}), b=resolveIntent({symbolIds:[],text:p.urdu});
      complete(a);complete(b);assert.deepEqual(a.intent,b.intent);assert.equal(a.intent?.negated,polarity==='negative');
      assert.deepEqual(a.intent?.concepts,[id]);
    });
  }
}
test('unknown text never becomes a substring command or a guessed sentence',()=>{
  for(const text of ['unknown','h','water pain','I do not want blue water','میرے سر میں شاید درد ہے','<script>alert(1)</script>','Water banana sleep']) {
    const r=resolveIntent({symbolIds:[],text}); assert.equal(r.status,'unsupported');assert.deepEqual(r.candidates,[]);assert.equal(r.input.text,text);
  }
  assert.equal(resolveIntent({symbolIds:['food-water'],text:'I am in pain.'}).status,'clarification');
});
test('empty, duplicate, excessive and unknown input',()=>{
  assert.equal(resolve().status,'empty');assert.equal(resolveIntent({symbolIds:[],text:'  '}).status,'empty');
  assert.deepEqual(resolve('food-water','food-water').candidates,resolve('food-water').candidates);
  assert.deepEqual(resolve('food-water','food-water').input.symbolIds,['food-water','food-water']);
  for(const ids of [['unknown'],['__proto__'],['constructor'],Array(25).fill('food-water')]) assert.equal(resolve(...ids).status,'unsupported');
});
const custom: Phrase = {...initialPhrases.find(p=>p.id==='food-water')!, id:'custom-drink',labelEnglish:'My drink',labelUrdu:'میرا مشروب',isCustom:true};
test('verified custom bilingual phrase is visible and resolves; labels do not infer meaning',()=>{
  assert.equal(customPhraseIntent(custom),'food-water');assert.deepEqual(validCustomPhrases([custom]),[custom]);
  const r=resolveIntent({symbolIds:[custom.id]},[custom]);complete(r);assert.deepEqual(r.intent?.concepts,['food-water']);
  assert.equal(resolveIntent({symbolIds:['basic-no',custom.id]},[custom]).intent?.negated,true);
});
test('custom invalidity, mismatched translations, duplicates and built-in collisions',()=>{
  const bad=[{...custom,sentenceEnglish:'Water pain blue'},{...custom,sentenceUrdu:'مجھے درد ہے۔'},
    {...custom,sentenceEnglish:'I do not want water.'},{...custom,sentenceUrdu:''},{...custom,id:'food-water'},
    {...custom,labelEnglish:'<b>hello</b>'},{...custom,isCustom:false}];
  for(const p of bad) {assert.equal(customPhraseIntent(p),null);assert.deepEqual(validCustomPhrases([p]),[]);}
  assert.deepEqual(validCustomPhrases([custom,custom]),[]);
  assert.equal(resolveIntent({symbolIds:[custom.id]},bad).status,'unsupported');
});
test('every pair either has a complete bounded result or preserves input without output',()=>{
  for(const a of initialPhrases) for(const b of initialPhrases) {
    const r=resolve(a.id,b.id);assert.deepEqual(r.input.symbolIds,[a.id,b.id]);
    if(r.status==='clear') complete(r);else assert.deepEqual(r.candidates,[]);
  }
});

test('malformed stored custom data fails closed',()=>{
  const malformed: unknown[] = [null,{}, {...custom,category:'invalid'}, {...custom,usageCount:NaN}, {...custom,iconName:null}, {...custom,favorite:'yes'}, {...custom,id:''}, {...custom,labelEnglish:'x'.repeat(301)}, {...custom,labelUrdu:'bad'+String.fromCharCode(0)}];
  for(const p of malformed) assert.equal(customPhraseIntent(p as Phrase),null);
  assert.deepEqual(validCustomPhrases(null as unknown as Phrase[]),[]);
});
test('politeness and urgency are only added when selected and never erase negation',()=>{
  const normal=resolve('food-water');assert.ok(normal.candidates.every(c=>!c.english.includes('Please')&&!c.english.includes('now')));
  const polite=resolve('social-please','food-water');complete(polite);assert.ok(polite.candidates.every(c=>c.english.startsWith('Please,')&&c.urdu.startsWith('براہ کرم')));
  for(const ids of [['basic-not','basic-now','food-water'],['basic-very','emergency-help'],['social-please','health-pain']]) assert.equal(resolve(...ids).status,'clarification');
});

test('question punctuation is not erased to infer a statement',()=>{
  for(const text of ['I need water?','I need water?!','مجھے پانی چاہیے؟']) {
    const r=resolveIntent({symbolIds:[],text});assert.equal(r.status,'unsupported');assert.deepEqual(r.candidates,[]);
  }
});
test('polite candidates preserve English pronoun capitalization',()=>{
  const r=resolve('social-please','food-water');complete(r);
  for(const c of r.candidates) assert.doesNotMatch(c.english,/\bi\b/u);
});
test('time and refusal scope across multiple requests or people needs clarification',()=>{
  for(const ids of [['basic-now','basic-and','food-water','food-hungry'],['basic-no','actions-call','family-mother','basic-and','family-father']]) {
    assert.equal(resolve(...ids).status,'clarification');
  }
});
test('a valid custom refusal preserves its bilingual negation',()=>{
  const refusal={...custom,id:'custom-refusal',sentenceEnglish:'I do not want water.',sentenceUrdu:'مجھے پانی نہیں چاہیے۔'};
  assert.deepEqual(validCustomPhrases([refusal]),[refusal]);
  const r=resolveIntent({symbolIds:[refusal.id]},[refusal]);complete(r);
  assert.equal(r.intent?.negated,true);assert.equal(r.candidates[0].english,refusal.sentenceEnglish);assert.equal(r.candidates[0].urdu,refusal.sentenceUrdu);
  assert.equal(resolveIntent({symbolIds:['basic-no',refusal.id]},[refusal]).status,'clarification');
});
