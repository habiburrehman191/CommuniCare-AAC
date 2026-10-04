import type { IntentResolution } from '../../types/intent';
import type { ContextMode, SentenceStyle } from '../signature/types';
import { reviewedVariants, validEquivalentPairs } from '../signature/language';
import { resolveIntent } from '../communication/intentResolver';
/** Sends canonical, non-personal vocabulary IDs only. Local candidates remain visible. */
export async function onlineSuggestions(resolution:IntentResolution,context:ContextMode,style:SentenceStyle,signal:AbortSignal,transport:typeof fetch=fetch){
 if(resolution.status!=='clear'||resolution.intent?.kind==='emergency'||!resolution.canonicalIds?.length||signal.aborted)return [];
 const base=resolveIntent({symbolIds:resolution.canonicalIds});
 if(base.status!=='clear')return [];
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,4000);
 signal.addEventListener('abort',abort,{once:true});
 try{
  const response=await transport('/api/suggestions',{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({symbolIds:resolution.canonicalIds,context,style})});
  if(!response.ok||signal.aborted||controller.signal.aborted)return [];
  const text=await response.text();if(text.length>12000||signal.aborted||controller.signal.aborted)return [];
  const data=JSON.parse(text);if(!data||Object.keys(data).join(',')!=='candidates')return [];
  return validEquivalentPairs(data.candidates,reviewedVariants(base.candidates,base.intent?.negated));
 }catch{return [];}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
