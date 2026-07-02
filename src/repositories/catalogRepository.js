const { runQuery } = require("../db");
const { IMAGE_COLUMNS } = require("../lib/imageResolver");

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

async function getActiveCatalogRows() {
  const result = await runQuery(`
    SELECT
      ${CATALOG_COLUMNS.join(",\n      ")}
    FROM dbo.Articoli_Su_Sito_Plus
    WHERE CANCELLATO = 0
    ORDER BY MD_ID, VA_ID
  `);

  return result.recordset;
}

module.exports = {
  getActiveCatalogRows,
};
