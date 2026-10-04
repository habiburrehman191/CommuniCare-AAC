import { useState } from 'react';
import { Pencil, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { initialPhrases } from '@/data/phrases';
import { phraseCategoryIds } from '@/types/aac';
import type { Phrase } from '@/types';
import type { BilingualSentence } from '@/types/intent';
import { resolveIntent, validCustomPhrases } from '@/features/communication/intentResolver';
import { reviewedVariants } from '@/features/signature/language';
import { contexts } from '@/features/signature/types';
import type { ContextMode } from '@/features/signature/types';
import { contextUrdu } from '@/features/signature/context';
import { useCommunicationStore } from '@/store/communicationStore';
import { iconMap } from './iconMap';

export function CaregiverPhraseStudio(){
 const custom=useCommunicationStore(s=>s.customPhrases);
 const [editing,setEditing]=useState<string|null>(null),[labelEn,setLabelEn]=useState(''),[labelUr,setLabelUr]=useState('');
 const [ids,setIds]=useState<string[]>(['food-water']),[icon,setIcon]=useState('Droplets'),[category,setCategory]=useState<Phrase['category']>('Food and Drink');
 const [situations,setSituations]=useState<ContextMode[]>(['Meal']),[emergency,setEmergency]=useState(false),[aliases,setAliases]=useState('');
 const [pairs,setPairs]=useState<BilingualSentence[]>(resolveIntent({symbolIds:['food-water']}).candidates.map(({english,urdu})=>({english,urdu})));
 const [reviewed,setReviewed]=useState(false),[notice,setNotice]=useState('');
 const meaning=resolveIntent({symbolIds:ids}),allowed=reviewedVariants(meaning.candidates,meaning.intent?.negated);
 const reset=()=>{setEditing(null);setLabelEn('');setLabelUr('');setIds(['food-water']);setIcon('Droplets');setCategory('Food and Drink');setSituations(['Meal']);setEmergency(false);setAliases('');setPairs(resolveIntent({symbolIds:['food-water']}).candidates.map(({english,urdu})=>({english,urdu})));setReviewed(false);};
 const edit=(p:Phrase)=>{setEditing(p.id);setLabelEn(p.labelEnglish);setLabelUr(p.labelUrdu);const found=initialPhrases.find(x=>x.sentenceEnglish===p.sentenceEnglish&&x.sentenceUrdu===p.sentenceUrdu);setIds(p.studio?.symbolIds??[found?.id??'food-water']);setIcon(p.iconName);setCategory(p.category);setSituations(p.studio?.contexts??[]);setEmergency(p.emergency);setAliases((p.studio?.aliases??[]).join('\n'));setPairs(p.studio?.alternatives??[{english:p.sentenceEnglish,urdu:p.sentenceUrdu}]);setReviewed(false);setNotice('Review all fields before saving changes.');};
 return <div className="phrase-studio"><div className="studio-heading"><div><span className="eyebrow">CAREGIVER TOOLS</span><h2>Caregiver Phrase Studio</h2><h3>Custom symbols</h3></div><Pencil aria-hidden="true"/></div>
 <p>Create familiar symbols with explicit meaning. Review both languages and every alias. Novel facts or unverified translations cannot be saved.</p>
 <form className="studio-form" onChangeCapture={()=>setReviewed(false)} onSubmit={e=>{
  e.preventDefault();if(!reviewed)return;
  const first=pairs[0];if(!first){setNotice('Add a reviewed bilingual alternative.');return;}
  const phrase:Phrase={id:editing??'custom-'+crypto.randomUUID(),labelEnglish:labelEn.trim(),labelUrdu:labelUr.trim(),iconName:icon,category,sentenceEnglish:first.english,sentenceUrdu:first.urdu,isCustom:true,emergency,quickAccess:emergency,favorite:false,usageCount:0,studio:{symbolIds:ids,alternatives:pairs,contexts:situations,aliases:aliases.split('\n').map(a=>a.trim()).filter(Boolean)}};
  if(!validCustomPhrases([phrase]).length){setNotice('Not saved. Choose a clear semantic meaning and use equivalent reviewed bilingual wording; check labels and aliases.');return;}
  const state=useCommunicationStore.getState();if(!editing&&state.customPhrases.length>=100){setNotice('The 100-symbol limit is reached. Remove a symbol first.');return;}
  state.saveStudioPhrase(phrase);setNotice(editing?'Reviewed symbol updated.':'Custom symbol added to '+category+'.');reset();
 }}>
 <div className="studio-grid"><label className="setting-field">English symbol label<input required maxLength={80} value={labelEn} onChange={e=>setLabelEn(e.target.value)}/></label><label className="setting-field">Urdu symbol label<input required maxLength={80} lang="ur" dir="rtl" value={labelUr} onChange={e=>setLabelUr(e.target.value)}/></label>
 <label className="setting-field">Icon / symbol<select value={icon} onChange={e=>setIcon(e.target.value)}>{Object.keys(iconMap).map(name=><option key={name}>{name}</option>)}</select></label>
 <label className="setting-field">Category<select value={category} onChange={e=>setCategory(e.target.value as Phrase['category'])}>{phraseCategoryIds.map(c=><option key={c}>{c}</option>)}</select></label></div>
 <label className="setting-field">Semantic intent — choose every required symbol<select multiple value={ids} size={7} onChange={e=>{const selected=Array.from(e.target.selectedOptions).map(o=>o.value);setIds(selected);const r=resolveIntent({symbolIds:selected});setPairs(r.candidates.map(({english,urdu})=>({english,urdu})));}}>{initialPhrases.map(p=><option key={p.id} value={p.id}>{p.labelEnglish} · {p.labelUrdu}</option>)}</select></label>
 <p className="quiet-hint">Use your device’s multiple-selection gesture or Ctrl/Command to combine symbols. Include Not, With, At or And when those relationships are intended.</p>
 {meaning.status!=='clear'&&<p role="status" className="clarification">This meaning needs clarification before it can be saved. یہ مطلب محفوظ کرنے سے پہلے واضح کریں۔</p>}
 <fieldset className="studio-contexts"><legend>Situations</legend>{contexts.map(c=><label key={c}><input type="checkbox" checked={situations.includes(c)} onChange={e=>setSituations(e.target.checked?[...situations,c]:situations.filter(x=>x!==c))}/><span>{c}</span><span lang="ur" dir="rtl">{contextUrdu[c]}</span></label>)}</fieldset>
 <div className="reviewed-alternatives"><h3>Reviewed bilingual alternatives · up to 3</h3><p>Use the reviewed wording selector or edit an equivalent pair. Validation rejects changed facts, negation and unverified wording.</p>{pairs.map((pair,i)=><div className="studio-alternative" key={i}><label className="setting-field">Reviewed message {i+1}<select value={allowed.findIndex(p=>p.english===pair.english&&p.urdu===pair.urdu)} onChange={e=>setPairs(pairs.map((p,j)=>i===j?allowed[Number(e.target.value)]:p))}><option value={-1} disabled>Edited wording — requires validation</option>{allowed.map((p,j)=><option value={j} key={j}>{p.english}</option>)}</select></label><div className="studio-grid"><label className="setting-field">English alternative {i+1}<textarea required value={pair.english} onChange={e=>setPairs(pairs.map((p,j)=>j===i?{...p,english:e.target.value}:p))}/></label><label className="setting-field">Urdu alternative {i+1}<textarea required lang="ur" dir="rtl" value={pair.urdu} onChange={e=>setPairs(pairs.map((p,j)=>j===i?{...p,urdu:e.target.value}:p))}/></label></div><button className="action-button" type="button" onClick={()=>{setReviewed(false);setPairs(pairs.filter((_,j)=>j!==i));}}>Remove alternative {i+1}</button></div>)}
 <button type="button" className="action-button" disabled={pairs.length>=3||!allowed.length} onClick={()=>{setReviewed(false);setPairs([...pairs,allowed.find(a=>!pairs.some(p=>p.english===a.english&&p.urdu===a.urdu))??allowed[0]]);}}><Plus aria-hidden="true"/>Add alternative</button></div>
 <label className="setting-field">Aliases, including Roman Urdu · one per line<textarea maxLength={1200} rows={3} value={aliases} onChange={e=>setAliases(e.target.value)}/></label>
 <p className="quiet-hint">Up to 12 exact aliases. Every alias must mean the selected intent. Known conflicting meanings require clarification; aliases never run UI commands from typed text.</p>
 <label className="toggle-row"><span><strong>Emergency priority</strong><span>Prioritize this symbol. This does not add urgency to the spoken sentence.</span></span><input type="checkbox" checked={emergency} onChange={e=>setEmergency(e.target.checked)}/></label>
 <label className="review-confirm"><input required type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>I reviewed the intent, English/Urdu alternatives and every alias with the communicator.</span></label>
 <div className="action-row"><button className="action-button primary-button" disabled={!reviewed||meaning.status!=='clear'} type="submit"><CheckCircle2 aria-hidden="true"/>{editing?'Save reviewed changes':'Add custom symbol'}</button>{editing&&<button className="action-button" type="button" onClick={reset}>Cancel edit</button>}</div>
 </form>{notice&&<p role="status" className="notice">{notice}</p>}
 <div className="studio-library">{custom.map(p=><article key={p.id}><div><h3>{p.labelEnglish}</h3><p lang="ur" dir="rtl">{p.labelUrdu}</p><span className="quiet-hint">{p.category}</span></div><div className="action-row"><button className="action-button" type="button" onClick={()=>edit(p)}><Pencil aria-hidden="true"/>Edit {p.labelEnglish}</button><button className="action-button danger-outline" type="button" onClick={()=>{useCommunicationStore.getState().deleteCustomPhrase(p.id);if(editing===p.id)reset();setNotice('Custom symbol removed.');}}><Trash2 aria-hidden="true"/>Remove custom symbol {p.labelEnglish}</button></div></article>)}</div>
 </div>;
}
