import { reviewedVariants, validEquivalentPairs } from '../signature/language';
import { contexts } from '../signature/types';
import { intents } from '../../data/intents';
import type { IntentDefinition } from '../../data/intents';
import { phraseCategoryIds } from '../../types/aac';
import type { Phrase } from '../../types/aac';
import type { BilingualSentence, IntentInput, IntentResolution, SemanticIntent } from '../../types/intent';

const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/[.!۔]+$/u, '').replace(/\s+/gu, ' ');
const pair = (english: string, urdu: string): BilingualSentence => ({english, urdu});
const hasOwn = (id: string) => Object.hasOwn(intents, id);
/** Unknown custom wording is retained in storage, but never treated as verified translation.
 * A custom tile can use any label and any equivalent pair from a supported intent.
 * No regex or declared confidence can prove arbitrary bilingual semantic equivalence.
 */
function customPhraseMeaning(phrase: Phrase): {id: string; negated: boolean; ids?: string[]} | null {
  if (!phrase || typeof phrase.id !== 'string' || hasOwn(phrase.id) || !phrase.isCustom) return null;
  if (!phrase.id.trim() || ['__proto__','constructor','prototype'].includes(phrase.id) || phrase.id.length > 100 || !phraseCategoryIds.includes(phrase.category)) return null;
  if (typeof phrase.iconName !== 'string' || phrase.iconName.length > 100 || !Number.isFinite(phrase.usageCount) || phrase.usageCount < 0) return null;
  if (![phrase.favorite, phrase.emergency, phrase.quickAccess].every(value => typeof value === 'boolean')) return null;
  if (![phrase.labelEnglish, phrase.labelUrdu, phrase.sentenceEnglish, phrase.sentenceUrdu].every(t => typeof t === 'string' && t.trim().length > 0 && t.length <= 300 && !/[<>]/u.test(t) && ![...t].some(c => c.charCodeAt(0) < 32))) return null;
  if(phrase.studio!==undefined){
    const studio=phrase.studio;
    if(!studio||typeof studio!=='object'||Object.keys(studio).sort().join(',')!=='aliases,alternatives,contexts,symbolIds')return null;
    if(!Array.isArray(studio.symbolIds)||!studio.symbolIds.length||studio.symbolIds.length>24||studio.symbolIds.some(id=>typeof id!=='string'||!hasOwn(id)))return null;
    if(!Array.isArray(studio.contexts)||studio.contexts.length>7||studio.contexts.some(c=>!contexts.includes(c)))return null;
    if(!Array.isArray(studio.aliases)||studio.aliases.length>12||studio.aliases.some(a=>typeof a!=='string'||!a.trim()||a.length>100||/[<>]/u.test(a)||[...a].some(c=>c.charCodeAt(0)<32)))return null;
    const resolved=resolveIntent({symbolIds:studio.symbolIds});
    if(resolved.status!=='clear'||!resolved.intent)return null;
    const allowed=reviewedVariants(resolved.candidates,resolved.intent.negated);
    if(!validEquivalentPairs(studio.alternatives,allowed).length||!validEquivalentPairs([{english:phrase.sentenceEnglish,urdu:phrase.sentenceUrdu}],allowed).length)return null;
    if(!resolved.intent.negated&&studio.aliases.some(a=>/(?:\b(?:not|no|never|nahi|nahin)\b|نہیں|نہ )/iu.test(a)))return null;
    return {id:studio.symbolIds[0],negated:false,ids:studio.symbolIds};
  }
  const matches = Object.entries(intents).flatMap(([id, d]) => [false, true].flatMap(negated => {
    const candidates = (negated ? d.negative : d.positive) ?? [];
    return candidates.some(p => normalize(p.english) === normalize(phrase.sentenceEnglish)) && candidates.some(p => normalize(p.urdu) === normalize(phrase.sentenceUrdu)) ? [{id, negated}] : [];
  }));
  return matches.length === 1 ? matches[0] : null;
}
export function customPhraseIntent(phrase: Phrase): string | null {
  return customPhraseMeaning(phrase)?.id ?? null;
}
export function validCustomPhrases(phrases: Phrase[]): Phrase[] {
  if (!Array.isArray(phrases)) return [];
  return phrases.filter(p => customPhraseIntent(p) && phrases.filter(other => other?.id === p.id).length === 1);
}

export function resolveIntent(input: IntentInput, customPhrases: Phrase[] = []): IntentResolution {
  // Keep original input, including unknown and repeated symbols, for correction.
  const original = {symbolIds: [...input.symbolIds], ...(input.text !== undefined ? {text: input.text} : {})};
  const fail = (status: 'empty' | 'clarification' | 'unsupported', english: string, urdu: string): IntentResolution => ({status,input:original,intent:null,candidates:[],clarification:status === 'empty' ? null : pair(english,urdu)});
  const clarify = () => fail('clarification','Please clarify the combination or remove a symbol.','براہ کرم مطلب واضح کریں یا کوئی علامت ہٹائیں۔');
  if (input.symbolIds.length > 24 || (input.text?.length ?? 0) > 500) return fail('unsupported','Please use a shorter message.','براہ کرم مختصر پیغام دیں۔');
  let ids = [...new Set(input.symbolIds)];
  if (input.text?.trim()) {
    // Exact complete utterances only. Never substring-match, tokenize away negation,
    // or infer the relation between simultaneous text and symbols.
    if (ids.length) return clarify();
    const text = normalize(input.text);
    const matches: {id: string; negative: boolean}[] = [];
    for (const [id, def] of Object.entries(intents)) {
      if (def.positive.some(p => [p.english,p.urdu].some(t => normalize(t) === text))) matches.push({id,negative:false});
      if (def.negative?.some(p => [p.english,p.urdu].some(t => normalize(t) === text))) matches.push({id,negative:true});
    }
    if (matches.length !== 1) return fail(matches.length ? 'clarification' : 'unsupported','This wording is not supported. Please use symbols or clarify.','یہ عبارت معاونت یافتہ نہیں ہے۔ براہ کرم علامات استعمال کریں یا مطلب واضح کریں۔');
    ids = matches[0].negative ? ['basic-not',matches[0].id] : [matches[0].id];
  }
  if (!ids.length) return fail('empty','','');
  const custom = validCustomPhrases(customPhrases);
  const canonical: string[] = [];
  for (const id of ids) {
    const customPhrase = custom.find(p => p.id === id);
    const meaning = customPhrase ? customPhraseMeaning(customPhrase) : null;
    if(meaning?.ids){canonical.push(...meaning.ids);continue;}
    if (meaning?.negated) {
      if (ids.length > 1) return clarify();
      canonical.push('basic-not');
    }
    const key = hasOwn(id) ? id : meaning?.id;
    if (!key) return fail('unsupported','An unknown or unverified phrase is selected. Please correct the input.','ایک نامعلوم یا غیر تصدیق شدہ فقرہ منتخب ہے۔ براہ کرم درست کریں۔');
    canonical.push(key);
  }
  ids = [...new Set(canonical)];
  const has = (id: string) => ids.includes(id);
  const negated = has('basic-not') || (has('basic-no') && ids.length > 1);
  if ((has('basic-yes') && ids.length > 1) || (has('basic-no') && has('basic-not'))) return clarify();
  const modifiers = ids.filter(id => ['basic-more','basic-less','basic-now','basic-very','social-please'].includes(id));
  if (has('basic-more') && has('basic-less')) return clarify();
  const controls = new Set([...modifiers,'basic-not','basic-and','basic-with','basic-at']);
  if (negated) controls.add('basic-no');
  let core = ids.filter(id => !controls.has(id));
  if (!core.length) return clarify();
  // Contradictions have no guessed temporal or contrastive interpretation.
  for (const [a,b] of [['emotions-happy','emotions-sad'],['health-hot','health-cold']]) if (has(a) && has(b)) return clarify();
  if (has('actions-stop') && core.length > 1) return clarify();
  if (has('basic-and') && core.length < 2) return clarify();
  let sentences: BilingualSentence[] = [];
  let kind: SemanticIntent['kind'] = 'combined';
  let definition: IntentDefinition | undefined;
  const rows = (en: string, ur: string) => [pair(en,ur)];
  const desire = (en: string, ur: string) => negated
    ? rows(`I do not want to ${en}.`, `مجھے ${ur} نہیں ہے۔`)
    : rows(`I want to ${en}.`, `مجھے ${ur} ہے۔`);
  // Explicit pain location consumes both tokens, never appends a second symptom.
  const locations = core.filter(id => intents[id].kind === 'location');
  if (locations.length) {
    if (locations.length !== 1 || !has('health-pain') || has('basic-and')) return clarify();
    const location = locations[0];
    if (has('health-headache') || has('health-stomach-pain')) return clarify();
    core = core.filter(id => id !== 'health-pain' && id !== location);
    core.push(location === 'health-head' ? 'health-headache' : 'health-stomach-pain');
  }
  // Go + destination and call + person have explicit roles. Bare person + need
  // remains ambiguous (speaker, addressee, companion, or beneficiary).
  const people = core.filter(id => intents[id].kind === 'person');
  const places = core.filter(id => intents[id].kind === 'destination');
  const actions = core.filter(id => intents[id].kind === 'activity');
  const relational = has('basic-with') || has('basic-at');
  if (core.includes('actions-call')) {
    if (!people.length || people.length > 3 || core.length !== people.length + 1 || relational || (people.length > 1) !== has('basic-and')) return clarify();
    if (negated && people.length > 1) return clarify();
    const en = people.map(id => intents[id].en).join(' and ');
    const ur = people.map(id => intents[id].ur).join(' اور ');
    sentences = negated ? rows(`Do not call ${en}.`,`${ur} کو نہ بلائیں۔`) : rows(`Call ${en}.`,`${ur} کو بلائیں۔`);
  } else if (core.includes('actions-go')) {
    if (places.length !== 1 || core.length !== 2 + people.length || people.length > 1 || has('basic-at') || has('basic-with') !== (people.length === 1) || has('basic-and')) return clarify();
    definition = intents[places[0]];
    if (people.length) {
      const p = intents[people[0]];
      sentences = desire(`go ${definition.en} with ${p.en}`,`${p.ur} کے ساتھ ${definition.ur} جانا`);
    } else {
      sentences = (negated ? definition.negative : definition.positive) ?? [];
    }
  } else if (relational) {
    if (actions.length !== 1 || has('basic-and') || (has('basic-with') ? people.length !== 1 : people.length !== 0) || (has('basic-at') ? places.length !== 1 : places.length !== 0) || core.length !== 1 + people.length + places.length) return clarify();
    if (!['actions-play','actions-sleep'].includes(actions[0])) return clarify();
    const a = intents[actions[0]], p = people.length ? intents[people[0]] : null, place = places.length ? intents[places[0]] : null;
    const enPlace = place ? (places[0] === 'places-outside' ? ' outside' : ` at ${place.en.replace(/^to /, '')}`) : '';
    const urPlace = place ? `${place.ur}${places[0] === 'places-outside' ? '' : ' میں'} ` : '';
    sentences = desire(`${a.en}${p ? ' with ' + p.en : ''}${enPlace}`,`${p ? p.ur + ' کے ساتھ ' : ''}${urPlace}${a.ur}`);
  } else if (core.length === 2 && (has('actions-drink') || has('actions-eat'))) {
    const drink = has('actions-drink');
    const object = core.find(id => id !== (drink ? 'actions-drink' : 'actions-eat'))!;
    if (has('basic-and') || !(drink ? ['food-water','food-juice'] : ['food-hungry']).includes(object)) return clarify();
    sentences = desire(`${drink ? 'drink' : 'eat'} ${intents[object].en}`,`${intents[object].ur} ${drink ? 'پینا' : 'کھانا'}`);
  } else if (core.length === 1) {
    definition = intents[core[0]];
    if (definition.kind === 'operator' || definition.kind === 'location') return clarify();
    kind = definition.kind;
    sentences = (negated ? definition.negative : definition.positive) ?? [];
  } else {
    // Explicit conjunction can combine compatible requests or statements. A
    // symptom + urgent help/comfort is also an unambiguous two-part message.
    if (negated || core.length > 3) return clarify(); // negation scope unknown
    const defs = core.map(id => intents[id]);
    const supportedAnd = has('basic-and') && defs.every(d => d.kind === 'state' || d.kind === 'request' || d.kind === 'emergency');
    const stateHelp = core.length === 2 && defs.some(d => d.kind === 'state') && core.some(id => ['emergency-help','basic-comfort'].includes(id));
    if (!supportedAnd && !stateHelp) return clarify();
    // An explicit semantic conjunction, after validating every selected role.
    sentences = rows(defs.map(d => d.positive[0].english.replace(/[.!?]$/, '')).join(' and ') + '.', defs.map(d => d.positive[0].urdu.replace(/[۔؟]$/, '')).join(' اور ') + '۔');
  }
  if (!sentences.length) return clarify();
  // Modifiers are licensed by meaning, not blindly appended to arbitrary text.
  if (has('basic-more') || has('basic-less')) {
    const object = core.find(id => ['food-water','food-juice','food-hungry'].includes(id));
    const action = core.find(id => ['actions-drink','actions-eat'].includes(id));
    if (!object || core.length !== (action ? 2 : 1) || negated || has('basic-very')) return clarify();
    const d = intents[object], more = has('basic-more');
    sentences = action ? desire(`${action === 'actions-drink' ? 'drink' : 'eat'} ${more ? 'more' : 'less'} ${d.en}`,`${more ? 'مزید' : 'کم'} ${d.ur} ${action === 'actions-drink' ? 'پینا' : 'کھانا'}`) : rows(`I want ${more ? 'more' : 'less'} ${d.en}.`,`مجھے ${more ? 'مزید' : 'کم'} ${d.ur} چاہیے۔`);
  }
  if (has('basic-very')) {
    if (negated) return clarify();
    const severe: Record<string,BilingualSentence> = {
      'health-pain':pair('I am in severe pain.','مجھے شدید درد ہے۔'),
      'health-headache':pair('I have a severe headache.','میرے سر میں شدید درد ہے۔'),
      'health-stomach-pain':pair('I have severe stomach pain.','میرے پیٹ میں شدید درد ہے۔'),
      'health-hot':pair('I feel very hot.','مجھے بہت گرمی لگ رہی ہے۔'),
      'health-cold':pair('I feel very cold.','مجھے بہت سردی لگ رہی ہے۔'),
      'emotions-happy':pair('I feel very happy.','میں بہت خوش ہوں۔'),
      'emotions-sad':pair('I feel very sad.','میں بہت اداس ہوں۔'),
      'emotions-scared':pair('I feel very scared.','مجھے بہت ڈر لگ رہا ہے۔'),
      'emotions-tired':pair('I feel very tired.','مجھے بہت تھکن محسوس ہو رہی ہے۔'),
      'emotions-angry':pair('I feel very angry.','مجھے بہت غصہ آ رہا ہے۔'),
    };
    const targets = core.filter(id => Object.hasOwn(severe,id));
    if (targets.length !== 1 || (core.length > 1 && (!core.every(id => intents[id].kind === 'state' || ['emergency-help','basic-comfort'].includes(id)) || core.filter(id => intents[id].kind === 'state').length !== 1))) return clarify();
    sentences = rows(core.map(id => (severe[id] ?? intents[id].positive[0]).english.replace(/[.!?]$/, '')).join(' and ') + '.', core.map(id => (severe[id] ?? intents[id].positive[0]).urdu.replace(/[۔؟]$/, '')).join(' اور ') + '۔');
  }
  if (has('basic-now')) {
    if ((has('basic-and') && !has('actions-call')) || negated || core.some(id => ['social','state'].includes(intents[id].kind))) return clarify();
    if (!['emergency-help','emergency-family'].includes(core[0])) sentences = sentences.map(s => pair(s.english.replace(/\.$/,' now.'), 'ابھی ' + s.urdu));
  }
  if (has('social-please')) {
    if (negated || core.some(id => ['state','social'].includes(intents[id].kind))) return clarify();
    sentences = sentences.map(s => /^Please /u.test(s.english) ? s : pair('Please, ' + (s.english.startsWith('I ') ? s.english : s.english[0].toLowerCase() + s.english.slice(1)),'براہ کرم، ' + s.urdu));
  }
  const studioPhrase=original.symbolIds.length===1?custom.find(p=>p.id===original.symbolIds[0]&&p.studio):undefined;
  if(studioPhrase?.studio)sentences=studioPhrase.studio.alternatives;
  const intent: SemanticIntent = {kind,concepts:core,negated,modifiers};
  const key = JSON.stringify(intent);
  return {status:'clear',input:original,canonicalIds:ids,intent,clarification:null,candidates:sentences.slice(0,3).map((s,i) => ({...s,id:key + ':' + i,intentKey:key}))};
}
