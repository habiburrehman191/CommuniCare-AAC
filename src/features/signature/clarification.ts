import type { IntentResolution, BilingualSentence } from '../../types/intent';
import type { Phrase } from '../../types/aac';
import { resolveIntent } from '../communication/intentResolver';
export interface ClarificationChoice extends BilingualSentence {ids?:string[];action?:'edit'|'symbols'|'cancel'}
export interface ClarificationPlan {question:BilingualSentence;choices:ClarificationChoice[]}
export function clarificationFor(result:IntentResolution,custom:Phrase[]=[]):ClarificationPlan|null{
 if(!['clarification','unsupported'].includes(result.status))return null;
 let ids=result.input.symbolIds;
 const t=(result.input.text??'').normalize('NFKC').toLowerCase().trim().replace(/[.۔!]+$/u,'');
 const incomplete:Record<string,string[]>={'go':['actions-go'],'i want to go':['actions-go'],'jana hai':['actions-go'],'مجھے جانا ہے':['actions-go'],'call':['actions-call'],'call someone':['actions-call'],'kisi ko bulao':['actions-call'],'کسی کو بلائیں':['actions-call'],'hot and cold':['health-hot','health-cold'],'water and pain':['food-water','health-pain'],'water pain':['food-water','health-pain'],'گرمی اور سردی':['health-hot','health-cold']};
 if(!ids.length&&Object.hasOwn(incomplete,t))ids=incomplete[t];
 const make=(chosen:string[]):ClarificationChoice|null=>{const r=resolveIntent({symbolIds:chosen},custom);return r.status==='clear'?{english:r.candidates[0].english,urdu:r.candidates[0].urdu,ids:chosen}:null;};
 const cancel:ClarificationChoice={english:'Cancel clarification',urdu:'وضاحت منسوخ کریں',action:'cancel'};
 if(ids.length===1&&ids[0]==='actions-go')return {question:{english:'Where would you like to go?',urdu:'آپ کہاں جانا چاہتے ہیں؟'},choices:[...['places-home','places-school','places-outside','health-hospital'].map(id=>make(['actions-go',id])).filter((p):p is ClarificationChoice=>p!==null),cancel]};
 if(ids.length===1&&ids[0]==='actions-call')return {question:{english:'Who would you like to call?',urdu:'آپ کس کو بلانا چاہتے ہیں؟'},choices:[...['family-mother','family-father','family-caregiver'].map(id=>make(['actions-call',id])).filter((p):p is ClarificationChoice=>p!==null),cancel]};
 if(ids.includes('basic-more')&&ids.includes('basic-less'))return {question:{english:'Would you like more or less?',urdu:'آپ کو زیادہ چاہیے یا کم؟'},choices:[make(ids.filter(id=>id!=='basic-less')),make(ids.filter(id=>id!=='basic-more'))].filter((p):p is ClarificationChoice=>p!==null).concat(cancel)};
 if(ids.includes('basic-yes')&&ids.includes('basic-no'))return {question:{english:'Do you mean yes or no?',urdu:'آپ کا مطلب ہاں ہے یا نہیں؟'},choices:[make(['basic-yes'])!,make(['basic-no'])!,cancel]};
 const core=ids.filter(id=>!['basic-and','basic-with','basic-at','basic-not','basic-no','basic-more','basic-less','basic-now','basic-very','social-please'].includes(id));
 const choices=core.slice(0,4).map(id=>make(ids.includes('basic-not')||ids.includes('basic-no')?['basic-not',id]:[id])).filter((p):p is ClarificationChoice=>p!==null);
 const together=make([...ids.filter(id=>id!=='basic-and'),'basic-and']);if(together)choices.unshift(together);
 if(choices.length)return {question:{english:'Which complete message do you mean? Choose only what you want to say.',urdu:'آپ کا مطلب کون سا مکمل پیغام ہے؟ صرف اپنا مطلوبہ پیغام منتخب کریں۔'},choices:[...choices,cancel]};
 return {question:{english:'I could not confirm this meaning. How would you like to clarify it?',urdu:'مطلب واضح نہیں ہوا۔ آپ اسے کیسے واضح کرنا چاہتے ہیں؟'},choices:[{english:'Edit my words',urdu:'میرے الفاظ درست کریں',action:'edit'},{english:'Choose symbols',urdu:'علامات منتخب کریں',action:'symbols'},cancel]};
}
