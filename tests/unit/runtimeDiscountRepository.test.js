const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("writeDiscountRules preserves sale campaigns and granular targets", async () => {
  const originalLoad = Module._load;
  const insertedRules = [];

  class MockTransaction {
    async begin() {}
    async commit() {}
    async rollback() {}
  }

  class MockRequest {
    constructor() {
      this.inputs = {};
    }

    input(name, _type, value) {
      this.inputs[name] = value;
      return this;
    }

    async query(sqlText) {
      if (sqlText.includes("SELECT id, sort_order, rule_json")) {
        return { recordset: [] };
      }

      if (sqlText.includes("INSERT INTO dbo.Albero_Discount_Rules")) {
        insertedRules.push(JSON.parse(this.inputs.ruleJson));
      }

      return { recordset: [] };
    }
  }

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "../../src/db" || request === "../db") {
      return {
        getPool: async () => ({ request: () => new MockRequest() }),
        runQuery: async () => ({ recordset: [] }),
        sql: {
          NVarChar: () => "NVarChar",
          Int: "Int",
          Bit: "Bit",
          DateTime2: "DateTime2",
          MAX: "MAX",
          Transaction: MockTransaction,
          Request: MockRequest,
          ISOLATION_LEVEL: { SERIALIZABLE: "SERIALIZABLE" },
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve("../../src/repositories/runtimeDiscountRepository")];
    const { writeDiscountRules } = require("../../src/repositories/runtimeDiscountRepository");

    await writeDiscountRules([
      {
        id: "sale-rule",
        trigger: "sale-campaign",
        name: "Saldi DB",
        active: true,
        priority: 0,
        schedule: { startAt: null, endAt: null },
        target: {
          brands: ["PINKO"],
          categories: ["accessori"],
          subtypes: ["Borse"],
          productIds: ["mdl_1"],
          outletMode: "any",
        },
        effect: { percentOff: 0 },
      },
    ]);

    assert.equal(insertedRules.length, 1);
    assert.equal(insertedRules[0].trigger, "sale-campaign");
    assert.deepEqual(insertedRules[0].target.subtypes, ["Borse"]);
    assert.deepEqual(insertedRules[0].target.productIds, ["mdl_1"]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve("../../src/repositories/runtimeDiscountRepository")];
  }
});
