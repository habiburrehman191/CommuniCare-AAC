/** Local, deterministic candidate service; it does not choose or speak. */
export { resolveIntent as generateSentenceCandidates, validCustomPhrases } from '../communication/intentResolver';
export type { IntentInput, IntentResolution, SentenceCandidate } from '../../types/intent';
