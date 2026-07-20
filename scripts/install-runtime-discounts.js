const { readFileSync } = require("node:fs");
const path = require("node:path");
const { closePool, runQuery, sql } = require("../src/db");

async function runBatch(batch) {
  const trimmed = batch.trim();
  if (!trimmed) return;
  await runQuery(trimmed);
}

function quoteIdentifier(identifier) {
  return `[${String(identifier).replace(/]/g, "]]")}]`;
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
  await runBatch(`GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Discount_Rules TO ${quotedUser}`);
  await runBatch(`GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Coupon_Redemptions TO ${quotedUser}`);
  await runBatch(`GRANT INSERT ON dbo.Albero_Admin_Audit_Log TO ${quotedUser}`);
  await runBatch(`GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Runtime_Documents TO ${quotedUser}`);
  await runBatch(`GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Orders TO ${quotedUser}`);
  await runBatch(`GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Albero_Order_Items TO ${quotedUser}`);
}

async function main() {
  const sqlPaths = [
    path.resolve(__dirname, "../sql/albero-runtime-discounts.sql"),
    path.resolve(__dirname, "../sql/albero-orders.sql"),
  ];
  for (const sqlPath of sqlPaths) {
    const batches = readFileSync(sqlPath, "utf-8").split(/^\s*GO\s*$/gim);
    for (const batch of batches) await runBatch(batch);
  }

  await grantApiPermissions(process.env.RUNTIME_DATA_GRANT_USER);

  console.log("Installed Albero runtime data and order tables.");
  if (process.env.RUNTIME_DATA_GRANT_USER) {
    console.log(`Granted API permissions to ${process.env.RUNTIME_DATA_GRANT_USER}.`);
  }
}

main()
  .catch((error) => {
    console.error("Failed to install runtime discount tables.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
