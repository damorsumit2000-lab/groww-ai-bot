// GrowwBot — Agent Support Assistant v7.0
// Fed answers are ABSOLUTE — returned as-is, AI never overrides them.

// ── Upstash Redis ──────────────────────────────────────────────────────────
function upstashUrl()   { return process.env.UPSTASH_REDIS_REST_URL; }
function upstashToken() { return process.env.UPSTASH_REDIS_REST_TOKEN; }
function upstashReady() { return !!(upstashUrl() && upstashToken()); }
function upstashHeaders() {
  return { Authorization: `Bearer ${upstashToken()}`, 'Content-Type': 'application/json' };
}

async function redisPipeline(commands) {
  if (!upstashReady()) return [];
  try {
    const r = await fetch(`${upstashUrl()}/pipeline`, {
      method: 'POST', headers: upstashHeaders(),
      body: JSON.stringify(commands),
    });
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

async function redisSet(key, value) {
  await redisPipeline([['set', key, JSON.stringify(value)]]);
}

async function redisDel(key) {
  await redisPipeline([['del', key]]);
}

async function redisKeys(pattern) {
  if (!upstashReady()) return [];
  try {
    const r = await fetch(`${upstashUrl()}/keys/${encodeURIComponent(pattern)}`, { headers: upstashHeaders() });
    const d = await r.json();
    return Array.isArray(d?.result) ? d.result : [];
  } catch { return []; }
}

async function getAllLearned() {
  const keys = await redisKeys('kb:*');
  if (!keys.length) return [];
  const results = await redisPipeline(keys.map(k => ['get', k]));
  return results.map(item => {
    if (!item?.result) return null;
    try {
      const p = JSON.parse(item.result);
      // handle old double-encoded entries
      if (typeof p === 'string') { try { return JSON.parse(p); } catch { return null; } }
      return (p && typeof p === 'object') ? p : null;
    } catch { return null; }
  }).filter(e => e && Array.isArray(e.keywords) && e.response);
}

// ── Keyword utils ──────────────────────────────────────────────────────────
const STOP = new Set(['the','and','for','are','this','that','with','have','from','will','your','please','note','you','can','our','has','not','its','been','once','after','they','their','which','when','also','then','into','more','what','how','does','would','could','should','was','were','about','there','here','just','like','some','very','well','any','all','but','get','set','new','now','one','two','may','per','via','upon','does','did','they','them']);

function extractKeywords(text) {
  return [...new Set(
    text.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP.has(w))
  )].slice(0, 30);
}

function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ── Matching — fed answers WIN absolutely ─────────────────────────────────
function scoreEntry(query, entry) {
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const kws = entry.keywords || [];
  if (!kws.length) return 0;
  const hits = kws.filter(k => qWords.has(k)).length;
  // Also check if query words appear in the stored question/topic
  const topicWords = (entry.question || entry.topic || '').toLowerCase();
  const topicHits = [...qWords].filter(w => topicWords.includes(w)).length;
  const kwScore  = hits / kws.length;
  const topScore = qWords.size > 0 ? topicHits / qWords.size : 0;
  return Math.max(kwScore, topScore * 1.5); // topic match weighted higher
}

async function findBestMatch(query) {
  const all = await getAllLearned();
  if (!all.length) return null;
  let best = null, bestScore = 0;
  for (const e of all) {
    const s = scoreEntry(query, e);
    if (s > bestScore && s >= 0.3) { bestScore = s; best = e; }
  }
  return best;
}

// ── Is query Groww/finance related? (gate for auto-learn) ─────────────────
const GROWW_SIGNALS = ['groww','sip','mutual fund','withdrawal','settlement','ipo','kyc','demat','nri','stocks','trading','fno','f&o','portfolio','invest','redeem','folio','sebi','nse','bse','account','pan','aadhaar','bank','utr','neft','imps','rupee','inr','equity','dividend','nav','etf','elss','smallcase','brokerage','margin','mtf','btst','circuit','order','pledge','nominee','nominee'];
function isGrowwRelated(text) {
  const t = text.toLowerCase();
  return GROWW_SIGNALS.some(s => t.includes(s));
}

// ── Groq call ─────────────────────────────────────────────────────────────
async function callGroq(apiKey, messages, systemPrompt, maxTokens = 700) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`Groq API error: ${e}`); }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── System prompt (only used when NO fed answer matches) ──────────────────
const CHAT_PROMPT = `You are GrowwBot, a Groww customer support assistant for agents.
Agents describe a customer issue → return the exact ready-to-send response to the customer.

STRICT RULES:
- No emojis. Plain text only.
- End EVERY response with: "Please feel free to reach out if you need any further assistance."
- Only answer Groww platform and Indian stock market topics. For anything else: "I am trained specifically to assist with Groww platform and investment-related queries. I am unable to assist with this particular request."
- No preamble. Start the response directly.
- Include Groww app navigation paths and links when relevant.
- For escalated/angry customers: open with a sincere apology, validate feelings, give resolution, reassure funds are safe.

EMPATHY RULE: If message contains (angry, upset, frustrated, threatened, escalated, cheated, fraud, scam, unacceptable, lost money): open with "We sincerely apologize for the inconvenience and frustration this situation has caused. We completely understand how distressing this must be, and resolving this is our top priority."`;

// ── Built-in compressed KB ────────────────────────────────────────────────
const BUILTIN = [
  { k:['settlement','traded today','t+1','10 pm','withdraw after'], r:`Since you traded today, stock settlement follows T+1 (one working day). Settled amount reflects in Groww balance ~10 PM today. Withdrawal available after 10 AM tomorrow.\n\nCheck: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['withdrawal reversed','reversal','ifsc','sent back to groww'], r:`Your withdrawal was reversed by your bank; funds returned to Groww Balance. Contact bank for details. If IFSC changed, update in bank records and Groww app, then re-request withdrawal.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['withdrawal not received','utr','not reflected in bank','neft'], r:`Withdrawal processed. UTR: [UTR NUMBER]. If not yet reflected, contact bank with UTR to verify at their end.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['raa','running account authorization','quarter end refund','month end refund'], r:`Under SEBI's RAA policy, excess trading funds are transferred to your registered bank at month/quarter-end.\nVerify: App > Profile > Wallet > All Transactions.\nDetails: https://groww.in/blog/running-account-authorization-how-does-it-work\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['instant withdrawal','after 4 pm','withdrawal timing'], r:`Instant withdrawals available 9:30 AM–4:00 PM on working days only. After-hours requests process next working day.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['negative balance','groww balance negative'], r:`Balance negative because settlement charges exceeded available balance. Please add funds to bring balance to zero or positive.\nCheck: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['how to redeem','redeem mutual fund','withdraw from fund'], r:`To redeem:\n1. App > Mutual Funds > Dashboard > select fund > Redeem\n2. Enter amount or Redeem All\n3. Enter OTP > confirm\nCredited to bank in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['sip not visible','sip missing','sip not showing'], r:`SIP completed. Check: App > MF > Dashboard > fund > Investment Details > Transactions.\nRefresh: MF Dashboard > Products and Tools > Import Funds. Updates in ~1 hour.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['skip sip','sip skip','skip installment'], r:`Can skip if 3–4 working days remain before SIP date. App > MF > Dashboard > SIPs > SIP > Skip Installment. Max 3 skips then SIP auto-cancels.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['elss','lock in','lock-in','3 year lock'], r:`ELSS funds have 3-year lock-in per installment from date of each investment. Full corpus redeemable 3 years after last installment.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['ipo amount blocked','ipo blocked','mandate end date','unblock ipo'], r:`Amount blocked by bank (not debited) pending allotment. Auto-unblocked before mandate end date if not allotted. Check mandate end date in UPI app.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['ipo not allotted','not get allotment','ipo rejected'], r:`No allotment received. Blocked amount auto-released before mandate end date. Check mandate end date in UPI app.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['ipo allotted','got allotment'], r:`Allotment received. Shares transfer to Demat on listing date before market opens.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['cancel ipo','ipo cancel'], r:`IPO closed — application cannot be cancelled. Wait for allotment. If not allotted, blocked amount auto-released.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['upper circuit','no sellers'], r:`Stock in upper circuit — no sellers, only buyers. Order executes when stock exits upper circuit.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['fno pending','f&o pending','fno activation pending'], r:`F&O account pending. Wait up to 24 hours for activation.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['fno rejected','fno activation rejected','income proof fno'], r:`F&O activation rejected — income proof didn't meet criteria. Re-upload one of:\n- Bank Statement (1 txn ≥ Rs.5,000 in 6 months)\n- ITR (gross income > Rs.90,000)\n- Demat Statement (holdings > Rs.5,000)\n- Salary Slip (gross monthly > Rs.7,500)\n- Form 16 (gross annual > Rs.1,80,000)\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['mtf squared off','negative 5 days'], r:`MTF position squared off — balance was negative for 5+ consecutive days per MTF policy. Maintain adequate funds to avoid square-offs.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['inactive account','account inactive','reactivate'], r:`Account inactive ~1 year. Log in > reactivate on home screen > complete e-sign. Active in 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['rekyc','re-kyc','kyc blocked','kyc pending'], r:`Complete ReKYC: https://groww.in/onboarding/data-collection?context=REKYC (open from Groww app). Wait ~10 min before clicking. MF investing enabled in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['delete account','account deletion','close account'], r:`Deletion request raised. Done in 24–48 hours. Re-register with same PAN/email/mobile after.\nFirst deactivate UPI: App > Groww UPI > UPI Settings > Manage UPI ID > three dots > Deactivate.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['esign','e-sign','account pending','account activation'], r:`E-sign done. Account activation takes ~2 working days.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['contract note','brokerage breakdown','trade charges'], r:`Contract note sent to registered email. Open with PAN in capitals.\nAlso: App > Profile > Wallet > All Transactions > settlement > Download Contract Note.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['brokerage fno','fno charges','f&o charges','options brokerage'], r:`Rs.20 per F&O order. Buy + Sell = Rs.40 round-trip.\nhttps://groww.in/pricing | Calculator: https://groww.in/calculators/brokerage-calculator\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['market timing','market hours','market open','market closed'], r:`Stocks (NSE/BSE): https://groww.in/p/stock-market-timings\nCommodity (MCX): https://groww.in/p/commodity-market-timing\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['dividend','not received dividend'], r:`Dividend credited to Demat-linked bank within 35–45 days of record date. Contact company's RTA if not received.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['tpin','cdsl','sell shares error'], r:`TPIN issue is from CDSL's end. Try selling from website www.groww.in or switch internet connection.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['compliance blocked','cdsl blocked','multiple accounts'], r:`Blocked by CDSL. Fill form: https://trygroww.typeform.com/to/ucWfoEru. Reactivated in 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.` },
];

function matchBuiltin(msg) {
  const m = msg.toLowerCase();
  for (const e of BUILTIN) {
    if (e.k.some(k => m.includes(k))) return e.r;
  }
  return null;
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  // GET ?action=list
  if (req.method === 'GET') {
    if (req.query?.action === 'list') {
      const all = await getAllLearned();
      return res.status(200).json({ count: all.length, entries: all });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  // DELETE { key }
  if (req.method === 'DELETE') {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    await redisDel(key);
    return res.status(200).json({ deleted: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { action } = body;

    // ── FEED: store Q+A pair directly, no AI guessing ─────────────────────
    if (action === 'feed') {
      const { question, answer, category } = body;
      if (!question?.trim() || !answer?.trim())
        return res.status(400).json({ error: 'Both question and answer are required.' });

      const key = `kb:feed:${hashKey(question.toLowerCase().trim())}`;
      const entry = {
        key,
        question: question.trim(),
        topic:    question.trim(),
        summary:  question.trim(),
        response: answer.trim(),
        triggers: [],
        category: category || 'Other',
        keywords: extractKeywords(question + ' ' + answer),
        source:   'feed',
        timestamp: new Date().toISOString(),
        hits: 0,
      };
      await redisSet(key, entry);
      return res.status(200).json({ stored: true, entry });
    }

    // ── CHAT ───────────────────────────────────────────────────────────────
    const { message, history = [] } = body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // 1. Check Redis fed KB — if found, return stored answer DIRECTLY (no AI)
    const learned = await findBestMatch(message);
    if (learned) {
      // Update hit count async
      redisSet(learned.key, { ...learned, hits: (learned.hits || 0) + 1 }).catch(() => {});
      return res.status(200).json({ reply: learned.response, source: 'learned' });
    }

    // 2. Check built-in KB — if found, use as context hint for AI
    const builtin = matchBuiltin(message);
    const userContent = builtin
      ? `REFERENCE:\n${builtin}\n\nAGENT QUERY: ${message}`
      : message;

    // 3. Call AI
    const msgs = [...history.slice(-6), { role: 'user', content: userContent }];
    const reply = await callGroq(apiKey, msgs, CHAT_PROMPT, 700);

    // 4. Auto-learn ONLY if Groww/finance related and no match existed
    const isGroww = isGrowwRelated(message) || isGrowwRelated(reply);
    const isUseful = reply.length > 80 && !reply.toLowerCase().includes('unable to assist');
    if (!builtin && isGroww && isUseful) {
      const key = `kb:auto:${hashKey(message)}`;
      const entry = {
        key, question: message, topic: message.slice(0, 80), summary: message,
        response: reply, triggers: [], keywords: extractKeywords(message + ' ' + reply),
        source: 'auto', category: 'Other', timestamp: new Date().toISOString(), hits: 0,
      };
      redisSet(key, entry).catch(() => {});
    }

    return res.status(200).json({ reply, source: builtin ? 'builtin' : 'ai', autoLearned: !builtin && isGroww && isUseful });

  } catch (error) {
    console.error('GrowwBot error:', error);
    return res.status(500).json({ error: error.message });
  }
}
