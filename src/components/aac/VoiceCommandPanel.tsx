import { Mic, MicOff, AudioLines, ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useOnlineTranscribe } from '@/hooks/useOnlineTranscribe';
import { matchVoiceCommand } from '@/features/communication/voiceCommands';
import type { RecognitionLocale } from '@/features/communication/recognitionController';
import { useCommunicationStore } from '@/store/communicationStore';

const noop = () => {};
interface Props {
  onSpeak?: () => void;
  onStop?: () => void;
  onRepeat?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function VoiceCommandPanel({
  onSpeak = noop,
  onStop = noop,
  onRepeat = noop,
  onBusyChange = noop,
}: Props) {
  const navigate = useNavigate();
  const [locale, setLocale] = useState<RecognitionLocale | 'roman'>('en-US');
  const [commandStatus, setCommandStatus] = useState('');
  const text = useCommunicationStore(s => s.communicationText);
  const resolution = useCommunicationStore(s => s.resolution);
  const generatedMessage = useCommunicationStore(s => s.generatedMessage);

  const commit = useCallback(
    (transcript: string) => {
      const command = matchVoiceCommand(transcript);
      const store = useCommunicationStore.getState();
      setCommandStatus(command ? 'Voice control: ' + command : '');
      if (!command) {
        store.setCommunicationText(transcript);
        return;
      }
      if (command === 'speak') onSpeak();
      if (command === 'stop') onStop();
      if (command === 'repeat') onRepeat();
      if (command === 'clear') store.clearSelection();
      if (command === 'remove-last') store.removeLastSymbol();
      if (command === 'emergency') {
        onStop();
        navigate('/emergency');
      }
    },
    [navigate, onSpeak, onStop, onRepeat]
  );

  const recognition = useSpeechRecognition(commit);
  const { abort, reset } = recognition;
  const onlineTranscribe = useOnlineTranscribe(commit);

  const busy =
    ['starting', 'listening', 'stopping'].includes(recognition.status) ||
    ['recording', 'transcribing'].includes(onlineTranscribe.status);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(
    () =>
      useCommunicationStore.subscribe((state, previous) => {
        if (state.resolution !== previous.resolution) reset();
        if (state.activeProfile !== previous.activeProfile) onlineTranscribe.cancel();
      }),
    [reset, onlineTranscribe]
  );

  const hasUrduError =
    locale === 'ur-PK' &&
    (recognition.status === 'unsupported' || !!recognition.error);
  const hasUnconfirmed = !!(
    recognition.error &&
    recognition.error.includes('unconfirmed') &&
    recognition.final &&
    !text
  );

  const showOnlineFallback =
    locale === 'ur-PK' ||
    hasUrduError ||
    onlineTranscribe.status !== 'idle' ||
    !!onlineTranscribe.error;

  return (
    <section className="voice-surface" aria-labelledby="voice-title">
      <div className="voice-heading">
        <div>
          <h2 id="voice-title">Speak or type</h2>
          <p className="quiet-hint">Say what you need, then choose a sentence.</p>
        </div>
        <label className="language-field">
          Input language
          <select
            value={locale}
            onChange={e => {
              abort();
              onlineTranscribe.cancel();
              const nextLocale = e.target.value as RecognitionLocale | 'roman';
              setLocale(nextLocale);
              const state = useCommunicationStore.getState();
              if (state.generatedMessage?.sourceLanguage) {
                state.setCommunicationText(state.communicationText);
              }
            }}
          >
            <option value="en-US">English</option>
            <option value="ur-PK">اردو (Urdu)</option>
            <option value="roman">Roman Urdu</option>
          </select>
        </label>
      </div>

      {locale === 'roman' && (
        <p className="quiet-hint">
          Type Roman Urdu; microphone recognition uses English mode. Review the transcript.
        </p>
      )}

      <div className="voice-input-row">
        {busy ? (
          <button
            type="button"
            className="mic-button listening"
            disabled={recognition.status === 'stopping' || onlineTranscribe.status === 'transcribing'}
            onClick={() => {
              if (onlineTranscribe.status === 'recording') onlineTranscribe.stop();
              else recognition.stop();
            }}
          >
            <MicOff aria-hidden="true" />
            <AudioLines aria-hidden="true" className="voice-wave" />
            <span>
              {onlineTranscribe.status === 'recording'
                ? 'Stop Recording'
                : onlineTranscribe.status === 'transcribing'
                ? 'Transcribing…'
                : recognition.status === 'stopping'
                ? 'Finishing…'
                : 'Stop Listening'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="mic-button"
            disabled={recognition.status === 'unsupported'}
            onClick={() => {
              onStop();
              onlineTranscribe.cancel();
              setCommandStatus('');
              recognition.start(locale === 'roman' ? 'en-US' : locale);
            }}
          >
            <Mic aria-hidden="true" />
            <span>Start Listening</span>
          </button>
        )}

        <label className="correction-field">
          Message text (editable)
          <textarea
            value={text}
            dir="auto"
            lang={locale === 'ur-PK' ? 'ur' : 'en'}
            onChange={e => {
              abort();
              onlineTranscribe.cancel();
              useCommunicationStore.getState().setCommunicationText(e.target.value);
            }}
            placeholder="Type here, or correct your message…"
            rows={2}
          />
        </label>
      </div>

      {hasUnconfirmed && (
        <div className="unconfirmed-action">
          <p className="quiet-hint">Unconfirmed speech was preserved.</p>
          <button
            type="button"
            className="action-button"
            onClick={() => {
              useCommunicationStore.getState().setCommunicationText(recognition.final);
            }}
          >
            Use transcript in message
          </button>
        </div>
      )}

      {showOnlineFallback && (
        <div className="urdu-recovery-panel" role="region" aria-label="Urdu speech options">
          {onlineTranscribe.status === 'idle' && !onlineTranscribe.error && (
            <div className="urdu-fallback-prompt">
              <div className="urdu-recovery-actions">
                <button
                  type="button"
                  className="action-button primary-fallback-button"
                  onClick={() => {
                    abort();
                    onlineTranscribe.start();
                  }}
                >
                  <AudioLines aria-hidden="true" />
                  <span>Try online Urdu transcription</span>
                  <span lang="ur" dir="rtl" className="urdu-sublabel">
                    آن لائن اردو آواز آزمائیں
                  </span>
                </button>
                <button
                  type="button"
                  className="action-button fallback-button"
                  onClick={() => {
                    abort();
                    onlineTranscribe.cancel();
                    setLocale('roman');
                  }}
                >
                  Switch to Roman Urdu
                </button>
              </div>
              <p className="privacy-notice">
                Online transcription sends this short recording securely for speech-to-text. Audio is not saved by CommuniCare.
              </p>
            </div>
          )}

          {onlineTranscribe.status === 'recording' && (
            <div className="recording-controls" role="status" aria-live="polite">
              <div className="recording-indicator">
                <AudioLines aria-hidden="true" className="voice-wave" />
                <span className="recording-label">Recording…</span>
                <span lang="ur" dir="rtl" className="recording-label-ur">
                  ریکارڈنگ ہو رہی ہے…
                </span>
              </div>
              <div className="urdu-recovery-actions">
                <button
                  type="button"
                  className="action-button"
                  onClick={onlineTranscribe.stop}
                >
                  <MicOff aria-hidden="true" />
                  <span>Stop recording</span>
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={onlineTranscribe.cancel}
                >
                  <span>Cancel</span>
                </button>
              </div>
              <p className="privacy-notice">
                Online transcription sends this short recording securely for speech-to-text. Audio is not saved by CommuniCare.
              </p>
            </div>
          )}

          {onlineTranscribe.status === 'transcribing' && (
            <div className="transcribing-controls" role="status" aria-live="polite">
              <div className="transcribing-indicator">
                <span className="transcribing-label">Transcribing…</span>
                <span lang="ur" dir="rtl" className="transcribing-label-ur">
                  متن بنایا جا رہا ہے…
                </span>
              </div>
              <div className="urdu-recovery-actions">
                <button
                  type="button"
                  className="action-button"
                  onClick={onlineTranscribe.cancel}
                >
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          )}

          {(onlineTranscribe.status === 'error' || !!onlineTranscribe.error) && (
            <div className="fallback-error-panel" role="alert">
              <p className="input-error">{onlineTranscribe.error || 'Transcription unavailable'}</p>
              <div className="urdu-recovery-actions">
                <button
                  type="button"
                  className="action-button"
                  onClick={() => {
                    abort();
                    onlineTranscribe.start();
                  }}
                >
                  <span>Try again</span>
                </button>
                <button
                  type="button"
                  className="action-button fallback-button"
                  onClick={() => {
                    abort();
                    onlineTranscribe.cancel();
                    setLocale('roman');
                  }}
                >
                  Switch to Roman Urdu
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={onlineTranscribe.cancel}
                >
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {resolution.status === 'clear' && resolution.candidates.length > 0 && (
        <div className="voice-resolution-ready" role="status" aria-live="polite">
          <p className="resolution-hint">Sentence options ready — choose one below.</p>
          <a
            className="action-button sentence-jump"
            href="#sentence-title"
            onClick={e => {
              e.preventDefault();
              const target = document.getElementById('sentence-title');
              target?.focus();
              target?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <ArrowDown aria-hidden="true" />
            View sentence options
          </a>
        </div>
      )}

      {(resolution.status === 'unsupported' || resolution.status === 'clarification') && !!text.trim() && !generatedMessage?.sourceLanguage && (
        <div className="voice-resolution-guidance" role="status">
          <p className="quiet-hint">
            {resolution.status === 'unsupported'
              ? 'We could not confirm this exact wording. You can edit your words above or tap symbols below to build your message.'
              : 'Clarification required. Please review the options below to clarify your message.'}
          </p>
          {(locale === 'ur-PK' || /[\u0600-\u06FF]/u.test(text)) && (
            <div className="exact-words-action">
              <button
                type="button"
                className="action-button exact-words-button"
                onClick={() => {
                  useCommunicationStore.getState().confirmExactText('ur');
                }}
              >
                <span>Use these exact words</span>
                <span lang="ur" dir="rtl">
                  یہی الفاظ استعمال کریں
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="transcript-area" role="status" aria-live="polite">
        <p className="listening-state">
          {onlineTranscribe.status === 'recording'
            ? 'Recording…'
            : onlineTranscribe.status === 'transcribing'
            ? 'Transcribing…'
            : recognition.status === 'listening'
            ? 'Listening…'
            : recognition.status === 'starting'
            ? 'Opening microphone…'
            : recognition.status === 'stopping'
            ? 'Finishing your message…'
            : recognition.error || onlineTranscribe.error
            ? 'Input needs attention'
            : text || recognition.final
            ? 'Transcript ready'
            : 'Microphone off · Ready when you are'}
        </p>
        <div className="transcript-pair">
          <p>
            <span>Live transcript</span>
            <span lang={locale === 'ur-PK' ? 'ur' : 'en'} dir="auto">
              {recognition.interim || '—'}
            </span>
          </p>
          <p>
            <span>Final transcript</span>
            <span lang={locale === 'ur-PK' ? 'ur' : 'en'} dir="auto">
              {recognition.final || text || '—'}
            </span>
          </p>
        </div>
        {commandStatus && <p>{commandStatus}</p>}
        {recognition.error && <p className="input-error">{recognition.error}</p>}
      </div>
    </section>
  );
}
