const { closePool, pingDatabase } = require("../src/db");

async function main() {
  const result = await pingDatabase();
  console.log("Database connection successful.");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("Database connection failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });

