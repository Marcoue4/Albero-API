process.env.ALBERO_API_RUNTIME_SECRET = "test-runtime-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../../src/app");
const { createHttpTestServer } = require("../helpers/httpTestServer");

function makeRepository(overrides = {}) {
  return {
    async readDiscountRules() {
      return {
        rules: [],
        revision: "empty",
        updatedAt: "2026-07-04T10:00:00.000Z",
      };
    },
    async writeDiscountRules(rules) {
      return {
        rules,
        revision: "next-rev",
        updatedAt: "2026-07-04T10:00:00.000Z",
      };
    },
    async readCouponRedemptions() {
      return [];
    },
    async getCouponUsageCounts() {
      return {};
    },
    async recordCouponRedemption(input) {
      return {
        id: "coupon-redemption-1",
        ruleId: input.ruleId,
        code: String(input.code || "").toUpperCase(),
        orderId: input.orderId,
        redeemedAt: "2026-07-04T10:00:00.000Z",
        amount: Number(input.amount) || 0,
        customerEmail: input.customerEmail || null,
        userId: input.userId || null,
      };
    },
    async getRuntimeDiscountHealth() {
      return {
        storage: "sql-server",
        ruleCount: 0,
        redemptionCount: 0,
        rulesRevision: "empty",
        rulesUpdatedAt: "2026-07-04T10:00:00.000Z",
      };
    },
    ...overrides,
  };
}

test("runtime discount routes require the shared secret", async () => {
  const server = await createHttpTestServer(
    createApp({ runtimeDiscountRepository: makeRepository() })
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/discounts/rules`);
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test("GET /api/runtime/discounts/rules returns the repository document", async () => {
  const server = await createHttpTestServer(
    createApp({
      runtimeDiscountRepository: makeRepository({
        async readDiscountRules() {
          return {
            rules: [{ id: "outlet-50", name: "Outlet", trigger: "automatic" }],
            revision: "rev-1",
            updatedAt: "2026-07-04T10:00:00.000Z",
          };
        },
      }),
    })
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/discounts/rules`, {
      headers: { "x-albero-runtime-secret": "test-runtime-secret" },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.revision, "rev-1");
    assert.equal(payload.rules[0].id, "outlet-50");
  } finally {
    await server.close();
  }
});

test("PUT /api/runtime/discounts/rules maps revision conflicts to 409", async () => {
  const server = await createHttpTestServer(
    createApp({
      runtimeDiscountRepository: makeRepository({
        async writeDiscountRules() {
          const error = new Error("DISCOUNT_RULES_REVISION_CONFLICT");
          error.code = "DISCOUNT_RULES_REVISION_CONFLICT";
          error.currentRevision = "current-rev";
          throw error;
        },
      }),
    })
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/discounts/rules`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-albero-runtime-secret": "test-runtime-secret",
      },
      body: JSON.stringify({ rules: [], expectedRevision: "stale" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.currentRevision, "current-rev");
  } finally {
    await server.close();
  }
});

test("POST /api/runtime/discounts/coupon-redemptions records idempotent usage", async () => {
  const server = await createHttpTestServer(
    createApp({ runtimeDiscountRepository: makeRepository() })
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/discounts/coupon-redemptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-albero-runtime-secret": "test-runtime-secret",
      },
      body: JSON.stringify({
        ruleId: "coupon-1",
        code: "save10",
        orderId: "ORD-1",
        amount: 10,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.record.code, "SAVE10");
    assert.equal(payload.record.ruleId, "coupon-1");
  } finally {
    await server.close();
  }
});
