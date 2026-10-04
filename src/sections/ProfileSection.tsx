import { emptyPersonalization } from '@/features/signature/types';
import { contextUrdu } from '@/features/signature/context';
import { Check, UserRound, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCommunicationStore } from '@/store/communicationStore';
export function ProfileSection() {
 const signature=useCommunicationStore(s=>s.signature);
 const profiles=useCommunicationStore(s=>s.profiles);
 const activeProfile=useCommunicationStore(s=>s.activeProfile);
 const setActiveProfile=useCommunicationStore(s=>s.setActiveProfile);
 return <div className="secondary-page"><Link to="/board" className="back-link"><ArrowLeft aria-hidden="true"/>Back to communication</Link><div className="page-heading"><h1>Choose a profile</h1><p>Choose whose local communication preferences to use. Messages and personal ordering stay on this device.</p></div>
  <div className="profile-grid">{profiles.map(profile=><button type="button" key={profile.id} className="profile-card" aria-pressed={activeProfile?.id===profile.id} onClick={()=>setActiveProfile(profile)}><UserRound className="profile-icon" aria-hidden="true"/><span className="profile-name">{profile.displayName}</span><span className="quiet-hint">{profile.primaryLanguage==='bilingual'?'English + Urdu':profile.primaryLanguage}</span><span className="profile-context">{(signature.profiles[profile.id]??emptyPersonalization()).context} · <span lang="ur" dir="rtl">{contextUrdu[(signature.profiles[profile.id]??emptyPersonalization()).context]}</span></span><span className="quiet-hint">{(signature.profiles[profile.id]??emptyPersonalization()).style} wording · local preferences</span><span className="profile-state">{activeProfile?.id===profile.id ? <><Check aria-hidden="true"/>Active profile</> : 'Select profile'}</span></button>)}</div>
 </div>;
}
