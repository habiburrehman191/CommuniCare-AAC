import { ContextSwitcher } from '@/components/aac/SignatureControls';
import { getSpeechController } from '@/features/communication/speechController';
import { MessageCircle, Settings, ShieldAlert, UserRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useCommunicationStore } from '@/store/communicationStore';
export function HeaderSection() {
 const activeProfile=useCommunicationStore(s=>s.activeProfile);
 const language=useCommunicationStore(s=>s.preferences.preferredVoiceLang);
 const updatePreferences=useCommunicationStore(s=>s.updatePreferences);
 return <header className="app-header"><div className="header-inner">
   <NavLink to="/board" className="brand" aria-label="CommuniCare communication board"><span className="brand-icon"><MessageCircle aria-hidden="true"/></span><span>CommuniCare<span className="brand-caption">Your words. Your voice.</span></span></NavLink>
   <nav className="header-controls" aria-label="Main navigation">
    <NavLink to="/profiles" className="header-profile"><UserRound aria-hidden="true"/><span>{activeProfile?.displayName || 'Choose profile'}</span></NavLink>
    <label className="header-language"><span className="sr-only">Speech language</span><select aria-label="Speech language" value={language} onChange={e=>{getSpeechController().cancel();updatePreferences({preferredVoiceLang:e.target.value as 'auto'|'en'|'ur'});}}><option value="auto">English + اردو</option><option value="en">English</option><option value="ur">اردو</option></select></label>
    <ContextSwitcher/>
    <NavLink to="/settings" className="header-settings" aria-label="Settings"><Settings aria-hidden="true"/><span>Settings</span></NavLink>
    <NavLink to="/emergency" className="sos-link" aria-label="SOS emergency messages"><ShieldAlert aria-hidden="true"/><span>SOS</span></NavLink>
   </nav>
 </div></header>;
}
