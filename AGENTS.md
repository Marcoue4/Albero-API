# Agent Guide: Albero API

This document is written for AI coding agents working on the `albero-api` project. It describes the project's architecture, conventions, and day-to-day workflows. Read this before making non-trivial changes.

## Project overview

`albero-api` is a small Node.js/Express API that connects the Albero storefront website to an on-premise Microsoft SQL Server inventory database. It exposes catalog, stock, and development-inspection endpoints, and includes an image-sync job that uploads product photos from a Windows share to Vercel Blob.

The API is intentionally simple: no transpile step, no ORM, no framework beyond Express, and tests use Node's built-in test runner. The production runtime is `node src/server.js`.

## Technology stack

- **Runtime**: Node.js (package is `"type": "commonjs"`)
- **Web framework**: Express 5.x
- **Database driver**: `mssql` (Tedious-based SQL Server driver)
- **External blob storage**: `@vercel/blob`
- **Configuration**: `dotenv` loaded from `.env`
- **CORS**: `cors` middleware
- **Testing**: Node.js built-in `node:test` and `node:assert/strict`
- **Linting/formatting**: none configured (no ESLint, Prettier, or similar config files)

## Project structure

```text
albero-api/
├── src/
│   ├── app.js                  # Express application factory and route handlers
│   ├── server.js               # Entry point: creates app and starts HTTP server
│   ├── config.js               # Environment-variable parsing and validation
│   ├── db.js                   # SQL Server connection pool and query helpers
│   ├── errors/
│   │   └── httpError.js        # Custom HttpError with status-code helpers
│   ├── lib/                    # Pure business logic and data transformations
│   │   ├── catalogIdentity.js  # ID/sku/slug builders and parsers
│   │   ├── catalogMapper.js    # Maps raw SQL rows to product/variant objects
│   │   ├── colorUtils.js       # Color-name-to-hex mapping
│   │   ├── htmlCleaner.js      # Strips HTML and normalizes whitespace
│   │   ├── imageResolver.js    # Builds image objects from RIFERIMENTO_* columns
│   │   ├── imageSyncManifest.js# Reads/writes the Vercel Blob image manifest
│   │   ├── imageSyncPaths.js   # Windows-path normalization and Blob pathname builder
│   │   └── taxonomy.js         # Category/subtype/gender inference from SQL text fields
│   ├── repositories/
│   │   ├── catalogRepository.js# Queries against dbo.Articoli_Su_Sito_Plus
│   │   └── stockRepository.js  # Queries against dbo.Barcode and dbo.Taglie_righe
│   └── services/
│       └── catalogService.js   # In-memory cached catalog, filtering, sorting, pagination
├── scripts/
│   ├── check-db.js             # Standalone DB connection test
│   ├── smoke.js                # End-to-end smoke test against a temporary server
│   └── sync-images.js          # Uploads product images to Vercel Blob and writes a manifest
├── tests/
│   ├── helpers/
│   │   └── httpTestServer.js   # Spins up the app on an ephemeral port for tests
│   ├── integration/
│   │   └── api.integration.test.js  # HTTP-level tests against the real database
│   └── unit/
│       ├── catalogMapper.test.js    # Pure mapping tests with synthetic rows
│       └── imageSyncPaths.test.js   # Path-normalization tests
├── .env.example                # All supported environment variables
├── package.json                # Scripts and dependencies
└── README.md                   # Human-readable endpoint and setup documentation
```

## Build and runtime

There is no build step. The server runs directly from source.

```bash
# Install dependencies
npm install

# Start the server (production-style)
npm start

# Start with file watching for development
npm run dev
```

The server listens on `http://${HOST}:${PORT}` with defaults `0.0.0.0:5000`.

Entry point flow:

1. `src/server.js` imports `config.js`, which validates required environment variables.
2. `createApp()` in `src/app.js` wires middleware and routes.
3. Routes delegate to `catalogService`, which calls repositories and mappers.
4. `src/db.js` lazily creates a single `mssql.ConnectionPool` and reuses it.

## Configuration

All configuration comes from environment variables loaded by `dotenv` in `src/config.js`.

Required variables (startup will throw if missing):

- `DB_SERVER`
- `DB_PORT`
- `DB_DATABASE`
- `DB_USER`
- `DB_PASSWORD`

Important optional variables:

- `PORT` / `HOST` — server bind address (default `0.0.0.0:5000`)
- `CORS_ORIGIN` — CORS origin, default `*`
- `ENABLE_DEV_INSPECTOR` — enables `/api/meta/*` routes (default `true`)
- `CATALOG_CACHE_TTL_MS` — in-memory catalog cache TTL (default `60000`)
- `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` — pagination limits
- `MAX_STOCK_LOOKUP_SKUS` — cap for `POST /api/stock/lookup` (default `100`)
- `STOREFRONT_ALLOWED_STORE_NAMES` — comma-separated store names allowed to appear on the storefront; defaults to the current five Albero locations
- `BLOB_READ_WRITE_TOKEN` or `BLOB_PUBLIC_READ_WRITE_TOKEN` — Vercel Blob token
- `BLOB_STORE_ID` or `BLOB_PUBLIC_STORE_ID` — Vercel Blob store ID
- `IMAGE_SOURCE_DB_ROOT` — UNC root stored in SQL, e.g. `\\SERVER-ATELIER\Foto`
- `IMAGE_SOURCE_LOCAL_ROOT` — local path where the sync script can read the same files
- `IMAGE_SYNC_MANIFEST_PATH` — where the image manifest JSON is written (default `./data/image-sync-manifest.json`)
- `IMAGE_SYNC_BLOB_PREFIX` / `IMAGE_SYNC_BLOB_ACCESS` / `IMAGE_SYNC_CACHE_CONTROL_MAX_AGE` / `IMAGE_SYNC_CONCURRENCY` / `IMAGE_SYNC_MANIFEST_CACHE_TTL_MS`

Copy `.env.example` to `.env` and fill in the database credentials before running anything.

## Code organization conventions

- **CommonJS**: every source file uses `require`/`module.exports`.
- **Factory pattern for services**: `createCatalogService()` and `createApp()` accept optional dependencies to make testing easier.
- **Layer separation**:
  - `app.js` only handles HTTP routing, query parsing, and error serialization.
  - `services/` holds orchestration logic, caching, and in-memory filtering/sorting.
  - `repositories/` contain raw SQL queries.
  - `lib/` contains pure functions that transform data.
- **No classes except `HttpError`**: most logic is written with plain functions.
- **String IDs**: products use `mdl_<MD_ID>` and variants use `var_<VA_ID>`. SKUs are `trim(MD_CODICE) + trim(VA_CODICE)`.
- **Windows paths**: image paths from SQL are UNC Windows paths. `src/lib/imageSyncPaths.js` normalizes them with `path.win32`.
- **Locale-aware sorting**: many sorts use `"it"` locale.

## Available endpoints

Public/storefront routes:

- `GET /health`
- `GET /health/db`
- `GET /api/products`
- `GET /api/products/:productId`
- `GET /api/catalog/facets`
- `POST /api/stock/lookup`

Development-only routes (gated by `ENABLE_DEV_INSPECTOR`):

- `GET /api/meta/tables`
- `GET /api/meta/tables/:schema/:table/columns`
- `GET /api/meta/tables/:schema/:table/rows?limit=20`

See `README.md` for query parameters and request/response shapes.

## Testing

Tests use the Node.js built-in test runner (`node --test`).

```bash
# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration
```

- **Unit tests** (`tests/unit/`) pass synthetic SQL rows into mapper/path functions and do not need a database.
- **Integration tests** (`tests/integration/`) start the full Express app on an ephemeral port and hit the real database configured in `.env`. They assume specific fixture data exists (e.g. `mdl_197582538` and SKU `7G5015PX33101111TUMBL`).
- **Smoke test** (`npm run smoke`) is an end-to-end script that starts a temporary server and exercises `/health/db`, `/api/products`, `/api/products/:id`, and `/api/stock/lookup`.

`tests/helpers/httpTestServer.js` creates the ephemeral server and closes the DB pool on teardown.

## Image sync workflow

The `scripts/sync-images.js` job uploads product images from the local filesystem to Vercel Blob.

```bash
# Dry run, limited to 20 images
npm run sync-images -- --dry-run --limit=20

# Real sync
npm run sync-images

# Force re-upload even if files look unchanged
npm run sync-images -- --force
```

What it does:

1. Reads active catalog rows from `dbo.Articoli_Su_Sito_Plus`.
2. Collects unique image paths from the `RIFERIMENTO_0`..`RIFERIMENTO_15` columns.
3. Rewrites the SQL `IMAGE_SOURCE_DB_ROOT` to the local `IMAGE_SOURCE_LOCAL_ROOT` when needed.
4. Uploads reachable files to Vercel Blob with concurrency controlled by `IMAGE_SYNC_CONCURRENCY`.
5. Writes a JSON manifest to `IMAGE_SYNC_MANIFEST_PATH`.

The API reads that manifest at runtime (`src/lib/imageSyncManifest.js`) and returns Blob URLs through the existing product/variant image fields. If no manifest exists, image URLs are `null` but `sourcePath` is still returned.

## Database notes

- The application connects to a single SQL Server database via `mssql`.
- Connection pool defaults: `max: 10`, `min: 0`, `idleTimeoutMillis: 30000`.
- The main catalog view/table is `dbo.Articoli_Su_Sito_Plus` filtered by `CANCELLATO = 0`, then scoped to `STOREFRONT_ALLOWED_STORE_NAMES` via matching rows in `dbo.BARCODE_ESISTENZA_RFID`.
- Stock is derived from `dbo.BARCODE_ESISTENZA_RFID` and filtered to `STOREFRONT_ALLOWED_STORE_NAMES`.
- Dev-inspector routes query `sys.tables`, `INFORMATION_SCHEMA.COLUMNS`, and arbitrary table previews with identifier quoting.
- When store filtering is enabled, the runtime bypasses `dbo.Albero_Stock_Cache` because that cache table does not preserve per-store scope.

## Security considerations

- `.env` and `data/` are gitignored. Never commit credentials or generated manifests.
- Database credentials are loaded from environment variables and passed directly to `mssql`.
- The `/api/meta/*` inspector routes can enumerate schemas, columns, and rows. Keep `ENABLE_DEV_INSPECTOR=false` in production or behind authentication.
- `getTablePreview` clamps `limit` between 1 and 100 and quotes identifiers, but the dev inspector still executes `SELECT TOP N *` against arbitrary tables.
- SQL queries use parameterized inputs (`request.input`) for dynamic values, but the catalog repository joins a fixed `CATALOG_COLUMNS` list directly into the query text. Do not add user-supplied columns there.
- CORS defaults to `*`. Restrict `CORS_ORIGIN` in production.

## Common tasks

```bash
# Verify DB connectivity without starting the server
npm run check-db

# Run the full test suite
npm test

# Run the end-to-end smoke test
npm run smoke

# Start with file watching
npm run dev
```

## Things to keep in mind

- The catalog is cached in memory for `CATALOG_CACHE_TTL_MS`. `catalogService.clearCache()` exists but is currently only useful from tests.
- The codebase is intentionally minimal: prefer adding small pure functions in `lib/` over introducing new dependencies.
- When changing ID/slug/sku logic, update both `src/lib/catalogIdentity.js` and the corresponding unit tests.
- When adding new environment variables, add them to `.env.example`, `src/config.js`, and this file.
