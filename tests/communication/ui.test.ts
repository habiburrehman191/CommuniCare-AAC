import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, existsSync } from 'node:fs';
import { SymbolCard } from '../../src/components/aac/SymbolCard';
import { SentenceSuggestions } from '../../src/components/aac/SentenceSuggestions';
import { CategoryTabs } from '../../src/components/aac/CategoryTabs';
import { SelectedMessagePreview } from '../../src/components/aac/SelectedMessagePreview';
import { CommunicationBoardSection } from '../../src/sections/CommunicationBoardSection';
import { SettingsSection } from '../../src/sections/SettingsSection';
import { EmergencySection } from '../../src/sections/EmergencySection';
import { HeaderSection } from '../../src/sections/HeaderSection';
import { ProfileSection } from '../../src/sections/ProfileSection';
import { AppServicesContext } from '../../src/components/layout/AppServices';
import { initialPhrases, phraseCategories } from '../../src/data/phrases';
import { resolveIntent } from '../../src/features/communication/intentResolver';
import { useCommunicationStore as store } from '../../src/store/communicationStore';
import { defaultStoredState } from '../../src/lib/storage';
import type { ReactElement } from 'react';

const noop=()=>{};
const wrapped=(element:ReactElement,path='/board')=>render(h(MemoryRouter,{initialEntries:[path]},element));
const services={syncStatus:'Local only' as const,isOnline:false,forceSyncCloud:async()=>false,restoreCloud:async()=>false,deleteCloud:async()=>false,resetLocal:async()=>true,canInstall:false,isInstalled:false,isIOS:false,promptInstall:async()=>false};
const settings=(section:string)=>wrapped(h(AppServicesContext.Provider,{value:services},h(SettingsSection)),'/settings?section='+section);
const phrase=initialPhrases.find(p=>p.id==='food-water')!;
beforeEach(()=>{store.getState().initFromStoredState(defaultStoredState);store.getState().clearSelection();});
test('all 52 symbols render both labels, an accessible toggle, and no usage metadata',()=>{
 for(const phrase of initialPhrases){
  const html=render(h(SymbolCard,{phrase,onSelect:noop,isSelected:false}));
  assert.match(html,/type="button"/);assert.match(html,/aria-pressed="false"/);
  assert.ok(html.includes(phrase.labelUrdu));assert.match(html,/lang="ur" dir="rtl"/);
  assert.doesNotMatch(html,/Used \d|usageCount|Quick<|High-Priority/);
 }
});
test('selected symbol has both pressed semantics and a visible check',()=>{
 const html=render(h(SymbolCard,{phrase,onSelect:noop,isSelected:true}));
 assert.match(html,/aria-pressed="true"/);assert.match(html,/selection-check/);assert.match(html,/Remove Water/);
});
test('category navigation exposes all categories and a single active choice',()=>{
 const html=render(h(CategoryTabs));
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 assert.equal((html.match(/<button/g)||[]).length,phraseCategories.length);
 assert.doesNotMatch(html,/role="grid"|truncate|overflow-x-auto/);
});
test('three candidate cards remain unselected before an explicit choice',()=>{
 const resolution=resolveIntent({symbolIds:['food-water']});
 const html=render(h(SentenceSuggestions,{resolution,selectedId:null,disabled:false,onSelect:noop}));
 assert.equal((html.match(/<button/g)||[]).length,3);
 assert.equal((html.match(/aria-pressed="false"/g)||[]).length,3);
 assert.equal((html.match(/lang="ur" dir="rtl"/g)||[]).length,3);
 assert.ok(html.includes('I need water.'));
});
test('one selected candidate is visibly identified and others remain selectable',()=>{
 const resolution=resolveIntent({symbolIds:['food-water']});
 const html=render(h(SentenceSuggestions,{resolution,selectedId:resolution.candidates[1].id,disabled:false,onSelect:noop}));
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);assert.match(html,/>Selected</);
});
test('recognition busy state disables every candidate',()=>{
 const resolution=resolveIntent({symbolIds:['food-water']});
 const html=render(h(SentenceSuggestions,{resolution,selectedId:null,disabled:true,onSelect:noop}));
 assert.equal((html.match(/disabled=""/g)||[]).length,3);
});
test('ambiguity renders bilingual clarification with no selectable nonsense',()=>{
 const resolution=resolveIntent({symbolIds:['food-water','health-pain']});
 const html=render(h(SentenceSuggestions,{resolution,selectedId:null,disabled:false,onSelect:noop}));
 assert.match(html,/role="status"/);assert.match(html,/lang="ur" dir="rtl"/);assert.doesNotMatch(html,/<button/);
});
test('voice input without selection receives a useful preview instruction',()=>{
 const html=render(h(SelectedMessagePreview,{symbols:[],mode:'sentence',generatedMessage:null,hasInput:true}));
 assert.match(html,/Choose a sentence below/);assert.doesNotMatch(html,/What would you/);
});
test('main communication order is message, voice, candidates, symbols',()=>{
 const html=wrapped(h(CommunicationBoardSection));
 const positions=['message-surface','voice-surface','sentence-section','symbols-section'].map(value=>html.indexOf(value));
 assert.ok(positions.every((p,i)=>p>=0&&(i===0||p>positions[i-1])));
 assert.doesNotMatch(html,/<aside|Clinical|Analytics|Synced|Used \d|<ModeToggle/);
});
test('voice input retains labeled editable text, two modes, and live/final regions',()=>{
 const html=wrapped(h(CommunicationBoardSection));
 for(const text of ['Message text (editable)','value="en-US"','value="ur-PK"','Live transcript','Final transcript','role="status"'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/Exact controls|recognition diagnostics/);
});
test('header has identity, profile, language, settings, and SOS without dashboard clutter',()=>{
 const html=wrapped(h(HeaderSection));
 for(const text of ['CommuniCare','Speech language','Settings','SOS','/profiles'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/Clinical|>Pro<|Caregiver|Synced|Local Storage|Install PWA/);
});
for(const section of ['General','Communication','Accessibility','Advanced'])test('only '+section+' settings panel renders',()=>{
 const html=settings(section.toLowerCase());
 assert.equal((html.match(/role="tabpanel"/g)||[]).length,1);
 assert.equal((html.match(/aria-selected="true"/g)||[]).length,1);
 assert.match(html,new RegExp('id="panel-'+section+'"'));
 assert.match(html,new RegExp('aria-labelledby="tab-'+section+'"'));
});
test('settings tabs expose correct roving focus and technical controls stay in Advanced',()=>{
 const html=settings('general');
 assert.equal((html.match(/role="tab"/g)||[]).length,4);
 assert.equal((html.match(/tabindex="-1"/g)||[]).length,3);
 assert.doesNotMatch(html,/Back up now|Reset saved app data|Optional emotion preference/);
 const advanced=settings('advanced');
 for(const text of ['Back up now','Reset saved app data','Voice input help','Optional emotion preference'])assert.ok(advanced.includes(text));
});
test('communication controls have labeled ranges and honest missing Urdu voice status',()=>{
 const html=settings('communication');
 assert.equal((html.match(/type="range"/g)||[]).length,3);
 for(const label of ['Speech speed','Voice pitch','Speech volume','Not available on this device','Test Speech Output'])assert.ok(html.includes(label));
});
test('accessibility setting exposes the existing high-contrast preference',()=>{
 assert.match(settings('accessibility'),/type="checkbox"/);
 const source=readFileSync('src/sections/SettingsSection.tsx','utf8');
 assert.ok(source.includes('checked={!!preferences.highContrast}'));
 assert.ok(source.includes('updatePreferences({highContrast:e.target.checked})'));
});
test('emergency initial state has explicit SOS and silent message cards',()=>{
 const html=wrapped(h(EmergencySection),'/emergency');
 assert.match(html,/Speak SOS Help/);assert.match(html,/Choose a message below/);
 assert.doesNotMatch(html,/Stop Speaking|animate-|Critical Alert|High-Priority/);
 assert.equal((html.match(/aria-pressed="false"/g)||[]).length,3);
 assert.match(html,/SOS does not call or contact anyone/);
});
test('profile choices expose active state without unimplemented calibration claims',()=>{
 const html=wrapped(h(ProfileSection),'/profiles');
 assert.match(html,/aria-pressed="true"/);assert.doesNotMatch(html,/calibrat|Clinical|word mode|sentence mode/);
});
test('legacy dashboard components are retired and root opens communication',()=>{
 for(const file of ['AACBoard','ModeToggle'])assert.equal(existsSync('src/components/aac/'+file+'.tsx'),false);
 assert.equal(existsSync('src/sections/CaregiverDashboardSection.tsx'),false);
 const router=readFileSync('src/app/AppRouter.tsx','utf8');
 assert.match(router,/Route index element=\{<Navigate to="\/board" replace/);
});
test('global presentation includes reduced motion, contrast, visible focus and hidden loading semantics',()=>{
 const css=readFileSync('src/index.css','utf8');
 for(const text of ['prefers-reduced-motion:reduce',':focus-visible','data-contrast="high"','#loading.hidden { visibility:hidden; }'])assert.ok(css.includes(text));
 assert.doesNotMatch(css,/overflow-x:\s*hidden/);
});

test('Communication settings connect a labeled custom editor to reviewed bilingual content',()=>{
 const html=settings('communication');
 for(const label of ['Custom symbols','Reviewed message','English symbol label','Urdu symbol label','Add custom symbol'])assert.ok(html.includes(label));
 assert.match(html,/maxlength="80"/i);assert.match(html,/lang="ur" dir="rtl"/);
 assert.doesNotMatch(settings('general'),/Add custom symbol/);
});
