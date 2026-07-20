process.env.ALBERO_API_RUNTIME_SECRET = "test-runtime-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../../src/app");
const { createHttpTestServer } = require("../helpers/httpTestServer");

function makeOrder(id = "ORD-20260720-ABC12345") {
  return {
    id,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    status: "received",
    paymentIntentId: "pi_123",
    paymentStatus: "succeeded",
    customer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    shippingAddress: {
      line1: "Via Roma 1",
      city: "Roma",
      postalCode: "00100",
      province: "RM",
      country: "IT",
    },
    totals: {
      subtotal: 100,
      discount: 0,
      shipping: 0,
      shippingDiscount: 0,
      islandSurcharge: 0,
      total: 100,
      currency: "EUR",
    },
    appliedDiscounts: [],
    coupon: null,
    items: [],
  };
}

function makeRepository(overrides = {}) {
  return {
    async listOrders() { return [makeOrder()]; },
    async createOrder() { return { order: makeOrder(), created: true }; },
    async getOrderById(id) { return makeOrder(id); },
    async updateOrderStatus(id, status) { return { ...makeOrder(id), status }; },
    async deleteOrder() { return true; },
    ...overrides,
  };
}

test("runtime order routes require the shared secret", async () => {
  const server = await createHttpTestServer(createApp({ orderRepository: makeRepository() }));
  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/orders`);
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test("POST /api/runtime/orders reports idempotent existing orders", async () => {
  const server = await createHttpTestServer(createApp({
    orderRepository: makeRepository({
      async createOrder() { return { order: makeOrder(), created: false }; },
    }),
  }));
  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-albero-runtime-secret": "test-runtime-secret",
      },
      body: JSON.stringify(makeOrder()),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.created, false);
    assert.equal(payload.order.paymentIntentId, "pi_123");
  } finally {
    await server.close();
  }
});

test("PATCH /api/runtime/orders/:id validates and updates status", async () => {
  const server = await createHttpTestServer(createApp({ orderRepository: makeRepository() }));
  try {
    const invalid = await fetch(`${server.baseUrl}/api/runtime/orders/ORD-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-albero-runtime-secret": "test-runtime-secret",
      },
      body: JSON.stringify({ status: "unknown" }),
    });
    assert.equal(invalid.status, 400);

    const response = await fetch(`${server.baseUrl}/api/runtime/orders/ORD-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-albero-runtime-secret": "test-runtime-secret",
      },
      body: JSON.stringify({ status: "completed" }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.order.status, "completed");
  } finally {
    await server.close();
  }
});
