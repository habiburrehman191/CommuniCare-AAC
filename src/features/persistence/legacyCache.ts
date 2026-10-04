export async function clearLegacyFirebaseCache(projectId:string|undefined, database:IDBFactory|undefined):Promise<boolean> {
 if(!projectId||!database)return true;
 try {
  if(!database.databases)return false;
  const names=(await database.databases()).map(item=>item.name).filter((name):name is string=>Boolean(name?.startsWith('firestore/[DEFAULT]/'+projectId+'/')));
  const results=await Promise.all(names.map(name=>new Promise<boolean>(resolve=>{
   const request=database.deleteDatabase(name);
   request.onsuccess=()=>resolve(true);request.onerror=()=>resolve(false);request.onblocked=()=>resolve(false);
  })));
  return results.every(Boolean);
 }catch{return false;}
}
