const test = require("node:test");
const assert = require("node:assert/strict");

const { createCatalogService } = require("../../src/services/catalogService");

function makeRow(overrides = {}) {
  const base = {
    MD_ID: 100,
    VA_ID: 200,
    MD_CODICE: "ABC123",
    VA_CODICE: "BLUE",
    SR_DES: "DONNA",
    GS_DES: "Abbigliamento",
    CG_DES: "MAGLIERIA",
    GR_DES: "Camicia",
    TI_DES: "MONDE",
    ST_SIGLA: "261",
    ST_DES: "Primavera estate 2026",
    CR_DES: "Blu",
    COLORE_VERO: null,
    MD_DES: "",
    DESCRIZIONE_BREVE_IT: "Camicia slim fit",
    DESCRIZIONE_BREVE: "Camicia slim fit",
    DESCRIZIONE_SPECIALE_IT: "CAMICIA SLIM FIT",
    DESCRIZIONE_SPECIALE: "CAMICIA SLIM FIT",
    SIZE_AND_FIT_IT: "&nbsp;<BR/>Camicia in cotone<BR/>Slim fit<BR/>",
    SIZE_AND_FIT: null,
    VA_PREZZO_VEN: 199,
  };

  for (let index = 0; index < 16; index += 1) {
    base[`RIFERIMENTO_${index}`] = null;
  }

  return {
    ...base,
    ...overrides,
  };
}

test("listProducts hides current-season products with zero allowed stock", async () => {
  const service = createCatalogService({
    getActiveCatalogRows: async () => [makeRow()],
    getActiveVariantTotals: async () => new Map(),
    getVariantStockByIds: async () => new Map(),
  });

  const result = await service.listProducts({});

  assert.equal(result.items.length, 0);
  assert.equal(result.pagination.totalItems, 0);
});

test("getProductDetail returns not found for zero-stock products", async () => {
  const service = createCatalogService({
    getActiveCatalogRows: async () => [makeRow()],
    getActiveVariantTotals: async () => new Map(),
    getVariantStockByIds: async () => new Map(),
  });

  await assert.rejects(
    service.getProductDetail("mdl_100"),
    /Product not found: mdl_100/
  );
});

test("listProducts still returns allowed-store products with positive stock", async () => {
  const stockMap = new Map([[200, { totalQty: 2, sizeQty: { M: 2 } }]]);
  const service = createCatalogService({
    getActiveCatalogRows: async () => [makeRow()],
    getActiveVariantTotals: async () => stockMap,
    getVariantStockByIds: async () => stockMap,
  });

  const result = await service.listProducts({});

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].availability, "available");
  assert.equal(result.items[0].totalStock, 2);
});
