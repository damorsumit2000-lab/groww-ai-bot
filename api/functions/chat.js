// GrowwBot v9.0 — PDF KB | Semantic Matching | Mobile Drawer | Matte UI

const VERSION = 'v10.0';

// Import Neon DB helper for PDF search
import { searchChunks } from './_db.js';

// ── Upstash Redis ──────────────────────────────────────────────────────────
const UP = {
  url:   () => process.env.UPSTASH_REDIS_REST_URL,
  token: () => process.env.UPSTASH_REDIS_REST_TOKEN,
  ready: () => !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  hdrs:  () => ({ Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }),
};

async function redisPipe(cmds) {
  if (!UP.ready()) return [];
  try {
    const r = await fetch(`${UP.url()}/pipeline`, { method:'POST', headers:UP.hdrs(), body:JSON.stringify(cmds) });
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}
async function redisSet(key, val) { await redisPipe([['set', key, JSON.stringify(val)]]); }
async function redisDel(key)      { await redisPipe([['del', key]]); }
async function redisKeys(pat) {
  if (!UP.ready()) return [];
  try {
    const r = await fetch(`${UP.url()}/keys/${encodeURIComponent(pat)}`, { headers:UP.hdrs() });
    const d = await r.json();
    return Array.isArray(d?.result) ? d.result : [];
  } catch { return []; }
}
async function redisGetAll(pattern) {
  const keys = await redisKeys(pattern);
  if (!keys.length) return [];
  const res = await redisPipe(keys.map(k => ['get', k]));
  return res.map(item => {
    if (!item?.result) return null;
    try {
      let p = JSON.parse(item.result);
      if (typeof p === 'string') p = JSON.parse(p);
      return (p && typeof p === 'object') ? p : null;
    } catch { return null; }
  }).filter(Boolean);
}
async function getAllLearned() {
  const entries = await redisGetAll('kb:*');
  return entries.filter(e => e.response);
}
// PDF search now uses Neon Postgres (imported from _db.js)
// getAllPdfChunks() removed — use searchPdfChunks() from _db.js instead

// ── Hash ────────────────────────────────────────────────────────────────────
function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ── NLP helpers ─────────────────────────────────────────────────────────────
const STOP = new Set(['the','and','for','are','this','that','with','have','from','will','your','please','note','you','can','our','has','not','its','been','once','after','they','their','which','when','also','then','into','more','what','how','does','would','could','should','was','were','about','there','here','just','like','some','very','well','any','all','but','get','set','new','now','one','two','may','per','via','upon','did','them','tell','want','need','asking','asked','query','issue','problem','customer','agent','client','dear','sir','madam','hello','kindly']);

const SYNONYMS = {
  'f&o':'fno','futures and options':'fno','f and o':'fno','f & o':'fno',
  'sip':'sip','systematic investment plan':'sip',
  'mutual fund':'mf','mutual funds':'mf',
  'nri':'nri','non resident indian':'nri','non-resident':'nri',
  'know your customer':'kyc',
  'initial public offering':'ipo',
  'margin trade funding':'mtf','margin trading':'mtf',
  'dematerialization':'demat',
  'permanent account number':'pan',
  'unique transaction reference':'utr',
  'withdraw':'withdrawal','withdrawl':'withdrawal',
  'settle':'settlement',
  'activate':'activation','pending':'pending',
  'close account':'closure','delete account':'closure','account closure':'closure',
};

function expand(text) {
  let t = text.toLowerCase();
  for (const [k, v] of Object.entries(SYNONYMS)) t = t.split(k).join(v);
  return t;
}

function tokens(text) {
  return [...new Set(expand(text).split(/\W+/).filter(w => w.length > 2 && !STOP.has(w)))];
}

function extractTriggers(question) {
  const q = question.toLowerCase().trim();
  const toks = tokens(q);
  const triggers = new Set([q]);
  for (let i = 0; i < toks.length; i++) {
    triggers.add(toks[i]);
    if (i+1 < toks.length) triggers.add(`${toks[i]} ${toks[i+1]}`);
    if (i+2 < toks.length) triggers.add(`${toks[i]} ${toks[i+1]} ${toks[i+2]}`);
  }
  return [...triggers].filter(t => t.length > 2).slice(0, 60);
}

// ── Semantic scoring ─────────────────────────────────────────────────────────
const MATCH_THRESHOLD = 0.55;

function semanticScore(qTokens, entry) {
  const trig = Array.isArray(entry.triggers) && entry.triggers.length
    ? entry.triggers : (entry.questionKeywords || entry.keywords || []);
  if (!trig.length) return 0;

  const qSet = new Set(qTokens);
  const tSet = new Set(trig);
  const overlap = qTokens.filter(t => tSet.has(t)).length;
  const tokenScore = overlap / Math.max(qSet.size, tSet.size);

  const qStr = qTokens.join(' ');
  const phraseHits = trig.filter(t => t.includes(' ') && qStr.includes(t)).length;
  const phraseScore = Math.min(1, phraseHits * 0.4);

  const storedQ = tokens(entry.question || entry.topic || '');
  const directHits = storedQ.filter(t => qSet.has(t)).length;
  const directScore = storedQ.length > 0 ? directHits / storedQ.length : 0;

  return Math.max(tokenScore * 0.5, phraseScore, directScore * 0.8);
}

async function findBestMatch(query) {
  const all = await getAllLearned();
  if (!all.length) return null;
  const qToks = tokens(query);
  let best = null, bestScore = 0;
  for (const e of all) {
    const s = semanticScore(qToks, e);
    if (s > bestScore && s >= MATCH_THRESHOLD) { bestScore = s; best = e; }
  }
  return best;
}

// searchPdfChunks replaced by searchChunks() imported from _db.js (Neon Postgres)

// ── Groww gate ───────────────────────────────────────────────────────────────
const GROWW_SIG = ['groww','sip','mutual','withdrawal','settlement','ipo','kyc','demat','nri','trading','fno','portfolio','invest','redeem','folio','sebi','nse','bse','account','pan','aadhaar','utr','neft','equity','dividend','nav','etf','elss','brokerage','margin','mtf','btst','circuit','pledge','nominee','activation','closure','rekyc','smallcase','sgb','bond'];
const NOT_GROWW = ['weather','recipe','cricket','football','movie','song','joke','hotel','travel','flight','visa','covid','medical','doctor','exam','school'];
function isGrowwRelated(text) {
  const t = text.toLowerCase();
  if (NOT_GROWW.some(s => t.includes(s))) return false;
  return GROWW_SIG.some(s => t.includes(s));
}

// ── Groq ─────────────────────────────────────────────────────────────────────
async function callGroq(apiKey, messages, system, maxTokens = 600) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role:'system', content:system }, ...messages],
      temperature: 0.15,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`Groq: ${e}`); }
  return (await res.json()).choices[0].message.content;
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are GrowwBot ${VERSION}, a Groww customer support assistant for agents.

Your job: agent describes a customer issue → you return a ready-to-send response to the customer.

FORMATTING RULES (very important):
- Keep responses SHORT and easy to read. Max 5–6 lines for simple queries.
- Use blank lines between paragraphs. Never write a wall of text.
- Use numbered steps (1. 2. 3.) for processes. Keep each step to one line.
- Plain text only — no emojis, no markdown headers.
- End EVERY response with a blank line, then: "Please feel free to reach out if you need any further assistance."

CONTENT RULES:
- Only answer Groww platform and Indian investment topics.
- For anything else: "I am trained specifically for Groww platform queries and am unable to assist with this request."
- No preamble. Start the response directly to the customer.
- Include app navigation paths (App > Section > Screen) when relevant.
- For escalated/angry customers: open with sincere apology, validate concern, give resolution, reassure funds are safe.

IF PDF KNOWLEDGE is provided, use it as primary context and cite the relevant information accurately.
IF REFERENCE ANSWER is provided, adapt it to the specific situation but keep it short.`;

// ── Built-in KB ───────────────────────────────────────────────────────────────
const BUILTIN = [
  {k:['settlement','traded today','t+1','10 pm','withdraw after'],r:`Your stock settlement follows T+1 — one working day after the trade.\n\nThe settled amount will reflect in your Groww balance by approximately 10 PM today. Withdrawal will be available after 10 AM tomorrow.\n\nTo track: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['withdrawal reversed','reversal','sent back to groww'],r:`Your withdrawal was reversed by your bank and the funds have been returned to your Groww Balance.\n\nPlease contact your bank for the reason. Also check if your IFSC code has changed — if yes, update it in the Groww app, then retry the withdrawal.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['withdrawal not received','utr','not reflected in bank'],r:`Your withdrawal has been processed. The UTR for this transaction is [UTR NUMBER].\n\nIf the amount is not yet reflecting, please share this UTR with your bank so they can trace it.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['raa','running account authorization','quarter end refund','month end refund'],r:`Under SEBI's RAA policy, Groww transfers excess funds back to your registered bank at month/quarter-end.\n\nYou can verify this under: App > Profile > Wallet > All Transactions.\n\nMore details: https://groww.in/blog/running-account-authorization-how-does-it-work\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['instant withdrawal','after 4 pm','withdrawal timing'],r:`Instant withdrawals are available between 9:30 AM and 4:00 PM on working days only.\n\nRequests placed after 4 PM will be processed the next working day. Your funds are safe.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['negative balance','groww balance negative'],r:`Your Groww balance is negative because settlement charges for your trades exceeded your available balance.\n\nPlease add funds to bring it back to zero or positive.\n\nApp > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['how to redeem','redeem mutual fund','withdraw from fund'],r:`To redeem your mutual fund:\n\n1. App > Mutual Funds > Dashboard\n2. Select the fund > tap Redeem\n3. Enter amount or choose Redeem All\n4. Enter OTP and confirm\n\nThe amount will be credited to your bank in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['cancel redemption','redeem cannot cancel'],r:`Once a redemption order is placed, it cannot be cancelled — it has already been submitted to the fund house.\n\nKindly wait for the amount to be credited. Your money is completely safe.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['sip not visible','sip missing','sip not showing'],r:`Your SIP has been completed and the investment is reflected in your dashboard.\n\nApp > Mutual Funds > Dashboard > Select fund > Investment Details > Transactions.\n\nTo refresh: MF Dashboard > Products and Tools > Import Funds. Updates within ~1 hour.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['skip sip','sip skip','skip installment'],r:`You can skip a SIP installment if at least 3–4 working days remain before the SIP date.\n\nApp > Mutual Funds > Dashboard > SIPs > Select SIP > Skip Installment.\n\nNote: A SIP can be skipped a maximum of 3 times, after which it auto-cancels.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['cancel sip','stop sip'],r:`SIP cancellation takes up to 7 working days to be fully processed.\n\nThe invested amount stays in the fund — you can redeem it whenever you wish.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['sip edit','change sip date','change sip amount'],r:`When you edit the SIP date or amount, the existing SIP is cancelled and a new one is created from the updated date.\n\nThe SMS about cancellation is expected — this is the standard process.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['elss','lock in','lock-in','3 year lock'],r:`ELSS funds have a mandatory 3-year lock-in per installment, starting from the date of each investment.\n\nThe full corpus can be redeemed only 3 years after the last installment.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo amount blocked','ipo blocked','mandate end date'],r:`When you apply for an IPO, the required amount is blocked by your bank — not debited.\n\nIt will be automatically unblocked before the mandate end date if you are not allotted shares.\n\nYou can check the mandate end date in your UPI app. Your funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo not allotted','not get allotment','ipo rejected'],r:`You have not received an allotment for this IPO.\n\nThe blocked amount will be automatically released by your bank before the mandate end date.\n\nYour funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo allotted','got allotment'],r:`Congratulations — you have received an IPO allotment!\n\nThe allotted shares will be credited to your Demat account on the listing date, before market opens.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['cancel ipo','ipo cancel'],r:`Since the IPO subscription period has closed, the application cannot be cancelled.\n\nKindly wait for the allotment result. If not allotted, the blocked amount will be released before the mandate end date.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo gmp','grey market'],r:`Grey market premium (GMP) is an unofficial indicator and not provided by Groww.\n\nFor allotment status, check: App > IPO > Applied IPOs.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['upper circuit','no sellers'],r:`The stock is currently in an upper circuit — there are no sellers, only buyers.\n\nYour buy order will be executed once the stock exits the upper circuit and sellers become available.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['lower circuit'],r:`The stock is in a lower circuit — trading is restricted. Only buy orders can be placed.\n\nYour sell order will execute once the circuit limit is lifted.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['fno pending','f&o pending','fno activation pending','f&o activation'],r:`Your F&O account is currently pending activation. Please wait up to 24 hours.\n\nIf it remains pending beyond 24 hours, please reach out again so we can escalate.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['fno rejected','fno activation rejected','income proof fno'],r:`Your F&O activation was rejected because the income proof did not meet the criteria.\n\nPlease re-upload one of the following documents:\n1. Bank Statement — 1 transaction of Rs. 5,000+ in the last 6 months\n2. ITR — gross annual income above Rs. 90,000\n3. Demat Statement — holdings above Rs. 5,000\n4. Salary Slip — gross monthly income above Rs. 7,500\n5. Form 16 — gross annual income above Rs. 1,80,000\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['span margin','exposure margin','option premium'],r:`For F&O trades, Groww collects SPAN margin plus exposure margin as required by the exchange.\n\nOption buyers pay the full premium upfront. Option sellers must maintain required margins.\n\nDetails: https://groww.in/p/risk-policy\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['gtt order','good till trigger'],r:`A GTT (Good Till Trigger) order stays active until your trigger price is hit or you cancel it.\n\nApp > Stocks > Portfolio > GTT Orders.\n\nNote: GTT orders are cancelled at the end of the quarter if not triggered.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['btst','buy today sell tomorrow'],r:`BTST (Buy Today Sell Tomorrow) allows you to sell shares before they settle in your Demat account.\n\nNote: There is an auction risk if the seller defaults. Groww charges standard brokerage for BTST trades.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['mtf','margin trade funding','leverage buying'],r:`MTF lets you buy stocks with leverage — you contribute a portion and Groww funds the rest (up to 80% based on haircut).\n\nInterest rate: 14.95% per annum (0.05% per day + GST). Positions settle daily on a mark-to-market basis.\n\nDetails: App > Stocks > MTF.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['mtf squared off','negative 5 days'],r:`Your MTF position was automatically squared off because your Groww balance remained negative for more than 5 consecutive days.\n\nThis is in line with our MTF policy. Please maintain adequate funds to prevent future square-offs.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['physical delivery','physical settlement'],r:`If you hold in-the-money F&O positions at expiry, they may result in physical delivery of shares.\n\nAdditional margins are required closer to expiry. Details: https://groww.in/physical-settlement\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['stock sip','equity sip'],r:`Stock SIP allows you to invest a fixed amount in a specific stock at regular intervals.\n\nApp > Stocks > Search stock > Start SIP.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['inactive account','account inactive','reactivate'],r:`Your account became inactive due to approximately 1 year of non-use.\n\nTo reactivate: Log in to the Groww app > tap Reactivate on the home screen > complete e-sign.\n\nYour account will be active within 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['rekyc','re-kyc','kyc blocked','kyc pending'],r:`Your KYC requires re-verification. Please complete the ReKYC process:\n\n1. Open this link inside the Groww app: https://groww.in/onboarding/data-collection?context=REKYC\n2. Wait ~10 minutes before clicking the link\n\nMF investing will be enabled within 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['delete account','account deletion','close account','account closure'],r:`A deletion request has been raised for your account. The process will be completed within 24–48 hours.\n\nAfter deletion, you can re-register using the same PAN, email, and mobile number.\n\nBefore deletion, please deactivate your UPI ID:\nApp > Groww UPI > UPI Settings > Manage UPI ID > three dots > Deactivate.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['esign','e-sign','account pending','account activation'],r:`Your e-sign has been completed. Account activation typically takes 2 working days — this is the standard process.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['aadhaar pan link','pan aadhaar'],r:`Your PAN and Aadhaar need to be linked for continued trading.\n\nLink here: https://eportal.incometax.gov.in/iec/foservices/#/pre-login/link-aadhaar-status\n\nAfter linking, allow 24–48 hours for the update to reflect on Groww.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['bank mismatch','wrong bank','bank not matching'],r:`If your bank account details do not match, please update them in the Groww app.\n\nApp > Profile > Bank Account > Add or update bank.\n\nEnsure the account is in your name and linked to your PAN.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['tpin','cdsl tpin','sell shares error'],r:`TPIN issues are managed by CDSL, not Groww.\n\nPlease try selling from the Groww website (www.groww.in) or switch to a different network connection.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['compliance blocked','cdsl blocked','multiple accounts'],r:`Your account has been blocked by CDSL due to a compliance issue.\n\nPlease fill out this form to resolve it: https://trygroww.typeform.com/to/ucWfoEru\n\nYour account will be reactivated within 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['nominee','add nominee'],r:`You can add or update a nominee from:\n\nApp > Profile > Nominee > Add Nominee.\n\nThis is important for the safety of your investments.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['contract note','brokerage breakdown','trade charges'],r:`Your contract note has been sent to your registered email address. Open it using your PAN in capital letters.\n\nYou can also access it from: App > Profile > Wallet > All Transactions > Settlement > Download Contract Note.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['brokerage fno','fno charges','f&o charges','options brokerage'],r:`Groww charges Rs. 20 per F&O order — so a buy + sell round trip costs Rs. 40 total.\n\nFull details: https://groww.in/pricing\nBrokerage calculator: https://groww.in/calculators/brokerage-calculator\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['market timing','market hours','market open','market closed'],r:`Market timings:\n\nStocks (NSE/BSE): https://groww.in/p/stock-market-timings\nCommodity (MCX): https://groww.in/p/commodity-market-timing\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['dividend','not received dividend'],r:`Dividends are credited to your Demat-linked bank account within 35–45 days of the record date, processed by the company's RTA.\n\nIf you have not received it, please contact the company's RTA directly. RTA details are available on BSE (www.bseindia.com) or NSE (www.nseindia.com) under Corporate Information.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['angry','frustrated','worst','pathetic','unacceptable','cheated','fraud','scam','lost money','threatening'],r:`We sincerely apologize for the inconvenience and frustration this situation has caused. We completely understand how distressing this must be, and resolving this is our top priority.\n\nYour funds are completely safe. I have escalated this to our senior team and you will receive a resolution update on your registered email within 24–48 working hours.\n\nThank you for your patience and trust in Groww.\n\nPlease feel free to reach out if you need any further assistance.`},
];

function matchBuiltin(msg) {
  const m = msg.toLowerCase();
  for (const e of BUILTIN) { if (e.k.some(k => m.includes(k))) return e.r; }
  return null;
}

// chunkText moved to api/upload.js

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const act = req.query?.action;
    if (act === 'list') {
      const all = await getAllLearned();
      return res.status(200).json({ count: all.length, entries: all, version: VERSION });
    }
    // PDF list → GET /api/upload
    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { key, docId } = req.body || {};
    // Delete a specific KB entry from Redis
    if (key) { await redisDel(key); return res.status(200).json({ deleted: true }); }
    // PDF deletes are handled by DELETE /api/upload
    return res.status(400).json({ error: 'key required. For PDF deletion use DELETE /api/upload' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { action } = body;

    // PDF upload → handled by /api/upload (separate route)

    // ── FEED Q&A ─────────────────────────────────────────────────────────────
    if (action === 'feed') {
      const { question, answer, category } = body;
      if (!question?.trim() || !answer?.trim())
        return res.status(400).json({ error: 'Both question and answer are required.' });

      const newKey = `kb:feed:${hashKey(question.toLowerCase().trim())}`;
      const newTrig = extractTriggers(question);
      const newToks = tokens(question);

      const allExisting = await getAllLearned();
      let deletedKeys = [], inheritedHits = 0;
      for (const e of allExisting) {
        const s = semanticScore(newToks, e);
        if (s >= 0.4) { await redisDel(e.key); deletedKeys.push(e.key); inheritedHits += (e.hits || 0); }
      }

      const entry = {
        key: newKey, question: question.trim(), topic: question.trim(), summary: question.trim(),
        response: answer.trim(), triggers: newTrig, questionKeywords: newToks, keywords: newToks,
        category: category || 'Other', source: 'feed',
        timestamp: new Date().toISOString(), hits: inheritedHits,
      };
      await redisSet(newKey, entry);
      return res.status(200).json({ stored: true, updated: deletedKeys.length > 0, replacedKeys: deletedKeys, triggerCount: newTrig.length, entry });
    }

    // ── CHAT ─────────────────────────────────────────────────────────────────
    const { message, history = [] } = body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Priority 1: Fed/learned KB (exact match → return verbatim)
    const learned = await findBestMatch(message);
    if (learned) {
      redisSet(learned.key, { ...learned, hits: (learned.hits || 0) + 1 }).catch(() => {});
      return res.status(200).json({ reply: learned.response, source: 'learned' });
    }

    // Priority 2: Built-in KB (keyword match → use as AI reference)
    const builtin = matchBuiltin(message);

    // Priority 3: PDF KB (semantic chunk search → use as AI context)
    const pdfChunks = await searchChunks(message, 4).catch(() => []);
    const pdfContext = pdfChunks.length > 0
      ? `\n\nPDF KNOWLEDGE BASE:\n${pdfChunks.map((c, i) => `[${c.docName}, section ${c.chunkIndex + 1}]:\n${c.text}`).join('\n\n')}`
      : '';

    let userContent = message;
    if (builtin) userContent = `REFERENCE ANSWER:\n${builtin}\n\nAGENT QUERY: ${message}`;
    else if (pdfContext) userContent = `${pdfContext}\n\nAGENT QUERY: ${message}`;

    const msgs = [...history.slice(-6), { role: 'user', content: userContent }];
    const reply = await callGroq(apiKey, msgs, SYSTEM, 600);

    // Auto-learn (Groww-related, useful, not from builtin)
    const isGroww = isGrowwRelated(message) || isGrowwRelated(reply);
    const isUseful = reply.length > 80 && !reply.toLowerCase().includes('unable to assist');
    if (!builtin && isGroww && isUseful) {
      const key = `kb:auto:${hashKey(message)}`;
      const trig = extractTriggers(message);
      const qToks = tokens(message);
      redisSet(key, {
        key, question: message, topic: message.slice(0, 80), summary: message,
        response: reply, triggers: trig, questionKeywords: qToks, keywords: qToks,
        source: 'auto', category: 'Other', timestamp: new Date().toISOString(), hits: 0,
      }).catch(() => {});
    }

    return res.status(200).json({
      reply,
      source: builtin ? 'builtin' : (pdfChunks.length ? 'pdf' : 'ai'),
      autoLearned: !builtin && isGroww && isUseful,
    });

  } catch (err) {
    console.error('GrowwBot error:', err);
    return res.status(500).json({ error: err.message });
  }
}
