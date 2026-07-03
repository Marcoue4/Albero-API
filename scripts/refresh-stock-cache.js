const { closePool, createRequest } = require("../src/db");

async function main() {
  const request = await createRequest();
  const result = await request.query(`
    EXEC dbo.Albero_Refresh_Stock_Cache
  `);

  const summary = result.recordset?.[0] || {};

  console.log("Refreshed dbo.Albero_Stock_Cache.");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to refresh stock cache.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
