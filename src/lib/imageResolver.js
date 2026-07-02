const { getImageSyncUrl } = require("./imageSyncManifest");
const { normalizeSourcePath } = require("./imageSyncPaths");

const IMAGE_COLUMNS = Array.from({ length: 16 }, (_, index) => `RIFERIMENTO_${index}`);

function resolveImageUrl(sourcePath) {
  return getImageSyncUrl(sourcePath);
}

function resolveImageAssetsFromRow(row) {
  const images = [];

  for (const columnName of IMAGE_COLUMNS) {
    const sourcePath = normalizeSourcePath(row[columnName]);

    if (!sourcePath) {
      continue;
    }

    images.push({
      url: resolveImageUrl(sourcePath),
      sourcePath,
      position: images.length,
    });
  }

  return images;
}

function mergeUniqueImages(imageGroups) {
  const merged = [];
  const seen = new Set();

  for (const group of imageGroups) {
    for (const image of group) {
      const key = image.sourcePath.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push({
        url: image.url,
        sourcePath: image.sourcePath,
        position: merged.length,
      });
    }
  }

  return merged;
}

module.exports = {
  IMAGE_COLUMNS,
  mergeUniqueImages,
  normalizeSourcePath,
  resolveImageUrl,
  resolveImageAssetsFromRow,
};
