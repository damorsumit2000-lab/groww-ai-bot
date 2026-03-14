// api/admin.js — GrowwBot Admin Panel Backend
// Handles: auth, PDF list, KB entries from Upstash, delete operations
// Protected by ADMIN_PASSWORD env variable

import { ensureTables, listDocuments, deleteDocument } from './_db.js';

// ── Auth helper ───────────────────────────────────────────────────────────────
function checkAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false; // No password set = locked
  return token === password;
}

// ── Upstash Redis helpers (inline — no shared dep on chat.js) ─────────────────
function upstashUrl()   { return process.env.UPSTASH_REDIS_REST_URL; }
function upstashToken() { return process.env.UPSTASH_REDIS_REST_TOKEN; }
function upstashReady() { return !!(upstashUrl() && upstashToken()); }
function upstashHdrs()  { return { Authorization: `Bearer ${upstashToken()}`, 'Content-Type': 'application/json' }; }

async function redisPipe(cmds) {
  if (!upstashReady()) return [];
  try {
    const r = await fetch(`${upstashUrl()}/pipeline`, {
      method: 'POST', headers: upstashHdrs(), body: JSON.stringify(cmds),
    });
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

async function redisKeys(pat) {
  if (!upstashReady()) return [];
  try {
    const r = await fetch(`${upstashUrl()}/keys/${encodeURIComponent(pat)}`, { headers: upstashHdrs() });
    const d = await r.json();
    return Array.isArray(d?.result) ? d.result : [];
  } catch { return []; }
}

async function redisGetAll(pattern) {
  const keys = await redisKeys(pattern);
  if (!keys.length) return [];
  const res = await redisPipe(keys.map(k => ['get', k]));
  return res.map((item, i) => {
    if (!item?.result) return null;
    try {
      let p = JSON.parse(item.result);
      if (typeof p === 'string') p = JSON.parse(p);
      return (p && typeof p === 'object') ? { ...p, _key: keys[i] } : null;
    } catch { return null; }
  }).filter(Boolean);
}

async function redisDel(key) {
  await redisPipe([['del', key]]);
}

// ── Main handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Auth check ──────────────────────────────────────────────────────────────
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = req.query?.action || '';

  try {
    // ── GET /api/admin?action=pdfs — list all uploaded PDFs ──────────────────
    if (req.method === 'GET' && action === 'pdfs') {
      await ensureTables();
      const docs = await listDocuments();
      return res.status(200).json({ docs });
    }

    // ── GET /api/admin?action=kb — list all Upstash KB entries ───────────────
    if (req.method === 'GET' && action === 'kb') {
      const entries = await redisGetAll('kb:*');
      const sorted = entries
        .filter(e => e.response)
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      return res.status(200).json({
        count: sorted.length,
        entries: sorted,
        upstashConnected: upstashReady(),
      });
    }

    // ── GET /api/admin?action=stats — dashboard stats ─────────────────────────
    if (req.method === 'GET' && action === 'stats') {
      await ensureTables();
      const [docs, kbEntries] = await Promise.all([
        listDocuments(),
        redisGetAll('kb:*'),
      ]);
      const kbValid = kbEntries.filter(e => e.response);
      const totalChunks = docs.reduce((s, d) => s + (d.chunk_count || 0), 0);
      const bySource = { feed: 0, auto: 0, manual: 0 };
      kbValid.forEach(e => { if (bySource[e.source] !== undefined) bySource[e.source]++; });
      const totalHits = kbValid.reduce((s, e) => s + (e.hits || 0), 0);
      return res.status(200).json({
        pdfs: { count: docs.length, totalChunks },
        kb: { count: kbValid.length, bySource, totalHits },
        upstashConnected: upstashReady(),
        dbConnected: !!process.env.DATABASE_URL,
      });
    }

    // ── DELETE /api/admin?action=kb — delete a KB entry ──────────────────────
    if (req.method === 'DELETE' && action === 'kb') {
      const body = await readBody(req);
      const { key } = JSON.parse(body);
      if (!key) return res.status(400).json({ error: 'key required' });
      await redisDel(key);
      return res.status(200).json({ deleted: true });
    }

    // ── DELETE /api/admin?action=pdf — delete a PDF and its chunks ────────────
    if (req.method === 'DELETE' && action === 'pdf') {
      const body = await readBody(req);
      const { docId } = JSON.parse(body);
      if (!docId) return res.status(400).json({ error: 'docId required' });
      await deleteDocument(docId);
      return res.status(200).json({ deleted: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (e) {
    console.error('Admin error:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
