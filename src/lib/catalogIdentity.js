function normalizeCode(value) {
  return String(value || "").trim();
}

function buildProductId(modelId) {
  return `mdl_${String(modelId).trim()}`;
}

function buildVariantId(variantId) {
  return `var_${String(variantId).trim()}`;
}

function parseProductId(productId) {
  const match = String(productId || "").trim().match(/^mdl_(-?\d+)$/i);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildProductSlug(brand, modelCode, modelId) {
  const base = slugify([brand, modelCode].filter(Boolean).join("-")) || "product";
  return `${base}-${String(modelId).trim()}`;
}

function buildVariantSku(modelCode, variantCode) {
  return `${normalizeCode(modelCode)}${normalizeCode(variantCode)}`;
}

module.exports = {
  buildProductId,
  buildProductSlug,
  buildVariantId,
  buildVariantSku,
  normalizeCode,
  parseProductId,
  slugify,
};
