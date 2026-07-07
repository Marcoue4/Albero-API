const fs = require("node:fs");
const path = require("node:path");
const { closePool, createRequest, sql } = require("../src/db");

function splitSqlBatches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function runBatch(batch) {
  const request = await createRequest();
  await request.query(batch);
}

function quoteSqlIdentifier(identifier) {
  return `[${String(identifier).replace(/]/g, "]]")}]`;
}

async function grantApiPermissions(userName) {
  if (!userName) {
    return;
  }

  const request = await createRequest([
    {
      name: "userName",
      type: sql.NVarChar,
      value: userName,
    },
  ]);

  const result = await request.query(`
    SELECT name
    FROM sys.database_principals
    WHERE name = @userName
  `);

  if (!result.recordset.length) {
    throw new Error(`Database principal not found for STOCK_CACHE_GRANT_USER=${userName}`);
  }

  const quotedUser = quoteSqlIdentifier(userName);

  await runBatch(`GRANT SELECT ON dbo.Albero_Stock_Cache TO ${quotedUser}`);
  await runBatch(
    `GRANT INSERT, UPDATE, DELETE ON dbo.Albero_Stock_Cache TO ${quotedUser}`
  );
  await runBatch(
    `GRANT INSERT ON dbo.Albero_Stock_Cache_Refresh_Log TO ${quotedUser}`
  );
  await runBatch(`GRANT EXECUTE ON dbo.Albero_Refresh_Stock_Cache TO ${quotedUser}`);
}

async function main() {
  const sqlPath = path.resolve(__dirname, "../sql/albero-stock-cache.sql");
  const sqlText = fs.readFileSync(sqlPath, "utf8");
  const batches = splitSqlBatches(sqlText);

  for (const batch of batches) {
    await runBatch(batch);
  }

  await grantApiPermissions(process.env.STOCK_CACHE_GRANT_USER);

  console.log("Installed dbo.Albero_Stock_Cache and dbo.Albero_Refresh_Stock_Cache.");

  if (process.env.STOCK_CACHE_GRANT_USER) {
    console.log(`Granted API permissions to ${process.env.STOCK_CACHE_GRANT_USER}.`);
  } else {
    console.log("No STOCK_CACHE_GRANT_USER set; grants were skipped.");
  }
}

main()
  .catch((error) => {
    console.error("Failed to install stock cache.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
