// _db.js — Neon Postgres client (shared helper)
// Uses the lightweight @neondatabase/serverless driver — no connection pooling needed

import { neon } from '@neondatabase/serverless';

// Returns a tagged-template SQL executor bound to DATABASE_URL
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env variable is not set. Add it in Vercel → Project → Settings → Environment Variables.');
  return neon(url);
}

// ── Bootstrap — run once to create tables ──────────────────────────────────
// Called automatically by upload.js on first use.
// Safe to call multiple times (IF NOT EXISTS guards).
export async function ensureTables() {
  const sql = getDb();

  // pdf_documents — one row per uploaded PDF
  await sql`
    CREATE TABLE IF NOT EXISTS pdf_documents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      size_bytes  INTEGER,
      page_count  INTEGER,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // pdf_chunks — chunked text from each PDF, with full-text search vector
  await sql`
    CREATE TABLE IF NOT EXISTS pdf_chunks (
      id          SERIAL PRIMARY KEY,
      doc_id      TEXT NOT NULL REFERENCES pdf_documents(id) ON DELETE CASCADE,
      doc_name    TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content     TEXT NOT NULL,
      tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
    )
  `;

  // GIN index on tsv for fast full-text search
  await sql`
    CREATE INDEX IF NOT EXISTS pdf_chunks_tsv_idx ON pdf_chunks USING GIN(tsv)
  `;

  // Index on doc_id for fast deletes
  await sql`
    CREATE INDEX IF NOT EXISTS pdf_chunks_doc_id_idx ON pdf_chunks(doc_id)
  `;
}

// ── PDF document operations ────────────────────────────────────────────────

export async function upsertDocument({ id, name, sizeBytes, pageCount }) {
  const sql = getDb();
  await sql`
    INSERT INTO pdf_documents (id, name, size_bytes, page_count)
    VALUES (${id}, ${name}, ${sizeBytes}, ${pageCount})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, size_bytes = EXCLUDED.size_bytes, page_count = EXCLUDED.page_count, uploaded_at = NOW()
  `;
}

export async function deleteDocument(docId) {
  const sql = getDb();
  // Cascades to pdf_chunks via ON DELETE CASCADE
  await sql`DELETE FROM pdf_documents WHERE id = ${docId}`;
}

export async function listDocuments() {
  const sql = getDb();
  return sql`
    SELECT d.id, d.name, d.size_bytes, d.page_count, d.uploaded_at,
           COUNT(c.id)::int AS chunk_count
    FROM   pdf_documents d
    LEFT JOIN pdf_chunks c ON c.doc_id = d.id
    GROUP BY d.id
    ORDER BY d.uploaded_at DESC
  `;
}

// ── Chunk operations ────────────────────────────────────────────────────────

export async function insertChunks(docId, docName, chunks) {
  const sql = getDb();
  // Delete existing chunks for this doc before re-inserting
  await sql`DELETE FROM pdf_chunks WHERE doc_id = ${docId}`;

  // Insert in batches of 50 to stay within Neon's parameter limits
  const BATCH = 50;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    // Build values using unnest for efficient bulk insert
    const indices = batch.map((_, j) => i + j);
    const contents = batch;
    await sql`
      INSERT INTO pdf_chunks (doc_id, doc_name, chunk_index, content)
      SELECT ${docId}, ${docName}, idx, content
      FROM   UNNEST(${indices}::int[], ${contents}::text[]) AS t(idx, content)
    `;
  }
}

// ── Full-text search ────────────────────────────────────────────────────────
// Returns top N chunks most relevant to the query using Postgres ts_rank

export async function searchChunks(query, topN = 4) {
  const sql = getDb();
  if (!query?.trim()) return [];

  // Convert query to tsquery — handle short/special words gracefully
  const words = query.trim().toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10);

  if (!words.length) return [];

  // Use plainto_tsquery for natural phrase matching (no special syntax needed)
  const tsQuery = words.join(' ');

  try {
    const rows = await sql`
      SELECT doc_name, chunk_index, content,
             ts_rank(tsv, plainto_tsquery('english', ${tsQuery})) AS rank
      FROM   pdf_chunks
      WHERE  tsv @@ plainto_tsquery('english', ${tsQuery})
      ORDER  BY rank DESC
      LIMIT  ${topN}
    `;
    return rows;
  } catch {
    // Fallback: ILIKE search if tsquery fails
    const pattern = `%${words[0]}%`;
    return sql`
      SELECT doc_name, chunk_index, content, 0.1 AS rank
      FROM   pdf_chunks
      WHERE  content ILIKE ${pattern}
      LIMIT  ${topN}
    `;
  }
}
