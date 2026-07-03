const config = require("../config");
const { createRequest } = require("../db");

let activeStockCache = {
  expiresAt: 0,
  stockByVariantId: null,
  pending: null,
};

let sqlStockCacheWarningShown = false;

function toVariantStockMap(records) {
  const stockByVariantId = new Map();

  for (const record of records) {
    const variantId = Number(record.VA_ID);
    const quantity = Number(record.qty || 0);
    const current = stockByVariantId.get(variantId) || {
      totalQty: 0,
      sizeQty: {},
    };

    current.totalQty += quantity;

    const sizeLabel = String(record.size_label || "").trim();

    if (sizeLabel && quantity > 0) {
      current.sizeQty[sizeLabel] = (current.sizeQty[sizeLabel] || 0) + quantity;
    }

    stockByVariantId.set(variantId, current);
  }

  return stockByVariantId;
}

function setRequestTimeout(request) {
  request.timeout = config.db.requestTimeoutMs;
  return request;
}

function getRfidStockSelect(activeVariantsSql) {
  return `
    WITH active_variants AS (
      ${activeVariantsSql}
    ),
    rfid_stock AS (
      SELECT
        av.VA_ID,
        LTRIM(RTRIM(r.TAGLIA)) AS size_label,
        SUM(ISNULL(r.ESI_ETICHETTE, 0)) AS qty
      FROM active_variants av
      INNER JOIN dbo.BARCODE_ESISTENZA_RFID r
        ON LTRIM(RTRIM(r.BRAND)) = av.brand
       AND LTRIM(RTRIM(r.SIGLA_STAGIONE)) = av.season
       AND LTRIM(RTRIM(r.CODICE_MODELLO)) = av.model_code
       AND LTRIM(RTRIM(r.CODICE_VARIANTE)) = av.variant_code
      GROUP BY av.VA_ID, LTRIM(RTRIM(r.TAGLIA))
      HAVING SUM(ISNULL(r.ESI_ETICHETTE, 0)) > 0
    )
    SELECT
      VA_ID,
      size_label,
      qty,
      TRY_CONVERT(int, size_label) AS size_order
    FROM rfid_stock
    ORDER BY VA_ID, TRY_CONVERT(int, size_label), size_label
  `;
}

function pickVariantStocks(stockByVariantId, variantIds) {
  const picked = new Map();

  for (const variantId of variantIds) {
    picked.set(variantId, stockByVariantId.get(variantId) || {
      totalQty: 0,
      sizeQty: {},
    });
  }

  return picked;
}

function warnSqlStockCacheFallback(error) {
  if (sqlStockCacheWarningShown) {
    return;
  }

  sqlStockCacheWarningShown = true;
  console.warn(
    `SQL stock cache unavailable; falling back to live RFID stock query. ${error.message}`
  );
}

async function loadSqlStockCache() {
  try {
    const result = await createRequest().then((request) =>
      setRequestTimeout(request).query(`
        SELECT
          VA_ID,
          size_label,
          qty
        FROM dbo.Albero_Stock_Cache
        WHERE qty > 0
        ORDER BY VA_ID, TRY_CONVERT(int, size_label), size_label
      `)
    );

    if (!result.recordset.length) {
      throw new Error("dbo.Albero_Stock_Cache exists but has no positive stock rows");
    }

    return toVariantStockMap(result.recordset);
  } catch (error) {
    if (config.requireSqlStockCache) {
      throw error;
    }

    warnSqlStockCacheFallback(error);
    return null;
  }
}

async function loadLiveRfidStock() {
  const result = await createRequest().then((request) =>
    setRequestTimeout(request).query(
      getRfidStockSelect(`
        SELECT DISTINCT
          VA_ID,
          LTRIM(RTRIM(TI_DES)) AS brand,
          LTRIM(RTRIM(ST_SIGLA)) AS season,
          LTRIM(RTRIM(MD_CODICE)) AS model_code,
          LTRIM(RTRIM(VA_CODICE)) AS variant_code
        FROM dbo.Articoli_Su_Sito_Plus
        WHERE CANCELLATO = 0
      `)
    )
  );

  return toVariantStockMap(result.recordset);
}

async function loadActiveVariantTotals() {
  const sqlStockCache = await loadSqlStockCache();

  if (sqlStockCache) {
    return sqlStockCache;
  }

  return loadLiveRfidStock();
}

async function getActiveVariantTotals() {
  const now = Date.now();

  if (activeStockCache.stockByVariantId && now < activeStockCache.expiresAt) {
    return activeStockCache.stockByVariantId;
  }

  if (!activeStockCache.pending) {
    activeStockCache.pending = loadActiveVariantTotals()
      .then((stockByVariantId) => {
        activeStockCache = {
          expiresAt: Date.now() + config.stockCacheTtlMs,
          stockByVariantId,
          pending: null,
        };
        return stockByVariantId;
      })
      .catch((error) => {
        activeStockCache.pending = null;
        throw error;
      });
  }

  return activeStockCache.pending;
}

async function getVariantStockByIds(variantIds) {
  const uniqueIds = [...new Set((variantIds || []).map(Number).filter(Number.isInteger))];

  if (!uniqueIds.length) {
    return new Map();
  }

  const now = Date.now();

  if (activeStockCache.stockByVariantId && now < activeStockCache.expiresAt) {
    return pickVariantStocks(activeStockCache.stockByVariantId, uniqueIds);
  }

  if (activeStockCache.pending) {
    const stockByVariantId = await activeStockCache.pending;
    return pickVariantStocks(stockByVariantId, uniqueIds);
  }

  const stockByVariantId = await getActiveVariantTotals();
  return pickVariantStocks(stockByVariantId, uniqueIds);
}

function getStockRuntimeCacheStatus() {
  const now = Date.now();

  return {
    hasMemoryCache: Boolean(activeStockCache.stockByVariantId),
    isRefreshInFlight: Boolean(activeStockCache.pending),
    expiresAt: activeStockCache.expiresAt
      ? new Date(activeStockCache.expiresAt).toISOString()
      : null,
    ttlMs: config.stockCacheTtlMs,
    remainingTtlMs: activeStockCache.expiresAt
      ? Math.max(0, activeStockCache.expiresAt - now)
      : 0,
  };
}

module.exports = {
  getActiveVariantTotals,
  getStockRuntimeCacheStatus,
  getVariantStockByIds,
};
