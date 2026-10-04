import type { SpeechController } from './speechController';
/** Input/selection changes invalidate playback synchronously, before React rerenders. */
export function bindSpeechToInput(
  subscribe: (listener:(state:{resolution:unknown;selectedCandidateId:string|null},previous:{resolution:unknown;selectedCandidateId:string|null})=>void)=>()=>void,
  speech:Pick<SpeechController,'cancel'>,
) {
  return subscribe((state,previous)=>{
    if(state.resolution!==previous.resolution || state.selectedCandidateId!==previous.selectedCandidateId)speech.cancel();
  });
}
