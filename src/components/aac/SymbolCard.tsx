import { createElement } from 'react';
import { Check } from 'lucide-react';
import type { Phrase } from '@/types';
import { getPhraseIcon } from './iconMap';
interface Props { phrase: Phrase; onSelect: (phrase: Phrase) => void; isSelected: boolean }
export function SymbolCard({phrase,onSelect,isSelected}: Props) {
 const Icon=getPhraseIcon(phrase.iconName,phrase.id);
 return <button type="button" onClick={()=>onSelect(phrase)} aria-label={`${isSelected?'Remove':'Select'} ${phrase.labelEnglish}. ${phrase.labelUrdu}`} aria-pressed={isSelected} className="symbol-card" data-category={phrase.category}>
   <span className="symbol-icon">{createElement(Icon, {'aria-hidden':true})}</span>
   {isSelected && <Check className="selection-check" aria-hidden="true"/>}
   <span className="symbol-english">{phrase.labelEnglish}</span>
   <span className="symbol-urdu" lang="ur" dir="rtl">{phrase.labelUrdu}</span>
 </button>;
}
