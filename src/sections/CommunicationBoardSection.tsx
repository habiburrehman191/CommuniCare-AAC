import { QuickCommunication, ContextRecommendations, SmartClarification } from '@/components/aac/SignatureControls';
import { PartnerMode } from '@/components/aac/PartnerMode';
import { useContextualSuggestions } from '@/hooks/useContextualSuggestions';
import { emptyPersonalization } from '@/features/signature/types';
import { orderPhrases } from '@/features/signature/context';
import { RepeatMessageDetails } from '@/components/aac/RepeatMessageDetails';
import {
  Delete,
  RotateCcw,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CategoryTabs } from '@/components/aac/CategoryTabs';
import { SelectedMessagePreview } from '@/components/aac/SelectedMessagePreview';
import { SymbolCard } from '@/components/aac/SymbolCard';
import { VoiceCommandPanel } from '@/components/aac/VoiceCommandPanel';
import { CameraPanel } from '@/components/aac/CameraPanel';
import { SentenceSuggestions } from '@/components/aac/SentenceSuggestions';
import { initialPhrases } from '@/data/phrases';
import { validCustomPhrases } from '@/features/suggestions';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { useCommunicationStore } from '@/store/communicationStore';
import { getSpeechController, voiceLanguage } from '@/features/communication/speechController';
import { bindSpeechToInput } from '@/features/communication/speechBinding';

export function CommunicationBoardSection() {
  const activeCategory = useCommunicationStore((state) => state.activeCategory);
  const selectedSymbols = useCommunicationStore((state) => state.selectedSymbols);
  const communicationMode = useCommunicationStore((state) => state.communicationMode);
  const generatedMessage = useCommunicationStore((state) => state.generatedMessage);
  const communicationText = useCommunicationStore((state) => state.communicationText);
  const [voiceBusy,setVoiceBusy] = useState(false);
  const [inputMode, setInputMode] = useState<'voice' | 'camera'>('voice');

  const selectSymbol = useCommunicationStore((state) => state.selectSymbol);
  const removeSymbol = useCommunicationStore((state) => state.removeSymbol);
  const clearSelection = useCommunicationStore((state) => state.clearSelection);
  const removeLastSymbol = useCommunicationStore((state) => state.removeLastSymbol);
  const resolution = useCommunicationStore((state) => state.resolution);
  const selectedCandidateId = useCommunicationStore((state) => state.selectedCandidateId);
  const selectCandidate = useCommunicationStore((state) => state.selectCandidate);
  const customPhrases = useCommunicationStore((state) => state.customPhrases);
  const addHistoryItem = useCommunicationStore((state) => state.addHistoryItem);

  const [speechError, setSpeechError] = useState<string | null>(null);
  const { isSpeaking, speakMessage, cancel, isSupported, repeat, canRepeat, lastMessage, voices, clearError } = useSpeechSynthesis();
  useEffect(() => bindSpeechToInput(useCommunicationStore.subscribe, getSpeechController()), []);

  const messageKey = `${generatedMessage?.id ?? ''}|${generatedMessage?.englishText ?? ''}|${generatedMessage?.urduText ?? ''}|${communicationText ?? ''}`;
  const [prevMessageKey, setPrevMessageKey] = useState(messageKey);
  if (prevMessageKey !== messageKey) {
    setPrevMessageKey(messageKey);
    setSpeechError(null);
  }

  useEffect(() => {
    clearError();
  }, [messageKey, clearError]);

  const hasLocalUrduVoice = voices.some((v) => voiceLanguage(v, 'ur'));

  const signature=useCommunicationStore(s=>s.signature),profile=useCommunicationStore(s=>s.activeProfile?.id);
  const personal=signature.profiles[profile??'default']??emptyPersonalization();
  useContextualSuggestions(voiceBusy);
  const visiblePhrases = orderPhrases([...initialPhrases, ...validCustomPhrases(customPhrases)].filter((phrase) => phrase.category === activeCategory),personal.context,personal,signature.enabled);
  const hasSelection = selectedSymbols.length > 0 || !!communicationText;

  const handleSpeak = useCallback(async (language?: 'en' | 'ur') => {
    setSpeechError(null);
    clearError();
    const state=useCommunicationStore.getState();
    const message=state.generatedMessage;
    if (!message) return;
    const p=state.preferences;
    let targetMode: 'auto' | 'en' | 'ur' = language ?? message.sourceLanguage ?? p.preferredVoiceLang;

    if (targetMode === 'auto' && !hasLocalUrduVoice) {
      if (message.englishText.trim() && message.urduText.trim()) {
        const enResult = await speakMessage({ englishText: message.englishText, urduText: '' }, 'en', { rate: p.speechRate, pitch: p.speechPitch, volume: p.speechVolume });
        if (enResult === 'cancelled') {
          setSpeechError(null);
          clearError();
          return;
        }
        if (enResult !== 'completed') {
          const err = getSpeechController().getSnapshot().error || 'Speech output is unavailable. Please try again.';
          setSpeechError(err);
          return;
        }
        const urResult = await speakMessage({ englishText: '', urduText: message.urduText }, 'ur', { rate: p.speechRate, pitch: p.speechPitch, volume: p.speechVolume });
        if (urResult === 'completed') {
          setSpeechError(null);
          clearError();
          addHistoryItem({ id: 'history-' + Date.now(), englishText: message.englishText, urduText: message.urduText, mode: message.mode, timestamp: new Date().toISOString() });
        } else if (urResult === 'cancelled') {
          setSpeechError(null);
          clearError();
        } else {
          const err = getSpeechController().getSnapshot().error || 'Urdu speech output is unavailable. Please try again.';
          setSpeechError(err);
        }
        return;
      }
      targetMode = message.urduText.trim() && !message.englishText.trim() ? 'ur' : 'en';
    }

    const result=await speakMessage(message, targetMode, {rate:p.speechRate,pitch:p.speechPitch,volume:p.speechVolume});
    if(result==='completed') {
      setSpeechError(null);
      clearError();
      addHistoryItem({id: 'history-'+Date.now(),englishText:message.englishText,urduText:message.urduText,mode:message.mode,timestamp:new Date().toISOString()});
    } else if (result==='cancelled') {
      setSpeechError(null);
      clearError();
    } else {
      const err = getSpeechController().getSnapshot().error || 'Speech output is unavailable. Please try again.';
      setSpeechError(err);
    }
  },[speakMessage,addHistoryItem,hasLocalUrduVoice,clearError]);
  const speakSelected=useCallback(()=>{void handleSpeak();},[handleSpeak]);
  const repeatMessage=useCallback(async ()=>{
    setSpeechError(null);
    clearError();
    const result = await repeat();
    if (result === 'completed' || result === 'cancelled') {
      setSpeechError(null);
      clearError();
    } else {
      const err = getSpeechController().getSnapshot().error || 'Speech output is unavailable. Please try again.';
      setSpeechError(err);
    }
  },[repeat,clearError]);

  // Keyboard accessibility shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('dialog[open]')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === 'Backspace' && hasSelection) {
        e.preventDefault();
        setSpeechError(null);
        clearError();
        removeLastSymbol();
      } else if (e.key === 'Escape' && hasSelection) {
        e.preventDefault();
        setSpeechError(null);
        clearError();
        clearSelection();
      } else if (e.code === 'Space' && e.ctrlKey && hasSelection && !voiceBusy) {
        e.preventDefault();
        handleSpeak();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasSelection, removeLastSymbol, clearSelection, handleSpeak, voiceBusy, clearError]);

  return <div className="communication-flow"><div className="flow-intro"><span className="eyebrow">YOUR COMMUNICATION SPACE</span><p>A thought. A choice. Your voice.</p></div>
    <section className="message-surface communication-canvas" aria-labelledby="message-title">
      <div className="section-heading"><h1 id="message-title" tabIndex={-1}>Your message</h1><span className="quiet-hint">{isSpeaking ? 'Speaking…' : generatedMessage ? 'Ready to speak' : 'Make yourself heard'}</span></div>
      <SelectedMessagePreview symbols={selectedSymbols} mode={communicationMode} generatedMessage={generatedMessage} hasInput={!!communicationText}/>
      <div className="message-actions">
        <fieldset disabled={voiceBusy} className="speak-control">{isSpeaking ? <button type="button" className="action-button stop-button" onClick={()=>{cancel();setSpeechError(null);clearError();}}><VolumeX aria-hidden="true"/>Stop Speaking</button> : <button type="button" className="action-button primary-button" onClick={speakSelected} disabled={!generatedMessage || !isSupported}><Volume2 aria-hidden="true"/>Speak Message</button>}</fieldset>
        {canRepeat && <button type="button" className="action-button" onClick={repeatMessage} disabled={voiceBusy} title={lastMessage?.englishText || lastMessage?.urduText}><RotateCcw aria-hidden="true"/>Repeat Last Message</button>}
        {generatedMessage && <PartnerMode message={generatedMessage}/>}
        {hasSelection && <div className="edit-actions"><button type="button" className="action-button" onClick={()=>{setSpeechError(null);clearError();removeLastSymbol();document.getElementById('message-title')?.focus();}} aria-label="Remove last input (Backspace)"><Delete aria-hidden="true"/>Undo last</button><button type="button" className="action-button" onClick={()=>{setSpeechError(null);clearError();clearSelection();document.getElementById('message-title')?.focus();}}><X aria-hidden="true"/>Clear</button></div>}
      </div>
      <RepeatMessageDetails message={lastMessage}/>
      {!hasLocalUrduVoice && (
        <p className="privacy-notice" role="note" style={{ margin: '8px 28px 0' }}>
          <span>Urdu speech uses a secure online voice when an Urdu voice is not available on this device.</span>{' '}
          <span lang="ur" dir="rtl">اگر اس ڈیوائس پر اردو آواز دستیاب نہ ہو تو اردو پیغام کے لیے آن لائن آواز استعمال کی جاتی ہے۔</span>
        </p>
      )}
      {speechError && (
        <div role="status" className="clarification">
          <p>{speechError}</p>
          <div className="action-row" style={{ marginTop: '8px' }}>
            <button
              type="button"
              className="action-button"
              onClick={() => { void handleSpeak(); }}
            >
              <RotateCcw aria-hidden="true" />
              <span>Try again</span>
            </button>
          </div>
        </div>
      )}
    </section>
    <QuickCommunication/>
    <div className="composition-stage">
      <div className="input-column">
        <div className="input-mode-selector" role="tablist" aria-label="Input mode">
          <button
            type="button"
            role="tab"
            id="tab-mode-voice"
            aria-selected={inputMode === 'voice'}
            aria-controls="panel-mode-voice"
            className={`input-mode-tab ${inputMode === 'voice' ? 'active' : ''}`}
            onClick={() => setInputMode('voice')}
          >
            <span>Voice</span>
            <span lang="ur" dir="rtl" className="urdu-sublabel">آواز</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-mode-camera"
            aria-selected={inputMode === 'camera'}
            aria-controls="panel-mode-camera"
            className={`input-mode-tab ${inputMode === 'camera' ? 'active' : ''}`}
            onClick={() => setInputMode('camera')}
          >
            <span>Camera</span>
            <span lang="ur" dir="rtl" className="urdu-sublabel">کیمرہ</span>
          </button>
        </div>

        {inputMode === 'voice' ? (
          <div id="panel-mode-voice" role="tabpanel" aria-labelledby="tab-mode-voice">
            <VoiceCommandPanel onSpeak={speakSelected} onStop={cancel} onRepeat={repeatMessage} onBusyChange={setVoiceBusy}/>
          </div>
        ) : (
          <div id="panel-mode-camera" role="tabpanel" aria-labelledby="tab-mode-camera">
            <CameraPanel />
          </div>
        )}
      </div>
      {resolution.status==='clarification'||resolution.status==='unsupported'?<SmartClarification/>:<SentenceSuggestions resolution={resolution} selectedId={selectedCandidateId} disabled={voiceBusy} onSelect={selectCandidate}/>}
    </div>
    <ContextRecommendations/>
    <section className="symbols-section" aria-labelledby="symbols-title">
      <div className="section-heading"><h2 id="symbols-title" tabIndex={-1}>Build with symbols</h2><p>Tap to add. Tap again to remove.</p></div>
      {selectedSymbols.length>0 && <div className="selected-symbols" aria-label="Selected symbols">{selectedSymbols.map(symbol=><button type="button" key={symbol.selectionId} className="symbol-chip" onClick={()=>{removeSymbol(symbol.phraseId);document.getElementById('symbols-title')?.focus();}} aria-label={`Remove ${symbol.labelEnglish}`}><span>{symbol.labelEnglish}</span><span lang="ur" dir="rtl">{symbol.labelUrdu}</span><X aria-hidden="true"/></button>)}</div>}
      {resolution.candidates.length>0 && <a className="action-button sentence-jump" href="#sentence-title">View sentence choices</a>}
      <CategoryTabs/>
      <h3 className="category-heading">{activeCategory}</h3>
      <div className="symbol-grid" aria-label={`${activeCategory} AAC symbols`}>{visiblePhrases.map(phrase=><SymbolCard key={phrase.id} phrase={phrase} onSelect={selectSymbol} isSelected={selectedSymbols.some(s=>s.phraseId===phrase.id)}/>)}</div>
    </section>
  </div>;
}
