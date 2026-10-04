import type { Phrase } from '../../types/aac';
import type { ContextMode, Personalization } from './types';
export const contextUrdu:Record<ContextMode,string>={Home:'گھر',School:'اسکول',Meal:'کھانا',Medical:'طبی',Social:'سماجی',Travel:'سفر',Emergency:'ایمرجنسی'};
const priorities:Record<ContextMode,string[]>={Home:['Family','Basic Needs','Actions'],School:['Places','Actions','Social'],Meal:['Food and Drink','Basic Needs'],Medical:['Health','Basic Needs','Emergency'],Social:['Social','Emotions','Family'],Travel:['Places','Basic Needs','Family'],Emergency:['Emergency','Health','Basic Needs']};
export const quickIds=['emergency-help','basic-yes','basic-no','actions-stop','basic-bathroom','food-water','health-pain','health-sick'];
export function orderPhrases(phrases:Phrase[],context:ContextMode,personal:Personalization,enabled:boolean):Phrase[]{
 const score=(p:Phrase)=> (p.emergency?1000:0)+(p.studio?.contexts.includes(context)?300:0)+(priorities[context].includes(p.category)?200-priorities[context].indexOf(p.category)*30:0)+(enabled?Math.min(50,personal.counts[p.id]??0)+(personal.recent.includes(p.id)?8-personal.recent.indexOf(p.id):0):0);
 return phrases.map((p,i)=>({p,i})).sort((a,b)=>score(b.p)-score(a.p)||a.i-b.i).map(x=>x.p);
}
