import type { CommunicationMode, GeneratedMessage, Phrase, SelectedSymbol } from '@/types';
import { resolveIntent } from '@/features/communication/intentResolver';
/** Materialize only an explicitly chosen candidate. Both legacy modes use semantics. */
export function generateCommunicationMessage(
  symbols: SelectedSymbol[],
  mode: CommunicationMode,
  selectedCandidateId?: string | null,
  customPhrases: Phrase[] = [],
): GeneratedMessage | null {
  if (!selectedCandidateId) return null;
  const result = resolveIntent({symbolIds:symbols.map(s => s.phraseId)}, customPhrases);
  const candidate = result.candidates.find(c => c.id === selectedCandidateId);
  if (!candidate) return null;
  return {id:candidate.id,selectedPhraseIds:symbols.map(s => s.phraseId),englishText:candidate.english,urduText:candidate.urdu,mode,createdAt:new Date().toISOString()};
}
