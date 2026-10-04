import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import {buildServiceWorker} from '../../scripts/build-service-worker.mjs';
const template=await readFile('public/sw.js','utf8');
const digest=text=>createHash('sha256').update(text).digest('hex');
function environment(options={}){
 const files=new Map([['/index.html','<html><main>AAC shell</main></html>'],['/assets/app-hash.js','export const aac=true;'],['/assets/app-hash.css','body{color:black}'],['/assets/urdu.woff2','font-bytes']]);
 const descriptors=[...files].map(([url,body])=>({url,sha256:digest(body)}));
 const cachesData=options.caches??new Map(),events=new Map();let online=true,skip=0,claimed=0;
 const calls=[];
 const origin='https://aac.test';
 const cacheObject=entries=>({
  async put(url,response){if(options.failPut===new URL(url).pathname)throw Error('quota');entries.set(String(url),response.clone());},
  async match(url){return entries.get(String(url))?.clone();},
 });
 const caches={async open(name){if(!cachesData.has(name))cachesData.set(name,new Map());return cacheObject(cachesData.get(name));},async keys(){return [...cachesData.keys()];},async delete(name){return cachesData.delete(name);}};
 const fetch=async request=>{
  const url=new URL(typeof request==='string'?request:request.url);calls.push(url.href);
  if(!online||options.failFetch===url.pathname)throw Error('offline');
  const body=options.corrupt===url.pathname?'wrong revision':files.get(url.pathname);
  return new Response(body??'not found',{status:body===undefined?404:200});
 };
 const self={location:{origin},clients:{claim:async()=>{claimed++;}},skipWaiting:async()=>{skip++;},addEventListener:(name,listener)=>events.set(name,listener)};
 vm.runInNewContext(template.replace('__SHELL_BUILD__',JSON.stringify(options.build??'test-v1')).replace('__SHELL_ASSETS__',JSON.stringify(descriptors)),{self,caches,fetch,Request,Response,URL,Uint8Array,crypto:webcrypto,console});
 const dispatch=type=>{let pending;events.get(type)({waitUntil:p=>{pending=p;}});return pending;};
 return {files,cachesData,calls,get skip(){return skip;},get claimed(){return claimed;},
 install:()=>dispatch('install'),activate:()=>dispatch('activate'),offline:()=>{online=false;},online:()=>{online=true;},
 request(url,mode='cors',method='GET',headers={}){
  let pending;
  events.get('fetch')({request:{url:new URL(url,origin).href,mode,method,headers:new Headers(headers)},respondWith:p=>{pending=p;}});
  return pending;
 }};
}
test('install precaches every required byte and activation never forces a waiting update',async()=>{
 const e=environment();await e.install();await e.activate();assert.equal(e.skip,0);assert.equal(e.claimed,1);
 assert.equal(e.cachesData.get('communicare-shell-v3-test-v1').size,5);
});
for(const route of ['/','/board','/settings','/emergency','/board/','/settings?section=advanced'])test('offline startup and route reload: '+route,async()=>{
 const e=environment();await e.install();await e.activate();e.offline();const response=await e.request(route,'navigate');
 assert.equal(response.status,200);assert.match(await response.text(),/AAC shell/);
 for(const asset of ['/assets/app-hash.js','/assets/app-hash.css','/assets/urdu.woff2'])assert.equal((await e.request(asset)).status,200);
});
test('unknown/API/private requests, third-party origins, query assets and writes are never cached or intercepted',async()=>{
 const e=environment();await e.install();
 for(const [url,mode,method,headers] of [
  ['/api/private','cors','GET'],['/private/account','navigate','GET'],['https://firestore.googleapis.com/v1/users','cors','GET'],
  ['https://fonts.googleapis.com/css','cors','GET'],['/assets/app-hash.js?secret=1','cors','GET'],
  ['/assets/app-hash.js','cors','POST'],['/assets/app-hash.js','cors','GET',{Authorization:'Bearer secret'}],
 ])assert.equal(e.request(url,mode,method,headers),undefined);
 assert.ok(![...e.cachesData.values()].some(cache=>[...cache.keys()].some(key=>/secret|private|googleapis/.test(key))));
});
for(const failure of [{failFetch:'/assets/urdu.woff2'},{corrupt:'/assets/app-hash.js'},{failPut:'/assets/app-hash.css'},{failPut:'/__communicare_shell_complete__'}])test('partial install fails atomically: '+JSON.stringify(failure),async()=>{
 const e=environment(failure);await assert.rejects(e.install());assert.equal(e.cachesData.has('communicare-shell-v3-test-v1'),false);assert.equal(e.skip,0);
});
test('failed update preserves the previous complete cache',async()=>{
 const first=environment();await first.install();const next=environment({caches:first.cachesData,build:'test-v2',failFetch:'/assets/app-hash.js'});
 await assert.rejects(next.install());assert.ok(first.cachesData.has('communicare-shell-v3-test-v1'));
});
test('successful activation removes only old app caches, not unrelated caches',async()=>{
 const e=environment();e.cachesData.set('another-app-cache',new Map());e.cachesData.set('communicare-shell-v1',new Map());e.cachesData.set('communicare-shell-v3-old',new Map());
 await e.install();await e.activate();assert.deepEqual([...e.cachesData.keys()].sort(),['another-app-cache','communicare-shell-v3-test-v1']);
});
test('activation refuses an incomplete cache',async()=>{
 const e=environment();await assert.rejects(e.activate());assert.equal(e.claimed,0);
});
test('missing offline asset fails explicitly, then repairs when network returns',async()=>{
 const e=environment();await e.install();const cache=e.cachesData.get('communicare-shell-v3-test-v1');cache.delete('https://aac.test/assets/app-hash.js');
 e.offline();assert.equal((await e.request('/assets/app-hash.js')).status,503);e.online();
 assert.equal((await e.request('/assets/app-hash.js')).status,200);e.offline();assert.equal((await e.request('/assets/app-hash.js')).status,200);
});
test('online recovery cannot replace cached HTML with mismatched new-build content',async()=>{
 const e=environment();await e.install();e.files.set('/index.html','new unverified HTML');
 assert.match(await (await e.request('/board','navigate')).text(),/AAC shell/);
});
test('builder includes actual hashed chunks/fonts and changes cache version when content changes',async()=>{
 const base=path.resolve('node_modules/.cache/offline-tests');await mkdir(base,{recursive:true});const dir=await mkdtemp(path.join(base,'build-'));
 try{
  await mkdir(path.join(dir,'assets'));for(const [file,content] of [['index.html','shell'],['manifest.json','{}'],['assets/main-123.js','js'],['assets/main-123.css','css'],['assets/urdu.woff2','font'],['private.json','secret']])await writeFile(path.join(dir,file),content);
  const first=await buildServiceWorker(dir);assert.ok(first.assets.some(a=>a.url==='/assets/urdu.woff2'));assert.ok(!first.assets.some(a=>a.url.includes('private')));
  await writeFile(path.join(dir,'assets/main-123.css'),'new css');const second=await buildServiceWorker(dir);assert.notEqual(first.version,second.version);
  assert.doesNotMatch(await readFile(path.join(dir,'sw.js'),'utf8'),/__SHELL_BUILD__|__SHELL_ASSETS__/);
 }finally{assert.equal(path.dirname(dir),base);await rm(dir,{recursive:true,force:true});}
});
