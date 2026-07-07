const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProductDetail, buildProductSummary, mapCatalogRowsToBaseCatalog } = require("../../src/lib/catalogMapper");

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

  base.RIFERIMENTO_0 = "\\\\SERVER\\Foto\\ABC123BLUE.JPG";

  return {
    ...base,
    ...overrides,
  };
}

test("groups multiple variants under one model product", () => {
  const rows = [
    makeRow({ VA_ID: 200, VA_CODICE: "BLUE", CR_DES: "Blu" }),
    makeRow({
      VA_ID: 201,
      VA_CODICE: "WHITE",
      CR_DES: "Bianco",
      RIFERIMENTO_0: "\\\\SERVER\\Foto\\ABC123WHITE.JPG",
    }),
  ];
  const catalog = mapCatalogRowsToBaseCatalog(rows);

  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.products[0].id, "mdl_100");
  assert.equal(catalog.products[0].variants.length, 2);
  assert.deepEqual(
    catalog.products[0].variants.map((variant) => variant.sku),
    ["ABC123BLUE", "ABC123WHITE"]
  );
});

test("adds MD_ID to slugs when MD_CODICE repeats across models", () => {
  const rows = [
    makeRow({ MD_ID: 100, VA_ID: 200, MD_CODICE: "REPEAT01" }),
    makeRow({ MD_ID: 101, VA_ID: 201, MD_CODICE: "REPEAT01", VA_CODICE: "BLACK" }),
  ];
  const catalog = mapCatalogRowsToBaseCatalog(rows);

  assert.equal(catalog.products.length, 2);
  assert.notEqual(catalog.products[0].slug, catalog.products[1].slug);
  assert.match(catalog.products[0].slug, /-100$/);
  assert.match(catalog.products[1].slug, /-101$/);
});

test("falls back to subtype and collection group when GS_DES is missing", () => {
  const rows = [
    makeRow({
      GS_DES: null,
      CG_DES: "MAGLIERIA",
      GR_DES: "Chemisere",
    }),
  ];
  const catalog = mapCatalogRowsToBaseCatalog(rows);

  assert.equal(catalog.products[0].category, "abbigliamento");
  assert.equal(catalog.products[0].subtype, "Chemisere");
});

test("cleans feature lines and marks zero stock as unavailable", () => {
  const rows = [makeRow()];
  const catalog = mapCatalogRowsToBaseCatalog(rows);
  const baseProduct = catalog.products[0];
  const zeroStock = new Map([[200, { totalQty: 0, sizeQty: {} }]]);
  const summary = buildProductSummary(baseProduct, zeroStock);
  const detail = buildProductDetail(baseProduct, zeroStock);

  assert.deepEqual(detail.featureLines, ["Camicia in cotone", "Slim fit"]);
  assert.equal(summary.availability, "unavailable");
  assert.equal(summary.totalStock, 0);
  assert.equal(detail.variants[0].availability, "unavailable");
});

test("uses DB sale pricing only when the row is part of a sale campaign", () => {
  const rows = [
    makeRow({
      VA_PREZZO_VEN: 199,
      LI_Prezzo_VEN_ITA: 199,
      LI_Prezzo_SAL_ITA: 99.5,
    }),
  ];
  const catalog = mapCatalogRowsToBaseCatalog(rows);
  const baseProduct = catalog.products[0];
  const stock = new Map([[200, { totalQty: 2, sizeQty: { M: 2 } }]]);
  const summary = buildProductSummary(baseProduct, stock);
  const detail = buildProductDetail(baseProduct, stock);

  assert.equal(baseProduct.price, 99.5);
  assert.equal(baseProduct.originalPrice, 199);
  assert.equal(baseProduct.saleCampaignActive, true);
  assert.equal(summary.price, 99.5);
  assert.equal(summary.originalPrice, 199);
  assert.equal(summary.saleCampaignActive, true);
  assert.equal(detail.variants[0].price, 99.5);
  assert.equal(detail.variants[0].originalPrice, 199);
  assert.equal(detail.variants[0].saleCampaignActive, true);
});

test("normalizes lowercase style names into cleaner storefront names", () => {
  const rows = [
    makeRow({
      DESCRIZIONE_BREVE_IT: "h reymond",
      DESCRIZIONE_BREVE: "h reymond",
      DESCRIZIONE_SPECIALE_IT: null,
      DESCRIZIONE_SPECIALE: null,
      MD_DES: null,
    }),
  ];
  const catalog = mapCatalogRowsToBaseCatalog(rows);

  assert.equal(catalog.products[0].name, "H-Reymond");
  assert.equal(catalog.products[0].descriptionShort, "H-Reymond");
});

test("prefers subtype plus style name when only a raw style name is available", () => {
  const rows = [
    makeRow({
      TI_DES: "BOSS",
      GR_DES: "Abito",
      MD_DES: "h reymond",
      DESCRIZIONE_BREVE_IT: null,
      DESCRIZIONE_BREVE: null,
      DESCRIZIONE_SPECIALE_IT: null,
      DESCRIZIONE_SPECIALE: "",
    }),
  ];
  const catalog = mapCatalogRowsToBaseCatalog(rows);

  assert.equal(catalog.products[0].name, "Abito H-Reymond");
  assert.equal(catalog.products[0].descriptionShort, "Abito H-Reymond");
});
