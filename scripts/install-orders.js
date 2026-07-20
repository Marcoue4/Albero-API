const { readFileSync } = require("node:fs");
const path = require("node:path");
const { closePool, runQuery, sql } = require("../src/db");

async function runBatch(batch) {
  const trimmed = batch.trim();
  if (trimmed) await runQuery(trimmed);
}

function quoteIdentifier(identifier) {
  const escaped = String(identifier).split("]").join(String.fromCharCode(93, 93));
  return `[${escaped}]`;
}

async function grantApiPermissions(userName) {
  if (!userName) return;

  const result = await runQuery(
    "SELECT COUNT(*) AS count FROM sys.database_principals WHERE name = @userName",
    [{ name: "userName", type: sql.NVarChar, value: userName }]
  );
  if (!Number(result.recordset[0]?.count || 0)) {
    throw new Error(`Database principal not found for RUNTIME_DATA_GRANT_USER=${userName}`);
  }

  const quotedUser = quoteIdentifier(userName);
  await runBatch(`GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Orders TO ${quotedUser}`);
  await runBatch(`GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Order_Items TO ${quotedUser}`);
}

async function main() {
  const sqlPath = path.resolve(__dirname, "../sql/albero-orders.sql");
  const batches = readFileSync(sqlPath, "utf-8").split(/^\s*GO\s*$/gim);
  for (const batch of batches) await runBatch(batch);
  await grantApiPermissions(process.env.RUNTIME_DATA_GRANT_USER);
  console.log("Installed Albero order tables.");
}

main()
  .catch((error) => {
    console.error("Failed to install Albero order tables.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
