const config = require("../config");
const { runQuery } = require("../db");
const { IMAGE_COLUMNS } = require("../lib/imageResolver");
const { formatStoreLocationScopeValue } = require("../lib/storeLocationScope");

const CATALOG_COLUMNS = [
  "MD_ID",
  "VA_ID",
  "MD_CODICE",
  "VA_CODICE",
  "SR_DES",
  "GS_DES",
  "CG_DES",
  "GR_DES",
  "TI_DES",
  "ST_SIGLA",
  "ST_DES",
  "CR_DES",
  "COLORE_VERO",
  "MD_DES",
  "DESCRIZIONE_BREVE_IT",
  "DESCRIZIONE_BREVE",
  "DESCRIZIONE_SPECIALE_IT",
  "DESCRIZIONE_SPECIALE",
  "SIZE_AND_FIT_IT",
  "SIZE_AND_FIT",
  "VA_PREZZO_VEN",
  "LI_Prezzo_VEN_ITA",
  "PREZZO_VENDITA",
  "LI_Prezzo_SAL_ITA",
  "VA_PREZZO_SAL",
  ...IMAGE_COLUMNS,
].map((column) => `a.${column}`);

function quoteSqlUnicodeString(value) {
  return `N'${String(value || "").replace(/'/g, "''")}'`;
}

function buildStoreScopeClause(allowedStoreNames = config.storefrontAllowedStoreNames) {
  const storeScope = formatStoreLocationScopeValue(allowedStoreNames);

  if (!storeScope) {
    return "ac.store_scope IS NULL";
  }

  return `ac.store_scope = ${quoteSqlUnicodeString(storeScope)}`;
}

function buildActiveCatalogQuery(allowedStoreNames = config.storefrontAllowedStoreNames) {
  const storeScopeClause = buildStoreScopeClause(allowedStoreNames);

  return `
    WITH scoped_variants AS (
      SELECT DISTINCT
        ac.VA_ID
      FROM dbo.Albero_Stock_Cache ac
      WHERE ac.qty > 0
        AND ${storeScopeClause}
    )
    SELECT
      ${CATALOG_COLUMNS.join(",\n      ")}
    FROM dbo.Articoli_Su_Sito_Plus a
    INNER JOIN scoped_variants sv
      ON sv.VA_ID = a.VA_ID
    WHERE a.CANCELLATO = 0
    ORDER BY a.MD_ID, a.VA_ID
  `;
}

async function ensureScopedStockCacheAvailable() {
  const storeScopeClause = buildStoreScopeClause();
  const result = await runQuery(`
    SELECT TOP 1 1 AS has_rows
    FROM dbo.Albero_Stock_Cache ac
    WHERE ac.qty > 0
      AND ${storeScopeClause}
  `);

  if (!result.recordset.length) {
    throw new Error(
      `dbo.Albero_Stock_Cache has no positive catalog rows for store scope ${config.storefrontAllowedStoreScope || "<all stores>"}`
    );
  }
}

async function getActiveCatalogRows() {
  if (config.requireSqlStockCache) {
    await ensureScopedStockCacheAvailable();
  }

  const result = await runQuery(buildActiveCatalogQuery());

  return result.recordset;
}

module.exports = {
  buildActiveCatalogQuery,
  buildStoreScopeClause,
  getActiveCatalogRows,
};
