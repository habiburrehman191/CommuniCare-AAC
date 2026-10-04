import type { SpeechMessage } from '@/features/communication/speechController';
export function RepeatMessageDetails({message}:{message:SpeechMessage|null}) {
 if(!message)return null;
 return <details className="repeat-details"><summary>Last spoken message</summary>{message.englishText && <p lang="en">{message.englishText}</p>}{message.urduText && <p lang="ur" dir="rtl">{message.urduText}</p>}</details>;
}
