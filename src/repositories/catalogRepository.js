const config = require("../config");
const { runQuery } = require("../db");
const { IMAGE_COLUMNS } = require("../lib/imageResolver");
const { buildStoreLocationPredicateSql } = require("../lib/storeLocationScope");

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
  ...IMAGE_COLUMNS,
];

function buildActiveCatalogQuery(allowedStoreNames = config.storefrontAllowedStoreNames) {
  const storePredicate = buildStoreLocationPredicateSql("r.NE_DES", allowedStoreNames);

  if (!storePredicate) {
    return `
      SELECT
        ${CATALOG_COLUMNS.join(",\n        ")}
      FROM dbo.Articoli_Su_Sito_Plus
      WHERE CANCELLATO = 0
      ORDER BY MD_ID, VA_ID
    `;
  }

  return `
    WITH scoped_variants AS (
      SELECT DISTINCT
        UPPER(LTRIM(RTRIM(r.BRAND))) AS brand,
        UPPER(LTRIM(RTRIM(r.SIGLA_STAGIONE))) AS season,
        UPPER(LTRIM(RTRIM(r.CODICE_MODELLO))) AS model_code,
        UPPER(LTRIM(RTRIM(r.CODICE_VARIANTE))) AS variant_code
      FROM dbo.BARCODE_ESISTENZA_RFID r
      WHERE ${storePredicate}
    )
    SELECT
      ${CATALOG_COLUMNS.join(",\n      ")}
    FROM dbo.Articoli_Su_Sito_Plus a
    INNER JOIN scoped_variants sv
      ON sv.brand = UPPER(LTRIM(RTRIM(a.TI_DES)))
     AND sv.season = UPPER(LTRIM(RTRIM(a.ST_SIGLA)))
     AND sv.model_code = UPPER(LTRIM(RTRIM(a.MD_CODICE)))
     AND sv.variant_code = UPPER(LTRIM(RTRIM(a.VA_CODICE)))
    WHERE a.CANCELLATO = 0
    ORDER BY a.MD_ID, a.VA_ID
  `;
}

async function getActiveCatalogRows() {
  const result = await runQuery(buildActiveCatalogQuery());

  return result.recordset;
}

module.exports = {
  buildActiveCatalogQuery,
  getActiveCatalogRows,
};
