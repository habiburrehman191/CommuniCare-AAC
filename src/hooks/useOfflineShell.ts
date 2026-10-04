import { useEffect, useState } from 'react';
export type OfflineStatus='Preparing offline access'|'Offline ready'|'Update ready — close all app tabs to apply'|'Offline setup failed — reconnect and reload'|'Offline setup requires a production build'|'Offline setup unavailable';
let registration:Promise<ServiceWorkerRegistration>|undefined;
export function useOfflineShell(){
 const [status,setStatus]=useState<OfflineStatus>(import.meta.env.PROD?'Preparing offline access':'Offline setup requires a production build');
 useEffect(()=>{
  if(!import.meta.env.PROD)return;
  if(!('serviceWorker' in navigator)){setStatus('Offline setup unavailable');return;}
  let disposed=false;
  const cleanups:Array<()=>void>=[];
  const publish=(value:OfflineStatus)=>{if(!disposed)setStatus(value);};
  registration??=navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(error=>{registration=undefined;throw error;});
  registration.then(reg=>{
   if(disposed)return;
   const update=()=>{
    if(reg.waiting)publish('Update ready — close all app tabs to apply');
    else if(reg.active)publish('Offline ready');
   };
   const watch=()=>{
    const worker=reg.installing;
    if(!worker){update();return;}
    const changed=()=>{if(worker.state==='redundant')publish('Offline setup failed — reconnect and reload');else update();};
    worker.addEventListener('statechange',changed);
    cleanups.push(()=>worker.removeEventListener('statechange',changed));
   };
   reg.addEventListener('updatefound',watch);cleanups.push(()=>reg.removeEventListener('updatefound',watch));watch();update();
   const recover=()=>{void reg.update().catch(()=>{if(!reg.active)publish('Offline setup failed — reconnect and reload');});};
   window.addEventListener('online',recover);cleanups.push(()=>window.removeEventListener('online',recover));
   void navigator.serviceWorker.ready.then(()=>update());
  }).catch(()=>publish('Offline setup failed — reconnect and reload'));
  return ()=>{disposed=true;cleanups.forEach(clean=>clean());};
 },[]);
 return status;
}
