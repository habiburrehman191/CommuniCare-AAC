import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PersistenceOwner, type CloudPort, type PersistenceStore} from '../../src/features/persistence/persistenceOwner';
import {STORAGE_KEY,LEGACY_STORAGE_KEYS,defaultStoredState,validateStoredState,validateBackupState,readStoredState,saveStoredState,type StoragePort} from '../../src/lib/storage';
import type {AACStoredState,SyncStatus} from '../../src/types';
import {useCommunicationStore as store} from '../../src/store/communicationStore';
import {initialPhrases} from '../../src/data/phrases';
class MemoryStorage implements StoragePort {
 data=new Map<string,string>();writes=0;blocked=false;
 getItem(key:string){if(this.blocked)throw new Error('blocked');return this.data.get(key)??null;}
 setItem(key:string,value:string){if(this.blocked)throw new Error('quota');this.writes++;this.data.set(key,value);}
 removeItem(key:string){if(this.blocked)throw new Error('blocked');this.data.delete(key);}
}
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
function fixture(storage=new MemoryStorage(),cloud:()=>Promise<CloudPort|null>=async()=>null,timeout=1000){
 let state=validateStoredState(defaultStoredState),online=true;const listeners=new Set<()=>void>(),statuses:SyncStatus[]=[];
 const port:PersistenceStore={snapshot:()=>state,hydrate:s=>{state=s;},subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},status:s=>{statuses.push(s);}};
 const owner=new PersistenceOwner(port,storage,cloud,()=>online,timeout);
 const release=owner.attach();
 return {owner,storage,statuses,release,get state(){return state;},get listeners(){return listeners.size;},
 setOnline(value:boolean){online=value;owner.recover();},
 change(rate:number){state={...state,preferences:{...state.preferences,speechRate:rate}};listeners.forEach(fn=>fn());}};
}
test('first real preference change persists and reloads; reads do not rewrite timestamps',()=>{
 const f=fixture();const baseline=f.storage.writes;f.change(1.25);
 assert.equal(f.storage.writes,baseline+1);const loaded=readStoredState(f.storage).state;
 assert.equal(loaded.preferences.speechRate,1.25);assert.ok(loaded.updatedAt>0);
 assert.equal(readStoredState(f.storage).state.updatedAt,loaded.updatedAt);f.release();
});
test('one subscription across two owners of the same singleton lifecycle; StrictMode remount does not hydrate twice',()=>{
 const f=fixture();const release2=f.owner.attach();assert.equal(f.listeners,1);f.change(1.2);f.release();assert.equal(f.listeners,1);
 release2();assert.equal(f.listeners,0);const release3=f.owner.attach();assert.equal(f.state.preferences.speechRate,1.2);release3();
});
test('unrelated status/runtime updates do not produce writes or timestamps',()=>{
 const f=fixture();const n=f.storage.writes;f.owner.recover();assert.equal(f.storage.writes,n);f.release();
});
test('blocked and quota-limited storage never stop communication or claim local success',()=>{
 const storage=new MemoryStorage();storage.blocked=true;const f=fixture(storage);f.change(1.25);
 assert.equal(f.state.preferences.speechRate,1.25);assert.equal(f.statuses.at(-1),'Storage error');
 storage.blocked=false;f.setOnline(true);assert.equal(readStoredState(storage).state.preferences.speechRate,1.25);f.release();
});
test('legacy migration preserves valid preferences and custom phrases but purges history, counts, and hidden data',()=>{
 const storage=new MemoryStorage(),custom={...initialPhrases.find(p=>p.id==='food-water')!,id:'custom-water',isCustom:true};
 storage.setItem(LEGACY_STORAGE_KEYS[0],JSON.stringify({...defaultStoredState,version:2,customPhrases:[custom],preferences:{speechRate:1.3},phraseHistory:[{englishText:'private'}],communicationText:'secret',aiResponse:'secret',frequentlyUsed:{water:4}}));
 const f=fixture(storage),raw=storage.getItem(STORAGE_KEY)!;assert.ok(raw.includes('custom-water'));assert.equal(f.state.preferences.speechRate,1.3);
 assert.doesNotMatch(raw,/secret|private|aiResponse|communicationText/);assert.deepEqual(f.state.phraseHistory,[]);assert.deepEqual(f.state.frequentlyUsed,{});
 assert.equal(storage.getItem(LEGACY_STORAGE_KEYS[0]),null);f.release();
});
for(const malformed of ['{','null','[]','42','{"version":999}','{"profiles":[null,3,{}],"preferences":{"speechRate":-8,"speechVolume":"loud"}}'])test('safe reload of malformed/unsupported state: '+malformed,()=>{
 const storage=new MemoryStorage();storage.setItem(STORAGE_KEY,malformed);const state=readStoredState(storage).state;
 assert.equal(state.version,3);assert.ok(state.profiles.length);assert.equal(state.preferences.speechRate,1);assert.equal(state.preferences.speechVolume,1);
});
test('a malformed current document never resurrects a stale legacy copy',()=>{
 const storage=new MemoryStorage();storage.setItem(STORAGE_KEY,'{');storage.setItem(LEGACY_STORAGE_KEYS[0],JSON.stringify({...defaultStoredState,preferences:{speechRate:1.5}}));
 assert.equal(readStoredState(storage).state.preferences.speechRate,1);
});
test('failed migration retains its source until a successful new-format save',()=>{
 const storage=new MemoryStorage();storage.setItem(LEGACY_STORAGE_KEYS[0],JSON.stringify(defaultStoredState));
 const original=storage.setItem.bind(storage);storage.setItem=()=>{throw new Error('quota');};const f=fixture(storage);
 assert.ok(storage.data.has(LEGACY_STORAGE_KEYS[0]));storage.setItem=original;f.release();
});
test('runtime validation strips extra profile/custom fields and deduplicates profile identities',()=>{
 const base=validateStoredState({});const profile={...base.profiles[0],transcript:'private'};
 const state=validateStoredState({...base,profiles:[profile,profile],activeProfileId:'missing',preferences:{speechRate:Infinity,highContrast:'yes'}});
 assert.equal(state.profiles.length,1);assert.equal(state.activeProfileId,profile.id);assert.equal(state.preferences.speechRate,1);assert.equal(state.preferences.highContrast,false);assert.doesNotMatch(JSON.stringify(state),/private/);
});
test('reset removes every local legacy key and resets runtime before subsequent reload',()=>{
 const f=fixture();f.change(1.4);f.storage.setItem(LEGACY_STORAGE_KEYS[1],'old');
 assert.equal(f.owner.reset(),true);assert.equal(f.state.preferences.speechRate,1);assert.equal(f.storage.getItem(LEGACY_STORAGE_KEYS[1]),null);
 assert.equal(readStoredState(f.storage).state.preferences.speechRate,1);f.release();
});
test('reset reports blocked deletion rather than promising saved data was erased',()=>{
 const f=fixture();f.change(1.4);f.storage.blocked=true;assert.equal(f.owner.reset(),false);
 assert.equal(f.state.preferences.speechRate,1);assert.equal(f.statuses.at(-1),'Storage error');f.release();
});
test('storage events read current storage, not a stale event payload',()=>{
 const f=fixture();saveStoredState({...f.state,preferences:{...f.state.preferences,speechRate:1.35}},f.storage);
 f.owner.reloadFromStorage();assert.equal(f.state.preferences.speechRate,1.35);f.release();
});
test('Firebase is never initialized by startup, local edits, or online recovery',()=>{
 let calls=0;const f=fixture(new MemoryStorage(),async()=>{calls++;throw new Error('Firebase failure');});
 f.change(1.3);f.setOnline(false);f.setOnline(true);assert.equal(calls,0);f.release();
});
test('Firebase unavailable, read failure, and offline mode never claim Synced or write cloud data',async()=>{
 for(const factory of [async()=>null,async()=>({read:async()=>{throw new Error('denied');},write:async()=>{throw new Error('should not write');}})]){
  const f=fixture(new MemoryStorage(),factory);assert.equal(await f.owner.backup(),false);assert.equal(f.statuses.at(-1),'Backup failed');f.release();
 }
 const f=fixture();f.setOnline(false);assert.equal(await f.owner.backup(),false);assert.equal(f.statuses.at(-1),'Offline local');f.release();
});
test('success is published only after acknowledged current backup; snapshot excludes private input',async()=>{
 const gate=deferred<void>();let payload:AACStoredState|undefined;
 const f=fixture(new MemoryStorage(),async()=>({read:async()=>({revision:null,state:null}),write:async state=>{payload=state!;await gate.promise;}}));
 const pending=f.owner.backup();await Promise.resolve();await Promise.resolve();assert.equal(f.statuses.at(-1),'Sync pending');
 gate.resolve();assert.equal(await pending,true);assert.equal(f.statuses.at(-1),'Synced');assert.deepEqual(payload?.phraseHistory,[]);f.release();
});
test('a newer local change invalidates pending cloud writes and their success state',async()=>{
 const gate=deferred<void>();let committed=false;
 const f=fixture(new MemoryStorage(),async()=>({read:async()=>({revision:'v1',state:null}),write:async(_state,_revision,current)=>{await gate.promise;if(!current())throw new Error('conflict');committed=true;}}));
 const pending=f.owner.backup();await Promise.resolve();await Promise.resolve();f.change(1.4);gate.resolve();
 assert.equal(await pending,false);assert.equal(committed,false);assert.notEqual(f.statuses.at(-1),'Synced');f.release();
});
test('restore rejects a response after new input settings or reset instead of overwriting them',async()=>{
 const read=deferred<{revision:string;state:AACStoredState}>();const f=fixture(new MemoryStorage(),async()=>({read:()=>read.promise,write:async()=>{}}));
 const pending=f.owner.restore();f.change(1.3);read.resolve({revision:'v2',state:validateStoredState({})});assert.equal(await pending,false);assert.equal(f.state.preferences.speechRate,1.3);f.release();
});
test('reset and unmount invalidate pending cloud callbacks',async()=>{
 for(const end of ['reset','release']){
  const gate=deferred<{revision:null;state:null}>();let writes=0;const f=fixture(new MemoryStorage(),async()=>({read:()=>gate.promise,write:async()=>{writes++;}}));
  const pending=f.owner.backup();if(end==='reset')f.owner.reset();else f.release();gate.resolve({revision:null,state:null});
  assert.equal(await pending,false);assert.equal(writes,0);if(end==='reset')f.release();
 }
});
test('a hanging cloud request times out; late completion cannot change status',async()=>{
 const gate=deferred<{revision:null;state:null}>();const f=fixture(new MemoryStorage(),async()=>({read:()=>gate.promise,write:async()=>{throw new Error('stale');}}),10);
 assert.equal(await f.owner.backup(),false);assert.equal(f.statuses.at(-1),'Backup failed');gate.resolve({revision:null,state:null});await Promise.resolve();assert.equal(f.statuses.at(-1),'Backup failed');f.release();
});
test('backup deletion writes only a content-free revision marker, never rehydrates local content',async()=>{
 let value:unknown='untouched';const f=fixture(new MemoryStorage(),async()=>({read:async()=>({revision:'old',state:validateStoredState({})}),write:async(state,revision)=>{assert.equal(revision,'old');value=state;}}));
 f.change(1.25);assert.equal(await f.owner.deleteBackup(),true);assert.equal(value,null);assert.equal(f.state.preferences.speechRate,1.25);f.release();
});
test('strict cloud schema rejects hidden AI/transcript fields and malformed backups',()=>{
 const state=validateStoredState({});assert.ok(validateBackupState(state));
 for(const value of [{...state,transcript:'private'},{...state,preferences:{...state.preferences,speechRate:9}},{...state,profiles:[]},{foo:'bar'}])assert.equal(validateBackupState(value),null);
});
test('real store profile, mode, and profile-list changes cannot leave stale generated text',()=>{
 store.getState().initFromStoredState(defaultStoredState);store.getState().setCommunicationText('I need water');
 store.getState().selectCandidate(store.getState().resolution.candidates[0].id);
 store.getState().setActiveProfile(store.getState().profiles[1]);
 assert.equal(store.getState().generatedMessage,null);assert.equal(store.getState().communicationText,'');
 assert.equal(store.getState().preferences.messageMode,store.getState().communicationMode);
 store.getState().setCommunicationMode('sentence');assert.equal(store.getState().activeProfile?.communicationPreference,'sentence');
 store.getState().setProfiles([store.getState().profiles[2]]);assert.equal(store.getState().activeProfile?.id,'profile-adult');
 assert.equal(store.getState().getFullStoredState().activeProfileId,'profile-adult');
});
test('real transcript, generated output, history and AI fields do not survive persistence/reload',()=>{
 store.getState().setCommunicationText('mujhe pani nahi chahiye');
 store.getState().addHistoryItem({id:'private',englishText:'private',urduText:'نجی',mode:'sentence',timestamp:new Date().toISOString()});
 const raw=JSON.stringify(store.getState().getFullStoredState());assert.doesNotMatch(raw,/mujhe|private|نجی|communicationText|generatedMessage/);
 store.getState().initFromStoredState(JSON.parse(raw));assert.equal(store.getState().communicationText,'');assert.equal(store.getState().generatedMessage,null);assert.deepEqual(store.getState().phraseHistory,[]);
});

test('legacy disk cleanup is scoped to the configured Firebase project and reports blocked deletion', async()=>{
 const {clearLegacyFirebaseCache}=await import('../../src/features/persistence/legacyCache');
 const deleted:string[]=[];
 const fake={databases:async()=>[{name:'firestore/[DEFAULT]/this-project/main'},{name:'firestore/[DEFAULT]/other-project/main'},{name:'firebaseLocalStorageDb'},{name:'unrelated'}],
 deleteDatabase:(name:string)=>{deleted.push(name);const request={} as IDBOpenDBRequest;queueMicrotask(()=>request.onsuccess?.({} as Event));return request;}} as unknown as IDBFactory;
 assert.equal(await clearLegacyFirebaseCache('this-project',fake),true);
 assert.deepEqual(deleted,['firestore/[DEFAULT]/this-project/main']);
 const blocked={...fake,deleteDatabase:()=>{const request={} as IDBOpenDBRequest;queueMicrotask(()=>request.onblocked?.({} as IDBVersionChangeEvent));return request;}} as IDBFactory;
 assert.equal(await clearLegacyFirebaseCache('this-project',blocked),false);
 assert.equal(await clearLegacyFirebaseCache(undefined,fake),true);
});
