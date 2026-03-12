// ─── Compact Knowledge Base ───
// Each entry: key = trigger keywords, value = exact response template
const KB = [
  {
    keys: ["settlement","traded today","withdraw after","t+1","contract note","10 pm"],
    res: `Please note that since you have traded today, kindly wait for the settlement to be completed. Stock settlement follows T+1 (Transaction + 1 working day). The settled amount will reflect in your Groww balance by approximately 10 PM today, and you will be able to withdraw after 10 AM tomorrow.\n\nYou can track this from: Groww app > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["withdrawal reversed","reversal","ifsc","sent back to groww"],
    res: `As checked, your withdrawal was reversed by your bank and the funds have been returned to your Groww Balance. Please contact your bank for details. Also check whether your IFSC code has changed — if it has, update it in your bank documents and then in the Groww app, after which you can retry the withdrawal.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["withdrawal not received","utr","not reflected in bank"],
    res: `Your withdrawal has been successfully processed. The UTR number for this transaction is [UTR NUMBER]. If the amount is not yet reflected, kindly share this UTR with your bank's support team so they can verify it at their end. NEFT transfers can occasionally take a little longer.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["cancel withdrawal","rebook withdrawal"],
    res: `You can cancel your withdrawal by navigating to: Groww app > Profile > Wallet > All Transactions > Select the withdrawal > Cancel Withdrawal. Please place a fresh request before 4 PM for same-day processing.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["raa","running account","sebi refund","quarter end","month end refund"],
    res: `Please note that under the Running Account Authorization (RAA) policy mandated by SEBI, excess funds in your trading account have been returned to your registered bank account as part of the periodic settlement. As a SEBI-registered broker, Groww is required to follow these guidelines.\n\nYou can verify this from: Groww app > Profile > Wallet > All Transactions.\nFor more details: https://groww.in/blog/running-account-authorization-how-does-it-work\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["instant withdrawal","after 4 pm","4:00 pm withdrawal"],
    res: `Please note that instant withdrawals are available only between 9:30 AM and 4:00 PM on working days. Requests placed after this time will be processed the next working day. Your funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["settlement holiday","holiday settlement"],
    res: `Please note that today is a settlement holiday. As per SEBI guidelines, stock settlement follows T+1 working days. The amount will be available for withdrawal once the settlement holiday is completed.\n\nYou can check your balance from: Groww app > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["negative balance","groww balance negative"],
    res: `Please note that your Groww balance has moved to a negative figure because the settlement charges for your trades exceeded your available balance at the time of settlement. Please add funds to bring your balance to zero or positive.\n\nYou can review all transactions from: Groww app > Profile > Wallet > All Transactions.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["redeem","how to redeem","mutual fund withdraw","get money back from fund"],
    res: `To redeem your mutual fund investment, please follow these steps:\n1. Open the Groww app and go to Mutual Funds.\n2. Click on Dashboard.\n3. Select the fund and tap Redeem.\n4. Enter the amount or choose Redeem All.\n5. Enter the OTP sent to your registered mobile and email.\n6. Confirm the redemption.\n\nThe amount will be credited to your registered bank account within 3 to 4 working days.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["redeem cannot cancel","cancel redemption","cancel redeem"],
    res: `We sincerely regret the inconvenience. Please note that once a redemption order is placed, it cannot be cancelled as it has already been submitted to the fund house. We request you to kindly wait for the amount to be credited. You may reinvest in the same fund once you receive the funds. Your money is completely safe.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["sip not visible","sip missing","sip not showing"],
    res: `Please note that your SIP order has been completed and the investment is reflected in your dashboard. You can verify by navigating to: Groww app > Mutual Funds > Dashboard > Click on the fund > Investment Details > Transactions.\n\nIf not updated, refresh by: MF Dashboard > Products and Tools > Import Funds. The dashboard should update within approximately one hour.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["sip edit","change sip date","change sip amount"],
    res: `Please note that when you edit the SIP date or amount, the existing SIP is cancelled and a new one is created from the updated date. This is why you received an SMS about cancellation. For example, if your SIP was on the 5th and you changed it to the 10th, the 5th SIP is cancelled and a new SIP begins from the 10th of the following month.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["sip skip","skip installment","skip sip"],
    res: `Please note that you can skip a SIP installment, however there must be a gap of at least 3 to 4 working days (excluding Saturday and Sunday) between today and the upcoming SIP date. A SIP can be skipped a maximum of 3 times, after which it will be automatically cancelled.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["cancel sip","stop sip"],
    res: `Please note that it takes up to 7 working days for a SIP cancellation to be fully processed. The amount you have already invested will remain in the fund until you choose to redeem it. You can restart the SIP in the same fund at any time.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["elss","lock in","lock-in","tax saver fund","3 year"],
    res: `Please note that ELSS (Equity Linked Savings Scheme) funds have a mandatory lock-in period of 3 years from the date of each individual investment. For example, an amount invested in January 2022 can be redeemed from January 2025 onwards. You will be able to redeem the full corpus only 3 years after the date of your last installment.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["ipo amount","ipo blocked","mandate end","unblock ipo"],
    res: `Please note that when you place an IPO application, the required amount is blocked by your bank to ensure sufficient funds are available at allotment. This amount is not debited — it is only blocked. It will be automatically unblocked before the mandate end date if you are not allotted shares.\n\nYou can check the mandate end date in your UPI app under the payment section. Your funds are completely safe.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["ipo not allotted","not allotted","ipo rejected allotment"],
    res: `Please note that you have not received an allotment for this IPO. The blocked amount will be automatically released by your bank before the mandate end date. You can check the mandate end date in your UPI app under the payment section. Your funds are completely safe and will be unblocked in due course.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["ipo allotted","got allotment","received allotment","ipo shares"],
    res: `Congratulations! You have received an allotment for this IPO. The allotted shares will be transferred to your Demat account on the listing date, before the market opens.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["ipo cancel","cancel ipo application"],
    res: `Please note that once an IPO application is placed and the IPO has closed, the application cannot be cancelled. Kindly wait for the allotment. If you are not allotted shares, the blocked amount will be automatically released before the mandate end date.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["asba","net banking ipo","apply ipo"],
    res: `You can apply for this IPO via the ASBA process through your net banking:\n1. Log in to your net banking account.\n2. Navigate to the ASBA or IPO section.\n3. Enter your Groww Demat account details as the beneficiary.\n4. Complete the IPO application.\n\nFor more information, please check with your bank.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["upper circuit","no sellers","circuit"],
    res: `Please note that the stock is currently in the upper circuit, which means there are no sellers available in the market — only buyers. Your buy order will be executed once the stock exits the upper circuit and sellers become available. We request you to wait until liquidity normalizes.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["fno pending","fno activation","fnO account pending","f&o pending"],
    res: `Please note that your F&O account is currently in pending status. We request you to kindly wait up to 24 hours, after which your F&O account will be activated and fully accessible.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["fno rejected","fno activation rejected","income proof"],
    res: `Please note that your F&O account activation was rejected as the income proof did not meet the required criteria. Please re-upload any one of the following documents:\n- Bank Statement: at least one transaction of Rs. 5,000 or above in the last 6 months\n- ITR acknowledgement: gross annual income exceeding Rs. 90,000\n- Demat Statement: holdings greater than Rs. 5,000\n- Salary Slip: gross monthly income exceeding Rs. 7,500\n- Form 16: gross annual income exceeding Rs. 1,80,000\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["mtf squared off","mtf squaredoff","negative 5 days","auto square"],
    res: `Please note that your MTF position was automatically squared off because your Groww balance remained negative for more than 5 consecutive days, as per our MTF policy. We recommend maintaining adequate funds in your wallet to avoid this in the future.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["mtf","margin trade","14.95","leverage buying"],
    res: `Please note that MTF (Margin Trade Funding) allows you to purchase stocks using leverage. You contribute a portion of the total value and Groww funds the remainder (up to 80%, based on the haircut percentage). The interest rate for MTF funding is 14.95% per annum (approximately 0.05% per day plus GST). MTF positions are settled daily on a Mark-to-Market (M2M) basis.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["inactive account","account inactive","reactivate account"],
    res: `Please note that your account has become inactive due to inactivity for approximately one year. To reactivate, please log in to the Groww app. On the home screen, you will find a reactivation option. Click on it and complete the e-sign process. Your account will be reactivated within 24 to 48 hours.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["rekyc","re-kyc","kyc blocked","kyc not verified"],
    res: `Please note that your KYC details require re-verification. Please complete the ReKYC process using the following link from within the Groww app: https://groww.in/onboarding/data-collection?context=REKYC\n\nWe recommend waiting approximately 10 minutes before clicking the link. Once completed, your account will be active within 3 to 4 working days.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["delete account","account delete","close account","account closure"],
    res: `Please note that a deletion request has been raised for your account. The deletion will be completed within 24 to 48 hours. After that, you will be able to create a new account using the same PAN, email address, and mobile number.\n\nBefore deletion, please deactivate your UPI from Groww Pay: Groww app > Groww UPI > Scroll down > UPI Settings > Manage UPI ID > Three dots > Deactivate.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["esign","e-sign","e sign","account pending activation"],
    res: `Please note that your e-sign has been completed and your account is currently in pending status. Account activation typically takes 2 working days as this is a standard process.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["market timing","market time","market hours","when market open"],
    res: `Please note the market timings for your reference:\n- Stocks (NSE/BSE): https://groww.in/p/stock-market-timings\n- Commodity (MCX): https://groww.in/p/commodity-market-timing\n\nOnce the market opens, you will be able to place your orders without any issues.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["contract note","trade charges","brokerage breakdown"],
    res: `Please note that your contract note has been sent to your registered email address. Open it using your PAN number in capital letters. It contains a complete breakdown of all transactions and charges.\n\nYou can also download it from: Groww app > Profile > Wallet > All Transactions > Click on the settlement > Download Contract Note.\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["brokerage fno","fno charges","f&o brokerage","options charges"],
    res: `Please note that Groww charges Rs. 20 per order for F&O trading — Rs. 20 for a buy order and Rs. 20 for a sell order, totalling Rs. 40 for a complete round trip. For more details: https://groww.in/pricing\n\nYou may also use the brokerage calculator: https://groww.in/calculators/brokerage-calculator\n\nPlease feel free to reach out if you need any further assistance.`
  },
  {
    keys: ["angry","not received","waited","days","frustrated","escalat","unhappy","complaint","how long","delay","still not"],
    res: `We sincerely apologize for the inconvenience and frustration this situation has caused you. We completely understand your concern and want to assure you that resolving this is our top priority. Your funds are completely safe throughout this process.\n\n[ADD SPECIFIC RESOLUTION HERE BASED ON ISSUE TYPE]\n\nWe have escalated this with our concerned team, and you will receive an update on your registered email within 24 to 48 working hours. We deeply appreciate your patience and trust.\n\nPlease feel free to reach out if you need any further assistance.`
  }
];

function getRelevantKB(message) {
  const msg = message.toLowerCase();
  const matches = [];
  for (const entry of KB) {
    if (entry.keys.some(k => msg.includes(k))) {
      matches.push(entry.res);
      if (matches.length >= 3) break; // cap at 3 entries to stay lean
    }
  }
  return matches.length > 0 ? matches.join('\n\n---\n\n') : '';
}

const SYSTEM_PROMPT = `You are GrowwBot, a Groww customer support assistant. You help agents get accurate, ready-to-send responses for customer queries.

RULES:
- No emojis. Plain text only.
- Formal, warm, and empathetic. Acknowledge the customer concern first.
- Include Groww navigation paths and links where relevant.
- End with: "Please feel free to reach out if you need any further assistance."
- For escalated customers: validate frustration, apologize, give resolution, reassure on fund safety.
- Only answer Groww and Indian finance queries. For anything else say: "I am trained specifically for Groww platform queries and am unable to assist with this request."
- Start the response directly — no preamble.
- Use the REFERENCE RESPONSES provided as your primary source. Adapt them to the specific situation. If no reference matches, use your knowledge of Groww and SEBI guidelines.`;

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

    const kb = getRelevantKB(message);
    const userMsg = kb
      ? `REFERENCE RESPONSES:\n${kb}\n\nAGENT QUERY: ${message}`
      : message;

    const messages = [
      ...history.slice(-4),
      { role: 'user', content: userMsg }
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
        temperature: 0.2,
        max_tokens: 600,
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
