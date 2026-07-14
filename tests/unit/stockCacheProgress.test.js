const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatDuration,
  parsePositiveInteger,
} = require("../../src/lib/stockCacheProgress");

test("parsePositiveInteger accepts only positive whole numbers", () => {
  assert.equal(parsePositiveInteger("15000", 10000), 15000);
  assert.equal(parsePositiveInteger("0", 10000), 10000);
  assert.equal(parsePositiveInteger("1.5", 10000), 10000);
  assert.equal(parsePositiveInteger("invalid", 10000), 10000);
});

test("formatDuration formats seconds and minutes", () => {
  assert.equal(formatDuration(999), "0s");
  assert.equal(formatDuration(15000), "15s");
  assert.equal(formatDuration(125000), "2m 5s");
  assert.equal(formatDuration(-1), "0s");
});
