const test = require("node:test");
const assert = require("node:assert/strict");
const { assertPlaceInput } = require("../../src/repositories/inventoryReviewRepository");

function validInput(overrides = {}) {
  return {
    idempotencyKey: "request-1",
    productId: "mdl_123",
    sku: "ABC-BLUE",
    size: "M",
    sourceStoreId: 10,
    quantity: 1,
    reasonCode: "repair",
    actor: "admin",
    ...overrides,
  };
}

test("normalizes a valid review placement", () => {
  const value = assertPlaceInput(validInput({ sku: " abc-blue " }));
  assert.equal(value.modelId, 123);
  assert.equal(value.sku, "ABC-BLUE");
  assert.equal(value.quantity, 1);
});

test("requires notes for the other reason", () => {
  assert.throws(
    () => assertPlaceInput(validInput({ reasonCode: "other", notes: "" })),
    /notes are required/
  );
});

test("rejects non-positive and fractional quantities", () => {
  assert.throws(() => assertPlaceInput(validInput({ quantity: 0 })), /positive integer/);
  assert.throws(() => assertPlaceInput(validInput({ quantity: 1.5 })), /positive integer/);
});
