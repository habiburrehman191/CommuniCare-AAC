import { validateSignature } from '@/features/signature/types';
import type { AACStoredState, CommunicationMode, Phrase, StoredLanguage, StoredPreferences, SupportedEmotion, UserProfile } from '@/types';
import { profilePlaceholders } from '@/data/profiles';
import { validCustomPhrases } from '@/features/suggestions';
export type { StoredLanguage, SupportedEmotion, StoredPreferences };
export type MessageBuildMode = CommunicationMode;
export type StoredPhrase = Phrase;
export type StoredState = AACStoredState;

export const STORAGE_KEY = 'communicare-state-v3';
export const LEGACY_STORAGE_KEYS = ['ai-communication-system-v2', 'ai-communication-system'];
export const defaultPreferences: StoredPreferences = {
 speechRate:1, speechPitch:1, speechVolume:1, preferredVoiceLang:'auto', signLanguageEnabled:false,
 selectedEmotion:'none', emotionSupportEnabled:false, messageMode:'sentence', highContrast:false, audioFeedback:true,
};
export const defaultStoredState: AACStoredState = {
 version:3, activeProfileId:'profile-child', profiles:profilePlaceholders, language:'english',
 phraseHistory:[], frequentlyUsed:{}, customPhrases:[], preferences:defaultPreferences, updatedAt:0,
};
const record=(v:unknown):Record<string,unknown> => v!==null && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const number=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
const choice=<T extends string>(v:unknown,values:readonly T[],fallback:T):T=>values.includes(v as T)?v as T:fallback;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!Array.from(v).some(c=>c.charCodeAt(0)<32)?v.trim():null;
export function validatePreferences(value:unknown):StoredPreferences {
 const p=record(value);
 return {
  speechRate:number(p.speechRate,.5,1.5,1),speechPitch:number(p.speechPitch,.5,1.5,1),speechVolume:number(p.speechVolume,0,1,1),
  preferredVoiceLang:choice(p.preferredVoiceLang,['auto','en','ur'],'auto'),
  messageMode:choice<CommunicationMode>(p.messageMode,['word','sentence'],'sentence'),
  highContrast:p.highContrast===true,audioFeedback:p.audioFeedback!==false,
  signLanguageEnabled:p.signLanguageEnabled===true,emotionSupportEnabled:p.emotionSupportEnabled===true,
  selectedEmotion:choice<SupportedEmotion>(p.selectedEmotion,['none','calm','sad','stressed','uncomfortable','angry','tired'],'none'),
 };
}
export function validateProfiles(value:unknown):UserProfile[] {
 const seen=new Set<string>();
 const profiles:UserProfile[]=[];
 for(const item of Array.isArray(value)?value.slice(0,20):[]){
  const p=record(item),id=text(p.id,80),displayName=text(p.displayName,80);
  if(!id||!displayName||['__proto__','constructor','prototype'].includes(id)||!/^[-a-zA-Z0-9_]+$/.test(id)||seen.has(id))continue;
  seen.add(id);
  profiles.push({id,displayName,ageGroup:choice(p.ageGroup,['child','teen','adult','senior'],'adult'),
   primaryLanguage:choice(p.primaryLanguage,['english','urdu','bilingual'],'bilingual'),
   communicationPreference:choice(p.communicationPreference,['word','sentence'],'sentence'),
   avatarColor:choice(p.avatarColor,['bg-sky-600','bg-emerald-600','bg-violet-700'],'bg-sky-600'),
  });
 }
 return profiles.length?profiles:profilePlaceholders.map(p=>({...p}));
}
// Construct every persisted field explicitly. Runtime messages, transcripts, AI fields,
// usage tracking and old history are intentionally not migrated.
export function validateStoredState(value:unknown):AACStoredState {
 const source=record(value);
 if(source.version!==undefined && ![1,2,3].includes(source.version as number))return validateStoredState({});
 const profiles=validateProfiles(source.profiles);
 const active=profiles.find(p=>p.id===source.activeProfileId)||profiles[0];
 const preferences=validatePreferences(source.preferences);
 if(record(source.preferences).messageMode===undefined)preferences.messageMode=active.communicationPreference;
 const consistentProfiles=profiles.map(p=>p.id===active.id?{...p,communicationPreference:preferences.messageMode!}:p);
 const custom=validCustomPhrases(Array.isArray(source.customPhrases)?source.customPhrases.slice(0,100):[]).map(p=>({
  id:p.id,category:p.category,iconName:p.iconName,labelEnglish:p.labelEnglish,labelUrdu:p.labelUrdu,
  sentenceEnglish:p.sentenceEnglish,sentenceUrdu:p.sentenceUrdu,
  favorite:p.favorite,emergency:p.emergency,quickAccess:p.quickAccess,usageCount:0,isCustom:true,
  ...(p.studio?{studio:{symbolIds:[...p.studio.symbolIds],alternatives:p.studio.alternatives.map(a=>({english:a.english,urdu:a.urdu})),contexts:[...p.studio.contexts],aliases:[...p.studio.aliases]}}:{}),
 }));
 return {...(source.signature!==undefined?{signature:validateSignature(source.signature)}:{}),version:3,profiles:consistentProfiles,activeProfileId:active.id,
  language:active.primaryLanguage==='urdu'?'urdu':'english',preferences,customPhrases:custom,
  phraseHistory:[],frequentlyUsed:{},updatedAt:number(source.updatedAt,0,Number.MAX_SAFE_INTEGER,0)};
}
export interface StoragePort {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export interface LoadResult {state:AACStoredState;error:string|null}
const browserStorage=():StoragePort=>window.localStorage;
export function readStoredState(port?:StoragePort):LoadResult {
 try {
  const storage=port??browserStorage();
  for(const key of [STORAGE_KEY,...LEGACY_STORAGE_KEYS]){
   const raw=storage.getItem(key);
   if(raw!==null){
    if(raw.length>1_000_000)return {state:validateStoredState({}),error:'Saved data was too large; defaults loaded.'};
    try{return {state:validateStoredState(JSON.parse(raw)),error:null};}
    catch{return {state:validateStoredState({}),error:'Saved data was unreadable; defaults loaded.'};}
   }
  }
  return {state:validateStoredState({}),error:null};
 }catch{return {state:validateStoredState({}),error:'Storage is unavailable. Changes will only last in this session.'};}
}
export function loadStoredState():AACStoredState {return readStoredState().state;}
export function saveStoredState(state:Partial<AACStoredState>,port?:StoragePort):boolean {
 try {(port??browserStorage()).setItem(STORAGE_KEY,JSON.stringify(validateStoredState(state)));return true;}catch{return false;}
}
export function removeLegacyState(port?:StoragePort):boolean {
 try {const storage=port??browserStorage();for(const key of LEGACY_STORAGE_KEYS)storage.removeItem(key);return true;}catch{return false;}
}
export function deleteStoredState(port?:StoragePort):boolean {
 let ok=true;
 try {const storage=port??browserStorage();for(const key of [STORAGE_KEY,...LEGACY_STORAGE_KEYS])try{storage.removeItem(key);}catch{ok=false;}}catch{ok=false;}
 return ok;
}

// Cloud documents must already satisfy the schema; unlike local migration, reject
// malformed backups instead of silently replacing a user's settings with defaults.
export function validateBackupState(value:unknown):AACStoredState|null {
 const source=record(value);
 if(source.version===2 && Array.isArray(source.profiles) && source.preferences && typeof source.preferences==='object')return validateStoredState(source);
 if(source.version!==3)return null;
 const normalized=validateStoredState(source);
 const stable=(v:unknown):string=>JSON.stringify(v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(stable(item))]))
  :Array.isArray(v)?v.map(item=>JSON.parse(stable(item))):v);
 try{return stable(source)===stable(normalized)?normalized:null;}catch{return null;}
}
