import type { IntentResolution } from '@/types/intent';
import { createElement } from 'react';
import { Home, School, Utensils, Stethoscope, MessageCircle, Navigation, ShieldAlert, Sparkles, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCommunicationStore } from '@/store/communicationStore';
import { contexts, emptyPersonalization } from '@/features/signature/types';
import type { ContextMode } from '@/features/signature/types';
import { contextUrdu, quickIds, orderPhrases } from '@/features/signature/context';
import { clarificationFor } from '@/features/signature/clarification';
import { initialPhrases } from '@/data/phrases';
import { getPhraseIcon } from './iconMap';
const contextIcons={Home,School,Meal:Utensils,Medical:Stethoscope,Social:MessageCircle,Travel:Navigation,Emergency:ShieldAlert};
export function ContextSwitcher(){
 const signature=useCommunicationStore(s=>s.signature),profile=useCommunicationStore(s=>s.activeProfile?.id);
 const context=(signature.profiles[profile??'default']??emptyPersonalization()).context;
 return <label className="context-switcher">{createElement(contextIcons[context],{'aria-hidden':true})}<span className="sr-only">Current situation</span><select aria-label="Current situation" value={context} onChange={e=>useCommunicationStore.getState().setContext(e.target.value as ContextMode)}>{contexts.map(c=><option key={c} value={c}>{c} · {contextUrdu[c]}</option>)}</select></label>;
}
export function QuickCommunication(){
 const confirm=useCommunicationStore(s=>s.confirmMeaning);
 return <section className="quick-communication" aria-label="Quick communication"><div className="quick-title"><Sparkles aria-hidden="true"/><span>Always within reach</span></div><div className="quick-grid">{quickIds.map(id=>{const p=initialPhrases.find(p=>p.id===id)!;return <button type="button" className="quick-action" key={id} onClick={()=>confirm([id])} aria-label={'Quick '+p.labelEnglish}>{createElement(getPhraseIcon(p.iconName,p.id),{'aria-hidden':true})}<span>{p.labelEnglish}</span><span lang="ur" dir="rtl">{p.labelUrdu}</span></button>})}<Link className="quick-action quick-sos" to="/emergency"><ShieldAlert aria-hidden="true"/><span>Emergency</span><span lang="ur" dir="rtl">ایمرجنسی</span></Link></div></section>;
}
export function ContextRecommendations(){
 const s=useCommunicationStore(),p=s.signature.profiles[s.activeProfile?.id??'default']??emptyPersonalization();
 const candidates=orderPhrases([...initialPhrases,...s.customPhrases].filter(x=>p.context==='Emergency'||!x.emergency),p.context,p,s.signature.enabled).slice(0,5);
 return <div className="context-recommendations"><p><span className="eyebrow">YOUR SITUATION</span><strong>{p.context} <span lang="ur" dir="rtl">{contextUrdu[p.context]}</span></strong></p><div>{candidates.map(phrase=><button key={phrase.id} type="button" onClick={()=>s.confirmMeaning([phrase.id])}>{createElement(getPhraseIcon(phrase.iconName,phrase.id),{'aria-hidden':true})}<span>{phrase.labelEnglish}</span></button>)}</div></div>;
}
export function SmartClarification({resolution:provided}:{resolution?:IntentResolution}){
 const current=useCommunicationStore(s=>s.resolution),custom=useCommunicationStore(s=>s.customPhrases);
 const generatedMessage=useCommunicationStore(s=>s.generatedMessage);
 if(generatedMessage?.sourceLanguage)return null;
 const resolution=provided??current;
 const plan=clarificationFor(resolution,custom);
 if(!plan)return null;
 return <section className="smart-clarification sentence-section" aria-labelledby="sentence-title"><span className="eyebrow">LET’S MAKE IT CLEAR</span><h2 id="sentence-title" tabIndex={-1}>{plan.question.english}</h2><p className="clarification-urdu" lang="ur" dir="rtl">{plan.question.urdu}</p><div className="clarification-options">{plan.choices.map((choice,i)=><button className="clarification-choice" type="button" key={i} onClick={()=>{
  if(choice.ids)useCommunicationStore.getState().confirmMeaning(choice.ids);
  else if(choice.action==='cancel')useCommunicationStore.getState().clearSelection();
  else if(choice.action==='edit')document.querySelector<HTMLTextAreaElement>('.correction-field textarea')?.focus();
  else{useCommunicationStore.getState().clearSelection();document.getElementById('symbols-title')?.focus();}
 }}><span>{choice.action==='cancel'&&<ArrowLeft aria-hidden="true"/>}{choice.english}</span><span lang="ur" dir="rtl">{choice.urdu}</span></button>)}</div></section>;
}
