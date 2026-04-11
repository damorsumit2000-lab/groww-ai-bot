// GrowwBot v11.0
// Architecture: Data-first analysis | KB fallback | Remark-driven response

const VERSION = 'v11.0';
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
    const r = await fetch(`${UP.url()}/pipeline`,{method:'POST',headers:UP.hdrs(),body:JSON.stringify(cmds)});
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}
async function redisSet(key,val) { await redisPipe([['set',key,JSON.stringify(val)]]); }
async function redisDel(key)     { await redisPipe([['del',key]]); }
async function redisKeys(pat) {
  if (!UP.ready()) return [];
  try {
    const r = await fetch(`${UP.url()}/keys/${encodeURIComponent(pat)}`,{headers:UP.hdrs()});
    const d = await r.json();
    return Array.isArray(d?.result) ? d.result : [];
  } catch { return []; }
}
async function redisGetAll(pattern) {
  const keys = await redisKeys(pattern);
  if (!keys.length) return [];
  const res = await redisPipe(keys.map(k=>['get',k]));
  return res.map(item=>{
    if (!item?.result) return null;
    try {
      let p=JSON.parse(item.result);
      if (typeof p==='string') p=JSON.parse(p);
      return (p&&typeof p==='object') ? p : null;
    } catch { return null; }
  }).filter(Boolean);
}
async function getAllLearned() {
  return (await redisGetAll('kb:*')).filter(e=>e.response);
}

// ── Hash ──────────────────────────────────────────────────────────────────
function hashKey(s) {
  let h=0; for(let i=0;i<s.length;i++) h=(Math.imul(31,h)+s.charCodeAt(i))|0;
  return Math.abs(h).toString(36);
}

// ── NLP / KB matching ─────────────────────────────────────────────────────
const STOP=new Set(['the','and','for','are','this','that','with','have','from','will','your','please','note','you','can','our','has','not','its','been','once','after','they','their','which','when','also','then','into','more','what','how','does','would','could','should','was','were','about','there','here','just','like','some','very','well','any','all','but','get','set','new','now','one','two','may','per','via','upon','did','them','tell','want','need','asking','asked','query','issue','problem','customer','agent','client','dear','sir','madam','hello','kindly']);
const SYNONYMS={'f&o':'fno','futures and options':'fno','sip':'sip','mutual fund':'mf','nri':'nri','kyc':'kyc','ipo':'ipo','mtf':'mtf','demat':'demat','pan':'pan','utr':'utr','withdraw':'withdrawal','withdrawl':'withdrawal','settle':'settlement','activate':'activation','close account':'closure','delete account':'closure'};
function expand(text){let t=text.toLowerCase();for(const[k,v]of Object.entries(SYNONYMS))t=t.split(k).join(v);return t;}
function tokens(text){return[...new Set(expand(text).split(/\W+/).filter(w=>w.length>2&&!STOP.has(w)))];}
function extractTriggers(q){const toks=tokens(q);const out=new Set([q.toLowerCase().trim()]);for(let i=0;i<toks.length;i++){out.add(toks[i]);if(i+1<toks.length)out.add(`${toks[i]} ${toks[i+1]}`);if(i+2<toks.length)out.add(`${toks[i]} ${toks[i+1]} ${toks[i+2]}`);}return[...out].filter(t=>t.length>2).slice(0,60);}

const MATCH_THRESHOLD=0.55;
function semanticScore(qToks,entry){
  const trig=Array.isArray(entry.triggers)&&entry.triggers.length?entry.triggers:(entry.questionKeywords||entry.keywords||[]);
  if(!trig.length)return 0;
  const qSet=new Set(qToks),tSet=new Set(trig);
  const overlap=qToks.filter(t=>tSet.has(t)).length;
  const tokenScore=overlap/Math.max(qSet.size,tSet.size);
  const qStr=qToks.join(' ');
  const phraseHits=trig.filter(t=>t.includes(' ')&&qStr.includes(t)).length;
  const phraseScore=Math.min(1,phraseHits*0.4);
  const storedQ=tokens(entry.question||entry.topic||'');
  const directHits=storedQ.filter(t=>qSet.has(t)).length;
  const directScore=storedQ.length>0?directHits/storedQ.length:0;
  return Math.max(tokenScore*0.5,phraseScore,directScore*0.8);
}
async function findBestKBMatch(query){
  const all=await getAllLearned();
  if(!all.length)return null;
  const qToks=tokens(query);
  let best=null,bestScore=0;
  for(const e of all){const s=semanticScore(qToks,e);if(s>bestScore&&s>=MATCH_THRESHOLD){bestScore=s;best=e;}}
  return best;
}

// ── Groww gate (for auto-learn) ────────────────────────────────────────────
const GROWW_SIG=['groww','sip','mutual','withdrawal','settlement','ipo','kyc','demat','nri','trading','fno','portfolio','invest','redeem','sebi','nse','bse','account','pan','utr','neft','equity','dividend','nav','etf','elss','brokerage','margin','mtf','btst','circuit','pledge','nominee','activation','closure','rekyc','order','rejected','executed','approved'];
function isGrowwRelated(t){return GROWW_SIG.some(s=>t.toLowerCase().includes(s));}

// ── Built-in KB ────────────────────────────────────────────────────────────
const BUILTIN=[
  {k:['settlement','traded today','t+1','10 pm','withdraw after'],r:`Your stock settlement follows T+1 — one working day after the trade.\n\nThe settled amount will reflect in your Groww balance by approximately 10 PM today. Withdrawal will be available after 10 AM tomorrow.\n\nTo track: App > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['withdrawal reversed','reversal','sent back to groww'],r:`Your withdrawal was reversed by your bank and the funds have been returned to your Groww Balance.\n\nPlease contact your bank for the reason. Also check if your IFSC code has changed — if yes, update it in the Groww app, then retry the withdrawal.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['withdrawal not received','utr','not reflected in bank'],r:`Your withdrawal has been processed. The UTR for this transaction is [UTR NUMBER].\n\nIf the amount is not yet reflecting, please share this UTR with your bank so they can trace it.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['raa','running account authorization','quarter end refund'],r:`Under SEBI's RAA policy, Groww transfers excess funds back to your registered bank at month/quarter-end.\n\nVerify: App > Profile > Wallet > All Transactions.\n\nDetails: https://groww.in/blog/running-account-authorization-how-does-it-work\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['instant withdrawal','after 4 pm','withdrawal timing'],r:`Instant withdrawals are available between 9:30 AM and 4:00 PM on working days only.\n\nRequests placed after 4 PM will be processed the next working day.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['negative balance','groww balance negative'],r:`Your Groww balance is negative because settlement charges exceeded your available balance.\n\nPlease add funds to bring it back to zero or positive.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['how to redeem','redeem mutual fund'],r:`To redeem:\n1. App > Mutual Funds > Dashboard\n2. Select the fund > tap Redeem\n3. Enter amount or Redeem All > OTP > confirm\n\nCredited to bank in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['sip not visible','sip missing'],r:`SIP completed. Check: App > MF > Dashboard > Fund > Investment Details > Transactions.\n\nRefresh: MF Dashboard > Products and Tools > Import Funds. Updates in ~1 hour.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['cancel sip','stop sip'],r:`SIP cancellation takes up to 7 working days. The invested amount stays in the fund until you redeem.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['elss','lock in','lock-in'],r:`ELSS funds have a mandatory 3-year lock-in per installment from the date of each investment.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['ipo amount blocked','ipo blocked'],r:`When you apply for an IPO, the required amount is blocked by your bank — not debited. It will be automatically unblocked before the mandate end date if you are not allotted shares.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['fno pending','f&o pending','fno activation pending'],r:`Your F&O account is currently pending activation. Please wait up to 24 hours.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['fno rejected','fno activation rejected'],r:`Your F&O activation was rejected because the income proof did not meet the criteria.\n\nPlease re-upload one of:\n1. Bank Statement (1 txn Rs.5,000+ in 6 months)\n2. ITR (gross income > Rs.90,000)\n3. Salary Slip (gross monthly > Rs.7,500)\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['mtf squared off','negative 5 days'],r:`Your MTF position was automatically squared off because your Groww balance remained negative for more than 5 consecutive days.\n\nPlease maintain adequate funds to prevent future square-offs.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['inactive account','account inactive'],r:`Your account became inactive due to ~1 year of non-use.\n\nTo reactivate: Log in > tap Reactivate on home screen > complete e-sign. Active within 24–48 hours.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['rekyc','re-kyc','kyc blocked'],r:`Complete ReKYC:\n1. Open inside Groww app: https://groww.in/onboarding/data-collection?context=REKYC\n2. Wait ~10 minutes before clicking\n\nMF investing enabled in 3–4 working days.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['delete account','account deletion','close account'],r:`Deletion request raised. Done in 24–48 hours. Re-register with same PAN/email/mobile after.\n\nFirst deactivate UPI: App > Groww UPI > UPI Settings > Manage UPI ID > three dots > Deactivate.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['margin exceeds','margin shortfall','rms margin'],r:`Your order was rejected because the available margin in your account was insufficient for this trade.\n\nRequired margin was higher than the available balance. Please add funds to your Groww account and retry the order.\n\nPlease feel free to reach out if you need any further assistance.`},
  {k:['angry','frustrated','worst','unacceptable','cheated','fraud','scam','lost money'],r:`We sincerely apologize for the inconvenience and frustration this situation has caused. We completely understand how distressing this must be, and resolving this is our top priority.\n\nYour funds are completely safe. I have escalated this to our senior team and you will receive a resolution update on your registered email within 24–48 working hours.\n\nPlease feel free to reach out if you need any further assistance.`},
];
function matchBuiltin(msg){const m=msg.toLowerCase();for(const e of BUILTIN){if(e.k.some(k=>m.includes(k)))return e.r;}return null;}

// ── Groq ──────────────────────────────────────────────────────────────────
async function callGroq(apiKey,messages,system,maxTokens=800){
  const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'system',content:system},...messages],temperature:0.15,max_tokens:maxTokens}),
  });
  if(!res.ok){const e=await res.text();throw new Error(`Groq: ${e}`);}
  return (await res.json()).choices[0].message.content;
}

// ── DATA ANALYSIS system prompt ────────────────────────────────────────────
// Used when agent provides order data
const DATA_ANALYSIS_PROMPT = `You are GrowwBot ${VERSION}, an expert Groww customer support analyst.

An agent has provided customer order data along with a customer remark/complaint.

YOUR JOB:
1. Carefully read and analyse ALL the order data provided
2. Read the customer remark — this tells you what the customer is complaining about or asking
3. Identify what happened — root cause, what succeeded, what failed and why
4. Draft a precise, professional reply the agent can directly send to the customer

REMARK HANDLING:
- If remark is "-" or "no issue" or empty: the customer just wants an explanation of their order activity. Summarise what happened clearly.
- If remark contains a specific complaint or question: address that complaint DIRECTLY using the data as evidence. Explain what happened, why, and what the customer should do next.

DATA FIELD MEANINGS (for F&O / stock orders):
- order_status: EXECUTED=success, REJECTED=failed, APPROVED=sent to exchange, NEW=just placed, CANCELLED=cancelled, TRIGGER_PENDING=SL order waiting, MODIFICATION_REQUESTED=edit in progress
- remark / nest_remark: the REJECTION REASON. "RMS:Margin Exceeds,Required:X,Available:Y" means insufficient margin
- buy_sell: B=Buy, S=Sell
- avg_fill_price: actual execution price
- qty: quantity ordered, filled_qty: quantity actually executed, remaining_qty: pending quantity
- segment: FNO=Futures & Options, CDS=Currency, COM=Commodity
- product: NRML=overnight/positional, MIS=intraday
- order_type: MKT=market order, LMT=limit order, SL=stop-loss
- symbol_name: human-readable instrument name (e.g. "SENSEX 09 Apr 77300 Call")
- transaction_type: INTERNAL=system/algo order, USER=customer placed
- exchange_time: when exchange received/processed the order
- order_source: SMARTORDER=algo/OCO order, USER=manual

RESPONSE FORMAT:
- Write directly to the customer (not to the agent)
- Start with 1 sentence addressing their concern directly
- Use plain text, no emojis
- Use blank lines between sections for readability
- If explaining rejection: state the exact reason, the shortfall amount, and what to do
- If explaining trade activity: summarise concisely (instrument, buy/sell, quantity, price, time)
- Keep it under 150 words unless the situation is complex
- End with: "Please feel free to reach out if you need any further assistance."
- Never say "as per the data" or "I can see in your order history" — be direct and confident`;

// ── KB-only system prompt (no data) ───────────────────────────────────────
const KB_PROMPT = `You are GrowwBot ${VERSION}, a Groww customer support assistant for agents.

Agent describes a customer issue → you return a ready-to-send response to the customer.

FORMATTING:
- Keep responses SHORT. Max 5–6 lines for simple queries.
- Blank lines between paragraphs. Never a wall of text.
- Numbered steps for processes. Plain text only, no emojis.
- End EVERY response with a blank line, then: "Please feel free to reach out if you need any further assistance."

CONTENT:
- Only answer Groww platform and Indian investment topics.
- For anything else: "I am trained specifically for Groww platform queries and am unable to assist with this request."
- No preamble. Start the response directly to the customer.
- Include app navigation paths when relevant.
- For escalated/angry customers: open with sincere apology, validate concern, resolve, reassure funds are safe.`;

// ── Main handler ──────────────────────────────────────────────────────────
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,GET,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();

  const apiKey=process.env.GROQ_API_KEY;
  if(!apiKey)return res.status(500).json({error:'GROQ_API_KEY not configured'});

  if(req.method==='GET'){
    if(req.query?.action==='list'){
      const all=await getAllLearned();
      return res.status(200).json({count:all.length,entries:all,version:VERSION});
    }
    return res.status(400).json({error:'Unknown action'});
  }

  if(req.method==='DELETE'){
    const {key}=req.body||{};
    if(!key)return res.status(400).json({error:'key required'});
    await redisDel(key);
    return res.status(200).json({deleted:true});
  }

  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});

  try{
    const body=req.body||{};
    const {action}=body;

    // ── FEED Q&A ─────────────────────────────────────────────────────────
    if(action==='feed'){
      const{question,answer,category}=body;
      if(!question?.trim()||!answer?.trim())
        return res.status(400).json({error:'Both question and answer are required.'});
      const newKey=`kb:feed:${hashKey(question.toLowerCase().trim())}`;
      const newTrig=extractTriggers(question);
      const newToks=tokens(question);
      const allExisting=await getAllLearned();
      let deletedKeys=[],inheritedHits=0;
      for(const e of allExisting){
        const s=semanticScore(newToks,e);
        if(s>=0.4){await redisDel(e.key);deletedKeys.push(e.key);inheritedHits+=(e.hits||0);}
      }
      const entry={key:newKey,question:question.trim(),topic:question.trim(),summary:question.trim(),response:answer.trim(),triggers:newTrig,questionKeywords:newToks,keywords:newToks,category:category||'Other',source:'feed',timestamp:new Date().toISOString(),hits:inheritedHits};
      await redisSet(newKey,entry);
      return res.status(200).json({stored:true,updated:deletedKeys.length>0,replacedKeys:deletedKeys,triggerCount:newTrig.length,entry});
    }

    // ── CHAT ─────────────────────────────────────────────────────────────
    const{message,orderData,remark,chatHistory=[]}=body;
    if(!message&&!orderData)return res.status(400).json({error:'message or orderData required'});

    // ── PATH A: Order data provided → Data Analysis mode ─────────────────
    if(orderData&&orderData.trim()){
      const remarkText=(remark||'').trim();
      const hasRemark=remarkText&&remarkText!=='-'&&remarkText.toLowerCase()!=='no issue'&&remarkText.toLowerCase()!=='nil'&&remarkText.toLowerCase()!=='none';

      const userPrompt=`CUSTOMER ORDER DATA:
${orderData}

CUSTOMER REMARK / COMPLAINT: ${hasRemark ? remarkText : '(No specific complaint — customer wants an explanation of their order activity)'}

${message ? `ADDITIONAL CONTEXT FROM AGENT: ${message}` : ''}

Please analyse the data and draft a response to send to the customer.`;

      const msgs=[...chatHistory.slice(-4),{role:'user',content:userPrompt}];
      const reply=await callGroq(apiKey,msgs,DATA_ANALYSIS_PROMPT,800);
      return res.status(200).json({reply,source:'data-analysis',mode:'data'});
    }

    // ── PATH B: No data → KB / AI mode ───────────────────────────────────
    // Check Redis KB first
    const learned=await findBestKBMatch(message);
    if(learned){
      redisSet(learned.key,{...learned,hits:(learned.hits||0)+1}).catch(()=>{});
      return res.status(200).json({reply:learned.response,source:'learned',mode:'kb'});
    }

    // Check built-in KB
    const builtin=matchBuiltin(message);

    // Check PDF KB
    const pdfChunks=await searchChunks(message,3).catch(()=>[]);
    const pdfCtx=pdfChunks.length>0
      ? `\n\nPDF KNOWLEDGE:\n${pdfChunks.map(c=>`[${c.docName}]:\n${c.content}`).join('\n\n')}`
      : '';

    let userContent=message;
    if(builtin) userContent=`REFERENCE:\n${builtin}\n\nAGENT QUERY: ${message}`;
    else if(pdfCtx) userContent=`${pdfCtx}\n\nAGENT QUERY: ${message}`;

    const msgs=[...chatHistory.slice(-6),{role:'user',content:userContent}];
    const reply=await callGroq(apiKey,msgs,KB_PROMPT,600);

    // Auto-learn Groww-related responses
    const isGroww=isGrowwRelated(message)||isGrowwRelated(reply);
    const isUseful=reply.length>80&&!reply.toLowerCase().includes('unable to assist');
    if(!builtin&&isGroww&&isUseful){
      const key=`kb:auto:${hashKey(message)}`;
      const trig=extractTriggers(message);
      const qToks=tokens(message);
      redisSet(key,{key,question:message,topic:message.slice(0,80),summary:message,response:reply,triggers:trig,questionKeywords:qToks,keywords:qToks,source:'auto',category:'Other',timestamp:new Date().toISOString(),hits:0}).catch(()=>{});
    }

    return res.status(200).json({
      reply,
      source:builtin?'builtin':(pdfChunks.length?'pdf':'ai'),
      autoLearned:!builtin&&isGroww&&isUseful,
      mode:'kb',
    });

  }catch(err){
    console.error('GrowwBot error:',err);
    return res.status(500).json({error:err.message});
  }
}
