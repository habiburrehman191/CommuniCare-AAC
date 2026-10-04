import type { StudioDefinition, SignatureState } from '../features/signature/types';
export const phraseCategoryIds = ['Basic Needs', 'Food and Drink', 'Health', 'Emotions', 'Places', 'Social', 'Emergency', 'Family', 'Actions'] as const;
export type PhraseCategory = typeof phraseCategoryIds[number];

export type CommunicationMode = 'word' | 'sentence';

export type SyncStatus = 'Local only' | 'Offline local' | 'Sync pending' | 'Synced' | 'Storage error' | 'Backup failed' | 'Backup conflict' | 'Local changes not backed up';

export type StoredLanguage = 'english' | 'urdu';

export type SupportedEmotion =
  | 'none'
  | 'calm'
  | 'sad'
  | 'stressed'
  | 'uncomfortable'
  | 'angry'
  | 'tired';

export type SuggestionReason =
  | 'quick-access'
  | 'favorite'
  | 'high-usage'
  | 'same-category'
  | 'emergency-context'
  | 'caregiver-recommended';

export interface UserProfile {
  id: string;
  displayName: string;
  ageGroup: 'child' | 'teen' | 'adult' | 'senior';
  primaryLanguage: 'english' | 'urdu' | 'bilingual';
  avatarColor: string;
  communicationPreference: CommunicationMode;
}

export interface Phrase {
  id: string;
  category: PhraseCategory;
  iconName: string;
  labelEnglish: string;
  labelUrdu: string;
  sentenceEnglish: string;
  sentenceUrdu: string;
  favorite: boolean;
  emergency: boolean;
  quickAccess: boolean;
  usageCount: number;
  isCustom?: boolean;
  studio?: StudioDefinition;
}

export interface EmergencyPhrase extends Phrase {
  category: 'Emergency';
  emergency: true;
  quickAccess: true;
}

export interface SelectedSymbol {
  selectionId: string;
  phraseId: string;
  category: PhraseCategory;
  iconName: string;
  labelEnglish: string;
  labelUrdu: string;
  sentenceEnglish: string;
  sentenceUrdu: string;
  selectedAt: string;
}

export interface GeneratedMessage {
  id: string;
  selectedPhraseIds: string[];
  englishText: string;
  urduText: string;
  mode: CommunicationMode;
  createdAt: string;
  sourceLanguage?: 'en' | 'ur';
}

export interface HistoryItem {
  id: string;
  englishText: string;
  urduText: string;
  mode: CommunicationMode;
  timestamp: string;
}

export interface StoredPreferences {
  speechRate: number;
  speechPitch: number;
  speechVolume: number;
  preferredVoiceLang: 'auto' | 'en' | 'ur';
  signLanguageEnabled: boolean;
  selectedEmotion?: SupportedEmotion;
  emotionSupportEnabled?: boolean;
  messageMode?: CommunicationMode;
  highContrast?: boolean;
  audioFeedback?: boolean;
}

export interface AACStoredState {
  signature?: SignatureState;
  version: number;
  activeProfileId: string | null;
  profiles: UserProfile[];
  language: StoredLanguage;
  phraseHistory: HistoryItem[];
  frequentlyUsed: Record<string, number>;
  customPhrases: Phrase[];
  preferences: StoredPreferences;
  updatedAt: number;
}

export interface PWAInstallState {
  canInstall: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  promptInstall: () => Promise<boolean>;
}

export interface TTSVoiceOption {
  voice: SpeechSynthesisVoice;
  lang: string;
  name: string;
  isUrdu: boolean;
}
