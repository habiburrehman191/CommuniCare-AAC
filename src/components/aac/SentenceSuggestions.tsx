import { Check, Circle } from 'lucide-react';
import type { IntentResolution } from '@/types/intent';
interface Props {resolution: IntentResolution; selectedId: string | null; disabled: boolean; onSelect: (id:string)=>void}
export function SentenceSuggestions({resolution,selectedId,disabled,onSelect}:Props) {
 return <section className="sentence-section" aria-labelledby="sentence-title">
   <div className="section-heading"><h2 id="sentence-title" tabIndex={-1}>Choose your sentence</h2><p>Select a card, then press Speak.</p></div>
   {resolution.clarification && <div className="clarification" role="status"><p>{resolution.clarification.english}</p><p lang="ur" dir="rtl">{resolution.clarification.urdu}</p></div>}
   {resolution.status==='empty' && <p className="quiet-hint">Your sentence choices will appear here after you speak, type, or choose symbols.</p>}
   <div className="sentence-grid">{resolution.candidates.map((candidate,index)=><button key={candidate.id} type="button" aria-pressed={selectedId===candidate.id} disabled={disabled} onClick={()=>onSelect(candidate.id)} className="sentence-card">
    <span className="candidate-number" aria-hidden="true">0{index+1}</span><span className="sentence-state">{selectedId===candidate.id ? <><Check aria-hidden="true"/>Selected</> : <><Circle aria-hidden="true"/>Choose sentence</>}</span>
    {candidate.source==='gemini'&&<span className="refined-label">Refined wording</span>}<span className="sentence-english" lang="en">{candidate.english}</span><span className="sentence-urdu" lang="ur" dir="rtl">{candidate.urdu}</span>
   </button>)}</div>
   {selectedId && <a className="action-button sentence-jump" href="#message-title">Go to Speak</a>}
 </section>;
}
