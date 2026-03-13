// GrowwBot — Agent Support Assistant v8.0
// Semantic trigger matching | Fed answers absolute | Auto-learn gated

const VERSION = 'v8.0';

// ── Upstash Redis ──────────────────────────────────────────────────────────
function upstashUrl()   { return process.env.UPSTASH_REDIS_REST_URL; }
function upstashToken() { return process.env.UPSTASH_REDIS_REST_TOKEN; }
function upstashReady() { return !!(upstashUrl() && upstashToken()); }
function upstashHdrs()  { return { Authorization:`Bearer ${upstashToken()}`,'Content-Type':'application/json' }; }

async function redisPipe(cmds) {
  if (!upstashReady()) return [];
  try {
    const r = await fetch(`${upstashUrl()}/pipeline`,{method:'POST',headers:upstashHdrs(),body:JSON.stringify(cmds)});
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}
async function redisSet(key,val) { await redisPipe([['set',key,JSON.stringify(val)]]); }
async function redisDel(key)     { await redisPipe([['del',key]]); }
async function redisKeys(pat) {
  if (!upstashReady()) return [];
  try {
    const r = await fetch(`${upstashUrl()}/keys/${encodeURIComponent(pat)}`,{headers:upstashHdrs()});
    const d = await r.json();
    return Array.isArray(d?.result) ? d.result : [];
  } catch { return []; }
}
async function getAllLearned() {
  const keys = await redisKeys('kb:*');
  if (!keys.length) return [];
  const res = await redisPipe(keys.map(k=>['get',k]));
  return res.map(item=>{
    if (!item?.result) return null;
    try {
      let p = JSON.parse(item.result);
      if (typeof p==='string') p = JSON.parse(p);
      return (p && typeof p==='object' && p.response) ? p : null;
    } catch { return null; }
  }).filter(Boolean);
}

// ── Hashing ────────────────────────────────────────────────────────────────
function hashKey(s) {
  let h=0; for(let i=0;i<s.length;i++) h=(Math.imul(31,h)+s.charCodeAt(i))|0;
  return Math.abs(h).toString(36);
}

// ── Stopwords & keyword extractor ─────────────────────────────────────────
const STOP = new Set(['the','and','for','are','this','that','with','have','from','will','your','please','note','you','can','our','has','not','its','been','once','after','they','their','which','when','also','then','into','more','what','how','does','would','could','should','was','were','about','there','here','just','like','some','very','well','any','all','but','get','set','new','now','one','two','may','per','via','upon','did','them','tell','want','need','asking','asked','query','issue','problem','customer','agent','client']);

function kwds(text) {
  return [...new Set(text.toLowerCase().split(/\W+/).filter(w=>w.length>2&&!STOP.has(w)))];
}

// ── Synonym expansion — maps variants to canonical tokens ─────────────────
const SYNONYMS = {
  'f&o':'fno','futures':'fno','options':'fno','f and o':'fno',
  'sip':'sip','systematic investment':'sip',
  'mutual fund':'mf','mf':'mf',
  'nri':'nri','non resident':'nri','nonresident':'nri',
  'kyc':'kyc','know your customer':'kyc',
  'ipo':'ipo','initial public offering':'ipo',
  'mtf':'mtf','margin trade':'mtf','margin funding':'mtf',
  'demat':'demat','dematerialization':'demat',
  'pan':'pan','permanent account':'pan',
  'utr':'utr','unique transaction':'utr',
  'withdrawal':'withdrawal','withdraw':'withdrawal',
  'settlement':'settlement','settle':'settlement',
  'activation':'activation','activate':'activation','pending':'pending',
  'closure':'closure','close account':'closure','delete account':'closure',
  'account':'account','profile':'account',
};

function expandSynonyms(text) {
  let t = text.toLowerCase();
  for (const [k,v] of Object.entries(SYNONYMS)) {
    t = t.split(k).join(v);
  }
  return t;
}

function semanticTokens(text) {
  const expanded = expandSynonyms(text);
  return [...new Set(expanded.split(/\W+/).filter(w=>w.length>2&&!STOP.has(w)))];
}

// ── Extract TRIGGER PHRASES — multi-word meaningful chunks ─────────────────
// These are what make matching precise. "fno activation pending" is one trigger,
// not three separate weak signals.
function extractTriggers(question) {
  const q = question.toLowerCase().trim();
  const triggers = new Set();

  // 1. The full normalized question as a trigger
  triggers.add(q);

  // 2. Bigrams and trigrams from semantic tokens
  const tokens = semanticTokens(q);
  for (let i=0; i<tokens.length; i++) {
    triggers.add(tokens[i]);
    if (i+1<tokens.length) triggers.add(`${tokens[i]} ${tokens[i+1]}`);
    if (i+2<tokens.length) triggers.add(`${tokens[i]} ${tokens[i+1]} ${tokens[i+2]}`);
  }

  return [...triggers].filter(t=>t.length>2).slice(0,50);
}

// ── Semantic similarity score ──────────────────────────────────────────────
// Returns 0.0–1.0. Only returns high scores for genuinely close matches.
function semanticScore(queryTokens, entry) {
  const triggers = Array.isArray(entry.triggers) && entry.triggers.length
    ? entry.triggers : (entry.questionKeywords || entry.keywords || []);

  if (!triggers.length) return 0;

  // Score 1: token overlap between query tokens and entry triggers
  const qSet = new Set(queryTokens);
  const tSet = new Set(triggers);
  const intersection = queryTokens.filter(t=>tSet.has(t)).length;
  const tokenScore = intersection / Math.max(qSet.size, tSet.size);

  // Score 2: check if any trigger PHRASE (2+ words) appears as substring in query
  const queryStr = queryTokens.join(' ');
  const phraseHits = triggers.filter(t=>t.includes(' ')&&queryStr.includes(t)).length;
  const phraseScore = phraseHits > 0 ? Math.min(1, phraseHits * 0.4) : 0;

  // Score 3: stored question words found in query (direct question similarity)
  const storedQ = semanticTokens(entry.question || entry.topic || '');
  const directHits = storedQ.filter(t=>qSet.has(t)).length;
  const directScore = storedQ.length > 0 ? directHits / storedQ.length : 0;

  // Combine: phrase hits are strongest, then direct question match, then token overlap
  const combined = Math.max(
    tokenScore * 0.5,
    phraseScore,
    directScore * 0.8
  );

  return combined;
}

// ── Find best match — high confidence threshold ────────────────────────────
const MATCH_THRESHOLD = 0.55; // Must be semantically close — no guessing

async function findBestMatch(query) {
  const all = await getAllLearned();
  if (!all.length) return null;
  const qTokens = semanticTokens(query);
  let best=null, bestScore=0;
  for (const e of all) {
    const s = semanticScore(qTokens, e);
    if (s>bestScore && s>=MATCH_THRESHOLD) { bestScore=s; best=e; }
  }
  return best;
}

// ── Groww/finance gate for auto-learn ─────────────────────────────────────
const GROWW_SIGNALS=['groww','sip','mutual','withdrawal','settlement','ipo','kyc','demat','nri','trading','fno','portfolio','invest','redeem','folio','sebi','nse','bse','account','pan','aadhaar','utr','neft','equity','dividend','nav','etf','elss','brokerage','margin','mtf','btst','circuit','pledge','nominee','activation','closure','rekyc'];
const NOT_GROWW=['weather','recipe','cricket','football','movie','song','joke','hotel','travel','flight','visa','covid','medical','doctor'];
function isGrowwRelated(text) {
  const t=text.toLowerCase();
  if (NOT_GROWW.some(s=>t.includes(s))) return false;
  return GROWW_SIGNALS.some(s=>t.includes(s));
}

// ── Groq ───────────────────────────────────────────────────────────────────
async function callGroq(apiKey, messages, systemPrompt, maxTokens=700) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'system',content:systemPrompt},...messages],temperature:0.15,max_tokens:maxTokens}),
  });
  if (!res.ok) { const e=await res.text(); throw new Error(`Groq: ${e}`); }
  return (await res.json()).choices[0].message.content;
}

// ── System prompt ──────────────────────────────────────────────────────────
const CHAT_PROMPT=`You are GrowwBot ${VERSION}, a Groww customer support assistant for agents.
Describe the customer issue → receive a ready-to-send response.

RULES:
- No emojis. Plain text only.
- End EVERY response with: "Please feel free to reach out if you need any further assistance."
- Only answer Groww platform and Indian investment topics. For anything else reply: "I am trained specifically for Groww platform queries and am unable to assist with this request."
- No preamble. Start response directly.
- Include navigation paths (App > Section > Action) and links when relevant.
- For angry/escalated customers: open with sincere apology, validate, resolve, reassure funds safe.`;

// ── Built-in KB ────────────────────────────────────────────────────────────
const BUILTIN=[
  {k:['settlement','traded today','t+1','10 pm','withdraw after'],r:`Since you traded today, stock settlement follows T+1 (one working day). Settled amount reflects in Groww balance ~10 PM today. Withdrawal available after 10 AM tomorrow.\n\nCheck: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['withdrawal reversed','reversal','ifsc','sent back to groww'],r:`Your withdrawal was reversed by your bank; funds returned to Groww Balance. Contact bank for details. If IFSC changed, update in bank records and Groww app, then re-request withdrawal.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['withdrawal not received','utr','not reflected in bank','neft'],r:`Withdrawal processed. UTR: [UTR NUMBER]. If not yet reflected, contact bank with UTR to verify at their end.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['raa','running account authorization','quarter end refund','month end refund'],r:`Under SEBI's RAA policy, excess trading funds are transferred to your registered bank at month/quarter-end.\nVerify: App > Profile > Wallet > All Transactions.\nDetails: https://groww.in/blog/running-account-authorization-how-does-it-work\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['instant withdrawal','after 4 pm','withdrawal timing'],r:`Instant withdrawals available 9:30 AM–4:00 PM on working days only. After-hours requests process next working day.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['negative balance','groww balance negative'],r:`Balance negative because settlement charges exceeded available balance. Please add funds.\nCheck: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['how to redeem','redeem mutual fund','withdraw from fund'],r:`To redeem:\n1. App > Mutual Funds > Dashboard > select fund > Redeem\n2. Enter amount or Redeem All > OTP > confirm\nCredited to bank in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['sip not visible','sip missing','sip not showing'],r:`SIP completed. Check: App > MF > Dashboard > fund > Investment Details > Transactions.\nRefresh: MF Dashboard > Products and Tools > Import Funds. Updates in ~1 hour.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['skip sip','sip skip','skip installment'],r:`Can skip if 3–4 working days remain before SIP date. App > MF > Dashboard > SIPs > SIP > Skip Installment. Max 3 skips then auto-cancels.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['elss','lock in','lock-in','3 year lock'],r:`ELSS funds have 3-year lock-in per installment. Full corpus redeemable 3 years after last installment.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo amount blocked','ipo blocked','mandate end date','unblock ipo'],r:`Amount blocked by bank (not debited) pending allotment. Auto-unblocked before mandate end date if not allotted.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo not allotted','not get allotment','ipo rejected'],r:`No allotment received. Blocked amount auto-released before mandate end date.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo allotted','got allotment'],r:`Allotment received. Shares transfer to Demat on listing date before market opens.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['cancel ipo','ipo cancel'],r:`IPO closed — application cannot be cancelled. Wait for allotment. If not allotted, blocked amount auto-released.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['upper circuit','no sellers'],r:`Stock in upper circuit — no sellers, only buyers. Order executes when stock exits upper circuit.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['fno pending','f&o pending','fno activation pending','f&o activation'],r:`F&O account is currently pending activation. Please wait up to 24 hours for the activation to be completed. If it remains pending beyond 24 hours, kindly reach out again so we can escalate.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['fno rejected','fno activation rejected','income proof fno'],r:`F&O activation rejected — income proof didn't meet criteria. Re-upload one of:\n- Bank Statement (1 txn ≥ Rs.5,000 in last 6 months)\n- ITR (gross income > Rs.90,000)\n- Demat Statement (holdings > Rs.5,000)\n- Salary Slip (gross monthly > Rs.7,500)\n- Form 16 (gross annual > Rs.1,80,000)\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['mtf squared off','negative 5 days'],r:`MTF position squared off — balance negative 5+ consecutive days per MTF policy. Maintain adequate funds to avoid square-offs.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['inactive account','account inactive','reactivate'],r:`Account inactive ~1 year. Log in > reactivate on home screen > complete e-sign. Active in 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['rekyc','re-kyc','kyc blocked','kyc pending'],r:`Complete ReKYC: https://groww.in/onboarding/data-collection?context=REKYC (open from Groww app). Wait ~10 min before clicking. MF investing enabled in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['delete account','account deletion','close account','account closure'],r:`Deletion request raised. Done in 24–48 hours. Re-register with same PAN/email/mobile after.\nFirst deactivate UPI: App > Groww UPI > UPI Settings > Manage UPI ID > three dots > Deactivate.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['esign','e-sign','account pending','account activation'],r:`E-sign done. Account activation takes ~2 working days.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['contract note','brokerage breakdown','trade charges'],r:`Contract note sent to registered email. Open with PAN in capitals.\nAlso: App > Profile > Wallet > All Transactions > Settlement > Download Contract Note.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['brokerage fno','fno charges','f&o charges','options brokerage'],r:`Rs.20 per F&O order. Buy + Sell = Rs.40 round-trip.\nhttps://groww.in/pricing | https://groww.in/calculators/brokerage-calculator\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['market timing','market hours','market open','market closed'],r:`Stocks (NSE/BSE): https://groww.in/p/stock-market-timings\nCommodity (MCX): https://groww.in/p/commodity-market-timing\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['dividend','not received dividend'],r:`Dividend credited to Demat-linked bank within 35–45 days of record date. Contact company's RTA if not received.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['tpin','cdsl','sell shares error'],r:`TPIN issue from CDSL's end. Try selling from www.groww.in or switch internet connection.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['compliance blocked','cdsl blocked','multiple accounts'],r:`Blocked by CDSL. Fill form: https://trygroww.typeform.com/to/ucWfoEru. Reactivated in 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['angry','frustrated','worst','pathetic','unacceptable','cheated','fraud','scam','lost money','threatening'],r:`We sincerely apologize for the inconvenience and frustration this has caused. We completely understand how distressing this must be, and resolving this is our absolute top priority. Your funds are completely safe.\n\nI have escalated this with our senior team and you will receive a resolution update on your registered email within 24–48 working hours. We deeply appreciate your patience and trust.\n\nPlease feel free to reach out if you need any further assistance.`},
];

function matchBuiltin(msg) {
  const m=msg.toLowerCase();
  for (const e of BUILTIN) { if (e.k.some(k=>m.includes(k))) return e.r; }
  return null;
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req,res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,GET,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const apiKey=process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({error:'GROQ_API_KEY not configured'});

  if (req.method==='GET') {
    if (req.query?.action==='list') {
      const all=await getAllLearned();
      return res.status(200).json({count:all.length,entries:all,version:VERSION});
    }
    return res.status(400).json({error:'Unknown action'});
  }

  if (req.method==='DELETE') {
    const {key}=req.body||{};
    if (!key) return res.status(400).json({error:'key required'});
    await redisDel(key);
    return res.status(200).json({deleted:true});
  }

  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  try {
    const body=req.body||{};
    const {action}=body;

    // ── FEED ──────────────────────────────────────────────────────────────
    if (action==='feed') {
      const {question,answer,category}=body;
      if (!question?.trim()||!answer?.trim())
        return res.status(400).json({error:'Both question and answer are required.'});

      const normalizedQ=question.toLowerCase().trim();
      const newKey=`kb:feed:${hashKey(normalizedQ)}`;
      const newTriggers=extractTriggers(question);  // semantic multi-word triggers
      const newQTokens=semanticTokens(question);

      // Delete ALL existing entries that overlap ≥40% with this question's tokens
      const allExisting=await getAllLearned();
      let deletedKeys=[];
      let inheritedHits=0;
      for (const e of allExisting) {
        const score=semanticScore(newQTokens, e);
        if (score>=0.4) {
          await redisDel(e.key);
          deletedKeys.push(e.key);
          inheritedHits+=(e.hits||0);
        }
      }

      const entry={
        key:newKey,
        question:question.trim(),
        topic:question.trim(),
        summary:question.trim(),
        response:answer.trim(),
        triggers:newTriggers,         // multi-word semantic trigger phrases
        questionKeywords:newQTokens,  // semantic token set
        keywords:newQTokens,
        category:category||'Other',
        source:'feed',
        timestamp:new Date().toISOString(),
        hits:inheritedHits,
      };
      await redisSet(newKey,entry);
      return res.status(200).json({stored:true,updated:deletedKeys.length>0,replacedKeys:deletedKeys,triggerCount:newTriggers.length,entry});
    }

    // ── CHAT ───────────────────────────────────────────────────────────────
    const {message,history=[]}=body;
    if (!message) return res.status(400).json({error:'message required'});

    // Step 1: Redis learned KB — high-confidence semantic match only
    const learned=await findBestMatch(message);
    if (learned) {
      redisSet(learned.key,{...learned,hits:(learned.hits||0)+1}).catch(()=>{});
      return res.status(200).json({reply:learned.response,source:'learned'});
    }

    // Step 2: Built-in KB — exact keyword match
    const builtin=matchBuiltin(message);
    const userContent=builtin
      ? `REFERENCE ANSWER:\n${builtin}\n\nAGENT QUERY: ${message}`
      : message;

    // Step 3: Call AI
    const msgs=[...history.slice(-6),{role:'user',content:userContent}];
    const reply=await callGroq(apiKey,msgs,CHAT_PROMPT,700);

    // Step 4: Auto-learn — Groww-related, AI-generated (not builtin), useful response
    // Store with semantic triggers so future matches are precise
    const isGroww=isGrowwRelated(message)||isGrowwRelated(reply);
    const isUseful=reply.length>100&&!reply.toLowerCase().includes('unable to assist');
    if (!builtin&&isGroww&&isUseful) {
      const key=`kb:auto:${hashKey(message)}`;
      const triggers=extractTriggers(message);
      const qTokens=semanticTokens(message);
      const entry={
        key,question:message,topic:message.slice(0,80),summary:message,
        response:reply,
        triggers,            // semantic triggers stored for future matching
        questionKeywords:qTokens,
        keywords:qTokens,
        source:'auto',category:'Other',timestamp:new Date().toISOString(),hits:0,
      };
      redisSet(key,entry).catch(()=>{});
    }

    return res.status(200).json({
      reply,
      source:builtin?'builtin':'ai',
      autoLearned:!builtin&&isGroww&&isUseful,
    });

  } catch(error) {
    console.error('GrowwBot error:',error);
    return res.status(500).json({error:error.message});
  }
}
