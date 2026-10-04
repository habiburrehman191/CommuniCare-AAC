import { contexts, defaultSignature, emptyPersonalization, validateSignature } from '@/features/signature/types';
import type { ContextMode, SignatureState, SentenceStyle } from '@/features/signature/types';
import { reviewedVariants, validEquivalentPairs, styledCandidates } from '@/features/signature/language';
import { initialPhrases } from '@/data/phrases';
import { create } from 'zustand';
import type {
  AACStoredState,
  CommunicationMode,
  GeneratedMessage,
  IntentResolution,
  HistoryItem,
  Phrase,
  PhraseCategory,
  SelectedSymbol,
  StoredPreferences,
  SyncStatus,
  UserProfile,
} from '@/types';
import { profilePlaceholders } from '@/data/profiles';
import { defaultPreferences, validateStoredState, validateProfiles, validatePreferences } from '@/lib/storage';
import { resolveVoiceInput } from '@/features/communication/voiceInput';
import { generateSentenceCandidates } from '@/features/suggestions';

interface CommunicationState {
  signature:SignatureState;
  setContext:(context:ContextMode)=>void;
  setSentenceStyle:(style:SentenceStyle)=>void;
  setPersonalizationEnabled:(enabled:boolean)=>void;
  resetPersonalization:()=>void;
  setAIEnabled:(enabled:boolean)=>void;
  applyEnhanced:(expected:IntentResolution,pairs:unknown)=>void;
  confirmMeaning:(ids:string[])=>void;
  saveStudioPhrase:(phrase:Phrase)=>void;
  // AAC Board Core State
  selectedSymbols: SelectedSymbol[];
  communicationText: string;
  setCommunicationText: (text: string) => void;
  activeCategory: PhraseCategory;
  communicationMode: CommunicationMode;
  generatedMessage: GeneratedMessage | null;
  resolution: IntentResolution;
  selectedCandidateId: string | null;
  selectCandidate: (id: string) => void;
  confirmExactText: (language: 'en' | 'ur') => void;
  applyPslMessage: (englishText: string, urduText: string) => void;

  // Profiles & User State
  activeProfile: UserProfile | null;
  profiles: UserProfile[];

  // Analytics & History
  phraseUsageCounts: Record<string, number>;
  phraseHistory: HistoryItem[];
  customPhrases: Phrase[];

  // Preferences & Sync
  preferences: StoredPreferences;
  syncStatus: SyncStatus;

  // Actions
  selectSymbol: (phrase: Phrase) => void;
  removeSymbol: (phraseId: string) => void;
  removeLastSymbol: () => void;
  clearSelection: () => void;
  setActiveCategory: (category: PhraseCategory) => void;
  setCommunicationMode: (mode: CommunicationMode) => void;
  generateMessage: () => void;

  setActiveProfile: (profile: UserProfile) => void;
  setProfiles: (profiles: UserProfile[]) => void;
  recordPhraseUsage: (phraseId: string) => void;
  addHistoryItem: (item: HistoryItem) => void;
  clearHistory: () => void;
  addCustomPhrase: (phrase: Phrase) => void;
  deleteCustomPhrase: (phraseId: string) => void;
  updatePreferences: (prefs: Partial<StoredPreferences>) => void;
  setSyncStatus: (status: SyncStatus) => void;

  initFromStoredState: (state: AACStoredState) => void;
  getFullStoredState: () => AACStoredState;
}

const createSelectedSymbol = (phrase: Phrase): SelectedSymbol => ({
  selectionId: `${phrase.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
  phraseId: phrase.id,
  category: phrase.category,
  iconName: phrase.iconName,
  labelEnglish: phrase.labelEnglish,
  labelUrdu: phrase.labelUrdu,
  sentenceEnglish: phrase.sentenceEnglish,
  sentenceUrdu: phrase.sentenceUrdu,
  selectedAt: new Date().toISOString(),
});

const withResolvedInput = (
  selectedSymbols: SelectedSymbol[],
  _communicationMode: CommunicationMode,
  customPhrases: Phrase[] = [],
  communicationText = '',
) => {
  const current=useCommunicationStore.getState();
  const personal=current.signature.profiles[current.activeProfile?.id??'default']??emptyPersonalization();
  const style=personal.style==='direct'&&personal.context==='Social'?'polite':personal.style;
  const resolution=communicationText.trim()?resolveVoiceInput(communicationText,customPhrases):generateSentenceCandidates({symbolIds:selectedSymbols.map(s=>s.phraseId)},customPhrases);
  return {selectedSymbols,communicationText,resolution:style==='direct'?resolution:{...resolution,candidates:styledCandidates(resolution,style)},selectedCandidateId:null,generatedMessage:null};
};

export const useCommunicationStore = create<CommunicationState>((set, get, api) => {
  api.getInitialState = () => get();
  return {

  saveStudioPhrase:(phrase)=>set(state=>{
    const checked=validateStoredState({customPhrases:[phrase]}).customPhrases[0];if(!checked)return {};
    const exists=state.customPhrases.some(p=>p.id===checked.id);if(!exists&&state.customPhrases.length>=100)return {};
    const customPhrases=exists?state.customPhrases.map(p=>p.id===checked.id?checked:p):[...state.customPhrases,checked];
    return {customPhrases,...withResolvedInput(state.selectedSymbols,state.communicationMode,customPhrases,state.communicationText)};
  }),
  signature:defaultSignature(),
  setContext:(context)=>set(state=>{
    if(!contexts.includes(context))return {};
    const id=state.activeProfile?.id??'default',p=state.signature.profiles[id]??emptyPersonalization();
    return {signature:{...state.signature,profiles:{...state.signature.profiles,[id]:{...p,context}}},...(!state.selectedCandidateId&&state.resolution.status==='clear'?{resolution:{...state.resolution,candidates:styledCandidates(generateSentenceCandidates({symbolIds:state.resolution.canonicalIds??[]}),p.style==='direct'&&context==='Social'?'polite':p.style)}}:{})};
  }),
  setSentenceStyle:(style)=>set(state=>{
    if(!['direct','polite','urgent'].includes(style))return {};
    const id=state.activeProfile?.id??'default',p=state.signature.profiles[id]??emptyPersonalization();
    return {signature:{...state.signature,profiles:{...state.signature.profiles,[id]:{...p,style}}},...(!state.selectedCandidateId&&state.resolution.status==='clear'?{resolution:{...state.resolution,candidates:styledCandidates(state.resolution,style)}}:{})};
  }),
  setPersonalizationEnabled:(enabled)=>set(state=>({signature:{...state.signature,enabled}})),
  resetPersonalization:()=>set(state=>({signature:{...state.signature,profiles:Object.fromEntries(Object.entries(state.signature.profiles).map(([id,p])=>[id,{...emptyPersonalization(),context:p.context}]))}})),
  setAIEnabled:(aiEnabled)=>set(state=>({signature:{...state.signature,aiEnabled}})),
  applyEnhanced:(expected,pairs)=>set(state=>{
    if(state.resolution!==expected||state.selectedCandidateId||expected.status!=='clear'||!expected.intent)return {};
    const base=generateSentenceCandidates({symbolIds:expected.canonicalIds??[]});
    const accepted=validEquivalentPairs(pairs,reviewedVariants(base.candidates,base.intent?.negated));
    if(!accepted.length)return {};
    const local=expected.candidates;
    const novel=accepted.filter(p=>!local.some(c=>c.english===p.english&&c.urdu===p.urdu));
    if(!novel.length)return {};
    return {resolution:{...expected,candidates:[...novel.map((p,i)=>({...p,id:local[0].intentKey+':ai:'+i,intentKey:local[0].intentKey,source:'gemini' as const})),...local].slice(0,3)}};
  }),
  confirmMeaning:(ids)=>set(state=>{
    const next=generateSentenceCandidates({symbolIds:ids},state.customPhrases);
    if(next.status!=='clear')return {};
    const phrases=[...initialPhrases,...state.customPhrases];
    return {...withResolvedInput(ids.map(id=>phrases.find(p=>p.id===id)).filter((p):p is Phrase=>!!p).map(createSelectedSymbol),state.communicationMode,state.customPhrases)};
  }),

  selectedSymbols: [],
  communicationText: '',
  setCommunicationText: (text) => set(state => withResolvedInput([], state.communicationMode, state.customPhrases, text)),
  activeCategory: 'Basic Needs',
  communicationMode: 'sentence',
  generatedMessage: null,
  resolution: generateSentenceCandidates({symbolIds: []}),
  selectedCandidateId: null,
  selectCandidate: (id) => set((state) => {
    const candidate = state.resolution.candidates.find(c => c.id === id);
    const message = candidate ? {id, selectedPhraseIds:state.selectedSymbols.map(s => s.phraseId), englishText:candidate.english, urduText:candidate.urdu, mode:state.communicationMode, createdAt:new Date().toISOString()} : null;
    if(!message)return {};
    const profile=state.activeProfile?.id??'default',personal=state.signature.profiles[profile]??emptyPersonalization();
    const ids=state.selectedSymbols.length?state.selectedSymbols.map(s=>s.phraseId):(state.resolution.canonicalIds??[]);
    const counts={...personal.counts};if(state.signature.enabled)for(const symbol of ids)counts[symbol]=Math.min(1000,(counts[symbol]??0)+1);
    const recent=state.signature.enabled?[...new Set([...ids,...personal.recent])].slice(0,8):personal.recent;
    return {selectedCandidateId:id,generatedMessage:message,signature:validateSignature({...state.signature,profiles:{...state.signature.profiles,[profile]:{...personal,counts,recent,style:state.signature.enabled?(candidate?.style??(candidate?.english.startsWith('Please')?'polite':personal.style)):personal.style}}})};
  }),
  confirmExactText: (language) => set((state) => {
    const text = state.communicationText.trim();
    if (!text) return {};
    const message: GeneratedMessage = {
      id: `exact-${language}-${Date.now()}`,
      selectedPhraseIds: [],
      englishText: language === 'en' ? text : '',
      urduText: language === 'ur' ? text : '',
      mode: state.communicationMode,
      createdAt: new Date().toISOString(),
      sourceLanguage: language,
    };
    return {
      generatedMessage: message,
      selectedCandidateId: null,
    };
  }),
  applyPslMessage: (englishText, urduText) => set((state) => {
    const message: GeneratedMessage = {
      id: `psl-${Date.now()}`,
      selectedPhraseIds: [],
      englishText,
      urduText,
      mode: state.communicationMode,
      createdAt: new Date().toISOString(),
    };
    return {
      generatedMessage: message,
      selectedCandidateId: null,
    };
  }),

  activeProfile: profilePlaceholders[0] || null,
  profiles: profilePlaceholders,

  phraseUsageCounts: {},
  phraseHistory: [],
  customPhrases: [],
  preferences: defaultPreferences,
  syncStatus: 'Local only',

  selectSymbol: (phrase) =>
    set((state) => {
      const isSelected = state.selectedSymbols.some((symbol) => symbol.phraseId === phrase.id);
      const nextSymbols = isSelected
        ? state.selectedSymbols.filter((symbol) => symbol.phraseId !== phrase.id)
        : [...state.selectedSymbols, createSelectedSymbol(phrase)];

      const currentCount = state.phraseUsageCounts[phrase.id] || 0;
      const updatedCounts = isSelected
        ? state.phraseUsageCounts
        : { ...state.phraseUsageCounts, [phrase.id]: currentCount + 1 };

      return {
        ...withResolvedInput(nextSymbols, state.communicationMode, state.customPhrases),
        phraseUsageCounts: updatedCounts,
      };
    }),

  removeSymbol: (phraseId) =>
    set((state) =>
      withResolvedInput(
        state.selectedSymbols.filter((symbol) => symbol.phraseId !== phraseId),
        state.communicationMode,
        state.customPhrases,
      ),
    ),

  removeLastSymbol: () =>
    set((state) => withResolvedInput(state.selectedSymbols.slice(0, -1), state.communicationMode, state.customPhrases, state.communicationText.trim().replace(/\s*\S+\s*$/u, ''))),

  clearSelection: () =>
    set(withResolvedInput([], 'sentence')),

  setActiveCategory: (category) => set({ activeCategory: category }),

  setCommunicationMode: (mode) =>
    set((state) => ({
      communicationMode: mode,
      preferences: {...state.preferences, messageMode:mode},
      profiles:state.profiles.map(p=>p.id===state.activeProfile?.id?{...p,communicationPreference:mode}:p),
      activeProfile:state.activeProfile?{...state.activeProfile,communicationPreference:mode}:null,
      ...withResolvedInput(state.selectedSymbols, mode, state.customPhrases, state.communicationText),
    })),

  generateMessage: () =>
    set((state) => ({
      ...withResolvedInput(state.selectedSymbols, state.communicationMode, state.customPhrases, state.communicationText),
    })),

  setActiveProfile: (profile) => set(state => {
    const profiles=validateProfiles(state.profiles.map(p=>p.id===profile.id?profile:p));
    const active=profiles.find(p=>p.id===profile.id);
    if(!active)return {};
    return {profiles,activeProfile:active,communicationMode:active.communicationPreference,
      preferences:{...state.preferences,messageMode:active.communicationPreference},
      phraseHistory:[],phraseUsageCounts:{},...withResolvedInput([],active.communicationPreference)};
  }),
  setProfiles: (input) => set(state => {
    const profiles=validateProfiles(input),active=profiles.find(p=>p.id===state.activeProfile?.id)||profiles[0];
    return {profiles,activeProfile:active,communicationMode:active.communicationPreference,
      preferences:{...state.preferences,messageMode:active.communicationPreference},
      ...withResolvedInput([],active.communicationPreference)};
  }),

  recordPhraseUsage: (phraseId) =>
    set((state) => ({
      phraseUsageCounts: {
        ...state.phraseUsageCounts,
        [phraseId]: (state.phraseUsageCounts[phraseId] || 0) + 1,
      },
    })),

  // Delivered content is not collected; Repeat belongs to the ephemeral speech controller.
  addHistoryItem: () => {},

  clearHistory: () => set({ phraseHistory: [] }),

  addCustomPhrase: (phrase) => set(state => {
    if(state.customPhrases.length>=100||state.customPhrases.some(p=>p.id===phrase.id))return {};
    const validated=validateStoredState({customPhrases:[phrase]}).customPhrases;
    if(!validated.length)return {};
    const customPhrases=[...state.customPhrases,...validated];
    return {customPhrases,...withResolvedInput(state.selectedSymbols,state.communicationMode,customPhrases,state.communicationText)};
  }),

  deleteCustomPhrase: (phraseId) =>
    set((state) => ({
      customPhrases: state.customPhrases.filter((p) => p.id !== phraseId),
      ...withResolvedInput(state.selectedSymbols.filter(s => s.phraseId !== phraseId), state.communicationMode, state.customPhrases.filter(p => p.id !== phraseId), state.communicationText),
    })),

  updatePreferences: (prefs) => set(state => {
    const preferences=validatePreferences({...state.preferences,...prefs});
    const mode=preferences.messageMode!;
    return {preferences,communicationMode:mode,
      profiles:state.profiles.map(p=>p.id===state.activeProfile?.id?{...p,communicationPreference:mode}:p),
      activeProfile:state.activeProfile?{...state.activeProfile,communicationPreference:mode}:null,
      ...(prefs.messageMode?withResolvedInput(state.selectedSymbols,mode,state.customPhrases,state.communicationText):{})};
  }),

  setSyncStatus: (status) => set({ syncStatus: status }),

  initFromStoredState: (input) => set(() => {
    const stored=validateStoredState(input);
    const active=stored.profiles.find(p=>p.id===stored.activeProfileId)!;
    return {...withResolvedInput([],stored.preferences.messageMode!),activeCategory:'Basic Needs',
      profiles:stored.profiles,activeProfile:active,phraseUsageCounts:{},phraseHistory:[],
      signature:validateSignature(stored.signature),customPhrases:stored.customPhrases,preferences:stored.preferences,communicationMode:stored.preferences.messageMode!};
  }),
  getFullStoredState: () => {
    const state=get();
    return validateStoredState({version:3,activeProfileId:state.activeProfile?.id,profiles:state.profiles,
      signature:state.signature,customPhrases:state.customPhrases,preferences:state.preferences,updatedAt:0});
  },
  };
});
