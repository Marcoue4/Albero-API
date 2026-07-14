const config = require("../src/config");
const { closePool, createRequest, sql } = require("../src/db");
const {
  formatDuration,
  parsePositiveInteger,
} = require("../src/lib/stockCacheProgress");

const DEFAULT_REFRESH_TIMEOUT_MS = 600000;
const DEFAULT_PROGRESS_INTERVAL_MS = 10000;

async function main() {
  const startedAt = Date.now();
  const refreshTimeoutMs = parsePositiveInteger(
    process.env.STOCK_CACHE_REFRESH_TIMEOUT_MS,
    Math.max(config.db.requestTimeoutMs, DEFAULT_REFRESH_TIMEOUT_MS)
  );
  const progressIntervalMs = parsePositiveInteger(
    process.env.STOCK_CACHE_REFRESH_PROGRESS_INTERVAL_MS,
    DEFAULT_PROGRESS_INTERVAL_MS
  );
  let currentStage = "connecting to SQL Server";

  console.log("Starting stock cache refresh.");
  console.log(
    `Database: ${config.db.server}:${config.db.port}/${config.db.database}`
  );
  console.log(
    `Store scope: ${config.storefrontAllowedStoreScope || "<all stores>"}`
  );
  console.log(`Request timeout: ${refreshTimeoutMs}ms`);

  const progressTimer = setInterval(() => {
    console.log(
      `[${formatDuration(Date.now() - startedAt)}] Still running: ${currentStage}.`
    );
  }, progressIntervalMs);
  progressTimer.unref();

  let request;

  try {
    request = await createRequest(
      [
        {
          name: "storeScope",
          type: sql.NVarChar(sql.MAX),
          value: config.storefrontAllowedStoreScope,
        },
      ],
      { requestTimeout: refreshTimeoutMs }
    );
    currentStage = "executing dbo.Albero_Refresh_Stock_Cache";
    console.log(`[${formatDuration(Date.now() - startedAt)}] Connected.`);

    request.on("info", (info) => {
      const message = String(info?.message || "").trim();

      if (!message) {
        return;
      }

      currentStage = message;
      console.log(`[${formatDuration(Date.now() - startedAt)}] ${message}`);
    });

    const result = await request.query(`
      EXEC dbo.Albero_Refresh_Stock_Cache @store_scope = @storeScope
    `);

    const summary = result.recordset?.[0] || {};

    console.log(
      `[${formatDuration(Date.now() - startedAt)}] Stock cache refresh completed.`
    );
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const refreshError =
      error instanceof Error ? error : new Error(String(error || "Unknown refresh error"));
    refreshError.stockCacheRefresh = {
      elapsedMs: Date.now() - startedAt,
      stage: currentStage,
    };
    throw refreshError;
  } finally {
    clearInterval(progressTimer);
  }
}

if (require.main === module) {
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
      if (error?.stockCacheRefresh) {
        console.error(
          `Stopped after ${formatDuration(error.stockCacheRefresh.elapsedMs)} during: ${error.stockCacheRefresh.stage}.`
        );
      }
      if (error?.code === "ETIMEOUT") {
        console.error(
          "The SQL request exceeded STOCK_CACHE_REFRESH_TIMEOUT_MS. SQL Server rolls back the cache replacement transaction, so the previous cache remains available."
        );
      }
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
