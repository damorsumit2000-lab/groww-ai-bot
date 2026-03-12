// ─────────────────────────────────────────────
//  GrowwBot  — Self-Learning Support Assistant
//  Storage   : Upstash Redis (free tier)
//  Model     : Groq llama-3.3-70b-versatile
// ─────────────────────────────────────────────

// ── Built-in KB (fast keyword lookup, no Redis needed) ──────────────────────
const BUILTIN_KB = [
  {
    keys: ["settlement","traded today","t+1","contract note","10 pm","withdraw after"],
    res: `Please note that since you have traded today, kindly wait for the settlement to be completed. Stock settlement follows T+1 (Transaction + 1 working day). The settled amount will reflect in your Groww balance by approximately 10 PM today, and you will be able to withdraw after 10 AM tomorrow.\n\nYou can track this from: Groww app > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["withdrawal reversed","reversal","ifsc","sent back to groww balance"],
    res: `As checked, your withdrawal was reversed by your bank and the funds have been returned to your Groww Balance. Please contact your bank for details. Also check whether your IFSC code has changed — if it has, update it in your bank documents and then in the Groww app, after which you can retry the withdrawal.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["withdrawal not received","utr","not reflected in bank","neft"],
    res: `Your withdrawal has been successfully processed. The UTR number for this transaction is [UTR NUMBER]. If the amount is not yet reflected, kindly share this UTR with your bank's support team so they can verify it at their end.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["raa","running account authorization","quarter end refund","month end refund"],
    res: `Please note that under the Running Account Authorization (RAA) policy mandated by SEBI, excess funds have been returned to your registered bank account as part of the periodic settlement. Groww is required to follow these SEBI guidelines.\n\nVerify from: Groww app > Profile > Wallet > All Transactions.\nRead more: https://groww.in/blog/running-account-authorization-how-does-it-work\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["instant withdrawal","after 4 pm","withdrawal timing"],
    res: `Please note that instant withdrawals are available only between 9:30 AM and 4:00 PM on working days. Requests placed after this time will be processed the next working day. Your funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["settlement holiday"],
    res: `Please note that today is a settlement holiday. As per SEBI guidelines, stock settlement follows T+1 working days. The amount will be available once the holiday period ends.\n\nCheck from: Groww app > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["negative balance","groww balance negative"],
    res: `Please note that your Groww balance is negative because settlement charges for your trades exceeded your available balance. Please add funds to bring the balance to zero or positive.\n\nReview from: Groww app > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["how to redeem","redeem mutual fund","withdraw from fund"],
    res: `To redeem your mutual fund investment:\n1. Open the Groww app and go to Mutual Funds.\n2. Click on Dashboard.\n3. Select the fund and tap Redeem.\n4. Enter the amount or choose Redeem All.\n5. Enter the OTP sent to your registered mobile and email.\n6. Confirm the redemption.\n\nThe amount will be credited to your bank within 3 to 4 working days.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["redeem cannot cancel","cancel redemption order"],
    res: `Please note that once a redemption order is placed, it cannot be cancelled as it has already been submitted to the fund house. Kindly wait for the amount to be credited. Your money is completely safe.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["sip not visible","sip missing","sip not showing"],
    res: `Your SIP order has been completed and the investment is reflected in your dashboard. Navigate to: Groww app > Mutual Funds > Dashboard > Click on the fund > Investment Details > Transactions.\n\nTo refresh: MF Dashboard > Products and Tools > Import Funds. Updates within approximately one hour.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["sip edit","change sip date","change sip amount"],
    res: `When you edit the SIP date or amount, the existing SIP is cancelled and a new one is created from the updated date. This is why you received an SMS about cancellation — this is the standard process.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["skip sip","sip skip","skip installment"],
    res: `You can skip a SIP installment, however there must be a gap of at least 3 to 4 working days (excluding Saturday and Sunday) between today and the upcoming SIP date. A SIP can be skipped a maximum of 3 times, after which it will be automatically cancelled.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["cancel sip","stop sip"],
    res: `Please note that it takes up to 7 working days for a SIP cancellation to be fully processed. The invested amount remains in the fund until you choose to redeem it.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["elss","lock in","lock-in","3 year lock"],
    res: `ELSS funds have a mandatory lock-in of 3 years per installment. For example, an amount invested in January 2022 can be redeemed from January 2025 onwards. You can redeem the full corpus only 3 years after the last installment.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["ipo amount blocked","ipo blocked","mandate end date","unblock ipo"],
    res: `When you place an IPO application, the required amount is blocked (not debited) by your bank to ensure sufficient funds are available. It will be automatically unblocked before the mandate end date if you are not allotted shares.\n\nCheck mandate end date in your UPI app under the payment section. Your funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["ipo not allotted","not get allotment","ipo rejected"],
    res: `You have not received an allotment for this IPO. The blocked amount will be automatically released by your bank before the mandate end date. Check the mandate end date in your UPI app. Your funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["ipo allotted","got allotment","received ipo"],
    res: `Congratulations! You have received an allotment for this IPO. The allotted shares will be transferred to your Demat account on the listing date, before the market opens.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["cancel ipo","ipo cancel"],
    res: `Once an IPO application is placed and the IPO has closed, it cannot be cancelled. Kindly wait for the allotment. If not allotted, the blocked amount will be released before the mandate end date.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["asba","apply ipo net banking"],
    res: `To apply for this IPO via ASBA:\n1. Log in to your net banking account.\n2. Navigate to the ASBA or IPO section.\n3. Enter your Groww Demat account details as the beneficiary.\n4. Complete the IPO application.\n\nFor assistance, please check with your bank.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["upper circuit","no sellers","circuit limit"],
    res: `The stock is currently in the upper circuit, which means there are no sellers available — only buyers. Your buy order will be executed once the stock exits the upper circuit and sellers become available.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["fno pending","f&o pending","fno activation pending"],
    res: `Your F&O account is currently in pending status. Please wait up to 24 hours for activation.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["fno rejected","fno activation rejected","income proof fno"],
    res: `Your F&O account activation was rejected. Please re-upload any one of these documents:\n- Bank Statement: one transaction of Rs. 5,000+ in the last 6 months\n- ITR acknowledgement: gross annual income exceeding Rs. 90,000\n- Demat Statement: holdings greater than Rs. 5,000\n- Salary Slip: gross monthly income exceeding Rs. 7,500\n- Form 16: gross annual income exceeding Rs. 1,80,000\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["mtf squared off","negative 5 days","auto squareoff mtf"],
    res: `Your MTF position was automatically squared off because your Groww balance remained negative for more than 5 consecutive days, as per our MTF policy. Please maintain adequate funds in your wallet to avoid this.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["mtf","margin trade funding","14.95","leverage buying"],
    res: `MTF (Margin Trade Funding) allows you to purchase stocks using leverage. You contribute a portion and Groww funds the remainder (up to 80%, based on the haircut percentage). Interest rate: 14.95% per annum (0.05%/day + GST). MTF positions settle daily on a Mark-to-Market basis.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["inactive account","account inactive","reactivate"],
    res: `Your account has become inactive due to approximately one year of non-use. To reactivate, log in to the Groww app, click the reactivation option on the home screen, and complete the e-sign process. Your account will be active within 24 to 48 hours.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["rekyc","re-kyc","kyc blocked","kyc not verified","kyc pending"],
    res: `Your KYC requires re-verification. Please complete the ReKYC using this link from within the Groww app: https://groww.in/onboarding/data-collection?context=REKYC\n\nWait approximately 10 minutes before clicking. Account will be active within 3 to 4 working days.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["delete account","account deletion","close account"],
    res: `A deletion request has been raised. The deletion will be completed within 24 to 48 hours. After that, you can create a new account using the same PAN, email, and mobile number.\n\nBefore deletion, deactivate UPI: Groww app > Groww UPI > UPI Settings > Manage UPI ID > Three dots > Deactivate.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["esign","e-sign","account pending","account activation"],
    res: `Your e-sign has been completed and the account is in pending status. Activation typically takes 2 working days. This is a standard process.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["market timing","market hours","market open","market closed"],
    res: `Market timings for reference:\n- Stocks (NSE/BSE): https://groww.in/p/stock-market-timings\n- Commodity (MCX): https://groww.in/p/commodity-market-timing\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["contract note","brokerage breakdown","trade charges download"],
    res: `Your contract note has been sent to your registered email. Open it using your PAN in capital letters. It contains a full breakdown of all transactions and charges.\n\nAlso accessible from: Groww app > Profile > Wallet > All Transactions > Settlement > Download Contract Note.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["brokerage fno","fno charges","f&o charges","options brokerage"],
    res: `Groww charges Rs. 20 per F&O order. Buy + Sell = Rs. 40 total for a round trip.\n\nDetails: https://groww.in/pricing\nCalculator: https://groww.in/calculators/brokerage-calculator\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["near strike","strike price rejected","strike too far","15%","commodity order rejected"],
    res: `Your F&O order was rejected because the selected strike is too far from the spot price. Please place orders within 15% of the current spot price (stocks/commodity). For BANKEX/SENSEX: 2%. For MIDCAP: 5%. For commodities: 2%.\n\nExample: Spot price Rs. 180 → Place orders between Rs. 153 and Rs. 207.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["pledge","unpledge","pledged balance"],
    res: `To unpledge shares: Profile > Groww Balance > Pledged Balance > Select stock > Unpledge > Enter quantity > Confirm.\n\nThe unpledge request takes 24 hours to process.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["dividend","not received dividend","where is my dividend"],
    res: `Dividends are credited to your Demat-linked bank account, generally within 35 to 45 days from the record date, processed by the company's RTA. If not received within this timeframe, please contact the company's RTA directly. RTA details are available on BSE (www.bseindia.com) or NSE (www.nseindia.com) under Corporate Information.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["angry","frustrated","waiting","still not resolved","complaint","how long","worst","pathetic","disgusting","unacceptable"],
    res: `We sincerely apologize for the inconvenience and frustration this has caused you. We completely understand your concern and want to assure you that resolving this is our top priority. Your funds are completely safe throughout this process.\n\nI have escalated this with our concerned team, and you will receive an update on your registered email within 24 to 48 working hours. We deeply appreciate your patience and trust.\n\nPlease feel free to reach out if you need any further assistance.`
  }
];

// ── Upstash Redis helpers ────────────────────────────────────────────────────
async function redisGet(key) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key, value) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;
    await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value))
    });
  } catch {}
}

async function redisGetAll() {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return [];
    // Get all learned keys
    const keysRes = await fetch(`${url}/keys/learned:*`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const keysData = await keysRes.json();
    const keys = keysData.result || [];
    if (keys.length === 0) return [];
    // Fetch all values via pipeline
    const pipeline = keys.map(k => ['get', k]);
    const pipeRes = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline)
    });
    const pipeData = await pipeRes.json();
    return pipeData
      .map(r => { try { return JSON.parse(r.result); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

async function redisIncr(key) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;
    await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {}
}

// ── Keyword match against built-in KB ────────────────────────────────────────
function matchBuiltin(message) {
  const msg = message.toLowerCase();
  const matches = [];
  for (const entry of BUILTIN_KB) {
    if (entry.keys.some(k => msg.includes(k))) {
      matches.push(entry.res);
      if (matches.length >= 2) break;
    }
  }
  return matches.join('\n\n---\n\n');
}

// ── Semantic similarity (simple keyword overlap score) ────────────────────────
function similarity(msgWords, learnedKeywords) {
  if (!learnedKeywords || learnedKeywords.length === 0) return 0;
  const hits = learnedKeywords.filter(k => msgWords.includes(k)).length;
  return hits / learnedKeywords.length;
}

// ── Find best learned entry from Redis ───────────────────────────────────────
async function matchLearned(message) {
  const learned = await redisGetAll();
  if (learned.length === 0) return null;
  const msgWords = message.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  let best = null, bestScore = 0;
  for (const entry of learned) {
    const score = similarity(msgWords, entry.keywords);
    if (score > bestScore && score >= 0.3) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

// ── Extract keywords from text ────────────────────────────────────────────────
function extractKeywords(text) {
  const stopwords = new Set(['the','and','for','are','this','that','with','have','from','will','your','please','note','you','can','our','has','not','its','been','once','after','they','their','which','when','also','then','into','more','what','how','does','would','could','should','been','was','were','about','there','here','just','like','some','very','well','any','all','but','get','set','new','now','one','two','may']);
  return text.toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .slice(0, 20);
}

// ── Detect if AI learned new info from a conversation turn ───────────────────
function shouldLearn(userMsg, botReply) {
  // Learn if: reply is substantial, not an error, not a generic fallback
  if (botReply.length < 80) return false;
  if (botReply.toLowerCase().includes('unable to assist')) return false;
  if (botReply.toLowerCase().includes('error occurred')) return false;
  return true;
}

// ── Stable hash for a string (used as Redis key) ─────────────────────────────
function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are GrowwBot, a Groww customer support assistant. You help agents get accurate, ready-to-send responses for Groww customer queries.

RULES:
- No emojis. Plain text only.
- Formal, warm, and empathetic. Acknowledge concern first.
- Include Groww navigation paths and relevant links.
- End every response with: "Please feel free to reach out if you need any further assistance."
- For escalated or angry customers: validate frustration sincerely, apologize, give clear resolution, reassure fund safety.
- Only answer Groww platform and Indian finance queries. For anything else reply: "I am trained specifically for Groww platform queries and am unable to assist with this request."
- Start the response directly — no preamble like "Here is the response".
- If REFERENCE RESPONSES are provided, use them as your primary source and adapt to the specific situation.`;

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Admin endpoint: view all learned entries ──────────────────────────────
  if (req.method === 'GET' && req.query?.action === 'learned') {
    const learned = await redisGetAll();
    return res.status(200).json({ count: learned.length, entries: learned });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, history = [], teach } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    // ── TEACH MODE: agent manually feeds a Q&A pair ───────────────────────
    if (teach && teach.question && teach.answer) {
      const keywords = extractKeywords(teach.question + ' ' + teach.answer);
      const key = `learned:${hashKey(teach.question)}`;
      await redisSet(key, {
        question: teach.question,
        answer: teach.answer,
        keywords,
        source: 'manual',
        timestamp: new Date().toISOString(),
        hits: 0
      });
      return res.status(200).json({ stored: true, key, keywords });
    }

    // ── Step 1: Check built-in KB ─────────────────────────────────────────
    const builtinMatch = matchBuiltin(message);

    // ── Step 2: Check learned KB from Redis ───────────────────────────────
    const learnedMatch = await matchLearned(message);

    // ── Step 3: Build context ─────────────────────────────────────────────
    let context = '';
    if (learnedMatch) {
      context += `LEARNED RESPONSE (from past training):\n${learnedMatch.answer}\n\n`;
      // Increment hit counter async
      redisIncr(`hits:${hashKey(learnedMatch.question)}`);
    }
    if (builtinMatch) {
      context += `REFERENCE RESPONSES:\n${builtinMatch}`;
    }

    const userContent = context
      ? `${context}\n\nAGENT QUERY: ${message}`
      : message;

    const messages = [
      ...history.slice(-4),
      { role: 'user', content: userContent }
    ];

    // ── Step 4: Call Groq ─────────────────────────────────────────────────
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.2,
        max_tokens: 600,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      throw new Error(`Groq API error: ${err}`);
    }

    const data = await groqRes.json();
    const reply = data.choices[0].message.content;

    // ── Step 5: Auto-learn if this was a new/unique query ─────────────────
    // Only learn if no builtin match existed AND reply is useful
    const isNew = !builtinMatch && !learnedMatch;
    if (isNew && shouldLearn(message, reply)) {
      const keywords = extractKeywords(message + ' ' + reply);
      const key = `learned:${hashKey(message)}`;
      // Don't await — store in background
      redisSet(key, {
        question: message,
        answer: reply,
        keywords,
        source: 'auto',
        timestamp: new Date().toISOString(),
        hits: 0
      }).catch(() => {});
    }

    return res.status(200).json({
      reply,
      source: learnedMatch ? 'learned' : builtinMatch ? 'builtin' : 'ai-generated',
      learned: isNew && shouldLearn(message, reply)
    });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message });
  }
}
