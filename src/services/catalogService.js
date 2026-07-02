const config = require("../config");
const { HttpError } = require("../errors/httpError");
const { buildProductDetail, buildProductSummary, mapCatalogRowsToBaseCatalog } = require("../lib/catalogMapper");
const { getActiveCatalogRows } = require("../repositories/catalogRepository");
const { getActiveVariantTotals, getVariantStockByIds } = require("../repositories/stockRepository");

function normalizeFilterList(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function compareSeasonCodes(left, right, direction = "desc") {
  const leftInt = Number.parseInt(left || "", 10);
  const rightInt = Number.parseInt(right || "", 10);

  if (Number.isFinite(leftInt) && Number.isFinite(rightInt) && leftInt !== rightInt) {
    return direction === "asc" ? leftInt - rightInt : rightInt - leftInt;
  }

  return direction === "asc"
    ? String(left || "").localeCompare(String(right || ""), "it")
    : String(right || "").localeCompare(String(left || ""), "it");
}

function sortProducts(products, sort) {
  const sorted = [...products];

  switch (sort) {
    case "name-asc":
      sorted.sort((left, right) => left.summary.name.localeCompare(right.summary.name, "it"));
      break;
    case "name-desc":
      sorted.sort((left, right) => right.summary.name.localeCompare(left.summary.name, "it"));
      break;
    case "price-asc":
      sorted.sort((left, right) => left.summary.price - right.summary.price || left.summary.name.localeCompare(right.summary.name, "it"));
      break;
    case "price-desc":
      sorted.sort((left, right) => right.summary.price - left.summary.price || left.summary.name.localeCompare(right.summary.name, "it"));
      break;
    case "season-asc":
      sorted.sort((left, right) => compareSeasonCodes(left.summary.seasonCode, right.summary.seasonCode, "asc"));
      break;
    case "season-desc":
    default:
      sorted.sort((left, right) => compareSeasonCodes(left.summary.seasonCode, right.summary.seasonCode, "desc"));
      break;
  }

  return sorted;
}

function filterLiveProducts(liveProducts, filters) {
  const ids = new Set(normalizeFilterList(filters.ids));
  const genders = new Set(normalizeFilterList(filters.genders).map((value) => value.toLowerCase()));
  const categories = new Set(normalizeFilterList(filters.categories).map((value) => value.toLowerCase()));
  const brands = new Set(normalizeFilterList(filters.brands).map((value) => value.toLowerCase()));
  const seasonCodes = new Set(normalizeFilterList(filters.seasonCodes).map((value) => value.toUpperCase()));
  const availability = String(filters.availability || "all").toLowerCase();
  const query = normalizeSearchText(filters.q);

  return liveProducts.filter(({ base, summary }) => {
    if (ids.size && !ids.has(summary.id)) {
      return false;
    }

    if (genders.size && !genders.has(summary.gender.toLowerCase())) {
      return false;
    }

    if (categories.size && !categories.has(summary.category.toLowerCase())) {
      return false;
    }

    if (brands.size && !brands.has(summary.brand.toLowerCase())) {
      return false;
    }

    if (seasonCodes.size && !seasonCodes.has(String(summary.seasonCode || "").toUpperCase())) {
      return false;
    }

    if (availability === "available" && summary.availability !== "available") {
      return false;
    }

    if (availability === "unavailable" && summary.availability !== "unavailable") {
      return false;
    }

    if (query && !base.searchText.includes(query)) {
      return false;
    }

    return true;
  });
}

function paginate(items, page, pageSize) {
  const totalItems = items.length;
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const pagedItems = items.slice(start, start + pageSize);

  return {
    items: pagedItems,
    pagination: {
      page: safePage,
      pageSize,
      totalItems,
      totalPages,
    },
  };
}

function buildFacetEntries(items, selector, labelSelector) {
  const counts = new Map();

  for (const item of items) {
    const value = selector(item);

    if (!value) {
      continue;
    }

    const key = String(value);
    const current = counts.get(key) || {
      value: key,
      label: labelSelector ? labelSelector(item) : key,
      count: 0,
    };

    current.count += 1;
    counts.set(key, current);
  }

  return [...counts.values()].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.label.localeCompare(right.label, "it");
  });
}

function createCatalogService() {
  const cache = {
    baseCatalog: null,
    expiresAt: 0,
  };

  async function getBaseCatalog() {
    const now = Date.now();

    if (cache.baseCatalog && now < cache.expiresAt) {
      return cache.baseCatalog;
    }

    const rows = await getActiveCatalogRows();
    const baseCatalog = mapCatalogRowsToBaseCatalog(rows);

    cache.baseCatalog = baseCatalog;
    cache.expiresAt = now + config.catalogCacheTtlMs;

    return baseCatalog;
  }

  async function getLiveProducts() {
    const [baseCatalog, liveStock] = await Promise.all([
      getBaseCatalog(),
      getActiveVariantTotals(),
    ]);

    return baseCatalog.products.map((product) => ({
      base: product,
      summary: buildProductSummary(product, liveStock),
    }));
  }

  return {
    async listProducts(filters) {
      const requestedPage = Number.parseInt(filters.page, 10);
      const requestedPageSize = Number.parseInt(filters.pageSize, 10);
      const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const pageSize = Math.min(
        Math.max(Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : config.defaultPageSize, 1),
        config.maxPageSize
      );

      const liveProducts = await getLiveProducts();
      const filtered = filterLiveProducts(liveProducts, filters);
      const sorted = sortProducts(filtered, filters.sort);
      const paginated = paginate(sorted, page, pageSize);

      return {
        items: paginated.items.map((entry) => entry.summary),
        pagination: paginated.pagination,
      };
    },

    async getProductDetail(productId) {
      const baseCatalog = await getBaseCatalog();
      const product = baseCatalog.productById.get(String(productId || "").trim());

      if (!product) {
        throw HttpError.notFound(`Product not found: ${productId}`);
      }

      const stockByVariantId = await getVariantStockByIds(
        product.variants.map((variant) => variant.variantId)
      );

      return buildProductDetail(product, stockByVariantId);
    },

    async lookupStock(skus) {
      const normalizedSkus = normalizeFilterList(skus).map((sku) => sku.toUpperCase());

      if (!normalizedSkus.length) {
        return {};
      }

      if (normalizedSkus.length > config.maxStockLookupSkus) {
        throw HttpError.badRequest(
          `Too many SKUs requested. Maximum allowed is ${config.maxStockLookupSkus}.`
        );
      }

      const baseCatalog = await getBaseCatalog();
      const variantRefs = normalizedSkus
        .map((sku) => baseCatalog.variantBySku.get(sku))
        .filter(Boolean);
      const uniqueVariantIds = [...new Set(variantRefs.map((entry) => entry.variantId))];
      const stockByVariantId = await getVariantStockByIds(uniqueVariantIds);
      const response = {};

      for (const variantRef of variantRefs) {
        const stock = stockByVariantId.get(variantRef.variantId) || {
          totalQty: 0,
          sizeQty: {},
        };
        response[variantRef.sku] = stock;
      }

      return response;
    },

    async getCatalogFacets() {
      const liveProducts = await getLiveProducts();
      const summaries = liveProducts.map((entry) => entry.summary);

      return {
        brands: buildFacetEntries(summaries, (item) => item.brand),
        categories: buildFacetEntries(summaries, (item) => item.category),
        subtypes: buildFacetEntries(
          summaries.filter((item) => item.subtype),
          (item) => item.subtype,
          (item) => item.subtype
        ),
        seasons: buildFacetEntries(
          summaries.filter((item) => item.seasonCode),
          (item) => item.seasonCode,
          (item) => item.seasonLabel || item.seasonCode
        ),
        availability: {
          all: summaries.length,
          available: summaries.filter((item) => item.availability === "available").length,
          unavailable: summaries.filter((item) => item.availability === "unavailable").length,
        },
      };
    },

    clearCache() {
      cache.baseCatalog = null;
      cache.expiresAt = 0;
    },
  };
}

module.exports = {
  createCatalogService,
};
