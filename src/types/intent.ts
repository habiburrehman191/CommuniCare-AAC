/** All candidates render the same resolved meaning; no scores or inferred facts. */
export interface BilingualSentence { english: string; urdu: string }
export interface SentenceCandidate extends BilingualSentence { id: string; intentKey: string; source?: 'local'|'gemini'; style?: 'direct'|'polite'|'urgent' }
export interface SemanticIntent {
  kind: 'request' | 'state' | 'activity' | 'destination' | 'person' | 'social' | 'emergency' | 'combined' | 'custom';
  concepts: string[];
  negated: boolean;
  modifiers: string[];
}
export interface IntentInput { symbolIds: string[]; text?: string }
export interface IntentResolution {
  canonicalIds?: string[];
  status: 'empty' | 'clear' | 'clarification' | 'unsupported';
  input: IntentInput;
  intent: SemanticIntent | null;
  candidates: SentenceCandidate[];
  clarification: BilingualSentence | null;
}
