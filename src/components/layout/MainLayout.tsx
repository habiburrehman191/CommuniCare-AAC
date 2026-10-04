import { useOfflineShell } from '@/hooks/useOfflineShell';
import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { HeaderSection } from '@/sections/HeaderSection';
import { useOfflineSync, usePWAInstall } from '@/hooks';
import { useCommunicationStore } from '@/store/communicationStore';
import { AppServicesContext } from './AppServices';
export function MainLayout() {
 const sync=useOfflineSync();
 const offlineStatus=useOfflineShell();
 const install=usePWAInstall();
 const highContrast=useCommunicationStore(s=>s.preferences.highContrast);
 const location=useLocation();
 const main=useRef<HTMLElement>(null);
 const previousPath=useRef(location.pathname);
 useEffect(()=>{
   if(previousPath.current!==location.pathname) {main.current?.focus();window.scrollTo(0,0);}
   previousPath.current=location.pathname;
 },[location.pathname]);
 return <AppServicesContext.Provider value={{...sync,...install,offlineStatus}}>
  <div className="app-shell" data-contrast={highContrast?'high':'normal'}>
   <a className="skip-link" href="#main-content">Skip to main content</a>
   <HeaderSection/>
   <main ref={main} tabIndex={-1} id="main-content" className="app-main"><Outlet/></main>
  </div>
 </AppServicesContext.Provider>;
}
