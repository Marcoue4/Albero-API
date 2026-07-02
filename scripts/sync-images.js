const fs = require("node:fs");
const path = require("node:path");
const { put } = require("@vercel/blob");
const config = require("../src/config");
const { closePool } = require("../src/db");
const { IMAGE_COLUMNS } = require("../src/lib/imageResolver");
const {
  buildBlobPathname,
  createSourceKey,
  normalizeSourcePath,
  resolveLocalSourcePath,
} = require("../src/lib/imageSyncPaths");
const {
  readImageSyncManifest,
  writeImageSyncManifest,
} = require("../src/lib/imageSyncManifest");
const { getActiveCatalogRows } = require("../src/repositories/catalogRepository");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    limit: null,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);

      if (Number.isFinite(value) && value > 0) {
        args.limit = value;
      }
    }
  }

  return args;
}

function ensureBlobCredentialsIfNeeded(dryRun) {
  if (dryRun) {
    return;
  }

  if (!config.blob.readWriteToken) {
    throw new Error(
      "Missing Blob read-write token. Set BLOB_READ_WRITE_TOKEN or BLOB_PUBLIC_READ_WRITE_TOKEN."
    );
  }
}

function collectImageCandidates(rows, options = {}) {
  const candidatesByKey = new Map();

  for (const row of rows) {
    for (const columnName of IMAGE_COLUMNS) {
      const sourcePath = normalizeSourcePath(row[columnName]);

      if (!sourcePath) {
        continue;
      }

      const sourceKey = createSourceKey(sourcePath);
      const current = candidatesByKey.get(sourceKey) || {
        sourcePath,
        localPath: resolveLocalSourcePath(sourcePath, {
          sourceDbRoot: options.sourceDbRoot,
          sourceLocalRoot: options.sourceLocalRoot,
        }),
        pathname: buildBlobPathname(sourcePath, {
          sourceRoot: options.sourceDbRoot,
          prefix: options.blobPrefix,
        }),
        modelIds: new Set(),
        variantIds: new Set(),
        columns: new Set(),
      };

      current.modelIds.add(Number(row.MD_ID));
      current.variantIds.add(Number(row.VA_ID));
      current.columns.add(columnName);
      candidatesByKey.set(sourceKey, current);
    }
  }

  return [...candidatesByKey.values()].map((candidate) => ({
    ...candidate,
    modelIds: [...candidate.modelIds].sort((left, right) => left - right),
    variantIds: [...candidate.variantIds].sort((left, right) => left - right),
    columns: [...candidate.columns].sort(),
  }));
}

function createEmptyManifest() {
  return {
    version: 1,
    generatedAt: null,
    images: {},
  };
}

function shouldSkipUpload(candidate, manifestEntry, stats, force) {
  if (force) {
    return false;
  }

  if (!manifestEntry || !manifestEntry.url) {
    return false;
  }

  return (
    manifestEntry.pathname === candidate.pathname &&
    manifestEntry.size === stats.size &&
    manifestEntry.mtimeMs === stats.mtimeMs &&
    manifestEntry.missing !== true
  );
}

async function runWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (queue.length) {
        const item = queue.shift();
        await worker(item);
      }
    }
  );

  await Promise.all(workers);
}

async function uploadCandidate(candidate, args, manifest, summary) {
  const sourceKey = createSourceKey(candidate.sourcePath);
  const localPath = candidate.localPath;
  const priorEntry = manifest.images[sourceKey] || null;

  if (!localPath || !fs.existsSync(localPath)) {
    summary.missing += 1;
    manifest.images[sourceKey] = {
      sourcePath: candidate.sourcePath,
      localPath,
      pathname: candidate.pathname,
      url: priorEntry?.url || null,
      downloadUrl: priorEntry?.downloadUrl || null,
      etag: priorEntry?.etag || null,
      size: priorEntry?.size || null,
      mtimeMs: priorEntry?.mtimeMs || null,
      contentType: priorEntry?.contentType || null,
      uploadedAt: priorEntry?.uploadedAt || null,
      lastSeenAt: new Date().toISOString(),
      modelIds: candidate.modelIds,
      variantIds: candidate.variantIds,
      missing: true,
      missingReason: "Source file not found on local filesystem.",
    };
    console.warn(`Missing source file: ${candidate.sourcePath} -> ${localPath}`);
    return;
  }

  const stats = fs.statSync(localPath);

  if (shouldSkipUpload(candidate, priorEntry, stats, args.force)) {
    summary.skipped += 1;
    manifest.images[sourceKey] = {
      ...priorEntry,
      sourcePath: candidate.sourcePath,
      localPath,
      pathname: candidate.pathname,
      lastSeenAt: new Date().toISOString(),
      modelIds: candidate.modelIds,
      variantIds: candidate.variantIds,
      missing: false,
      missingReason: null,
    };
    console.log(`Skip unchanged: ${candidate.pathname}`);
    return;
  }

  if (args.dryRun) {
    summary.planned += 1;
    manifest.images[sourceKey] = {
      sourcePath: candidate.sourcePath,
      localPath,
      pathname: candidate.pathname,
      url: priorEntry?.url ?? null,
      downloadUrl: priorEntry?.downloadUrl ?? null,
      etag: priorEntry?.etag ?? null,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      contentType: priorEntry?.contentType ?? null,
      uploadedAt: priorEntry?.uploadedAt ?? null,
      lastSeenAt: new Date().toISOString(),
      modelIds: candidate.modelIds,
      variantIds: candidate.variantIds,
      missing: false,
      missingReason: null,
    };
    console.log(`[dry-run] Would upload ${localPath} -> ${candidate.pathname}`);
    return;
  }

  const fileBuffer = await fs.promises.readFile(localPath);
  const uploadBody = new Blob([fileBuffer]);
  const blob = await put(candidate.pathname, uploadBody, {
    access: config.imageSync.blobAccess,
    token: config.blob.readWriteToken,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: config.imageSync.cacheControlMaxAgeSeconds,
  });

  summary.uploaded += 1;
  manifest.images[sourceKey] = {
    sourcePath: candidate.sourcePath,
    localPath,
    pathname: blob.pathname,
    url: blob.url,
    downloadUrl: blob.downloadUrl,
    etag: blob.etag,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    contentType: blob.contentType,
    uploadedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    modelIds: candidate.modelIds,
    variantIds: candidate.variantIds,
    missing: false,
    missingReason: null,
  };
  console.log(`Uploaded ${candidate.pathname}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureBlobCredentialsIfNeeded(args.dryRun);

  const rows = await getActiveCatalogRows();
  let candidates = collectImageCandidates(rows, {
    sourceDbRoot: config.imageSync.sourceDbRoot,
    sourceLocalRoot: config.imageSync.sourceLocalRoot,
    blobPrefix: config.imageSync.blobPrefix,
  });

  if (args.limit) {
    candidates = candidates.slice(0, args.limit);
  }

  const manifest = readImageSyncManifest() || createEmptyManifest();
  const summary = {
    total: candidates.length,
    uploaded: 0,
    skipped: 0,
    planned: 0,
    missing: 0,
  };

  console.log(
    `Syncing ${candidates.length} unique images from ${config.imageSync.sourceLocalRoot} to Blob prefix "${config.imageSync.blobPrefix}".`
  );

  await runWithConcurrency(
    candidates,
    config.imageSync.concurrency,
    async (candidate) => {
      await uploadCandidate(candidate, args, manifest, summary);
    }
  );

  const savedManifest = writeImageSyncManifest(manifest);
  console.log(
    `Manifest written to ${path.relative(process.cwd(), config.imageSync.manifestPath) || config.imageSync.manifestPath}`
  );
  console.log(
    `Done. total=${summary.total} uploaded=${summary.uploaded} skipped=${summary.skipped} planned=${summary.planned} missing=${summary.missing}`
  );

  if (savedManifest.generatedAt) {
    console.log(`Manifest timestamp: ${savedManifest.generatedAt}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
