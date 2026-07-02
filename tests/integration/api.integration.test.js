const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../../src/app");
const { createHttpTestServer } = require("../helpers/httpTestServer");

const MULTI_VARIANT_PRODUCT_ID = "mdl_197582538";
const KNOWN_STOCK_SKU = "7G5015PX33101111TUMBL";

let testServer;

test.before(async () => {
  testServer = await createHttpTestServer(createApp());
});

test.after(async () => {
  await testServer.close();
});

test("GET /api/products supports storefront filters and pagination", async () => {
  const response = await fetch(
    `${testServer.baseUrl}/api/products?gender=uomo&category=calzature&brand=LIU%20JO%20SHOES&seasonCode=261&page=1&pageSize=5`
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.pagination.pageSize, 5);
  assert.ok(payload.items.length >= 1);

  for (const item of payload.items) {
    assert.equal(item.gender, "uomo");
    assert.equal(item.category, "calzature");
    assert.equal(item.brand, "LIU JO SHOES");
    assert.equal(item.seasonCode, "261");
  }
});

test("GET /api/products/:productId returns a grouped model with variants", async () => {
  const response = await fetch(
    `${testServer.baseUrl}/api/products/${encodeURIComponent(MULTI_VARIANT_PRODUCT_ID)}`
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.product.id, MULTI_VARIANT_PRODUCT_ID);
  assert.ok(payload.product.variants.length >= 2);
  assert.ok(payload.product.colors.length >= 2);
});

test("POST /api/stock/lookup returns exact size stock for a known variant SKU", async () => {
  const response = await fetch(`${testServer.baseUrl}/api/stock/lookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      skus: [KNOWN_STOCK_SKU],
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.stocks[KNOWN_STOCK_SKU].totalQty, 6);
  assert.deepEqual(payload.stocks[KNOWN_STOCK_SKU].sizeQty, {
    "40": 1,
    "41": 1,
    "42": 1,
    "43": 1,
    "44": 1,
    "45": 1,
  });
});

test("GET /api/catalog/facets returns aggregate filter data", async () => {
  const response = await fetch(`${testServer.baseUrl}/api/catalog/facets`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.brands.length > 0);
  assert.ok(payload.categories.length > 0);
  assert.ok(payload.seasons.length > 0);
  assert.ok(payload.availability.available >= 1);
});
