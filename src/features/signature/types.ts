import type { BilingualSentence } from '../../types/intent';
export const contexts=['Home','School','Meal','Medical','Social','Travel','Emergency'] as const;
export type ContextMode=typeof contexts[number];
export type SentenceStyle='direct'|'polite'|'urgent';
export interface StudioDefinition {symbolIds:string[];alternatives:BilingualSentence[];contexts:ContextMode[];aliases:string[]}
export interface Personalization {counts:Record<string,number>;recent:string[];style:SentenceStyle;context:ContextMode}
export interface SignatureState {enabled:boolean;aiEnabled:boolean;profiles:Record<string,Personalization>}
export const emptyPersonalization=():Personalization=>({counts:{},recent:[],style:'direct',context:'Home'});
export const defaultSignature=():SignatureState=>({enabled:true,aiEnabled:false,profiles:{}});
export function validateSignature(value:unknown):SignatureState{
 if(!value||typeof value!=='object')return defaultSignature();
 const s=value as Record<string,unknown>,profiles:Record<string,Personalization>={};
 if(s.profiles&&typeof s.profiles==='object')for(const [id,v] of Object.entries(s.profiles).slice(0,20)){
  if(['__proto__','constructor','prototype'].includes(id)||!/^[-a-zA-Z0-9_]{1,80}$/.test(id)||!v||typeof v!=='object')continue;
  const p=v as Record<string,unknown>,counts:Record<string,number>={};
  if(p.counts&&typeof p.counts==='object')for(const [key,n] of Object.entries(p.counts).slice(0,200))if(!['__proto__','constructor','prototype'].includes(key)&&/^[-a-zA-Z0-9_]{1,100}$/.test(key)&&typeof n==='number'&&Number.isFinite(n)&&n>0)counts[key]=Math.min(1000,Math.floor(n));
  profiles[id]={counts,recent:Array.isArray(p.recent)?p.recent.filter((x):x is string=>typeof x==='string'&&Object.hasOwn(counts,x)).slice(0,8):[],style:['direct','polite','urgent'].includes(p.style as string)?p.style as SentenceStyle:'direct',context:contexts.includes(p.context as ContextMode)?p.context as ContextMode:'Home'};
 }
 return {enabled:s.enabled!==false,aiEnabled:s.aiEnabled===true,profiles};
}
