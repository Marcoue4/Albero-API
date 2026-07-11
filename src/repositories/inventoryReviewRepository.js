const config = require("../config");
const {
  createInventoryWriterRequest,
  runQuery,
  sql,
} = require("../db");
const { parseProductId } = require("../lib/catalogIdentity");
const { HttpError } = require("../errors/httpError");

const REASON_CODES = new Set(["damaged", "repair", "inventory-check", "other"]);
const RESOLUTIONS = new Set(["restore", "remove"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function rowToReviewItem(row) {
  return {
    id: String(row.id),
    idempotencyKey: row.idempotency_key,
    productId: row.product_id,
    productName: row.product_name || null,
    productBrand: row.product_brand || null,
    productImage: row.product_image || null,
    variantId: Number(row.variant_id),
    sku: row.sku,
    size: row.size_label,
    quantity: Number(row.quantity),
    sourceStoreId: Number(row.source_store_id),
    sourceStoreName: row.source_store_name,
    reasonCode: row.reason_code,
    notes: row.notes || null,
    status: row.status,
    actor: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedBy: row.resolved_by || null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    sourceHeaderId: row.source_header_id == null ? null : Number(row.source_header_id),
    destinationHeaderId:
      row.destination_header_id == null ? null : Number(row.destination_header_id),
    resolutionSourceHeaderId:
      row.resolution_source_header_id == null
        ? null
        : Number(row.resolution_source_header_id),
    resolutionDestinationHeaderId:
      row.resolution_destination_header_id == null
        ? null
        : Number(row.resolution_destination_header_id),
  };
}

function assertPlaceInput(input) {
  const productId = normalizeText(input.productId);
  const modelId = parseProductId(productId);
  const sku = normalizeText(input.sku).toUpperCase();
  const size = normalizeText(input.size);
  const reasonCode = normalizeText(input.reasonCode).toLowerCase();
  const notes = normalizeText(input.notes);
  const idempotencyKey = normalizeText(input.idempotencyKey);
  const sourceStoreId = Number(input.sourceStoreId);
  const quantity = Number(input.quantity);

  if (modelId === null || !sku || !size || !idempotencyKey) {
    throw HttpError.badRequest("productId, sku, size, and idempotencyKey are required.");
  }
  if (!Number.isInteger(sourceStoreId)) {
    throw HttpError.badRequest("sourceStoreId must be an integer.");
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw HttpError.badRequest("quantity must be a positive integer.");
  }
  if (!REASON_CODES.has(reasonCode)) {
    throw HttpError.badRequest("Unsupported inventory review reason.");
  }
  if (reasonCode === "other" && !notes) {
    throw HttpError.badRequest("notes are required for the other reason.");
  }

  return {
    productId,
    modelId,
    sku,
    size,
    idempotencyKey,
    sourceStoreId,
    quantity,
    reasonCode,
    notes: notes || null,
    actor: normalizeText(input.actor) || "admin",
    productName: normalizeText(input.productName) || null,
    productBrand: normalizeText(input.productBrand) || null,
    productImage: normalizeText(input.productImage) || null,
  };
}

async function executeReviewProcedure(input) {
  const request = await createInventoryWriterRequest();
  request.input("operation", sql.VarChar(12), input.operation);
  request.input("reviewId", sql.UniqueIdentifier, input.reviewId || null);
  request.input("idempotencyKey", sql.NVarChar(120), input.idempotencyKey || null);
  request.input("productId", sql.NVarChar(80), input.productId || null);
  request.input("productName", sql.NVarChar(300), input.productName || null);
  request.input("productBrand", sql.NVarChar(200), input.productBrand || null);
  request.input("productImage", sql.NVarChar(2000), input.productImage || null);
  request.input("modelId", sql.Int, input.modelId ?? null);
  request.input("sku", sql.NVarChar(180), input.sku || null);
  request.input("sizeLabel", sql.NVarChar(50), input.size || null);
  request.input("quantity", sql.Int, input.quantity ?? null);
  request.input("sourceStoreId", sql.Int, input.sourceStoreId ?? null);
  request.input("reasonCode", sql.NVarChar(40), input.reasonCode || null);
  request.input("notes", sql.NVarChar(1000), input.notes || null);
  request.input("actor", sql.NVarChar(120), input.actor || "admin");
  request.input(
    "reviewLocationName",
    sql.NVarChar(250),
    config.inventoryReviewLocationName
  );
  request.input(
    "storeScope",
    sql.NVarChar(sql.MAX),
    config.storefrontAllowedStoreScope
  );
  let result;
  try {
    result = await request.execute("dbo.Albero_Move_Inventory_Review");
  } catch (error) {
    const message = String(error?.originalError?.info?.message || error?.message || "");
    const knownCode = [
      "INVENTORY_REVIEW_INSUFFICIENT_STOCK",
      "INVENTORY_REVIEW_STATE_CONFLICT",
      "INVENTORY_REVIEW_NOT_FOUND",
      "INVENTORY_REVIEW_LOCATION_NOT_CONFIGURED",
    ].find((code) => message.includes(code));
    if (knownCode) {
      error.code = knownCode;
      error.statusCode = knownCode === "INVENTORY_REVIEW_NOT_FOUND" ? 404 : undefined;
      error.message = knownCode;
    }
    throw error;
  }
  const row = result.recordset?.[0];
  if (!row) throw new Error("Inventory review procedure returned no item.");
  return rowToReviewItem(row);
}

async function listItems(options = {}) {
  const status = normalizeText(options.status).toLowerCase();
  const query = normalizeText(options.q);
  const result = await runQuery(
    `
      SELECT *
      FROM dbo.Albero_Inventory_Review
      WHERE (@status = N'' OR status = @status)
        AND (
          @query = N''
          OR product_id LIKE N'%' + @query + N'%'
          OR product_name LIKE N'%' + @query + N'%'
          OR product_brand LIKE N'%' + @query + N'%'
          OR sku LIKE N'%' + @query + N'%'
          OR source_store_name LIKE N'%' + @query + N'%'
        )
      ORDER BY CASE WHEN status = N'in_review' THEN 0 ELSE 1 END, created_at DESC
    `,
    [
      { name: "status", type: sql.NVarChar(20), value: status },
      { name: "query", type: sql.NVarChar(180), value: query },
    ]
  );
  return result.recordset.map(rowToReviewItem);
}

async function getProductStock(productId) {
  const modelId = parseProductId(productId);
  if (modelId === null) throw HttpError.badRequest("Invalid productId.");

  const result = await runQuery(
    `
      WITH allowed_stores AS (
        SELECT DISTINCT UPPER(LTRIM(RTRIM(value))) AS store_name
        FROM STRING_SPLIT(@storeScope, N',')
        WHERE LTRIM(RTRIM(value)) <> N''
      )
      SELECT
        a.MD_ID AS model_id,
        a.VA_ID AS variant_id,
        LTRIM(RTRIM(a.MD_CODICE)) + LTRIM(RTRIM(a.VA_CODICE)) AS sku,
        COALESCE(NULLIF(LTRIM(RTRIM(a.CR_DES)), N''), LTRIM(RTRIM(a.VA_CODICE))) AS color_name,
        LTRIM(RTRIM(r.TAGLIA)) AS size_label,
        n.NE_ID AS store_id,
        LTRIM(RTRIM(r.NE_DES)) AS store_name,
        CAST(SUM(ISNULL(r.ESI_ETICHETTE, 0)) AS int) AS quantity
      FROM dbo.Articoli_Su_Sito_Plus a
      INNER JOIN dbo.BARCODE_ESISTENZA_RFID r
        ON LTRIM(RTRIM(r.BRAND)) = LTRIM(RTRIM(a.TI_DES))
       AND LTRIM(RTRIM(r.SIGLA_STAGIONE)) = LTRIM(RTRIM(a.ST_SIGLA))
       AND LTRIM(RTRIM(r.CODICE_MODELLO)) = LTRIM(RTRIM(a.MD_CODICE))
       AND LTRIM(RTRIM(r.CODICE_VARIANTE)) = LTRIM(RTRIM(a.VA_CODICE))
      INNER JOIN allowed_stores s
        ON s.store_name = UPPER(LTRIM(RTRIM(r.NE_DES)))
      INNER JOIN dbo.Negozi n
        ON UPPER(LTRIM(RTRIM(n.NE_DES))) = s.store_name
       AND ISNULL(n.NE_CANCELLATO, 0) = 0
      WHERE a.MD_ID = @modelId
        AND a.CANCELLATO = 0
      GROUP BY
        a.MD_ID, a.VA_ID, a.MD_CODICE, a.VA_CODICE, a.CR_DES,
        r.TAGLIA, n.NE_ID, r.NE_DES
      HAVING SUM(ISNULL(r.ESI_ETICHETTE, 0)) > 0
      ORDER BY sku, TRY_CONVERT(int, LTRIM(RTRIM(r.TAGLIA))), size_label, store_name
    `,
    [
      { name: "storeScope", type: sql.NVarChar(sql.MAX), value: config.storefrontAllowedStoreScope },
      { name: "modelId", type: sql.Int, value: modelId },
    ]
  );

  return result.recordset.map((row) => ({
    productId: `mdl_${row.model_id}`,
    variantId: Number(row.variant_id),
    sku: row.sku,
    colorName: row.color_name,
    size: row.size_label,
    storeId: Number(row.store_id),
    storeName: row.store_name,
    quantity: Number(row.quantity),
  }));
}

async function placeItem(input) {
  const normalized = assertPlaceInput(input);
  return executeReviewProcedure({ ...normalized, operation: "place" });
}

async function resolveItem(id, input) {
  const resolution = normalizeText(input.resolution).toLowerCase();
  if (!RESOLUTIONS.has(resolution)) {
    throw HttpError.badRequest("resolution must be restore or remove.");
  }
  return executeReviewProcedure({
    operation: resolution,
    reviewId: normalizeText(id),
    actor: normalizeText(input.actor) || "admin",
  });
}

module.exports = {
  assertPlaceInput,
  getProductStock,
  listItems,
  placeItem,
  resolveItem,
};
