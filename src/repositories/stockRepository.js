const { createRequest, sql } = require("../db");

function buildNumberParamBindings(prefix, values) {
  return values.map((value, index) => ({
    name: `${prefix}${index}`,
    type: sql.Int,
    value,
  }));
}

function buildInClause(prefix, values) {
  return values.map((_value, index) => `@${prefix}${index}`).join(", ");
}

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

async function getActiveVariantTotals() {
  const result = await createRequest().then((request) =>
    request.query(`
      WITH active_variants AS (
        SELECT DISTINCT VA_ID
        FROM dbo.Articoli_Su_Sito_Plus
        WHERE CANCELLATO = 0
      )
      SELECT
        av.VA_ID,
        COUNT(b.BI_BARCODE) AS total_qty
      FROM active_variants av
      LEFT JOIN dbo.Barcode b
        ON b.BI_VA_ID = av.VA_ID
       AND ISNULL(b.BI_CANCELLATO, 0) = 0
      GROUP BY av.VA_ID
    `)
  );

  const totals = new Map();

  for (const record of result.recordset) {
    totals.set(Number(record.VA_ID), {
      totalQty: Number(record.total_qty || 0),
      sizeQty: {},
    });
  }

  return totals;
}

async function getVariantStockByIds(variantIds) {
  const uniqueIds = [...new Set((variantIds || []).map(Number).filter(Number.isInteger))];

  if (!uniqueIds.length) {
    return new Map();
  }

  const bindings = buildNumberParamBindings("variantId", uniqueIds);
  const inClause = buildInClause("variantId", uniqueIds);
  const request = await createRequest(bindings);
  const result = await request.query(`
    SELECT
      v.VA_ID,
      tr.TR_DES AS size_label,
      COUNT(b.BI_BARCODE) AS qty,
      MIN(tr.TR_ORDINE) AS size_order
    FROM (
      SELECT DISTINCT VA_ID
      FROM dbo.Articoli_Su_Sito_Plus
      WHERE CANCELLATO = 0
        AND VA_ID IN (${inClause})
    ) v
    LEFT JOIN dbo.Barcode b
      ON b.BI_VA_ID = v.VA_ID
     AND ISNULL(b.BI_CANCELLATO, 0) = 0
    LEFT JOIN dbo.Taglie_righe tr
      ON tr.TR_ID = b.BI_TR_ID
     AND ISNULL(tr.TR_CANCELLATO, 0) = 0
    GROUP BY v.VA_ID, tr.TR_DES
    ORDER BY v.VA_ID, MIN(tr.TR_ORDINE), tr.TR_DES
  `);

  const stockMap = toVariantStockMap(result.recordset);

  for (const variantId of uniqueIds) {
    if (!stockMap.has(variantId)) {
      stockMap.set(variantId, {
        totalQty: 0,
        sizeQty: {},
      });
    }
  }

  return stockMap;
}

module.exports = {
  getActiveVariantTotals,
  getVariantStockByIds,
};
