const fs = require("node:fs");
const path = require("node:path");
const { closePool, createRequest, runQuery, sql } = require("../src/db");

function splitSqlBatches(text) {
  return text.split(/^\s*GO\s*;?\s*$/gim).map((entry) => entry.trim()).filter(Boolean);
}

function quoteIdentifier(value) {
  const escaped = String(value).split("]").join("]]");
  return `[${escaped}]`;
}

async function assertPreflight() {
  const reviewLocationName = process.env.INVENTORY_REVIEW_LOCATION_NAME || "xLavorazione";
  const result = await runQuery(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Negozi WHERE NE_DES=@reviewLocationName AND ISNULL(NE_CANCELLATO,0)=0) AS review_locations,
      (SELECT COUNT(*) FROM dbo.Negozi WHERE NE_DES=N'xResi Difettosi' AND ISNULL(NE_CANCELLATO,0)=0) AS defective_locations,
      (SELECT COUNT(*) FROM dbo.Causali WHERE CA_ID=13 AND CA_ESI=-1 AND CA_TRU=1) AS exit_causes,
      (SELECT COUNT(*) FROM dbo.Causali WHERE CA_ID=12 AND CA_ESI=1 AND CA_TRE=1) AS entry_causes,
      (SELECT COUNT(*) FROM dbo.database_id WHERE DB_ID=1001 AND DB_ID_MIN=1 AND DB_ID_MAX=10000000) AS db_ranges,
      CASE WHEN OBJECT_ID(N'dbo.Albero_Stock_Cache',N'U') IS NULL THEN 0 ELSE 1 END AS stock_cache
  `, [{ name: "reviewLocationName", type: sql.NVarChar(250), value: reviewLocationName }]);
  const row = result.recordset[0];
  for (const [key, value] of Object.entries(row)) {
    if (Number(value) !== 1) throw new Error(`Inventory review preflight failed: ${key}=${value}`);
  }
}

async function grantPermissions() {
  const writer = process.env.INVENTORY_REVIEW_WRITER_GRANT_USER;
  const reader = process.env.INVENTORY_REVIEW_READER_GRANT_USER;
  if (writer) {
    await runQuery(`GRANT EXECUTE ON dbo.Albero_Move_Inventory_Review TO ${quoteIdentifier(writer)}`);
  }
  if (reader) {
    await runQuery(`GRANT SELECT ON dbo.Albero_Inventory_Review TO ${quoteIdentifier(reader)}`);
  }
}

async function main() {
  await assertPreflight();
  const sqlPath = path.resolve(__dirname, "../sql/albero-inventory-review.sql");
  for (const batch of splitSqlBatches(fs.readFileSync(sqlPath, "utf8"))) {
    const request = await createRequest();
    await request.query(batch);
  }
  await grantPermissions();
  console.log("Installed inventory review table and transfer procedure.");
}

main().catch((error) => {
  console.error("Failed to install inventory review workflow.");
  console.error(error);
  process.exitCode = 1;
}).finally(closePool);
