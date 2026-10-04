import { clearLegacyFirebaseCache } from '@/features/persistence/legacyCache';
import { getSpeechController } from '@/features/communication/speechController';
import { useEffect } from 'react';
import { useCommunicationStore } from '@/store/communicationStore';
import { PersistenceOwner } from '@/features/persistence/persistenceOwner';
import { useNetworkStatus } from './useNetworkStatus';
import { STORAGE_KEY, LEGACY_STORAGE_KEYS } from '@/lib/storage';

let owner:PersistenceOwner|undefined;
export function getPersistenceOwner(){
 if(!owner)owner=new PersistenceOwner({
  snapshot:()=>useCommunicationStore.getState().getFullStoredState(),
  activity:()=>{const state=useCommunicationStore.getState();return state.generatedMessage??state.resolution;},
  hydrate:state=>{getSpeechController().clearMemory();useCommunicationStore.getState().initFromStoredState(state);},
  subscribe:listener=>useCommunicationStore.subscribe((state,previous)=>{if(state.activeProfile?.id!==previous.activeProfile?.id)getSpeechController().clearMemory();listener();}),
  status:status=>useCommunicationStore.getState().setSyncStatus(status),
 },{
  getItem:key=>window.localStorage.getItem(key),
  setItem:(key,value)=>window.localStorage.setItem(key,value),
  removeItem:key=>window.localStorage.removeItem(key),
 },async()=>{
  const module=await import('@/lib/firebase');
  return module.isFirebaseConfigured()?module.firebaseBackup:null;
 },()=>navigator.onLine);
 return owner;
}
export function useOfflineSync(){
 const {isOnline}=useNetworkStatus();
 const syncStatus=useCommunicationStore(s=>s.syncStatus);
 useEffect(()=>{
  const persistence=getPersistenceOwner(),release=persistence.attach();
  void clearLegacyFirebaseCache(import.meta.env.VITE_FIREBASE_PROJECT_ID,window.indexedDB).then(ok=>{if(!ok)useCommunicationStore.getState().setSyncStatus('Storage error');});
  const recover=()=>persistence.recover();
  const storage=(event:StorageEvent)=>{if(event.key===null||[STORAGE_KEY,...LEGACY_STORAGE_KEYS].includes(event.key))persistence.reloadFromStorage();};
  window.addEventListener('online',recover);window.addEventListener('offline',recover);window.addEventListener('storage',storage);
  return ()=>{release();window.removeEventListener('online',recover);window.removeEventListener('offline',recover);window.removeEventListener('storage',storage);};
 },[]);
 return {syncStatus,isOnline,forceSyncCloud:()=>getPersistenceOwner().backup(),
  restoreCloud:()=>getPersistenceOwner().restore(),deleteCloud:()=>getPersistenceOwner().deleteBackup(),
  resetLocal:async()=>{const reset=getPersistenceOwner().reset();const cleared=await clearLegacyFirebaseCache(import.meta.env.VITE_FIREBASE_PROJECT_ID,window.indexedDB);if(!cleared)useCommunicationStore.getState().setSyncStatus('Storage error');return reset&&cleared;}};
}
