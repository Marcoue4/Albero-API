const fs = require("node:fs");
const path = require("node:path");
const config = require("../config");
const { createSourceKey, normalizeSourcePath } = require("./imageSyncPaths");

const EMPTY_MANIFEST = Object.freeze({
  version: 1,
  generatedAt: null,
  images: {},
});

let manifestCache = {
  loadedAt: 0,
  manifest: EMPTY_MANIFEST,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeManifest(input) {
  if (!input || typeof input !== "object") {
    return clone(EMPTY_MANIFEST);
  }

  const images =
    input.images && typeof input.images === "object" ? input.images : {};
  const normalizedImages = {};

  for (const value of Object.values(images)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const sourcePath = normalizeSourcePath(value.sourcePath);

    if (!sourcePath) {
      continue;
    }

    const key = createSourceKey(sourcePath);
    normalizedImages[key] = {
      sourcePath,
      localPath: value.localPath ? String(value.localPath) : null,
      pathname: value.pathname ? String(value.pathname) : null,
      url: value.url ? String(value.url) : null,
      downloadUrl: value.downloadUrl ? String(value.downloadUrl) : null,
      etag: value.etag ? String(value.etag) : null,
      size: Number.isFinite(Number(value.size)) ? Number(value.size) : null,
      mtimeMs: Number.isFinite(Number(value.mtimeMs)) ? Number(value.mtimeMs) : null,
      contentType: value.contentType ? String(value.contentType) : null,
      uploadedAt: value.uploadedAt ? String(value.uploadedAt) : null,
      lastSeenAt: value.lastSeenAt ? String(value.lastSeenAt) : null,
      modelIds: Array.isArray(value.modelIds)
        ? value.modelIds.map((entry) => Number(entry)).filter(Number.isFinite)
        : [],
      variantIds: Array.isArray(value.variantIds)
        ? value.variantIds.map((entry) => Number(entry)).filter(Number.isFinite)
        : [],
      missing: value.missing === true,
      missingReason: value.missingReason ? String(value.missingReason) : null,
    };
  }

  return {
    version: 1,
    generatedAt: input.generatedAt ? String(input.generatedAt) : null,
    images: normalizedImages,
  };
}

function readImageSyncManifest(options = {}) {
  const manifestPath = path.resolve(
    options.manifestPath || config.imageSync.manifestPath
  );

  if (!fs.existsSync(manifestPath)) {
    return clone(EMPTY_MANIFEST);
  }

  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    return normalizeManifest(JSON.parse(raw));
  } catch {
    return clone(EMPTY_MANIFEST);
  }
}

function loadCachedImageSyncManifest(options = {}) {
  const force = options.force === true;
  const now = Date.now();

  if (
    !force &&
    manifestCache.manifest &&
    now - manifestCache.loadedAt < config.imageSync.manifestCacheTtlMs
  ) {
    return manifestCache.manifest;
  }

  manifestCache = {
    loadedAt: now,
    manifest: readImageSyncManifest(options),
  };

  return manifestCache.manifest;
}

function writeImageSyncManifest(manifest, options = {}) {
  const manifestPath = path.resolve(
    options.manifestPath || config.imageSync.manifestPath
  );
  const normalized = normalizeManifest(manifest);
  normalized.generatedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(normalized, null, 2) + "\n",
    "utf8"
  );

  manifestCache = {
    loadedAt: Date.now(),
    manifest: normalized,
  };

  return normalized;
}

function getImageSyncEntry(sourcePath, options = {}) {
  const key = createSourceKey(sourcePath);

  if (!key) {
    return null;
  }

  const manifest = loadCachedImageSyncManifest(options);
  return manifest.images[key] || null;
}

function getImageSyncUrl(sourcePath, options = {}) {
  const entry = getImageSyncEntry(sourcePath, options);
  return entry?.url || null;
}

module.exports = {
  EMPTY_MANIFEST,
  getImageSyncEntry,
  getImageSyncUrl,
  loadCachedImageSyncManifest,
  readImageSyncManifest,
  writeImageSyncManifest,
};
