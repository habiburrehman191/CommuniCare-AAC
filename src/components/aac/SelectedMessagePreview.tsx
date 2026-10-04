import type { CommunicationMode, GeneratedMessage, SelectedSymbol } from '@/types';
interface Props { symbols: SelectedSymbol[]; mode: CommunicationMode; generatedMessage: GeneratedMessage | null; onRemoveSymbol?: (id: string) => void; hasInput?: boolean }
export function SelectedMessagePreview({symbols, generatedMessage, hasInput=false}: Props) {
  return <div className="message-preview" aria-live="polite" aria-atomic="true">
    {generatedMessage ? (
      generatedMessage.sourceLanguage === 'ur' ? (
        <p className="message-urdu" lang="ur" dir="rtl">{generatedMessage.urduText}</p>
      ) : generatedMessage.sourceLanguage === 'en' ? (
        <p className="message-english" lang="en">{generatedMessage.englishText}</p>
      ) : (
        <>
          <p className="message-english" lang="en">{generatedMessage.englishText}</p>
          <p className="message-urdu" lang="ur" dir="rtl">{generatedMessage.urduText}</p>
        </>
      )
    ) : <>
      <p className="message-english empty-message">{symbols.length || hasInput ? 'Choose a sentence below.' : 'What would you like to say?'}</p>
      <p className="message-urdu empty-message" lang="ur" dir="rtl">{symbols.length || hasInput ? 'نیچے سے جملہ منتخب کریں۔' : 'آپ کیا کہنا چاہتے ہیں؟'}</p>
    </>}
  </div>;
}
