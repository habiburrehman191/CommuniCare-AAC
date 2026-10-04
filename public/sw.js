/* Build placeholders are replaced by scripts/build-service-worker.mjs. */
const BUILD = __SHELL_BUILD__;
const ASSETS = __SHELL_ASSETS__;
const PREFIX = 'communicare-shell-v3-';
const CACHE = PREFIX + BUILD;
const ROUTES = new Set(['/', '/board', '/settings', '/emergency', '/profiles', '/caregiver']);
const manifest = new Map(ASSETS.map(asset => [new URL(asset.url, self.location.origin).href, asset.sha256]));
const COMPLETE = new URL('/__communicare_shell_complete__', self.location.origin).href;
async function verified(url) {
 const response = await fetch(new Request(url, {cache:'reload',credentials:'omit',redirect:'error'}));
 if(!response.ok || response.status !== 200 || response.type === 'opaque') throw new Error('Incomplete app shell');
 const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==manifest.get(url))throw new Error('App shell asset mismatch');
 return response;
}
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  // Verify all responses before writing, then wait for every put before cleanup.
  const fetched=await Promise.allSettled([...manifest.keys()].map(async url=>[url,await verified(url)]));
  if(fetched.some(result=>result.status==='rejected')){await caches.delete(CACHE);throw new Error('App shell download failed');}
  const cache=await caches.open(CACHE);
  const writes=await Promise.allSettled(fetched.map(result=>cache.put(result.value[0],result.value[1])));
  if(writes.some(result=>result.status==='rejected')){await caches.delete(CACHE);throw new Error('App shell cache failed');}
  try {await cache.put(COMPLETE,new Response(BUILD));}
  catch(error){await caches.delete(CACHE);throw error;}
  // Updates wait until old clients close. Never mix a new HTML shell with old chunks.
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  if(!await cache.match(COMPLETE))throw new Error('Incomplete app shell');
  const names=await caches.keys();
  await Promise.all(names.filter(name=>(name.startsWith(PREFIX)||name==='communicare-shell-v1')&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
async function asset(url) {
 const cache=await caches.open(CACHE);
 const cached=await cache.match(url);
 if(cached)return cached;
 try {const response=await verified(url);await cache.put(url,response.clone());return response;}
 catch {return new Response('Offline app shell unavailable. Reconnect and reopen the app.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
}
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||request.headers.has('Authorization'))return;
 const path=url.pathname.replace(/\/$/,'')||'/';
 if(request.mode==='navigate'&&ROUTES.has(path)){
  // A single public HTML document, not URL-specific or private navigation responses.
  event.respondWith(asset(new URL('/index.html',self.location.origin).href));return;
 }
 if(url.search||!manifest.has(url.href))return;
 event.respondWith(asset(url.href));
});
