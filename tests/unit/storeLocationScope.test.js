const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_STOREFRONT_ALLOWED_STORE_NAMES,
  buildStoreLocationPredicateSql,
  formatStoreLocationScopeValue,
  parseAllowedStoreNames,
} = require("../../src/lib/storeLocationScope");

test("parseAllowedStoreNames falls back to the five storefront stores", () => {
  assert.deepEqual(parseAllowedStoreNames(""), [
    ...DEFAULT_STOREFRONT_ALLOWED_STORE_NAMES,
  ]);
});

test("parseAllowedStoreNames normalizes casing, spacing, and duplicates", () => {
  assert.deepEqual(
    parseAllowedStoreNames(" turati, Corso   Trieste, TURATI , mazzini uomo "),
    ["TURATI", "CORSO TRIESTE", "MAZZINI UOMO"]
  );
});

test("formatStoreLocationScopeValue produces a canonical cache scope key", () => {
  assert.equal(
    formatStoreLocationScopeValue(" turati, Corso   Trieste, TURATI , mazzini uomo "),
    "TURATI,CORSO TRIESTE,MAZZINI UOMO"
  );
});

test("buildStoreLocationPredicateSql quotes store names safely", () => {
  assert.equal(
    buildStoreLocationPredicateSql("r.NE_DES", ["Turati", "O'Neil"]),
    "UPPER(LTRIM(RTRIM(r.NE_DES))) IN (N'TURATI', N'O''NEIL')"
  );
});
