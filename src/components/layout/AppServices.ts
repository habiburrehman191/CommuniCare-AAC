import { createContext, useContext } from 'react';
import type { useOfflineSync, usePWAInstall } from '@/hooks';
export const AppServicesContext=createContext<(ReturnType<typeof useOfflineSync> & ReturnType<typeof usePWAInstall> & {offlineStatus?:string}) | null>(null);
export function useAppServices() {
 const value=useContext(AppServicesContext);
 if(!value) throw new Error('App services require MainLayout');
 return value;
}
