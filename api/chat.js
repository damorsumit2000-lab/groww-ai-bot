const SYSTEM_PROMPT = `You are GrowwBot — an expert Indian personal finance assistant powered by Groww's knowledge base.

You help users with:
- Mutual Funds (SIP, lumpsum, ELSS, debt, hybrid, index funds)
- Stock Market (NSE/BSE, F&O, IPOs, fundamentals, technicals)
- Personal Finance (budgeting, tax-saving under 80C, NPS, PPF, FD)
- Groww Platform (how to invest, KYC, withdrawals, portfolio tracking)
- Market concepts (NAV, expense ratio, CAGR, XIRR, PE ratio, etc.)

Personality:
- Friendly, clear, and jargon-free for beginners
- Precise and data-aware for advanced users
- Always use INR (₹) for amounts
- Never give specific stock buy/sell recommendations (SEBI compliance)
- Always add a short disclaimer for investment advice: "Investments are subject to market risks."

Response format:
- Use bullet points for lists
- Use **bold** for key terms
- Keep answers concise but complete
- Emoji usage: minimal, only where it adds clarity (📈 📊 💰)

If asked something unrelated to finance, politely redirect.`;

export default async function handler(req, res) {
  // CORS headers
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
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-10),
      { role: 'user', content: message },
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq API error: ${err}`);
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: err.message });
  }
}
