import { SignatureSettings } from '@/components/aac/SignatureSettings';
import { CustomPhraseSettings } from '@/components/aac/CustomPhraseSettings';
import { ArrowLeft, Volume2, Square, Download, RefreshCw } from 'lucide-react';
import { useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { getSpeechController } from '@/features/communication/speechController';
import { useCommunicationStore } from '@/store/communicationStore';
import { useAppServices } from '@/components/layout/AppServices';
import type { SupportedEmotion } from '@/types';

const sections=['General','Communication','Accessibility','Advanced'] as const;
type Section=typeof sections[number];
export function SettingsSection() {
 const [params,setParams]=useSearchParams();
 const active=sections.find(s=>s.toLowerCase()===params.get('section')) || 'General';
 const tabs=useRef<Array<HTMLButtonElement|null>>([]);
 const preferences=useCommunicationStore(s=>s.preferences);
 const activeProfile=useCommunicationStore(s=>s.activeProfile);
 const updatePreferences=useCommunicationStore(s=>s.updatePreferences);
 const clearHistory=useCommunicationStore(s=>s.clearHistory);
 const {speakMessage,isSpeaking,cancel,voices,error}=useSpeechSynthesis();
 const {syncStatus,isOnline,forceSyncCloud,restoreCloud,deleteCloud,resetLocal,offlineStatus,canInstall,isInstalled,isIOS,promptInstall}=useAppServices();
 const [notice,setNotice]=useState('');
 const [syncing,setSyncing]=useState(false);
 const [confirmReset,setConfirmReset]=useState(false);
 const [cloudAction,setCloudAction]=useState<'restore'|'delete'|null>(null);
 const choose=(section:Section)=>{cancel();setConfirmReset(false);setCloudAction(null);setNotice('');setParams({section:section.toLowerCase()},{replace:true});};
 const testVoice=()=>{void speakMessage({englishText:'This is a speech test.',urduText:'یہ آواز کی جانچ ہے۔'},preferences.preferredVoiceLang,{rate:preferences.speechRate,pitch:preferences.speechPitch,volume:preferences.speechVolume,remember:false});};
 return <div className="settings-page">
  <Link to="/board" className="back-link"><ArrowLeft aria-hidden="true"/>Back to communication</Link>
  <div className="page-heading"><h1>Settings</h1><p>Make communication comfortable for you.</p></div>
  <div role="tablist" aria-label="Settings sections" className="settings-tabs">{sections.map((section,i)=><button key={section} ref={el=>{tabs.current[i]=el;}} type="button" role="tab" id={'tab-'+section} aria-controls={'panel-'+section} aria-selected={active===section} tabIndex={active===section?0:-1} onClick={()=>choose(section)} onKeyDown={e=>{
   let next=i;
   if(e.key==='ArrowRight')next=(i+1)%sections.length;
   else if(e.key==='ArrowLeft')next=(i+sections.length-1)%sections.length;
   else if(e.key==='Home')next=0;
   else if(e.key==='End')next=sections.length-1;
   else return;
   e.preventDefault();choose(sections[next]);tabs.current[next]?.focus();
  }}>{section}</button>)}</div>
  <section role="tabpanel" id={'panel-'+active} aria-labelledby={'tab-'+active} tabIndex={0} className="settings-panel">
   <h2>{active}</h2>
   {active==='General' && <div className="settings-fields">
    <div className="setting-row"><div><h3>Active profile</h3><p>{activeProfile?.displayName || 'No profile selected'}</p></div><Link className="action-button" to="/profiles">Change profile</Link></div>
    <div className="setting-description"><h3>English and Urdu, together</h3><p>Profiles share device settings and custom phrases; they are not private accounts. Messages and symbols always show both languages. Choose the spoken language in Communication or in the header.</p></div>
    <div className="setting-description"><h3>You control your voice</h3><p>Choose symbols, speak, or type. Select a sentence and press Speak when you are ready. Selecting a card never starts speech.</p></div>
   </div>}
   {active==='Communication' && <div className="settings-fields">
    <label className="setting-field">Speech language<select value={preferences.preferredVoiceLang} onChange={e=>{cancel();updatePreferences({preferredVoiceLang:e.target.value as 'auto'|'en'|'ur'});}}><option value="auto">English + Urdu</option><option value="en">English only</option><option value="ur">Urdu only</option></select></label>
    <label className="setting-field" htmlFor="speech-rate">Speech speed <output>{preferences.speechRate}×</output><input id="speech-rate" type="range" min="0.5" max="1.5" step="0.05" value={preferences.speechRate} onChange={e=>updatePreferences({speechRate:Number(e.target.value)})}/></label>
    <label className="setting-field" htmlFor="speech-pitch">Voice pitch <output>{preferences.speechPitch}×</output><input id="speech-pitch" type="range" min="0.5" max="1.5" step="0.05" value={preferences.speechPitch} onChange={e=>updatePreferences({speechPitch:Number(e.target.value)})}/></label>
    <label className="setting-field" htmlFor="speech-volume">Speech volume <output>{Math.round(preferences.speechVolume*100)}%</output><input id="speech-volume" type="range" min="0" max="1" step="0.05" value={preferences.speechVolume} onChange={e=>updatePreferences({speechVolume:Number(e.target.value)})}/></label>
    <p role="status" className="setting-description">Urdu voice: {voices.some(v=>/^ur(?:-|_|$)/i.test(v.lang))?'Available':'Not available on this device'}. {voices.some(v=>/^ur(?:-|_|$)/i.test(v.lang)&&v.localService)?'An offline Urdu voice is installed.':'No offline Urdu voice is installed.'}</p>
    <div className="action-row">{isSpeaking?<button type="button" className="action-button stop-button" onClick={cancel}><Square aria-hidden="true"/>Stop Speech Test</button>:<button type="button" className="action-button primary-button" onClick={testVoice}><Volume2 aria-hidden="true"/>Test Speech Output</button>}</div>
    {error&&<p role="status" className="clarification">{error}</p>}
    <SignatureSettings/>
    <CustomPhraseSettings/>
   </div>}
   {active==='Accessibility' && <div className="settings-fields">
    <label className="toggle-row"><span><strong>High contrast</strong><span>Stronger borders and darker text.</span></span><input type="checkbox" checked={!!preferences.highContrast} onChange={e=>updatePreferences({highContrast:e.target.checked})}/></label>
    <div className="setting-description"><h3>Keyboard controls</h3><p>Use Tab to move and Enter or Space to select. On the board, Backspace removes the last input; Escape clears it; Ctrl + Space speaks the chosen sentence. These shortcuts do not run while you edit text.</p></div>
    <div className="setting-description"><h3>Text size and motion</h3><p>Use your browser’s zoom controls to enlarge the interface. Reduced motion follows your device preference.</p></div>
   </div>}
   {active==='Advanced' && <div className="settings-fields">
    <div className="setting-description"><h3>Voice input help</h3><p>Recognition depends on your browser and may need internet. Typing and symbols remain available. Select English or Urdu above the microphone.</p><p>Exact voice controls: “speak message”, “stop speaking”, “repeat message”, “clear message”, “remove last symbol”, “open emergency board”.</p><p lang="ur" dir="rtl">پیغام بولیں، بولنا بند کریں، پیغام دہرائیں، پیغام صاف کریں، آخری علامت ہٹائیں، ایمرجنسی بورڈ کھولیں۔</p></div>
    <div className="setting-description"><h3>Storage and backup</h3><p>Settings and custom phrases are saved on this device. Back up now uploads only profiles, settings, and custom phrases to Firebase. Backup is optional and never runs automatically. Transcripts and message history are not retained.</p><p>{syncStatus}. {isOnline?'Network available.':'Offline.'}</p><button type="button" className="action-button" disabled={syncing||!isOnline} onClick={async()=>{setSyncing(true);try{const ok=await forceSyncCloud();setNotice(ok?'Backup complete.':'Backup did not complete. Check the storage status before closing this page.');}finally{setSyncing(false);}}}><RefreshCw aria-hidden="true"/>{syncing?'Backing up…':'Back up now'}</button><div className="action-row"><button type="button" className="action-button" disabled={syncing||!isOnline} onClick={()=>setCloudAction('restore')}>Restore backup</button><button type="button" className="action-button danger-outline" disabled={syncing||!isOnline} onClick={()=>setCloudAction('delete')}>Delete cloud backup</button></div>{cloudAction&&<div className="clarification"><p>{cloudAction==='restore'?'Replace this device’s profiles, settings, and custom phrases with the backup? Current message input will be cleared.':'Delete the saved cloud content? Local settings remain. A content-free revision marker prevents stale writes from restoring deleted data.'}</p><div className="action-row"><button type="button" className="action-button" disabled={syncing} onClick={async()=>{setSyncing(true);try{const ok=await (cloudAction==='restore'?restoreCloud():deleteCloud());setNotice(ok?'Operation completed.':'Operation did not complete; check the storage status.');}finally{setSyncing(false);setCloudAction(null);}}}>Confirm {cloudAction}</button><button type="button" className="action-button" disabled={syncing} onClick={()=>setCloudAction(null)}>Cancel</button></div></div>}</div>
    <div className="setting-description"><h3>Install on this device</h3><p role="status">{offlineStatus}</p>{isInstalled?<p>The app is installed.</p>:canInstall?<button type="button" className="action-button" onClick={async()=>{const installed=await promptInstall();setNotice(installed?'Installation accepted. Your browser will finish installing the app.':'Installation was not completed.');}}><Download aria-hidden="true"/>Install app</button>:<p>{isIOS?'In Safari, use Share, then Add to Home Screen.':'Use your browser’s install option if available.'}</p>}</div>
    <label className="setting-field">Optional emotion preference<select value={preferences.selectedEmotion||'none'} onChange={e=>updatePreferences({selectedEmotion:e.target.value as SupportedEmotion})}>{['none','calm','sad','stressed','uncomfortable','angry','tired'].map(value=><option key={value} value={value}>{value==='none'?'None':value.charAt(0).toUpperCase()+value.slice(1)}</option>)}</select><span className="quiet-hint">Saved preference only; it does not change the meaning of your messages.</span></label>
    <div className="setting-description"><h3>Saved data</h3><div className="action-row"><button type="button" className="action-button" onClick={()=>{clearHistory();setNotice('Message history cleared.');}}>Clear message history</button><button type="button" className="action-button danger-outline" onClick={()=>setConfirmReset(true)}>Reset saved app data</button></div>{confirmReset&&<div className="clarification"><p>This resets local profiles, preferences, custom phrases, and history to defaults. It does not delete a cloud backup.</p><div className="action-row"><button type="button" className="action-button danger-button" onClick={async()=>{getSpeechController().clearMemory();const ok=await resetLocal();setConfirmReset(false);setNotice(ok?'Saved app data reset to defaults.':'Session reset, but saved data could not be fully cleared. Close other app tabs and check browser storage permissions.');}}>Confirm reset</button><button type="button" className="action-button" onClick={()=>setConfirmReset(false)}>Keep my data</button></div></div>}</div>
   </div>}
   {notice&&<p role="status" className="notice">{notice}</p>}
  </section>
 </div>;
}
