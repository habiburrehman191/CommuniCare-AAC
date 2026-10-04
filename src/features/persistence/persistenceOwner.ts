import type { AACStoredState, SyncStatus } from '@/types';
import { readStoredState, saveStoredState, deleteStoredState, removeLegacyState, validateStoredState, validateBackupState, type StoragePort } from '@/lib/storage';

export interface CloudSnapshot {revision:string|null;state:AACStoredState|null}
export interface CloudPort {
 read():Promise<CloudSnapshot>;
 write(state:AACStoredState|null,expected:string|null,current:()=>boolean):Promise<void>;
}
export interface PersistenceStore {
 snapshot():AACStoredState;
 activity?():unknown;
 hydrate(state:AACStoredState):void;
 subscribe(listener:()=>void):()=>void;
 status(status:SyncStatus):void;
}
export class PersistenceOwner {
 private unsubscribe:(()=>void)|null=null;
 private initialized=false;
 private leases=0;
 private applying=false;
 private fingerprint='';
 private revision=0;
 private operation=0;
 private busy=false;
 private saved=true;
 private stamp=0;
 private store:PersistenceStore;
 private storage:StoragePort;
 private cloud:()=>Promise<CloudPort|null>;
 private online:()=>boolean;
 private timeout:number;
 constructor(store:PersistenceStore,storage:StoragePort,cloud:()=>Promise<CloudPort|null>,online:()=>boolean,timeout=15000){
  this.store=store;this.storage=storage;this.cloud=cloud;this.online=online;this.timeout=timeout;
 }
 private content=()=>JSON.stringify({...this.store.snapshot(),updatedAt:0});
 private persist=()=>{
  this.stamp=Math.max(Date.now(),this.stamp+1);
  this.saved=saveStoredState({...this.store.snapshot(),updatedAt:this.stamp},this.storage);
  this.store.status(this.saved?(this.online()?'Local only':'Offline local'):'Storage error');
  return this.saved;
 };
 private changed=()=>{
  if(this.applying)return;
  const next=this.content();
  if(next===this.fingerprint)return;
  this.fingerprint=next;
  this.revision++;
  if(this.persist())this.store.status('Local changes not backed up');
 };
 attach=()=>{
  this.leases++;
  if(!this.initialized){
   this.initialized=true;
   const loaded=readStoredState(this.storage);
   this.store.hydrate(loaded.state);
   this.stamp=loaded.state.updatedAt;
   this.fingerprint=this.content();
   // Full replacement purges legacy/private fields before removing the migration source.
   if(this.persist() && !removeLegacyState(this.storage))this.store.status('Storage error');
   if(loaded.error)this.store.status('Storage error');
  }
  if(!this.unsubscribe)this.unsubscribe=this.store.subscribe(this.changed);
  let released=false;
  return ()=>{if(released)return;released=true;if(--this.leases===0){this.unsubscribe?.();this.unsubscribe=null;this.operation++;this.busy=false;}};
 };
 recover=()=>{
  if(!this.saved)this.persist();
  else if(!this.online())this.store.status('Offline local');
  else this.store.status('Local only');
 };
 reloadFromStorage=()=>{
  const loaded=readStoredState(this.storage);
  if(loaded.error){this.store.status('Storage error');return;}
  const next=JSON.stringify({...loaded.state,updatedAt:0});
  if(next===this.fingerprint)return;
  this.operation++;this.revision++;this.busy=false;this.applying=true;
  this.store.hydrate(loaded.state);this.fingerprint=this.content();this.stamp=loaded.state.updatedAt;
  this.applying=false;this.store.status('Local only');
 };
 reset=()=>{
  this.operation++;this.revision++;this.busy=false;this.applying=true;
  const removed=deleteStoredState(this.storage);
  this.store.hydrate(validateStoredState({}));
  this.fingerprint=this.content();this.applying=false;
  const saved=this.persist();
  if(!removed||!saved)this.store.status('Storage error');
  return removed&&saved;
 };
 private async run(task:(cloud:CloudPort,current:()=>boolean)=>Promise<boolean>):Promise<boolean>{
  if(this.busy)return false;
  if(!this.online()){this.store.status('Offline local');return false;}
  const token=++this.operation;this.busy=true;this.store.status('Sync pending');
  const current=()=>token===this.operation;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
   const work=(async()=>{const cloud=await this.cloud();if(!cloud||!current())throw new Error('unavailable');return task(cloud,current);})();
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),this.timeout);});
   const result=await Promise.race([work,timeout]);
   if(!current())return false;
   if(!result)this.store.status('Backup conflict');
   return result;
  }catch(error){
   if(current())this.store.status(error instanceof Error && error.message==='storage'?'Storage error':error instanceof Error && error.message==='conflict'?'Backup conflict':'Backup failed');
   return false;
  }finally{if(timer)clearTimeout(timer);if(current()){this.operation++;this.busy=false;}}
 }
 backup=()=>{const version=this.revision,state=this.store.snapshot();return this.run(async(cloud,current)=>{
  const remote=await cloud.read();
  if(!current())return false;
  const fresh=()=>current()&&version===this.revision;
  if(!fresh())return false;
  await cloud.write(state,remote.revision,fresh);
  if(!fresh())return false;
  this.store.status(this.saved?'Synced':'Storage error');
  return true;
 });};
 restore=()=>{const version=this.revision,activity=this.store.activity?.();return this.run(async(cloud,current)=>{
  const remote=await cloud.read();
  if(!current()||version!==this.revision||activity!==this.store.activity?.())return false;
  if(!remote.state)throw new Error('missing');
  const state=validateBackupState(remote.state);if(!state)throw new Error('invalid-backup');
  this.applying=true;
  this.store.hydrate(state);this.revision++;this.fingerprint=this.content();
  this.applying=false;
  const saved=this.persist();if(!saved)throw new Error('storage');this.store.status('Synced');
  return true;
 });};
 deleteBackup=()=>this.run(async(cloud,current)=>{
  const remote=await cloud.read();
  if(!current())return false;
  await cloud.write(null,remote.revision,current);
  if(!current())return false;
  this.store.status(this.saved?'Local only':'Storage error');
  return true;
 });
}
