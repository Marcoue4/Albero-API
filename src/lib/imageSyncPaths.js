const crypto = require("node:crypto");
const path = require("node:path");

function normalizeSourcePath(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return null;
  }

  return path.win32.normalize(trimmed.replace(/\//g, "\\"));
}

function stripTrailingSeparators(value) {
  let normalized = normalizeSourcePath(value);

  if (!normalized) {
    return null;
  }

  while (normalized.length > 3 && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function createSourceKey(value) {
  const normalized = normalizeSourcePath(value);
  return normalized ? normalized.toLowerCase() : null;
}

function startsWithWindowsPath(candidate, prefix) {
  const normalizedCandidate = stripTrailingSeparators(candidate);
  const normalizedPrefix = stripTrailingSeparators(prefix);

  if (!normalizedCandidate || !normalizedPrefix) {
    return false;
  }

  const lowerCandidate = normalizedCandidate.toLowerCase();
  const lowerPrefix = normalizedPrefix.toLowerCase();

  return (
    lowerCandidate === lowerPrefix ||
    lowerCandidate.startsWith(`${lowerPrefix}\\`)
  );
}

function getRelativeSourcePath(sourcePath, sourceRoot) {
  const normalizedSource = stripTrailingSeparators(sourcePath);
  const normalizedRoot = stripTrailingSeparators(sourceRoot);

  if (!normalizedSource || !normalizedRoot) {
    return null;
  }

  if (!startsWithWindowsPath(normalizedSource, normalizedRoot)) {
    return null;
  }

  const relative = path.win32.relative(normalizedRoot, normalizedSource);
  return relative || path.win32.basename(normalizedSource);
}

function resolveLocalSourcePath(sourcePath, options = {}) {
  const normalizedSource = normalizeSourcePath(sourcePath);
  const normalizedDbRoot = normalizeSourcePath(options.sourceDbRoot);
  const normalizedLocalRoot =
    normalizeSourcePath(options.sourceLocalRoot) || normalizedDbRoot;

  if (!normalizedSource) {
    return null;
  }

  if (
    normalizedDbRoot &&
    normalizedLocalRoot &&
    startsWithWindowsPath(normalizedSource, normalizedDbRoot)
  ) {
    const relative = path.win32.relative(normalizedDbRoot, normalizedSource);
    return path.win32.join(normalizedLocalRoot, relative);
  }

  return normalizedSource;
}

function slugifyPathPart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeFilename(filename) {
  const ext = path.win32.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const stem = path.win32.basename(filename, path.win32.extname(filename));
  const safeStem = slugifyPathPart(stem) || "image";
  return `${safeStem}${ext}`;
}

function hashShort(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function buildBlobPathname(sourcePath, options = {}) {
  const normalizedSource = normalizeSourcePath(sourcePath);
  const prefix = slugifyPathPart(options.prefix || "catalog") || "catalog";

  if (!normalizedSource) {
    return `${prefix}/missing-source-path`;
  }

  const relative = getRelativeSourcePath(normalizedSource, options.sourceRoot);
  let segments;

  if (relative) {
    segments = relative.split(/[\\/]+/).filter(Boolean);
  } else {
    segments = [
      "unmapped",
      `${hashShort(normalizedSource)}-${path.win32.basename(normalizedSource)}`,
    ];
  }

  const safeSegments = segments.map((segment, index) => {
    const isLast = index === segments.length - 1;

    if (isLast) {
      return sanitizeFilename(segment);
    }

    return slugifyPathPart(segment) || `segment-${index + 1}`;
  });

  return [prefix, ...safeSegments].join("/");
}

module.exports = {
  buildBlobPathname,
  createSourceKey,
  getRelativeSourcePath,
  normalizeSourcePath,
  resolveLocalSourcePath,
};
