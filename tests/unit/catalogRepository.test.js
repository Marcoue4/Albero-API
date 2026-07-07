const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildActiveCatalogQuery,
  buildStoreScopeClause,
} = require("../../src/repositories/catalogRepository");

test("buildStoreScopeClause canonicalizes the configured store scope", () => {
  assert.equal(
    buildStoreScopeClause(["turati", "Corso Trieste", "MAZZINI UOMO"]),
    "ac.store_scope = N'TURATI,CORSO TRIESTE,MAZZINI UOMO'"
  );
});

test("buildActiveCatalogQuery scopes catalog rows through Albero_Stock_Cache by VA_ID", () => {
  const query = buildActiveCatalogQuery(["TURATI"]);

  assert.match(query, /FROM dbo\.Albero_Stock_Cache ac/);
  assert.match(query, /SELECT DISTINCT\s+ac\.VA_ID/);
  assert.match(query, /SELECT\s+a\.MD_ID,\s+a\.VA_ID,/);
  assert.match(query, /ON sv\.VA_ID = a\.VA_ID/);
  assert.doesNotMatch(query, /BARCODE_ESISTENZA_RFID/);
});
