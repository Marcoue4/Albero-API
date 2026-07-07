const config = require("../src/config");
const { closePool, createRequest, sql } = require("../src/db");

async function main() {
  const request = await createRequest([
    {
      name: "storeScope",
      type: sql.NVarChar(sql.MAX),
      value: config.storefrontAllowedStoreScope,
    },
  ]);
  const result = await request.query(`
    EXEC dbo.Albero_Refresh_Stock_Cache @store_scope = @storeScope
  `);

  const summary = result.recordset?.[0] || {};

  console.log("Refreshed dbo.Albero_Stock_Cache.");
  console.log(
    `Store scope: ${config.storefrontAllowedStoreScope || "<all stores>"}`
  );
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    if (error?.number === 8146) {
      console.error(
        "The installed dbo.Albero_Refresh_Stock_Cache procedure is still on the old schema."
      );
      console.error(
        "Run `npm run install-stock-cache` once to apply the scoped-cache SQL update, then rerun this refresh."
      );
    }
    console.error("Failed to refresh stock cache.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
