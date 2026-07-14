const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const sqlText = fs.readFileSync(
  path.resolve(__dirname, "../../sql/albero-stock-cache.sql"),
  "utf8"
);

test("stock cache refresh joins movements by stable numeric variant and size ids", () => {
  assert.match(sqlText, /m\.MM_ID_ARTICOLI = av\.VA_ID/);
  assert.match(sqlText, /eb\.BI_TR_ID = m\.MM_ID_TAGLIE_RIGHE/);
  assert.doesNotMatch(sqlText, /JOIN dbo\.BARCODE_ESISTENZA_RFID/);
});

test("stock cache refresh emits observable progress stages", () => {
  assert.match(sqlText, /Preparing store scope/);
  assert.match(sqlText, /Aggregating stock movements/);
  assert.match(sqlText, /Cache rows committed/);
  assert.match(sqlText, /WITH NOWAIT/);
});
