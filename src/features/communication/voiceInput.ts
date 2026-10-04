import { initialPhrases } from '../../data/phrases';
import { resolveIntent, validCustomPhrases } from './intentResolver';
import { normalizeUtterance } from './voiceCommands';
import type { Phrase } from '../../types';

export function normalizeRomanUrdu(text: string): string {
  const s = text.normalize('NFKC').toLowerCase().trim().replace(/[.!۔]+$/gu, '').replace(/\s+/gu, ' ');
  return s
    .replace(/\b(mjhe|muje|mujhey)\b/g, 'mujhe')
    .replace(/\b(paani|paane)\b/g, 'pani')
    .replace(/\b(chahye|chaheye|chahie|chaheay|chaye)\b/g, 'chahiye')
    .replace(/\b(nahin|nahe|nhe)\b/g, 'nahi')
    .replace(/\b(khaana)\b/g, 'khana')
    .replace(/\b(bhuk|bhukh)\b/g, 'bhook')
    .replace(/\b(pait)\b/g, 'pet')
    .replace(/\b(dawai|dawo)\b/g, 'dawa')
    .replace(/\b(ammi|mama)\b/g, 'ami')
    .replace(/\b(abbu|baba|papa)\b/g, 'abu')
    .replace(/\b(thand|thund)\b/g, 'sardi')
    .replace(/\b(garm)\b/g, 'garmi')
    .replace(/\b(tabiat|tabeeat)\b/g, 'tabiyat')
    .replace(/\b(khraab)\b/g, 'kharab')
    .replace(/\b(washroom|toilet)\b/g, 'bathroom')
    .replace(/\b(jaana)\b/g, 'jana')
    .replace(/\b(soona)\b/g, 'sona')
    .replace(/\b(udaas)\b/g, 'udas')
    .replace(/\b(darr)\b/g, 'dar')
    .replace(/\b(shukria)\b/g, 'shukriya')
    .replace(/\b(salaam)\b/g, 'salam')
    .replace(/\b(thakan|thaka)\b/g, 'thak')
    .replace(/\b(peena|pina)\b/g, 'peena')
    .replace(/\b(neend|nend)\b/g, 'neend')
    .replace(/\b(maddad)\b/g, 'madad')
    .replace(/\b(karain|karen|kijiye|kijye)\b/g, 'karein');
}

export function stripPoliteMarkers(text: string): string {
  return text
    .replace(/^\s*(?:please|plz|barah\s*e\s*karam|meherbani\s*(?:karke)?)\s+/iu, '')
    .replace(/\s+(?:please|plz|barah\s*e\s*karam|meherbani\s*(?:karke)?)\s*$/iu, '')
    .trim();
}

/** Bidirectional loan-word normalization for supported AAC vocabulary. Negation words are never altered. */
export function normalizeMixedUtterance(text: string): string[] {
  const norm = normalizeUtterance(text);
  const variants: string[] = [];

  // English loan words in Roman Urdu context -> Urdu concept
  const toUrdu = norm
    .replace(/\bwater\b/g, 'pani')
    .replace(/\b(medicine|meds)\b/g, 'dawa')
    .replace(/\bhelp\b/g, 'madad')
    .replace(/\bfood\b/g, 'khana')
    .replace(/\bhungry\b/g, 'bhook');
  if (toUrdu !== norm) variants.push(toUrdu);

  // Roman Urdu words in English context -> English concept
  const toEnglish = norm
    .replace(/\b(pani|paani)\b/g, 'water')
    .replace(/\b(khana|khaana)\b/g, 'food')
    .replace(/\b(dawa|dawai)\b/g, 'medicine')
    .replace(/\bmadad\b/g, 'help')
    .replace(/\bghar\b/g, 'home');
  if (toEnglish !== norm && !variants.includes(toEnglish)) variants.push(toEnglish);

  return variants;
}


/** An exact alias adapter; the Step 1 resolver still owns all semantics. */
const aliases: [string[], string[]][] = [
  // Basic Needs
  [['haan','han','ہاں','جی ہاں','jee haan','yes please','yes'],['basic-yes']],
  [['nahi','nahin','جی نہیں','jee nahi','no thank you','no thanks','no'],['basic-no']],
  [['bathroom jana hai','mujhe bathroom jana hai','toilet','washroom','washroom jana hai','toilet jana hai','باتھ روم جانا ہے','مجھے باتھ روم جانا ہے','واش روم جانا ہے','I need the bathroom','I want to use the bathroom','go to the bathroom','need the toilet','need washroom','use the bathroom'],['basic-bathroom']],

  // Food & Drink
  [['pani','paani','mujhe pani chahiye','mujhe paani chahiye','pani chahiye','pani do','pani peena hai','pyas lagi hai','pyaas lagi hai','مجھے پانی چاہیے','پانی چاہیے','پانی دو','پانی پینا ہے','پیاس لگی ہے','I want water','I need water','can I have water','can I get water','could I have water','I am thirsty','drink water','water please','give me water','I would like water'],['food-water']],
  [['mujhe pani nahi chahiye','mujhe paani nahin chahiye','pani nahi chahiye','pani nahi peena','مجھے پانی نہیں چاہیے','پانی نہیں چاہیے','پانی نہیں پینا','I do not want water','I don\'t want water','I do not need water','I don\'t need water'],['basic-not','food-water']],

  [['khana','mujhe khana chahiye','khana chahiye','khana do','mujhe bhook lagi hai','bhook lagi hai','kuch khana hai','مجھے کھانا چاہیے','کھانا چاہیے','کھانا دو','مجھے بھوک لگی ہے','بھوک لگی ہے','کچھ کھانا ہے','I need food','I am hungry','I want food','something to eat','food please','give me food'],['food-hungry']],
  [['mujhe khana nahi chahiye','khana nahi chahiye','bhook nahi hai','bhook nahi lagi','مجھے کھانا نہیں چاہیے','کھانا نہیں چاہیے','بھوک نہیں لگی','بھوک نہیں ہے','I do not want food','I don\'t want food','I do not need food','I don\'t need food','I am not hungry'],['basic-not','food-hungry']],

  [['khana khana hai','I want to eat'],['actions-eat']],

  [['juice','juice chahiye','juice peena hai','mujhe juice chahiye','جوس چاہیے','مجھے جوس چاہیے','I need juice','I want juice','can I have juice','drink juice','juice please'],['food-juice']],
  [['juice nahi chahiye','جوس نہیں چاہیے','I do not want juice','I don\'t want juice','I do not need juice','I don\'t need juice'],['basic-not','food-juice']],

  [['mujhe pani aur khana chahiye','I need water and food','I want water and food','مجھے پانی اور کھانا چاہیے'],['food-water','basic-and','food-hungry']],

  // Health
  [['dawa','dawai','mujhe dawa chahiye','mujhe dawai chahiye','dawa chahiye','dawai chahiye','dawa do','medicine chahiye','mujhe medicine chahiye','medicine do','take medicine','my medicine','give me medicine','مجھے دوا چاہیے','دوا چاہیے','دوا دو','میری دوا','مجھے دوائی چاہیے','دوائی چاہیے','I need medicine','I want medicine','I need my medicine'],['health-medicine']],
  [['dawa nahi chahiye','dawai nahi chahiye','mujhe dawa nahi chahiye','medicine nahi chahiye','mujhe medicine nahi chahiye','مجھے دوا نہیں چاہیے','دوا نہیں چاہیے','دوائی نہیں چاہیے','I do not need medicine','I don\'t need medicine','I do not want medicine','I don\'t want medicine','I do not want my medicine'],['basic-not','health-medicine']],

  [['doctor','doctor ko dikhana hai','doctor ke paas jana hai','doctor chahiye','ڈاکٹر کو دکھانا ہے','ڈاکٹر چاہیے','I need a doctor','see a doctor','call a doctor','I want to see a doctor'],['health-doctor']],

  [['hospital','hospital jana hai','hospital le jao','ہسپتال جانا ہے','ہسپتال لے جاؤ','I want to go to the hospital','go to the hospital','take me to the hospital','I need to go to the hospital'],['health-hospital']],
  [['hospital nahi jana','ہسپتال نہیں جانا','I do not want to go to the hospital','I don\'t want to go to the hospital'],['basic-not','health-hospital']],

  [['dard','mujhe dard hai','dard ho raha hai','dard hai','مجھے درد ہے','درد ہو رہا ہے','درد ہے','I have pain','I am in pain','it hurts','I feel pain'],['health-pain']],
  [['mujhe dard nahi hai','mujhe dard nahin ho raha','dard nahi hai','dard nahi ho raha','مجھے درد نہیں ہے','درد نہیں ہے','I do not have pain','I don\'t have pain','I am not in pain','no pain'],['basic-not','health-pain']],

  [['sar dard','mera sar dard kar raha hai','mere sar mein dard hai','میرے سر میں درد ہو رہا ہے','میرے سر میں درد ہے','sar mein dard hai','sar dard hai','my head hurts','I have a headache','headache'],['health-headache']],
  [['mere sar mein dard nahi hai','sar dard nahi hai','sar mein dard nahi hai','میرے سر میں درد نہیں ہے','I do not have a headache','I don\'t have a headache','my head does not hurt'],['basic-not','health-headache']],

  [['pet dard','mere pait mein dard hai','pet mein dard hai','pet dard hai','میرے پیٹ میں درد ہے','پیٹ میں درد ہے','my stomach hurts','I have stomach pain','stomach pain','stomach ache'],['health-stomach-pain']],
  [['pet dard nahi hai','pet mein dard nahi hai','pait mein dard nahi hai','میرے پیٹ میں درد نہیں ہے','my stomach does not hurt','I do not have stomach pain','I don\'t have stomach pain'],['basic-not','health-stomach-pain']],

  [['meri tabiyat kharab hai','tabiyat kharab hai','main bimar hoon','bimar hoon','میری طبیعت خراب ہے','طبیعت خراب ہے','میں بیمار ہوں','بیمار ہوں','I feel sick','I feel unwell','I am sick','I am feeling sick','I am feeling unwell'],['health-sick']],
  [['tabiyat kharab nahi hai','bimar nahi hoon','main bimar nahi hoon','طبیعت خراب نہیں ہے','میں بیمار نہیں ہوں','I am not sick','I do not feel sick','I don\'t feel sick','I do not feel unwell','I don\'t feel unwell'],['basic-not','health-sick']],

  [['mujhe sardi lag rahi hai','sardi lag rahi hai','thand lag rahi hai','bohot sardi hai','bohot thand hai','مجھے سردی لگ رہی ہے','سردی لگ رہی ہے','ٹھنڈ لگ رہی ہے','I feel cold','I am cold','feeling cold','I am freezing'],['health-cold']],
  [['sardi nahi lag rahi','thand nahi lag rahi','mujhe sardi nahi lag rahi','سردی نہیں لگ رہی','ٹھنڈ نہیں لگ رہی','I don\'t feel cold','I do not feel cold','not cold'],['basic-not','health-cold']],

  [['mujhe garmi lag rahi hai','garmi lag rahi hai','bohot garmi hai','مجھے گرمی لگ رہی ہے','گرمی لگ رہی ہے','I feel hot','I am hot','feeling hot'],['health-hot']],
  [['garmi nahi lag rahi','mujhe garmi nahi lag rahi','گرمی نہیں لگ رہی','I don\'t feel hot','I do not feel hot','not hot'],['basic-not','health-hot']],

  // Emotions
  [['main thak gaya hoon','mujhe thakan ho rahi hai','thak gaya hoon','thakan ho rahi hai','میں تھک گیا ہوں','مجھے تھکن ہو رہی ہے','I am tired','I feel tired','I am exhausted'],['emotions-tired']],
  [['thak nahi gaya','thakan nahi hai','میں تھکا نہیں ہوں','I don\'t feel tired','I do not feel tired','I am not tired'],['basic-not','emotions-tired']],

  [['main khush hoon','khush hoon','میں خوش ہوں','خوش ہوں','I feel happy','I am happy'],['emotions-happy']],
  [['khush nahi hoon','main khush nahi hoon','میں خوش نہیں ہوں','I am not happy','I don\'t feel happy'],['basic-not','emotions-happy']],

  [['main udas hoon','main udaas hoon','udas hoon','udaas hoon','میں اداس ہوں','اداس ہوں','I feel sad','I am sad'],['emotions-sad']],
  [['udas nahi hoon','main udas nahi hoon','میں اداس نہیں ہوں','I am not sad','I don\'t feel sad'],['basic-not','emotions-sad']],

  [['mujhe dar lag raha hai','dar lag raha hai','مجھے ڈر لگ رہا ہے','ڈر لگ رہا ہے','I feel scared','I am scared'],['emotions-scared']],
  [['dar nahi lag raha','mujhe dar nahi lag raha','مجھے ڈر نہیں لگ رہا','I am not scared','I don\'t feel scared'],['basic-not','emotions-scared']],

  [['mujhe gussa aa raha hai','gussa aa raha hai','مجھے غصہ آ رہا ہے','I feel angry','I am angry'],['emotions-angry']],
  [['gussa nahi aa raha','مجھے غصہ نہیں آ رہا','I am not angry','I don\'t feel angry'],['basic-not','emotions-angry']],

  // Emergency
  [['mujhe madad chahiye abhi','madad','فوری مدد','madad chahiye','madad karo','madad karein','mujhe madad chahiye','help chahiye','mujhe help chahiye','meri help karein','meri help karo','meri madad karein','meri madad karain','meri madad karen','meri madad karo','meri madad kijiye','میری مدد کریں','مدد کریں','میری مدد کرو','مجھے مدد چاہیے','مدد چاہیے','میری مدد کیجیے','I need help','help me','help please','I need help now','please help me','help me please','please help','I require help'],['emergency-help']],
  [['madad nahi chahiye','mujhe madad nahi chahiye','help nahi chahiye','مدد نہیں چاہیے','مجھے مدد نہیں چاہیے','I do not need help','I do not want help'],['basic-not','emergency-help']],
  [['mujhe saans lene mein mushkil ho rahi hai','saans lene mein mushkil','saans nahi aa rahi','مجھے سانس لینے میں مشکل ہو رہی ہے','I am having trouble breathing','I have trouble breathing'],['emergency-breathe']],
  [['I am not having trouble breathing','مجھے سانس لینے میں مشکل نہیں ہو رہی'],['basic-not','emergency-breathe']],

  // Places
  [['mujhe ghar jana hai','ghar jana hai','ghar le jao','mujhe home jana hai','home jana hai','مجھے گھر جانا ہے','گھر جانا ہے','گھر لے جاؤ','I want to go home','take me home','go home','I need to go home'],['places-home']],
  [['mujhe ghar nahi jana','ghar nahi jana','مجھے گھر نہیں جانا','گھر نہیں جانا','I do not want to go home','I don\'t want to go home'],['basic-no','places-home']],
  [['school jana hai','اسکول جانا ہے','go to school','I want to go to school'],['places-school']],
  [['bahar jana hai','باہر جانا ہے','go outside','I want to go outside'],['places-outside']],

  // Actions
  [['mujhe sona hai','sona hai','neend aa rahi hai','مجھے سونا ہے','نیند آ رہی ہے','I want to sleep','go to sleep','time to sleep'],['actions-sleep']],
  [['sona nahi hai','mujhe sona nahi hai','سونا نہیں ہے','I do not want to sleep','I don\'t want to sleep'],['basic-not','actions-sleep']],
  [['mujhe khelna hai','khelna hai','مجھے کھیلنا ہے','I want to play'],['actions-play']],
  [['khelna nahi hai','mujhe khelna nahi hai','کھیلنا نہیں ہے','I do not want to play','I don\'t want to play'],['basic-not','actions-play']],
  [['ruk jao','رک جائیں','rok do','bas karo','please stop','stop it'],['actions-stop']],

  // Family
  [['ami ko bulayen','call my mother','امی کو بلائیں','ami ko bulao','ammi ko bulao','mama ko bulao','call my mom','call mom','call mama'],['actions-call','family-mother']],
  [['abu ko bulayen','call my father','ابو کو بلائیں','abu ko bulao','abbu ko bulao','baba ko bulao','call my dad','call dad','call papa'],['actions-call','family-father']],
  [['caregiver ko bulayen','call my caregiver','caregiver ko bulao','میرے نگہداشت کرنے والے کو بلائیں'],['actions-call','family-caregiver']],

  // Social
  [['salam','assalam o alaikum','hello'],['social-hello']],
  [['shukriya','shukria','thank you'],['social-thanks']],
  [['khuda hafiz','allah hafiz','goodbye'],['social-goodbye']],
];

export function resolveVoiceInput(text: string, customPhrases: Phrase[] = []) {
  let direct = resolveIntent({symbolIds:[],text}, customPhrases);
  if (direct.status === 'clarification') return direct;
  // Expand only meaning-preserving contractions; never remove a negative word.
  const expanded=text.replace(/\bI['’]m\b/gi,'I am').replace(/\bdon['’]t\b/gi,'do not').replace(/\bcan['’]t\b/gi,'cannot');
  if(expanded!==text){
    const result=resolveIntent({symbolIds:[],text:expanded},customPhrases);
    if(result.status==='clear')direct={...result,input:{symbolIds:[],text}};
  }
  const normalized = normalizeUtterance(text);
  const normalizedRoman = normalizeRomanUrdu(normalized);
  const candidatesToCheck = [normalized];
  if (normalizedRoman !== normalized) candidatesToCheck.push(normalizedRoman);

  // Add mixed loan-word variants
  const mixedVariants = [
    ...normalizeMixedUtterance(normalized),
    ...(normalizedRoman !== normalized ? normalizeMixedUtterance(normalizedRoman) : [])
  ];
  for (const mv of mixedVariants) {
    if (!candidatesToCheck.includes(mv)) candidatesToCheck.push(mv);
    const normMvRoman = normalizeRomanUrdu(mv);
    if (normMvRoman !== mv && !candidatesToCheck.includes(normMvRoman)) candidatesToCheck.push(normMvRoman);
  }

  // Add polite-marker-stripped variants without altering negation
  const politeStripped = stripPoliteMarkers(normalized);
  if (politeStripped !== normalized && politeStripped.length > 0) {
    if (!candidatesToCheck.includes(politeStripped)) candidatesToCheck.push(politeStripped);
    const normPoliteRoman = normalizeRomanUrdu(politeStripped);
    if (!candidatesToCheck.includes(normPoliteRoman)) candidatesToCheck.push(normPoliteRoman);
    for (const mv of normalizeMixedUtterance(politeStripped)) {
      if (!candidatesToCheck.includes(mv)) candidatesToCheck.push(mv);
      const normMvRoman = normalizeRomanUrdu(mv);
      if (!candidatesToCheck.includes(normMvRoman)) candidatesToCheck.push(normMvRoman);
    }
  }

  if (expanded !== text) {
    const normExp = normalizeUtterance(expanded);
    if (!candidatesToCheck.includes(normExp)) candidatesToCheck.push(normExp);
    const normExpRoman = normalizeRomanUrdu(normExp);
    if (normExpRoman !== normExp && !candidatesToCheck.includes(normExpRoman)) candidatesToCheck.push(normExpRoman);
    for (const mv of normalizeMixedUtterance(normExp)) {
      if (!candidatesToCheck.includes(mv)) candidatesToCheck.push(mv);
    }
  }

  const matches: string[][] = [];
  for (const [words,ids] of aliases) {
    if (words.some(word => candidatesToCheck.includes(normalizeUtterance(word)))) {
      matches.push(ids);
    }
  }
  // Bare 'breathing' does not assert respiratory distress; 'call family' does not assert urgency.
  for (const phrase of [...initialPhrases,...validCustomPhrases(customPhrases)]) {
    if (['emergency-breathe','emergency-family'].includes(phrase.id)) continue;
    if ([phrase.labelEnglish,phrase.labelUrdu,...(phrase.studio?.aliases??[]),...(phrase.studio?.alternatives.flatMap(p=>[p.english,p.urdu])??[])].some(label => candidatesToCheck.includes(normalizeUtterance(label)))) matches.push([phrase.id]);
  }
  const unique = [...new Map(matches.map(ids => [JSON.stringify(ids),ids])).values()];
  if (!unique.length) return direct;
  const results = unique.map(symbolIds => resolveIntent({symbolIds},customPhrases));
  if(direct.status==='clear') results.unshift(direct);
  const keys = new Set(results.map(r => JSON.stringify(r.intent)));
  if (keys.size !== 1 || results.some(r => r.status !== 'clear')) return {...direct,status:'clarification' as const,intent:null,candidates:[]};
  return {...results[0],input:{symbolIds:[],text}};
}

