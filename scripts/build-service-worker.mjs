import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildServiceWorker(directory,templatePath='public/sw.js'){
 const names=['index.html','manifest.json'];
 for(const name of await readdir(directory))if(/^icon-\d+x\d+\.png$/.test(name))names.push(name);
 const walk=async(folder)=>{for(const entry of await readdir(path.join(directory,folder),{withFileTypes:true})){const name=folder+'/'+entry.name;if(entry.isDirectory())await walk(name);else if(/\.(?:js|css|woff2?|png|svg|webp)$/.test(name))names.push(name);}};
 await walk('assets');
 if(!names.some(name=>name.endsWith('.js'))||!names.some(name=>name.endsWith('.css')))throw new Error('Missing built app assets');
 const assets=await Promise.all(names.sort().map(async name=>({url:'/'+name,sha256:hash(await readFile(path.join(directory,name)))})));
 const template=await readFile(templatePath,'utf8');
 const version=hash(template+JSON.stringify(assets)).slice(0,24);
 const worker=template.replace('__SHELL_BUILD__',JSON.stringify(version)).replace('__SHELL_ASSETS__',JSON.stringify(assets));
 await writeFile(path.join(directory,'sw.js'),worker);
 return {version,assets};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await buildServiceWorker(path.resolve('dist'));
 console.log('Offline shell: '+result.assets.length+' verified assets, build '+result.version);
}
