import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { doc, getDoc, getFirestore, runTransaction } from 'firebase/firestore/lite';
import { validateStoredState, validateBackupState } from './storage';
import type { CloudPort, CloudSnapshot } from '@/features/persistence/persistenceOwner';

const env=import.meta.env ?? {};
const config={apiKey:env.VITE_FIREBASE_API_KEY,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.VITE_FIREBASE_PROJECT_ID,appId:env.VITE_FIREBASE_APP_ID};
export const isFirebaseConfigured=()=>Boolean(config.apiKey&&config.authDomain&&config.projectId&&config.appId);
let authPromise:Promise<string>|null=null;
function app(){return getApps().length?getApp():initializeApp(config);}
async function stateRef(){
 if(!isFirebaseConfigured())throw new Error('unavailable');
 const auth=getAuth(app());
 await auth.authStateReady();
 if(!auth.currentUser){
  authPromise??=signInAnonymously(auth).then(r=>r.user.uid).finally(()=>{authPromise=null;});
  await authPromise;
 }
 if(!auth.currentUser)throw new Error('unavailable');
 return doc(getFirestore(app()),'userStates',auth.currentUser.uid);
}
function decode(data:Record<string,unknown>|undefined):CloudSnapshot {
 if(!data)return {revision:null,state:null};
 if(typeof data.revision==='string'){
  if(data.deleted===true)return {revision:data.revision,state:null};
  if(data.deleted!==false||!data.state||typeof data.state!=='object')throw new Error('invalid-backup');
  const state=validateBackupState(data.state);if(!state)throw new Error('invalid-backup');
  return {revision:data.revision,state};
 }
 // A legacy backup may be explicitly restored/migrated, but is never auto-applied.
 if(data.version===2)return {revision:'legacy',state:validateStoredState(data)};
 throw new Error('invalid-backup');
}
export const firebaseBackup:CloudPort={
 async read(){const snapshot=await getDoc(await stateRef());return decode(snapshot.exists()?snapshot.data():undefined);},
 async write(state,expected,current){
  const ref=await stateRef();
  if(!current())throw new Error('conflict');
  // Lite has no disk cache or offline write queue. Pin the revision across retries.
  await runTransaction(getFirestore(app()),async transaction=>{
   const snapshot=await transaction.get(ref);
   const remote=decode(snapshot.exists()?snapshot.data():undefined);
   if(!current()||remote.revision!==expected)throw new Error('conflict');
   transaction.set(ref,state===null?{revision:crypto.randomUUID(),deleted:true}:
    {revision:crypto.randomUUID(),deleted:false,state:validateStoredState({...state,signature:undefined})});
  },{maxAttempts:3});
 },
};
