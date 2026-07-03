const cors = require("cors");
const express = require("express");
const config = require("./config");
const { closePool, getTableColumns, getTablePreview, listTables, pingDatabase, runQuery } = require("./db");
const { HttpError } = require("./errors/httpError");
const { createCatalogService } = require("./services/catalogService");
const { getStockRuntimeCacheStatus } = require("./repositories/stockRepository");

const NO_STORE_HEADER = "no-store";

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function parseCsvQueryValue(value) {
  return asArray(value)
    .flatMap((entry) => String(entry || "").split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function getSqlStockCacheHealth() {
  const cacheResult = await runQuery(`
    IF OBJECT_ID(N'dbo.Albero_Stock_Cache', N'U') IS NULL
    BEGIN
      SELECT
        0 AS cache_exists,
        0 AS rows,
        CAST(NULL AS datetime2) AS min_refreshed_at,
        CAST(NULL AS datetime2) AS max_refreshed_at,
        CAST(NULL AS datetime) AS latest_source_movement_at,
        CAST(NULL AS bigint) AS age_ms
    END
    ELSE
    BEGIN
      SELECT
        1 AS cache_exists,
        COUNT(VA_ID) AS rows,
        MIN(refreshed_at) AS min_refreshed_at,
        MAX(refreshed_at) AS max_refreshed_at,
        MAX(source_last_movement_at) AS latest_source_movement_at,
        DATEDIFF_BIG(millisecond, MAX(refreshed_at), SYSDATETIME()) AS age_ms
      FROM dbo.Albero_Stock_Cache
    END
  `);
  const logResult = await runQuery(`
    IF OBJECT_ID(N'dbo.Albero_Stock_Cache_Refresh_Log', N'U') IS NULL
    BEGIN
      SELECT
        CAST(NULL AS bigint) AS id,
        CAST(NULL AS datetime2) AS started_at,
        CAST(NULL AS datetime2) AS finished_at,
        CAST(NULL AS int) AS rows_refreshed,
        CAST(NULL AS varchar(20)) AS status,
        CAST(NULL AS nvarchar(4000)) AS error_message
    END
    ELSE
    BEGIN
      SELECT TOP 1
        id,
        started_at,
        finished_at,
        rows_refreshed,
        status,
        error_message
      FROM dbo.Albero_Stock_Cache_Refresh_Log
      ORDER BY id DESC
    END
  `);
  const cache = cacheResult.recordset[0] || {};
  const lastRefresh = logResult.recordset[0] || null;
  const refreshedAt = cache.max_refreshed_at ? new Date(cache.max_refreshed_at) : null;
  const ageMs = cache.age_ms === null || cache.age_ms === undefined ? null : Number(cache.age_ms);

  return {
    exists: Boolean(cache.cache_exists),
    rows: Number(cache.rows || 0),
    refreshedAt: refreshedAt ? refreshedAt.toISOString() : null,
    ageMs,
    latestSourceMovementAt: cache.latest_source_movement_at
      ? new Date(cache.latest_source_movement_at).toISOString()
      : null,
    lastRefresh: lastRefresh?.id
      ? {
          id: Number(lastRefresh.id),
          startedAt: lastRefresh.started_at
            ? new Date(lastRefresh.started_at).toISOString()
            : null,
          finishedAt: lastRefresh.finished_at
            ? new Date(lastRefresh.finished_at).toISOString()
            : null,
          rowsRefreshed: lastRefresh.rows_refreshed,
          status: lastRefresh.status,
          errorMessage: lastRefresh.error_message,
        }
      : null,
  };
}

function createApp(options = {}) {
  const app = express();
  const catalogService = options.catalogService || createCatalogService();

  app.use(
    cors({
      origin: config.corsOrigin === "*" ? true : config.corsOrigin,
    })
  );
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      name: "albero-api",
      status: "ok",
      routes: [
        "GET /health",
        "GET /health/cache",
        "GET /health/db",
        "GET /api/products",
        "GET /api/products/:productId",
        "GET /api/catalog/facets",
        "POST /api/stock/lookup",
        "GET /api/meta/tables",
        "GET /api/meta/tables/:schema/:table/columns",
        "GET /api/meta/tables/:schema/:table/rows?limit=20",
      ],
    });
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      uptimeSeconds: Number(process.uptime().toFixed(2)),
      database: {
        server: config.db.server,
        port: config.db.port,
        name: config.db.database,
      },
      devInspectorEnabled: config.enableDevInspector,
    });
  });

  app.get("/health/db", async (_req, res, next) => {
    try {
      const dbStatus = await pingDatabase();
      res.json({
        status: "ok",
        database: dbStatus,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/health/cache", async (_req, res, next) => {
    try {
      const sqlStockCache = await getSqlStockCacheHealth();

      res.set("Cache-Control", NO_STORE_HEADER);
      res.json({
        status:
          sqlStockCache.exists &&
          sqlStockCache.rows > 0 &&
          sqlStockCache.lastRefresh?.status !== "failed"
            ? "ok"
            : "warning",
        checkedAt: new Date().toISOString(),
        sqlStockCache,
        apiMemoryStockCache: getStockRuntimeCacheStatus(),
        catalogCacheTtlMs: config.catalogCacheTtlMs,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products", async (req, res, next) => {
    try {
      const result = await catalogService.listProducts({
        ids: parseCsvQueryValue(req.query.ids),
        genders: parseCsvQueryValue(req.query.gender),
        categories: parseCsvQueryValue(req.query.category),
        brands: parseCsvQueryValue(req.query.brand),
        seasonCodes: parseCsvQueryValue(req.query.seasonCode),
        availability: req.query.availability,
        q: req.query.q,
        page: req.query.page,
        pageSize: req.query.pageSize,
        sort: req.query.sort,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products/:productId", async (req, res, next) => {
    try {
      const product = await catalogService.getProductDetail(req.params.productId);
      res.json({ product });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/catalog/facets", async (_req, res, next) => {
    try {
      const facets = await catalogService.getCatalogFacets();
      res.json(facets);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/stock/lookup", async (req, res, next) => {
    try {
      const skus = Array.isArray(req.body?.skus)
        ? req.body.skus.filter((sku) => typeof sku === "string")
        : [];
      const stocks = await catalogService.lookupStock(skus);

      res.set("Cache-Control", NO_STORE_HEADER);
      res.json({ stocks });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/meta/tables", async (_req, res, next) => {
    if (!config.enableDevInspector) {
      res.status(403).json({ error: "Development inspector is disabled." });
      return;
    }

    try {
      const tables = await listTables();
      res.json({
        count: tables.length,
        tables,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/meta/tables/:schema/:table/columns", async (req, res, next) => {
    if (!config.enableDevInspector) {
      res.status(403).json({ error: "Development inspector is disabled." });
      return;
    }

    try {
      const columns = await getTableColumns(req.params.schema, req.params.table);

      if (!columns.length) {
        res.status(404).json({ error: "Table not found." });
        return;
      }

      res.json({
        schema: req.params.schema,
        table: req.params.table,
        columns,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/meta/tables/:schema/:table/rows", async (req, res, next) => {
    if (!config.enableDevInspector) {
      res.status(403).json({ error: "Development inspector is disabled." });
      return;
    }

    try {
      const rows = await getTablePreview(
        req.params.schema,
        req.params.table,
        req.query.limit
      );

      res.json({
        schema: req.params.schema,
        table: req.params.table,
        count: rows.length,
        rows,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error instanceof HttpError ? error.statusCode : error.statusCode || 500;

    if (statusCode >= 500) {
      console.error(error);
    }

    res.status(statusCode).json({
      error: error.message || "Unexpected server error.",
      details: error.details,
    });
  });

  app.locals.closeResources = async () => {
    await closePool();
  };

  return app;
}

module.exports = {
  createApp,
};
