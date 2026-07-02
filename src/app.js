const cors = require("cors");
const express = require("express");
const config = require("./config");
const { closePool, getTableColumns, getTablePreview, listTables, pingDatabase } = require("./db");
const { HttpError } = require("./errors/httpError");
const { createCatalogService } = require("./services/catalogService");

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
