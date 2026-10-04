import type { BilingualSentence } from '../types/intent';
export type ConceptKind = 'request' | 'state' | 'activity' | 'destination' | 'person' | 'social' | 'emergency' | 'operator' | 'location';
export interface IntentDefinition {
  kind: ConceptKind;
  en: string;
  ur: string;
  positive: BilingualSentence[];
  negative?: BilingualSentence[];
}
const pairs = (rows: [string, string][]): BilingualSentence[] => rows.map(([english, urdu]) => ({english, urdu}));
const request = (en: string, ur: string): IntentDefinition => ({kind: 'request', en, ur,
  positive: pairs([[`I need ${en}.`, `مجھے ${ur} چاہیے۔`], [`I am asking for ${en}.`, `میری درخواست ${ur} کے لیے ہے۔`], [`My request is for ${en}.`, `${ur} کے لیے میری درخواست ہے۔`]]),
  negative: pairs([[`I do not want ${en}.`, `مجھے ${ur} نہیں چاہیے۔`], [`I am refusing ${en}.`, `مجھے ${ur} قبول نہیں۔`], [`I do not wish to have ${en}.`, `میری خواہش ${ur} لینے کی نہیں ہے۔`]])});
const person = (en: string, ur: string): IntentDefinition => ({kind:'person',en,ur,
  positive:pairs([[`I need ${en}.`,`مجھے ${ur} کی ضرورت ہے۔`]]),
  negative:[]});
const activity = (en: string, ur: string): IntentDefinition => ({kind: 'activity', en, ur,
  positive: pairs([[`I want to ${en}.`, `مجھے ${ur} ہے۔`], [`I would like to ${en}.`, `میری خواہش ${ur} ہے۔`], [`My wish is to ${en}.`, `${ur} میری خواہش ہے۔`]]),
  negative: pairs([[`I do not want to ${en}.`, `مجھے ${ur} نہیں ہے۔`], [`I do not wish to ${en}.`, `میری خواہش ${ur} نہیں ہے۔`], [`It is not my wish to ${en}.`, `${ur} میری خواہش نہیں ہے۔`]])});
const state = (en: string, ur: string, negEn: string, negUr: string): IntentDefinition => ({kind:'state',en,ur,positive:pairs([[en,ur]]),negative:pairs([[negEn,negUr]])});
const fixed = (kind: ConceptKind, rows: [string,string][]): IntentDefinition => ({kind,en:'',ur:'',positive:pairs(rows)});
const operator = (): IntentDefinition => ({kind:'operator',en:'',ur:'',positive:[]});
/** Sole authored sentence source. Phrase assets derive their compatibility sentences here. */
export const intents: Record<string, IntentDefinition> = {
 'basic-yes': fixed('social', [['Yes, that is what I want.','جی ہاں، مجھے یہی چاہیے۔']]),
 'basic-no': fixed('social', [['No, I do not want that.','نہیں، مجھے یہ نہیں چاہیے۔']]),
 'basic-bathroom': {...activity('use the bathroom','باتھ روم استعمال کرنا'), kind:'request'},
 'food-water': request('water','پانی'),
 'food-hungry': request('food','کھانا'),
 'food-juice': request('juice','جوس'),
 'health-medicine': request('my medicine','اپنی دوا'),
 'health-doctor': {...activity('see a doctor','ڈاکٹر سے ملنا'),kind:'person',en:'a doctor',ur:'ڈاکٹر'},
 'health-hospital': {...activity('go to the hospital','ہسپتال جانا'),kind:'destination',en:'to the hospital',ur:'ہسپتال'},
 'health-pain': state('I am in pain.','مجھے درد ہے۔','I am not in pain.','مجھے درد نہیں ہے۔'),
 'health-headache': fixed('state', [['I have a headache.','میرے سر میں درد ہے۔'],['My head hurts.','میرے سر میں درد ہو رہا ہے۔'],['I feel pain in my head.','مجھے سر میں درد محسوس ہو رہا ہے۔']]),
 'health-stomach-pain': state('My stomach hurts.','میرے پیٹ میں درد ہے۔','My stomach does not hurt.','میرے پیٹ میں درد نہیں ہے۔'),
 'health-sick': state('I feel unwell.','میری طبیعت خراب ہے۔','I do not feel unwell.','میری طبیعت خراب نہیں ہے۔'),
 'health-hot': state('I feel hot.','مجھے گرمی لگ رہی ہے۔','I do not feel hot.','مجھے گرمی نہیں لگ رہی ہے۔'),
 'health-cold': state('I feel cold.','مجھے سردی لگ رہی ہے۔','I do not feel cold.','مجھے سردی نہیں لگ رہی ہے۔'),
 'health-head': {kind:'location',en:'head',ur:'سر',positive:[]},
 'health-stomach': {kind:'location',en:'stomach',ur:'پیٹ',positive:[]},
 'emotions-happy': state('I feel happy.','میں خوش ہوں۔','I do not feel happy.','میں خوش نہیں ہوں۔'),
 'emotions-sad': state('I feel sad.','میں اداس ہوں۔','I do not feel sad.','میں اداس نہیں ہوں۔'),
 'emotions-scared': state('I feel scared.','مجھے ڈر لگ رہا ہے۔','I do not feel scared.','مجھے ڈر نہیں لگ رہا ہے۔'),
 'emotions-angry': state('I feel angry.','مجھے غصہ آ رہا ہے۔','I do not feel angry.','مجھے غصہ نہیں آ رہا ہے۔'),
 'emotions-tired': state('I feel tired.','مجھے تھکن محسوس ہو رہی ہے۔','I do not feel tired.','مجھے تھکن محسوس نہیں ہو رہی ہے۔'),
 'basic-comfort': request('comfort','تسلی'),
 'basic-rest': {...activity('rest','آرام کرنا'),kind:'request'},
 'places-home': {...activity('go home','گھر جانا'),kind:'destination',en:'home',ur:'گھر'},
 'places-school': {...activity('go to school','اسکول جانا'),kind:'destination',en:'to school',ur:'اسکول'},
 'places-outside': {...activity('go outside','باہر جانا'),kind:'destination',en:'outside',ur:'باہر'},
 'family-mother': person('my mother','امی'),
 'family-father': person('my father','ابو'),
 'family-caregiver': person('my caregiver','میرے نگہداشت کرنے والے'),
 'actions-sleep': activity('sleep','سونا'),
 'actions-play': activity('play','کھیلنا'),
 'actions-eat': activity('eat','کھانا کھانا'),
 'actions-drink': activity('drink','کچھ پینا'),
 'actions-go': operator(), 'actions-call': operator(),
 'actions-stop': fixed('social', [['Please stop.','براہ کرم رک جائیں۔']]),
 'social-hello': fixed('social', [['Hello, it is nice to see you.','سلام، آپ سے مل کر خوشی ہوئی۔']]),
 'social-thanks': fixed('social', [['Thank you.','آپ کا شکریہ۔']]),
 'social-goodbye': fixed('social', [['Goodbye, see you later.','خدا حافظ، بعد میں ملتے ہیں۔']]),
 'emergency-help': fixed('emergency', [['I need help now.','مجھے ابھی مدد چاہیے۔'],['I require help immediately.','مجھے فوری مدد کی ضرورت ہے۔'],['My need for help is immediate.','مجھے مدد کی ضرورت ابھی ہے۔']]),
 'emergency-breathe': state('I am having trouble breathing.','مجھے سانس لینے میں مشکل ہو رہی ہے۔','I am not having trouble breathing.','مجھے سانس لینے میں مشکل نہیں ہو رہی ہے۔'),
 'emergency-family': fixed('emergency', [['Please call my family immediately.','براہ کرم فوراً میرے خاندان کو بلائیں۔']]),
 'basic-not': operator(), 'basic-more': operator(), 'basic-less': operator(),
 'basic-now': operator(), 'basic-very': operator(), 'social-please': operator(),
 'basic-and': operator(), 'basic-with': operator(), 'basic-at': operator(),
};
intents['health-headache'].negative = pairs([['I do not have a headache.','میرے سر میں درد نہیں ہے۔']]);
