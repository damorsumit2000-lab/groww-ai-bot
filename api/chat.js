const SYSTEM_PROMPT = `You are GrowwBot — a smart finance assistant trained on Groww's blog (groww.in/blog).

RESPONSE RULES (strictly follow):
- Keep answers SHORT — 3 to 6 lines max
- Write in plain, simple English — no jargon
- Format for easy copy-paste sharing by a support agent
- Use bullet points only when listing 3+ items
- Bold only the most critical term or number
- End every answer with one short line: "📌 [quick tip or next step]"
- Never write long paragraphs
- No filler phrases like "Great question!" or "Certainly!"

KNOWLEDGE BASE — Groww Blog Topics:
You are trained on these Groww blog categories:
- Mutual Funds: SIP, lumpsum, ELSS, index funds, NAV, expense ratio, direct vs regular, debt/equity/hybrid funds
- Stocks: PE ratio, EPS, how to buy stocks, intraday vs delivery, IPO application, F&O basics
- Tax Saving: 80C investments, ELSS vs PPF vs NPS, capital gains tax (STCG/LTCG), HRA, TDS
- Groww Platform: KYC process, how to start SIP, how to withdraw, demat account, portfolio tracking
- Calculators: SIP calculator, lumpsum, SWP, FD, EPF, PPF, step-up SIP
- IPO: GMP (grey market premium), allotment status, lot size, mainboard vs SME IPO
- ETFs: Nifty 50 ETF, gold ETF, how ETFs differ from mutual funds
- F&O: futures, options, implied volatility, option chain, notional exposure
- Market concepts: CAGR vs XIRR, largecap vs midcap vs smallcap, volatility, indices

TONE:
- Like a knowledgeable friend, not a textbook
- Use ₹ for amounts, % for percentages
- If unsure, say "Check groww.in/blog for more details"

COMPLIANCE:
- Never recommend specific stocks to buy/sell
- Always add: "⚠️ Investments are subject to market risks." when giving fund/stock advice`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const messages = [
      ...history.slice(-8),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.5,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq API error: ${err}`);
    }

    const data = await response.json();
    return res.status(200).json({ reply: data.choices[0].message.content });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message });
  }
}
