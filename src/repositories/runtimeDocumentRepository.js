const { createHash } = require("node:crypto");
const { getPool, runQuery, sql } = require("../db");

const ALLOWED_KEYS = new Set([
  "catalog-season",
  "home-featured",
  "home-categories",
  "inventory-overrides",
  "curated-outfits",
]);

function assertAllowedKey(key) {
  const normalized = String(key || "").trim();
  if (!ALLOWED_KEYS.has(normalized)) {
    const error = new Error("RUNTIME_DOCUMENT_KEY_NOT_ALLOWED");
    error.statusCode = 404;
    throw error;
  }
  return normalized;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function inferRevision(document) {
  if (document && typeof document === "object" && typeof document.revision === "string") {
    return document.revision.trim() || null;
  }

  return createHash("sha256")
    .update(JSON.stringify(document ?? null))
    .digest("hex")
    .slice(0, 16);
}

function parseDocumentJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rowToDocument(row) {
  if (!row) return null;
  return {
    key: row.doc_key,
    document: parseDocumentJson(row.document_json),
    revision: row.revision || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function readRuntimeDocument(key) {
  const docKey = assertAllowedKey(key);
  const result = await runQuery(
    `
      SELECT doc_key, document_json, revision, updated_at
      FROM dbo.Albero_Runtime_Documents
      WHERE doc_key = @docKey
    `,
    [{ name: "docKey", type: sql.NVarChar(120), value: docKey }]
  );

  return rowToDocument(result.recordset[0]) || {
    key: docKey,
    document: null,
    revision: null,
    updatedAt: null,
  };
}

async function writeRuntimeDocument(key, document, options = {}) {
  const docKey = assertAllowedKey(key);
  const nextDocument = cloneJson(document);
  const nextRevision = inferRevision(nextDocument);
  const expectedRevision =
    typeof options.expectedRevision === "string" && options.expectedRevision.trim()
      ? options.expectedRevision.trim()
      : null;
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const currentRequest = new sql.Request(transaction);
    currentRequest.input("docKey", sql.NVarChar(120), docKey);
    const currentResult = await currentRequest.query(`
      SELECT doc_key, document_json, revision, updated_at
      FROM dbo.Albero_Runtime_Documents WITH (UPDLOCK, HOLDLOCK)
      WHERE doc_key = @docKey
    `);
    const current = rowToDocument(currentResult.recordset[0]);
    const currentRevision = current?.revision || inferRevision(current?.document ?? null);

    if (current && expectedRevision && expectedRevision !== currentRevision) {
      const conflict = new Error("RUNTIME_DOCUMENT_REVISION_CONFLICT");
      conflict.code = "RUNTIME_DOCUMENT_REVISION_CONFLICT";
      conflict.currentRevision = currentRevision;
      throw conflict;
    }

    const writeRequest = new sql.Request(transaction);
    writeRequest.input("docKey", sql.NVarChar(120), docKey);
    writeRequest.input("documentJson", sql.NVarChar(sql.MAX), JSON.stringify(nextDocument));
    writeRequest.input("revision", sql.NVarChar(80), nextRevision);

    const saved = await writeRequest.query(`
      MERGE dbo.Albero_Runtime_Documents AS target
      USING (
        SELECT
          @docKey AS doc_key,
          @documentJson AS document_json,
          @revision AS revision
      ) AS source
      ON target.doc_key = source.doc_key
      WHEN MATCHED THEN
        UPDATE SET
          document_json = source.document_json,
          revision = source.revision,
          updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (doc_key, document_json, revision, updated_at)
        VALUES (source.doc_key, source.document_json, source.revision, SYSUTCDATETIME())
      OUTPUT inserted.doc_key, inserted.document_json, inserted.revision, inserted.updated_at;
    `);

    await transaction.commit();
    return rowToDocument(saved.recordset[0]);
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function getRuntimeDocumentsHealth() {
  const result = await runQuery(`
    SELECT doc_key, revision, updated_at
    FROM dbo.Albero_Runtime_Documents
    ORDER BY doc_key ASC
  `);

  return {
    storage: "sql-server",
    documents: result.recordset.map((row) => ({
      key: row.doc_key,
      revision: row.revision || null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    })),
  };
}

module.exports = {
  getRuntimeDocumentsHealth,
  readRuntimeDocument,
  writeRuntimeDocument,
};
