import { phraseCategories } from '@/data/phrases';
import { useCommunicationStore } from '@/store/communicationStore';
import { getCategoryIcon } from './iconMap';
export function CategoryTabs() {
 const activeCategory=useCommunicationStore(s=>s.activeCategory);
 const setActiveCategory=useCommunicationStore(s=>s.setActiveCategory);
 return <nav aria-label="Phrase categories" className="category-list">{phraseCategories.map(category=>{
   const Icon=getCategoryIcon(category.id);
   return <button type="button" key={category.id} onClick={()=>setActiveCategory(category.id)} aria-pressed={activeCategory===category.id} className="category-button"><Icon aria-hidden="true"/><span>{category.id}<span lang="ur" dir="rtl">{category.labelUrdu}</span></span></button>;
 })}</nav>;
}
