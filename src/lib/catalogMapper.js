const { buildProductId, buildProductSlug, buildVariantId, buildVariantSku, normalizeCode } = require("./catalogIdentity");
const { colorToHex, normalizeColorName } = require("./colorUtils");
const { cleanText, splitFeatureLines } = require("./htmlCleaner");
const { mergeUniqueImages, resolveImageAssetsFromRow } = require("./imageResolver");
const { inferCategorySubtype, normalizeGender } = require("./taxonomy");

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function pickFirstValue(rows, selectors) {
  for (const row of rows) {
    for (const selector of selectors) {
      const cleaned = cleanText(row[selector]);

      if (cleaned) {
        return cleaned;
      }
    }
  }

  return null;
}

function pickFirstFeatureLines(rows, selectors) {
  for (const row of rows) {
    for (const selector of selectors) {
      const lines = splitFeatureLines(row[selector]);

      if (lines.length) {
        return lines;
      }
    }
  }

  return [];
}

function pickFirstValueWithSource(rows, selectors) {
  for (const row of rows) {
    for (const selector of selectors) {
      const cleaned = cleanText(row[selector]);

      if (cleaned) {
        return {
          value: cleaned,
          source: selector,
        };
      }
    }
  }

  return {
    value: null,
    source: null,
  };
}

function toTitleCaseSegment(value) {
  return String(value || "")
    .split(/([\s\-\/]+)/)
    .map((part) => {
      if (!part || /^[\s\-\/]+$/.test(part)) {
        return part;
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

function normalizeDisplayName(value) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return null;
  }

  const compact = cleaned.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  if (compact !== compact.toLowerCase()) {
    return compact;
  }

  const styleNameMatch = compact.match(/^([a-z])\s+([a-z0-9].*)$/);
  if (styleNameMatch) {
    return `${styleNameMatch[1].toUpperCase()}-${toTitleCaseSegment(styleNameMatch[2])}`;
  }

  return toTitleCaseSegment(compact);
}

function looksLikeRawStyleName(value) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return false;
  }

  const compact = cleaned.replace(/\s+/g, " ").trim();
  const tokenCount = compact.split(" ").filter(Boolean).length;

  if (compact !== compact.toLowerCase()) {
    return false;
  }

  if (compact.length <= 2 || tokenCount > 4) {
    return false;
  }

  return /^[a-z0-9][a-z0-9\s\-'/]+$/i.test(compact);
}

function buildFallbackCatalogName(groupDescription, brand) {
  const normalizedGroup = cleanText(groupDescription);
  const normalizedBrand = cleanText(brand);

  if (normalizedGroup && normalizedBrand) {
    return `${normalizedGroup} ${normalizedBrand}`;
  }

  return normalizedGroup || normalizedBrand || null;
}

function minPositivePrice(values) {
  const positives = values.filter((value) => Number.isFinite(value) && value > 0);
  return positives.length ? Math.min(...positives) : 0;
}

function buildProductSizes(variants) {
  const sizes = [];
  const seen = new Set();

  for (const variant of variants) {
    for (const size of Object.keys(variant.sizeStock || {})) {
      const normalized = String(size || "").trim();

      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      sizes.push(normalized);
    }
  }

  return sizes;
}

function compareSeasonCodesDesc(left, right) {
  const leftInt = Number.parseInt(left, 10);
  const rightInt = Number.parseInt(right, 10);

  if (Number.isFinite(leftInt) && Number.isFinite(rightInt) && leftInt !== rightInt) {
    return rightInt - leftInt;
  }

  return String(right).localeCompare(String(left));
}

function buildVariantBase(row) {
  const modelCode = normalizeCode(row.MD_CODICE);
  const variantCode = normalizeCode(row.VA_CODICE);
  const colorName =
    cleanText(row.CR_DES) ||
    cleanText(row.COLORE_VERO) ||
    variantCode ||
    "Variante";
  const images = resolveImageAssetsFromRow(row);

  return {
    id: buildVariantId(row.VA_ID),
    variantId: Number(row.VA_ID),
    sku: buildVariantSku(modelCode, variantCode),
    modelCode,
    variantCode,
    color: {
      name: normalizeColorName(colorName),
      hex: colorToHex(colorName),
    },
    images,
    price: toNumber(row.VA_PREZZO_VEN, 0),
  };
}

function buildBaseProduct(rows) {
  const firstRow = rows[0];
  const modelId = Number(firstRow.MD_ID);
  const brand = cleanText(firstRow.TI_DES) || "Brand sconosciuto";
  const pickedName = pickFirstValueWithSource(rows, [
      "DESCRIZIONE_BREVE_IT",
      "DESCRIZIONE_BREVE",
      "DESCRIZIONE_SPECIALE_IT",
      "DESCRIZIONE_SPECIALE",
      "MD_DES",
      "GR_DES",
    ]);
  const rawName = pickedName.value || `Articolo ${modelId}`;
  const fallbackCatalogName = buildFallbackCatalogName(firstRow.GR_DES, brand);
  const shouldPreferFallbackCatalogName =
    pickedName.source === "MD_DES" &&
    looksLikeRawStyleName(rawName) &&
    Boolean(fallbackCatalogName);
  const name =
    (shouldPreferFallbackCatalogName
      ? normalizeDisplayName(fallbackCatalogName)
      : normalizeDisplayName(rawName)) || `Articolo ${modelId}`;
  const descriptionShort = name;
  const featureLines = pickFirstFeatureLines(rows, ["SIZE_AND_FIT_IT", "SIZE_AND_FIT"]);
  const { category, subtype, subtypeKey } = inferCategorySubtype(
    firstRow.GS_DES,
    firstRow.GR_DES,
    firstRow.CG_DES
  );
  const variants = rows.map(buildVariantBase);
  const images = mergeUniqueImages(variants.map((variant) => variant.images));
  const seasonCode = cleanText(firstRow.ST_SIGLA) || null;
  const seasonLabel = cleanText(firstRow.ST_DES) || null;
  const modelCode = normalizeCode(firstRow.MD_CODICE);
  const product = {
    id: buildProductId(modelId),
    modelId,
    slug: buildProductSlug(brand, modelCode, modelId),
    name,
    brand,
    gender: normalizeGender(firstRow.SR_DES),
    category,
    subtype: subtype || cleanText(firstRow.GR_DES) || null,
    subtypeKey: subtypeKey || null,
    seasonCode,
    seasonLabel,
    descriptionShort,
    featureLines,
    images,
    image: images[0]?.url ?? null,
    price: minPositivePrice(variants.map((variant) => variant.price)),
    variants,
  };

  product.searchText = [
    product.name,
    product.brand,
    product.gender,
    product.category,
    product.subtype,
    product.seasonCode,
    product.seasonLabel,
    ...product.variants.flatMap((variant) => [variant.sku, variant.color.name]),
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return product;
}

function mapCatalogRowsToBaseCatalog(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = String(row.MD_ID);
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }

  const products = [...groups.values()]
    .map(buildBaseProduct)
    .sort((left, right) => {
      const seasonCompare = compareSeasonCodesDesc(left.seasonCode || "", right.seasonCode || "");

      if (seasonCompare !== 0) {
        return seasonCompare;
      }

      return left.name.localeCompare(right.name, "it");
    });

  const productById = new Map();
  const variantBySku = new Map();

  for (const product of products) {
    productById.set(product.id, product);

    for (const variant of product.variants) {
      variantBySku.set(variant.sku.toUpperCase(), {
        productId: product.id,
        modelId: product.modelId,
        variantId: variant.variantId,
        sku: variant.sku,
      });
    }
  }

  return {
    products,
    productById,
    variantBySku,
  };
}

function availabilityFromQty(totalQty) {
  return totalQty > 0 ? "available" : "unavailable";
}

function mergeVariantStock(variant, stock) {
  const totalQty = stock?.totalQty ?? 0;
  const sizeStock = stock?.sizeQty ?? {};

  return {
    id: variant.id,
    sku: variant.sku,
    color: {
      name: variant.color.name,
      hex: variant.color.hex,
    },
    images: variant.images,
    price: variant.price,
    totalStock: totalQty,
    sizeStock,
    availability: availabilityFromQty(totalQty),
  };
}

function buildProductSummary(product, stockByVariantId) {
  const variants = product.variants.map((variant) =>
    mergeVariantStock(variant, stockByVariantId.get(variant.variantId))
  );
  const totalStock = variants.reduce((sum, variant) => sum + variant.totalStock, 0);
  const sizes = buildProductSizes(variants);
  const primaryVariant = variants.find((variant) => variant.sku) || variants[0] || null;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    gender: product.gender,
    category: product.category,
    subtype: product.subtype,
    seasonCode: product.seasonCode,
    seasonLabel: product.seasonLabel,
    sku: primaryVariant?.sku || null,
    price: product.price,
    image: product.image,
    descriptionShort: product.descriptionShort,
    sizes,
    colors: variants.map((variant) => ({
      name: variant.color.name,
      hex: variant.color.hex,
      sku: variant.sku,
      image: variant.images[0]?.url ?? null,
      price: variant.price,
      totalStock: variant.totalStock,
      availability: variant.availability,
    })),
    totalStock,
    availability: availabilityFromQty(totalStock),
  };
}

function buildProductDetail(product, stockByVariantId) {
  const summary = buildProductSummary(product, stockByVariantId);
  const variants = product.variants.map((variant) =>
    mergeVariantStock(variant, stockByVariantId.get(variant.variantId))
  );

  return {
    ...summary,
    descriptionShort: product.descriptionShort,
    featureLines: product.featureLines,
    images: product.images,
    variants,
  };
}

module.exports = {
  availabilityFromQty,
  buildProductDetail,
  buildProductSummary,
  mapCatalogRowsToBaseCatalog,
};
