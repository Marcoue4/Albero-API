process.env.ALBERO_API_RUNTIME_SECRET = "review-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../../src/app");
const { createHttpTestServer } = require("../helpers/httpTestServer");

function catalogService() {
  return {
    clearCache() {},
    async listProducts() { return { items: [], pagination: {} }; },
    async getProductDetail() { return null; },
    async lookupStock() { return {}; },
    async getCatalogFacets() { return {}; },
  };
}

function reviewRepository(overrides = {}) {
  return {
    async listItems() { return []; },
    async getProductStock() { return []; },
    async placeItem(input) { return { id: "review-1", status: "in_review", ...input }; },
    async resolveItem(id, input) { return { id, status: input.resolution === "restore" ? "restored" : "removed" }; },
    ...overrides,
  };
}

async function withServer(repository, work) {
  const server = await createHttpTestServer(createApp({
    catalogService: catalogService(),
    inventoryReviewRepository: repository,
  }));
  try { await work(server.baseUrl); } finally { await server.close(); }
}

test("inventory review routes require the runtime secret", async () => {
  await withServer(reviewRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/runtime/inventory-review/items`);
    assert.equal(response.status, 401);
  });
});

test("inventory review stock and item routes return repository payloads", async () => {
  await withServer(reviewRepository({
    async getProductStock(productId) {
      return [{ productId, sku: "SKU1", size: "M", quantity: 1 }];
    },
  }), async (baseUrl) => {
    const headers = { "x-albero-runtime-secret": "review-test-secret" };
    const stock = await fetch(`${baseUrl}/api/runtime/inventory-review/stock?productId=mdl_1`, { headers });
    assert.equal(stock.status, 200);
    assert.equal((await stock.json()).stock[0].sku, "SKU1");

    const placed = await fetch(`${baseUrl}/api/runtime/inventory-review/items`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ productId: "mdl_1" }),
    });
    assert.equal(placed.status, 201);
    assert.equal((await placed.json()).item.status, "in_review");
  });
});

test("inventory review state conflicts map to 409", async () => {
  await withServer(reviewRepository({
    async resolveItem() {
      const error = new Error("INVENTORY_REVIEW_STATE_CONFLICT");
      error.code = "INVENTORY_REVIEW_STATE_CONFLICT";
      throw error;
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/runtime/inventory-review/items/review-1/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-albero-runtime-secret": "review-test-secret",
      },
      body: JSON.stringify({ resolution: "restore" }),
    });
    assert.equal(response.status, 409);
  });
});
