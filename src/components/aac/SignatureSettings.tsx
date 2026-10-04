import { useState } from 'react';
import { useCommunicationStore } from '@/store/communicationStore';
import { emptyPersonalization } from '@/features/signature/types';
export function SignatureSettings(){
 const s=useCommunicationStore(),[notice,setNotice]=useState('');
 const p=s.signature.profiles[s.activeProfile?.id??'default']??emptyPersonalization();
 return <div className="settings-fields"><div className="setting-description"><h3>Language & personal support</h3><p>Situation and local preferences change ordering, never your meaning.</p></div>
 <label className="setting-field">Preferred sentence style<select value={p.style} onChange={e=>s.setSentenceStyle(e.target.value as typeof p.style)}><option value="direct">Direct & clear</option><option value="polite">Polite</option><option value="urgent">Urgent when your message is urgent</option></select></label>
 <label className="toggle-row"><span><strong>Local personalization</strong><span>Remember bounded symbol counts and recent symbol IDs on this device. No transcript history.</span></span><input type="checkbox" checked={s.signature.enabled} onChange={e=>s.setPersonalizationEnabled(e.target.checked)}/></label>
 <button className="action-button" type="button" onClick={()=>{s.resetPersonalization();setNotice('Personalization reset for all local profiles.');}}>Reset Personalization</button>
 <label className="toggle-row"><span><strong>Gemini language enhancement</strong><span>Optional: send only the current standard intent, situation and style to Google through this app’s server. No raw words, audio or profile data. Local choices remain immediately available.</span></span><input type="checkbox" checked={s.signature.aiEnabled} onChange={e=>s.setAIEnabled(e.target.checked)}/></label>
 <p className="quiet-hint">Online enhancement needs a configured server. If unavailable or rejected, the reviewed local sentences remain. Emergency communication is always local.</p>
 {notice&&<p role="status">{notice}</p>}</div>;
}
