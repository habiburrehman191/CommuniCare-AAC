/** Whole-utterance controls only. Ordinary 'stop', 'help', 'no' are communication. */
export type VoiceCommand = 'speak' | 'stop' | 'repeat' | 'clear' | 'remove-last' | 'emergency';
export const normalizeUtterance = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/[.!۔]+$/u, '').replace(/\s+/gu,' ');
const commands: Record<VoiceCommand, string[]> = {
  speak:['speak message','پیغام بولیں','paigham bolen','paigham boliye','paigham bolo','paigham bolain'],
  stop:['stop speaking','بولنا بند کریں','bolna band karein','bolna band karo','bolna band karain'],
  repeat:['repeat message','پیغام دہرائیں','paigham dohrayen','paigham dohrao','paigham dohrayain'],
  clear:['clear message','پیغام صاف کریں','paigham saaf karein','paigham saaf karo','paigham saaf karain'],
  'remove-last':['remove last symbol','آخری علامت ہٹائیں','aakhri alamat hatayen','akhri alamat hatao','aakhri alamat hatain'],
  emergency:['open emergency board','ایمرجنسی بورڈ کھولیں','emergency board kholen','emergency board kholo','emergency board kholain'],
};
export function matchVoiceCommand(text: string): VoiceCommand | null {
  const normalized = normalizeUtterance(text);
  for (const [command, aliases] of Object.entries(commands)) if (aliases.some(alias => normalized === normalizeUtterance(alias))) return command as VoiceCommand;
  return null;
}
