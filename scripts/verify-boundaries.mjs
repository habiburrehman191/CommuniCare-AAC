import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const names=(await readdir('dist/assets')).filter(name=>/\.(js|css)$/.test(name));
assert.ok(names.some(name=>name.endsWith('.js')),'Build must exist before this check');
for(const name of names){
 const text=await readFile('dist/assets/'+name,'utf8');
 assert.doesNotMatch(text,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
 assert.doesNotMatch(text,/GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|generativelanguage\.googleapis\.com|VITE_GEMINI/i);
 assert.doesNotMatch(text,/AZURE_SPEECH_KEY|Ocp-Apim-Subscription-Key|tts\.speech\.microsoft\.com|cognitiveservices\/v1/i);
 if(process.env.AZURE_SPEECH_KEY){assert.ok(!text.includes(process.env.AZURE_SPEECH_KEY),'Client assets must not contain AZURE_SPEECH_KEY value');}
}
const html=await readFile('dist/index.html','utf8');
assert.doesNotMatch(html,/fonts\.googleapis\.com|fonts\.gstatic\.com/);
const worker=await readFile('dist/sw.js','utf8');
assert.doesNotMatch(worker,/__SHELL_BUILD__|__SHELL_ASSETS__/);
console.log('Production boundary checks passed: no provider endpoint/key references in client assets, private-key blocks, remote fonts or unbuilt worker placeholders.');
