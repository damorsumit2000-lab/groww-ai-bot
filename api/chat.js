// GrowwBot — Agent Support Assistant v6.0
// Features: Upstash Redis | Feed & Analyze | Self-Learning | Compressed KB

// ── Upstash Redis helpers ──────────────────────────────────────────────────
// Upstash REST API: values are stored/retrieved as plain strings.
// We JSON.stringify objects on write and JSON.parse on read — once, consistently.

function upstashHeaders() {
  return {
    Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
    'Content-Type': 'application/json',
  };
}
function upstashUrl() { return process.env.UPSTASH_REDIS_REST_URL; }
function upstashReady() { return !!(upstashUrl() && process.env.UPSTASH_REDIS_REST_TOKEN); }

async function redisGet(key) {
  if (!upstashReady()) return null;
  try {
    const r = await fetch(`${upstashUrl()}/get/${encodeURIComponent(key)}`, { headers: upstashHeaders() });
    const d = await r.json();
    if (!d?.result) return null;
    return JSON.parse(d.result);       // stored as JSON.stringify(obj)
  } catch { return null; }
}

async function redisSet(key, value) {
  if (!upstashReady()) return;
  try {
    // Upstash /set/key — body must be a JSON array: ["SET", key, value]
    // Simplest correct approach: use the pipeline endpoint with a single SET command
    await fetch(`${upstashUrl()}/pipeline`, {
      method: 'POST',
      headers: upstashHeaders(),
      body: JSON.stringify([['set', key, JSON.stringify(value)]]),
    });
  } catch {}
}

async function redisDel(key) {
  if (!upstashReady()) return;
  try {
    await fetch(`${upstashUrl()}/pipeline`, {
      method: 'POST',
      headers: upstashHeaders(),
      body: JSON.stringify([['del', key]]),
    });
  } catch {}
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
  try {
    // Fetch all values in one pipeline request
    const commands = keys.map(k => ['get', k]);
    const r = await fetch(`${upstashUrl()}/pipeline`, {
      method: 'POST',
      headers: upstashHeaders(),
      body: JSON.stringify(commands),
    });
    const data = await r.json();
    // Upstash pipeline returns an array of {result, error} objects
    const items = Array.isArray(data) ? data : [];
    return items.map(item => {
      if (!item?.result) return null;
      try { return JSON.parse(item.result); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// ── Keyword utils ─────────────────────────────────────────────────────────
const STOP = new Set(['the','and','for','are','this','that','with','have','from','will','your','please','note','you','can','our','has','not','its','been','once','after','they','their','which','when','also','then','into','more','what','how','does','would','could','should','was','were','about','there','here','just','like','some','very','well','any','all','but','get','set','new','now','one','two','may','per','its','via','upon']);

function keywords(text) {
  return [...new Set(
    text.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP.has(w))
  )].slice(0, 25);
}

function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function scoreMatch(query, entry) {
  const qw = new Set(query.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const hits = entry.keywords.filter(k => qw.has(k)).length;
  return entry.keywords.length > 0 ? hits / entry.keywords.length : 0;
}

async function findBestMatch(query) {
  const all = await getAllLearned();
  if (!all.length) return null;
  let best = null, bestScore = 0;
  for (const e of all) {
    const s = scoreMatch(query, e);
    if (s > bestScore && s >= 0.25) { bestScore = s; best = e; }
  }
  return best;
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

// ── System prompts ────────────────────────────────────────────────────────
const CHAT_PROMPT = `You are GrowwBot, a Groww customer support assistant for agents.
Agents describe a customer issue → return the exact ready-to-send response.

RULES:
- No emojis. Plain text only.
- End EVERY response with: "Please feel free to reach out if you need any further assistance."
- Include Groww app navigation paths and links when relevant.
- Only answer Groww/Indian finance topics. For unrelated queries: "I am trained specifically to assist with Groww platform and investment-related queries. I am unable to assist with this particular request."
- No preamble. Start the response directly.
- If LEARNED KNOWLEDGE is provided below, use it as your PRIMARY source and base your response on it.

EMPATHY RULE: If the agent message contains frustration signals (angry, upset, furious, frustrated, threatening, escalated, waiting days, cheated, fraud, scam, unacceptable, lost money, threatening legal), open with: "We sincerely apologize for the inconvenience and frustration this situation has caused. We completely understand how distressing this must be, and resolving this is our top priority." Then validate feelings → resolution → reassure funds safe → offer escalation.`;

const ANALYZE_PROMPT = `You are a Groww support knowledge base editor.
Your job is to analyze raw information fed by a support team member and extract it into a clean, structured KB entry.

Given raw input, you MUST return ONLY a valid JSON object (no markdown, no backticks, no preamble) with this exact structure:
{
  "topic": "short topic label (e.g. 'New UPI Limit Policy')",
  "summary": "1-2 sentence summary of what this information is about",
  "response": "the full, ready-to-send customer-facing response the agent should use, written in Groww support tone — formal, warm, plain text, no emojis, ends with: Please feel free to reach out if you need any further assistance.",
  "triggers": ["keyword1", "keyword2", "keyword3"],
  "category": "one of: Settlements, Mutual Funds, IPO, Stocks, F&O, Account & KYC, Market Info, Other"
}

IMPORTANT:
- The 'response' must be written exactly as an agent would send it to a customer.
- 'triggers' should be 3-8 keywords/phrases a support agent might use when describing this issue.
- Be concise but complete. Do not invent information — only use what was provided.`;

// ── Compressed built-in KB (keyword fallback) ─────────────────────────────
const BUILTIN = [
  { k:['settlement','traded today','t+1','10 pm','withdraw after'], r:`Since you traded today, stock settlement follows T+1 (one working day). Settled amount reflects in Groww balance ~10 PM today. Withdrawal available after 10 AM tomorrow.\n\nCheck: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['withdrawal reversed','reversal','ifsc','sent back to groww'], r:`Your withdrawal was reversed by your bank; funds returned to Groww Balance. Contact bank for details. If IFSC changed, update in bank records and Groww app, then re-request withdrawal.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['withdrawal not received','utr','not reflected in bank','neft'], r:`Withdrawal processed. UTR: [UTR NUMBER]. If not yet reflected, contact bank with UTR to verify at their end.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['raa','running account authorization','quarter end refund','month end refund'], r:`Under SEBI's RAA policy, excess trading funds are transferred to your registered bank at month/quarter-end. Verify: App > Profile > Wallet > All Transactions.\nDetails: https://groww.in/blog/running-account-authorization-how-does-it-work\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['instant withdrawal','after 4 pm','withdrawal timing'], r:`Instant withdrawals available 9:30 AM–4:00 PM on working days only. After-hours requests process next working day. Funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['negative balance','groww balance negative'], r:`Balance is negative because settlement charges exceeded available balance. Please add funds to bring balance to zero or positive.\nCheck: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['how to redeem','redeem mutual fund','withdraw from fund'], r:`To redeem:\n1. App > Mutual Funds > Dashboard > select fund > Redeem\n2. Enter amount or choose Redeem All\n3. Enter OTP > confirm\nCredited to bank in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['sip not visible','sip missing','sip not showing'], r:`SIP completed. Check: App > MF > Dashboard > fund > Investment Details > Transactions.\nTo refresh: MF Dashboard > Products and Tools > Import Funds. Updates in ~1 hour.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['skip sip','sip skip','skip installment'], r:`Can skip if 3–4 working days remain before SIP date. App > MF > Dashboard > SIPs > SIP > Skip Installment. Max 3 skips then SIP auto-cancels.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['elss','lock in','lock-in','3 year lock'], r:`ELSS funds have 3-year lock-in per installment from date of each investment. Full corpus redeemable 3 years after last installment.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['ipo amount blocked','ipo blocked','mandate end date','unblock ipo'], r:`Amount blocked by bank (not debited) pending allotment. Auto-unblocked before mandate end date if not allotted. Check mandate end date in UPI app. Funds completely safe.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['ipo not allotted','not get allotment','ipo rejected'], r:`No allotment received. Blocked amount auto-released before mandate end date. Check mandate end date in UPI app. Funds completely safe.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['ipo allotted','got allotment'], r:`Allotment received. Shares transfer to Demat on listing date before market opens.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['cancel ipo','ipo cancel'], r:`IPO closed — application cannot be cancelled. Wait for allotment. If not allotted, blocked amount auto-released before mandate end date.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['upper circuit','no sellers'], r:`Stock in upper circuit — no sellers, only buyers. Order executes when stock exits upper circuit.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['fno pending','f&o pending','fno activation pending'], r:`F&O account pending. Wait up to 24 hours for activation.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['fno rejected','fno activation rejected','income proof fno'], r:`F&O activation rejected — income proof didn't meet criteria. Re-upload one of:\n- Bank Statement (1 txn ≥ Rs.5,000 in 6 months)\n- ITR (gross income > Rs.90,000)\n- Demat Statement (holdings > Rs.5,000)\n- Salary Slip (gross monthly > Rs.7,500)\n- Form 16 (gross annual > Rs.1,80,000)\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['mtf squared off','negative 5 days'], r:`MTF position squared off — balance was negative for 5+ consecutive days per MTF policy. Maintain adequate funds to avoid square-offs.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['inactive account','account inactive','reactivate'], r:`Account inactive ~1 year. Log in > reactivate on home screen > complete e-sign. Active in 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['rekyc','re-kyc','kyc blocked','kyc pending'], r:`Complete ReKYC: https://groww.in/onboarding/data-collection?context=REKYC (open from Groww app). Wait ~10 min before clicking. MF investing enabled in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['delete account','account deletion','close account'], r:`Deletion request raised. Done in 24–48 hours. Re-register with same PAN/email/mobile after.\nFirst deactivate UPI: App > Groww UPI > UPI Settings > Manage UPI ID > three dots > Deactivate.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['esign','e-sign','account pending','account activation'], r:`E-sign done. Account activation takes ~2 working days. Standard process.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['contract note','brokerage breakdown','trade charges'], r:`Contract note sent to registered email. Open with PAN in capitals.\nAlso: App > Profile > Wallet > All Transactions > settlement > Download Contract Note.\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['brokerage fno','fno charges','f&o charges','options brokerage'], r:`Rs.20 per F&O order. Buy + Sell = Rs.40 round-trip.\nhttps://groww.in/pricing | Calculator: https://groww.in/calculators/brokerage-calculator\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['market timing','market hours','market open','market closed'], r:`Stocks (NSE/BSE): https://groww.in/p/stock-market-timings\nCommodity (MCX): https://groww.in/p/commodity-market-timing\n\nPlease feel free to reach out if you need any further assistance.` },
  { k:['dividend','not received dividend'], r:`Dividend credited to Demat-linked bank within 35–45 days of record date by company's RTA. Contact company's RTA if not received. RTA details on BSE (www.bseindia.com) or NSE (www.nseindia.com).\n\nPlease feel free to reach out if you need any further assistance.` },
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

// ── Main handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  // ── GET /api/chat?action=list  → list all learned entries ──────────────
  if (req.method === 'GET') {
    const action = req.query?.action;
    if (action === 'list') {
      const all = await getAllLearned();
      return res.status(200).json({ count: all.length, entries: all });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── DELETE /api/chat  { key }  → delete a learned entry ───────────────
  if (req.method === 'DELETE') {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    await redisDel(key);
    return res.status(200).json({ deleted: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, history = [], action, feedText, feedKey } = req.body || {};

    // ── ACTION: feed  → analyze raw info and store in Redis ───────────────
    if (action === 'feed') {
      if (!feedText?.trim()) return res.status(400).json({ error: 'feedText required' });

      const raw = await callGroq(apiKey,
        [{ role: 'user', content: `Analyze this information and return the JSON KB entry:\n\n${feedText}` }],
        ANALYZE_PROMPT, 600
      );

      let parsed;
      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        return res.status(422).json({ error: 'AI could not parse the information. Try adding more context.', raw });
      }

      const key = feedKey || `kb:feed:${hashKey(feedText)}`;
      const entry = {
        key,
        topic:    parsed.topic    || 'Untitled',
        summary:  parsed.summary  || '',
        response: parsed.response || '',
        triggers: parsed.triggers || [],
        category: parsed.category || 'Other',
        keywords: keywords((parsed.triggers || []).join(' ') + ' ' + parsed.topic + ' ' + feedText),
        source:   'feed',
        timestamp: new Date().toISOString(),
        hits: 0,
      };
      await redisSet(key, entry);
      return res.status(200).json({ stored: true, entry });
    }

    // ── ACTION: teach  → manually store a Q&A ─────────────────────────────
    if (action === 'teach') {
      const { question, answer } = req.body;
      if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
      const key = `kb:teach:${hashKey(question)}`;
      const entry = {
        key, topic: question, summary: question, response: answer,
        triggers: [], keywords: keywords(question + ' ' + answer),
        source: 'manual', timestamp: new Date().toISOString(), hits: 0,
      };
      await redisSet(key, entry);
      return res.status(200).json({ stored: true, entry });
    }

    // ── CHAT ──────────────────────────────────────────────────────────────
    if (!message) return res.status(400).json({ error: 'message required' });

    // Priority 1: Redis learned KB
    const learned = await findBestMatch(message);

    // Priority 2: Built-in KB
    const builtin = matchBuiltin(message);

    // Build context block
    let context = '';
    if (learned) {
      context += `LEARNED KNOWLEDGE:\nTopic: ${learned.topic}\n${learned.response}\n\n`;
      // async hit increment
      redisSet(learned.key, { ...learned, hits: (learned.hits || 0) + 1 }).catch(() => {});
    } else if (builtin) {
      context += `REFERENCE KNOWLEDGE:\n${builtin}\n\n`;
    }

    const userContent = context
      ? `${context}AGENT QUERY: ${message}`
      : message;

    const msgs = [...(history.slice(-6)), { role: 'user', content: userContent }];
    const reply = await callGroq(apiKey, msgs, CHAT_PROMPT, 700);

    // Auto-learn: if no match existed and reply is useful, store it
    const isNew = !learned && !builtin && reply.length > 80 && !reply.includes('unable to assist');
    if (isNew) {
      const key = `kb:auto:${hashKey(message)}`;
      const entry = {
        key, topic: message.slice(0, 80), summary: message,
        response: reply, triggers: [], keywords: keywords(message + ' ' + reply),
        source: 'auto', timestamp: new Date().toISOString(), hits: 0,
      };
      redisSet(key, entry).catch(() => {});
    }

    return res.status(200).json({
      reply,
      source: learned ? 'learned' : builtin ? 'builtin' : 'ai',
      autoLearned: isNew,
    });

  } catch (error) {
    console.error('GrowwBot error:', error);
    return res.status(500).json({ error: error.message });
  }
}
