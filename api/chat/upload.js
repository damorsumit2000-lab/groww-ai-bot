// api/upload.js — PDF upload endpoint
// Receives a PDF file via multipart form-data, extracts text using pdf-parse,
// chunks it, and stores in Neon Postgres. No browser PDF processing needed.

import { ensureTables, upsertDocument, insertChunks, listDocuments, deleteDocument } from './_db.js';
import { Readable } from 'stream';

// Vercel serverless config — allow larger body for PDF uploads (up to 10MB)
export const config = {
  api: {
    bodyParser: false,   // we handle raw multipart ourselves
    sizeLimit: '15mb',
  },
};

// ── Text chunker ─────────────────────────────────────────────────────────────
function chunkText(text, chunkWords = 350, overlapWords = 60) {
  // Clean up excessive whitespace from PDF extraction
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkWords).join(' ');
    if (chunk.trim().length > 40) chunks.push(chunk); // skip tiny chunks
    i += chunkWords - overlapWords;
  }
  return chunks;
}

// ── Read raw body from request ────────────────────────────────────────────────
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Parse multipart form-data manually (no extra deps) ───────────────────────
function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const sepIdx = buffer.indexOf(sep, start);
    if (sepIdx === -1) break;
    const headerStart = sepIdx + sep.length + 2; // skip \r\n
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextSep = buffer.indexOf(sep, dataStart);
    const dataEnd = nextSep === -1 ? buffer.length : nextSep - 2; // strip \r\n before sep
    const data = buffer.slice(dataStart, dataEnd);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: fileMatch?.[1] || null,
        data,
        text: fileMatch ? null : data.toString(),
      });
    }
    start = nextSep === -1 ? buffer.length : nextSep;
  }
  return parts;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Ensure Neon tables exist (idempotent)
  try { await ensureTables(); } catch (e) {
    return res.status(500).json({ error: `Database setup failed: ${e.message}. Check DATABASE_URL env variable.` });
  }

  // ── GET — list all uploaded PDFs ─────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const docs = await listDocuments();
      return res.status(200).json({ docs });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE — remove a PDF and all its chunks ──────────────────────────────
  if (req.method === 'DELETE') {
    try {
      const body = await readBody(req);
      const { docId } = JSON.parse(body.toString());
      if (!docId) return res.status(400).json({ error: 'docId required' });
      await deleteDocument(docId);
      return res.status(200).json({ deleted: true, docId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — upload and process PDF ────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const contentType = req.headers['content-type'] || '';

    let pdfBuffer, fileName, docId;

    if (contentType.includes('multipart/form-data')) {
      // Parse multipart upload
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) return res.status(400).json({ error: 'No boundary in multipart' });
      const rawBody = await readBody(req);
      const parts = parseMultipart(rawBody, boundaryMatch[1]);
      const filePart = parts.find(p => p.filename);
      const namePart = parts.find(p => p.name === 'docId');
      if (!filePart) return res.status(400).json({ error: 'No PDF file in upload' });
      pdfBuffer = filePart.data;
      fileName  = filePart.filename;
      docId     = namePart?.text?.trim() || `doc_${Date.now()}`;
    } else {
      // JSON body with base64-encoded PDF (alternative upload method)
      const rawBody = await readBody(req);
      const body = JSON.parse(rawBody.toString());
      if (!body.pdfBase64) return res.status(400).json({ error: 'pdfBase64 or multipart file required' });
      pdfBuffer = Buffer.from(body.pdfBase64, 'base64');
      fileName  = body.fileName || 'document.pdf';
      docId     = body.docId   || `doc_${Date.now()}`;
    }

    if (!pdfBuffer || pdfBuffer.length === 0)
      return res.status(400).json({ error: 'Empty PDF received' });

    if (pdfBuffer.length > 14 * 1024 * 1024)
      return res.status(413).json({ error: 'PDF too large. Maximum size is 14MB.' });

    // Extract text using pdf-parse
    let pdfParse;
    try {
      pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    } catch {
      try {
        pdfParse = (await import('pdf-parse')).default;
      } catch {
        return res.status(500).json({ error: 'pdf-parse package not installed. Run: npm install pdf-parse' });
      }
    }

    let pdfData;
    try {
      pdfData = await pdfParse(pdfBuffer);
    } catch (e) {
      return res.status(422).json({ error: `Could not parse PDF: ${e.message}. Ensure it is a text-based PDF, not a scanned image.` });
    }

    const rawText = pdfData.text || '';
    if (rawText.trim().length < 50) {
      return res.status(422).json({
        error: 'No readable text found in this PDF. It may be a scanned/image-based PDF. Please use a text-based PDF.'
      });
    }

    // Chunk the extracted text
    const chunks = chunkText(rawText);
    if (!chunks.length) return res.status(422).json({ error: 'Could not extract any text chunks from PDF.' });

    // Store in Neon Postgres
    await upsertDocument({
      id: docId, name: fileName,
      sizeBytes: pdfBuffer.length,
      pageCount: pdfData.numpages || 0,
    });
    await insertChunks(docId, fileName, chunks);

    return res.status(200).json({
      success: true,
      docId,
      fileName,
      pages: pdfData.numpages,
      chunks: chunks.length,
      textLength: rawText.length,
    });

  } catch (e) {
    console.error('Upload error:', e);
    return res.status(500).json({ error: e.message });
  }
}
