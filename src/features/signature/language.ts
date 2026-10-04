import type { BilingualSentence, SentenceCandidate, IntentResolution } from '../../types/intent';
import type { SentenceStyle } from './types';
export const normalizeSentence=(text:string)=>text.normalize('NFKC').trim().replace(/\s+/gu,' ');
const key=(p:BilingualSentence)=>normalizeSentence(p.english)+'|'+normalizeSentence(p.urdu);
/** Finite, auditable surface grammar. Urgency is never added to a non-urgent meaning. */
export function reviewedVariants(pairs:BilingualSentence[],negated=false):BilingualSentence[]{
 const result=[...pairs];
 for(const p of pairs){
  if(!p.english.startsWith('Please')&&!p.urdu.startsWith('براہ کرم')&&!negated && /^(I need |I want |Call |I would like )/.test(p.english)){
   result.push({english:'Please, '+p.english,urdu:'براہ کرم، '+p.urdu});
  }
 }
 return [...new Map(result.map(p=>[key(p),p])).values()].slice(0,9);
}
export function validEquivalentPairs(value:unknown,allowed:BilingualSentence[]):BilingualSentence[]{
 if(!Array.isArray(value)||value.length<1||value.length>3)return [];
 const seen=new Set<string>(),allowedKeys=new Set(allowed.map(key)),result:BilingualSentence[]=[];
 for(const item of value){
  if(!item||typeof item!=='object'||Object.keys(item).sort().join(',')!=='english,urdu')return [];
  const p=item as BilingualSentence;
  if(typeof p.english!=='string'||typeof p.urdu!=='string'||p.english.length>1200||p.urdu.length>1200||/[<>\u202a-\u202e\u2066-\u2069]/u.test(p.english+p.urdu))return [];
  const k=key(p);if(seen.has(k)||!allowedKeys.has(k))return [];
  seen.add(k);result.push({english:normalizeSentence(p.english),urdu:normalizeSentence(p.urdu)});
 }
 return result;
}
export function styledCandidates(resolution:IntentResolution,style:SentenceStyle):SentenceCandidate[]{
 if(resolution.status!=='clear'||!resolution.intent)return [];
 const pairs=reviewedVariants(resolution.candidates,resolution.intent.negated);
 const preferred=style==='polite'?pairs.filter(p=>p.english.startsWith('Please')):[];
 return [...new Map([...preferred,...pairs].map(p=>[key(p),p])).values()].slice(0,3).map((p,i)=>({...p,id:resolution.candidates[0].intentKey+':style:'+style+':'+i,intentKey:resolution.candidates[0].intentKey,style:p.english.startsWith('Please')?'polite':resolution.intent!.modifiers.includes('basic-now')||resolution.intent!.kind==='emergency'?'urgent':'direct'}));
}
