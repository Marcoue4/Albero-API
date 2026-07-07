const path = require("node:path");
const dotenv = require("dotenv");
const {
  formatStoreLocationScopeValue,
  parseAllowedStoreNames,
} = require("./lib/storeLocationScope");

dotenv.config({ quiet: true });

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const storefrontAllowedStoreNames = parseAllowedStoreNames(
  process.env.STOREFRONT_ALLOWED_STORE_NAMES
);

const config = {
  port: parseNumber(process.env.PORT, 5000),
  host: process.env.HOST || "0.0.0.0",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  enableDevInspector: parseBoolean(process.env.ENABLE_DEV_INSPECTOR, true),
  catalogCacheTtlMs: parseNumber(process.env.CATALOG_CACHE_TTL_MS, 60000),
  defaultPageSize: parseNumber(process.env.DEFAULT_PAGE_SIZE, 24),
  maxPageSize: parseNumber(process.env.MAX_PAGE_SIZE, 100),
  maxStockLookupSkus: parseNumber(process.env.MAX_STOCK_LOOKUP_SKUS, 100),
  stockCacheTtlMs: parseNumber(process.env.STOCK_CACHE_TTL_MS, 300000),
  requireSqlStockCache: parseBoolean(process.env.REQUIRE_SQL_STOCK_CACHE, false),
  storefrontAllowedStoreNames,
  storefrontAllowedStoreScope:
    formatStoreLocationScopeValue(storefrontAllowedStoreNames),
  runtimeDataSecret:
    process.env.ALBERO_API_RUNTIME_SECRET ||
    process.env.API_RUNTIME_SECRET ||
    null,
  blob: {
    storeId:
      process.env.BLOB_STORE_ID ||
      process.env.BLOB_PUBLIC_STORE_ID ||
      null,
    readWriteToken:
      process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_PUBLIC_READ_WRITE_TOKEN ||
      null,
  },
  imageSync: {
    sourceDbRoot:
      process.env.IMAGE_SOURCE_DB_ROOT || "\\\\SERVER-ATELIER\\Foto",
    sourceLocalRoot:
      process.env.IMAGE_SOURCE_LOCAL_ROOT ||
      process.env.IMAGE_SOURCE_DB_ROOT ||
      "\\\\SERVER-ATELIER\\Foto",
    manifestPath: path.resolve(
      process.cwd(),
      process.env.IMAGE_SYNC_MANIFEST_PATH || "./data/image-sync-manifest.json"
    ),
    blobPrefix: process.env.IMAGE_SYNC_BLOB_PREFIX || "catalog",
    blobAccess:
      process.env.IMAGE_SYNC_BLOB_ACCESS === "private" ? "private" : "public",
    cacheControlMaxAgeSeconds: parseNumber(
      process.env.IMAGE_SYNC_CACHE_CONTROL_MAX_AGE,
      31536000
    ),
    concurrency: parseNumber(process.env.IMAGE_SYNC_CONCURRENCY, 4),
    manifestCacheTtlMs: parseNumber(
      process.env.IMAGE_SYNC_MANIFEST_CACHE_TTL_MS,
      5000
    ),
  },
  db: {
    server: process.env.DB_SERVER,
    port: parseNumber(process.env.DB_PORT, 1433),
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    encrypt: parseBoolean(process.env.DB_ENCRYPT, false),
    trustServerCertificate: parseBoolean(
      process.env.DB_TRUST_SERVER_CERTIFICATE,
      true
    ),
    requestTimeoutMs: parseNumber(process.env.DB_REQUEST_TIMEOUT_MS, 120000),
  },
};

const requiredVars = [
  "DB_SERVER",
  "DB_PORT",
  "DB_DATABASE",
  "DB_USER",
  "DB_PASSWORD",
];

for (const envVar of requiredVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

module.exports = config;
