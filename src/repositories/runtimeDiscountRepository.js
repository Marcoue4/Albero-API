const { createHash, randomUUID } = require("node:crypto");
const { getPool, runQuery, sql } = require("../db");

const DISCOUNT_RULES_LOCK_RESOURCE = "albero-discount-rules";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeDateString(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeTrigger(value) {
  return value === "coupon" ? "coupon" : "automatic";
}

function normalizeAudience(value) {
  if (
    value === "authenticated" ||
    value === "verified" ||
    value === "newsletter-subscribed"
  ) {
    return value;
  }
  return "all";
}

function normalizeOutletMode(value) {
  if (value === "only" || value === "exclude") return value;
  return "any";
}

function normalizeCategories(value) {
  if (!Array.isArray(value)) return [];
  const categories = new Set();

  for (const entry of value) {
    if (
      entry === "abbigliamento" ||
      entry === "accessori" ||
      entry === "calzature"
    ) {
      categories.add(entry);
    }
  }

  return [...categories];
}

function normalizeBrands(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const brands = [];

  for (const entry of value) {
    const brand = normalizeString(entry);
    const key = brand.toLowerCase();
    if (!brand || seen.has(key)) continue;
    seen.add(key);
    brands.push(brand);
  }

  return brands;
}

function normalizeRule(value) {
  const source = value && typeof value === "object" ? value : {};
  const trigger = normalizeTrigger(source.trigger);
  const priority = Number(source.priority);
  const maxRedemptions = Number(source.maxRedemptions);
  const target = source.target && typeof source.target === "object" ? source.target : {};
  const schedule = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
  const effect = source.effect && typeof source.effect === "object" ? source.effect : {};
  const percent = Number(effect.percentOff);

  return {
    id: normalizeString(source.id) || `discount-${randomUUID()}`,
    trigger,
    name: normalizeString(source.name) || "Nuova regola",
    active: source.active !== false,
    priority: Number.isFinite(priority) ? Math.trunc(priority) : 0,
    schedule: {
      startAt: normalizeDateString(schedule.startAt),
      endAt: normalizeDateString(schedule.endAt),
    },
    target: {
      brands: normalizeBrands(target.brands),
      categories: normalizeCategories(target.categories),
      outletMode: normalizeOutletMode(target.outletMode),
    },
    effect: {
      percentOff: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
    },
    code: trigger === "coupon" ? normalizeOptionalString(source.code)?.toUpperCase() ?? null : null,
    maxRedemptions:
      trigger === "coupon" && Number.isFinite(maxRedemptions) && maxRedemptions > 0
        ? Math.trunc(maxRedemptions)
        : null,
    audience: trigger === "coupon" ? normalizeAudience(source.audience) : "all",
  };
}

function normalizeRules(value) {
  return Array.isArray(value) ? value.map(normalizeRule) : [];
}

function buildRevision(rules) {
  return createHash("sha256")
    .update(JSON.stringify({ rules }))
    .digest("hex")
    .slice(0, 16);
}

function buildDocument(rules, updatedAt = new Date().toISOString()) {
  const normalized = normalizeRules(rules);
  return {
    rules: normalized,
    revision: buildRevision(normalized),
    updatedAt,
  };
}

function parseRuleJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function documentFromRows(rows) {
  const rules = rows.map((row) => normalizeRule(parseRuleJson(row.rule_json)));
  const latestUpdatedAt = rows
    .map((row) => row.updated_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];

  return buildDocument(
    rules,
    latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : new Date(0).toISOString()
  );
}

async function readDiscountRules() {
  const result = await runQuery(`
    SELECT id, sort_order, rule_json, updated_at
    FROM dbo.Albero_Discount_Rules
    ORDER BY sort_order ASC, id ASC
  `);

  return documentFromRows(result.recordset);
}

async function recordAdminAuditLog(input, request) {
  const target = request || (await getPool()).request();
  target.input("action", sql.NVarChar(120), input.action);
  target.input("status", sql.NVarChar(20), input.status);
  target.input("entity", sql.NVarChar(120), input.entity);
  target.input("entityId", sql.NVarChar(160), input.entityId ?? null);
  target.input("previousRevision", sql.NVarChar(80), input.previousRevision ?? null);
  target.input("nextRevision", sql.NVarChar(80), input.nextRevision ?? null);
  target.input("detailJson", sql.NVarChar(sql.MAX), JSON.stringify(input.detail || {}));

  await target.query(`
    INSERT INTO dbo.Albero_Admin_Audit_Log (
      action,
      status,
      entity,
      entity_id,
      previous_revision,
      next_revision,
      detail_json
    )
    VALUES (
      @action,
      @status,
      @entity,
      @entityId,
      @previousRevision,
      @nextRevision,
      @detailJson
    )
  `);
}

async function writeDiscountRules(rules, options = {}) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const lockRequest = new sql.Request(transaction);
    lockRequest.input("resource", sql.NVarChar(255), DISCOUNT_RULES_LOCK_RESOURCE);
    await lockRequest.query(`
      DECLARE @result int;
      EXEC @result = sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 10000;
      IF @result < 0
        THROW 51000, 'DISCOUNT_RULES_LOCK_TIMEOUT', 1;
    `);

    const readRequest = new sql.Request(transaction);
    const currentResult = await readRequest.query(`
      SELECT id, sort_order, rule_json, updated_at
      FROM dbo.Albero_Discount_Rules
      ORDER BY sort_order ASC, id ASC
    `);
    const current = documentFromRows(currentResult.recordset);
    const expectedRevision = normalizeString(options.expectedRevision);

    if (expectedRevision && expectedRevision !== current.revision) {
      const conflict = new Error("DISCOUNT_RULES_REVISION_CONFLICT");
      conflict.code = "DISCOUNT_RULES_REVISION_CONFLICT";
      conflict.currentRevision = current.revision;
      throw conflict;
    }

    const next = buildDocument(rules);
    if (next.revision === current.revision) {
      await transaction.commit();
      return current;
    }

    const deleteRequest = new sql.Request(transaction);
    await deleteRequest.query("DELETE FROM dbo.Albero_Discount_Rules");

    for (const [index, rule] of next.rules.entries()) {
      const insertRequest = new sql.Request(transaction);
      insertRequest.input("id", sql.NVarChar(120), rule.id);
      insertRequest.input("sortOrder", sql.Int, index);
      insertRequest.input("ruleJson", sql.NVarChar(sql.MAX), JSON.stringify(rule));
      insertRequest.input("triggerType", sql.NVarChar(20), rule.trigger);
      insertRequest.input("isActive", sql.Bit, rule.active);
      insertRequest.input("priority", sql.Int, rule.priority);
      insertRequest.input("updatedAt", sql.DateTime2, new Date(next.updatedAt));
      await insertRequest.query(`
        INSERT INTO dbo.Albero_Discount_Rules (
          id,
          sort_order,
          rule_json,
          trigger_type,
          is_active,
          priority,
          updated_at
        )
        VALUES (
          @id,
          @sortOrder,
          @ruleJson,
          @triggerType,
          @isActive,
          @priority,
          @updatedAt
        )
      `);
    }

    await recordAdminAuditLog(
      {
        action: "discount_rules.update",
        status: "success",
        entity: "discount_rules",
        previousRevision: expectedRevision || null,
        nextRevision: next.revision,
        detail: { ruleCount: next.rules.length },
      },
      new sql.Request(transaction)
    );

    await transaction.commit();
    return next;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);

    await recordAdminAuditLog({
      action: "discount_rules.update",
      status: error.code === "DISCOUNT_RULES_REVISION_CONFLICT" ? "conflict" : "error",
      entity: "discount_rules",
      previousRevision: options.expectedRevision || null,
      detail: { error: error.message || "UNKNOWN_ERROR" },
    }).catch(() => undefined);

    throw error;
  }
}

function rowToRedemption(row) {
  return {
    id: row.id,
    ruleId: row.rule_id,
    code: row.code,
    orderId: row.order_id,
    redeemedAt: new Date(row.redeemed_at).toISOString(),
    amount: Number(row.amount) || 0,
    customerEmail: row.customer_email || null,
    userId: row.user_id || null,
  };
}

async function readCouponRedemptions() {
  const result = await runQuery(`
    SELECT
      id,
      rule_id,
      code,
      order_id,
      redeemed_at,
      amount,
      customer_email,
      user_id
    FROM dbo.Albero_Coupon_Redemptions
    ORDER BY redeemed_at DESC, id DESC
  `);

  return result.recordset.map(rowToRedemption);
}

async function getCouponUsageCounts() {
  const result = await runQuery(`
    SELECT rule_id, COUNT(*) AS usage_count
    FROM dbo.Albero_Coupon_Redemptions
    GROUP BY rule_id
  `);

  return Object.fromEntries(
    result.recordset.map((row) => [row.rule_id, Number(row.usage_count) || 0])
  );
}

async function recordCouponRedemption(input) {
  const ruleId = normalizeString(input.ruleId);
  const code = normalizeString(input.code).toUpperCase();
  const orderId = normalizeString(input.orderId);

  if (!ruleId || !code || !orderId) {
    const error = new Error("COUPON_REDEMPTION_INVALID");
    error.statusCode = 400;
    throw error;
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const findRequest = new sql.Request(transaction);
    findRequest.input("ruleId", sql.NVarChar(120), ruleId);
    findRequest.input("orderId", sql.NVarChar(80), orderId);
    const existing = await findRequest.query(`
      SELECT TOP 1
        id,
        rule_id,
        code,
        order_id,
        redeemed_at,
        amount,
        customer_email,
        user_id
      FROM dbo.Albero_Coupon_Redemptions WITH (UPDLOCK, HOLDLOCK)
      WHERE rule_id = @ruleId AND order_id = @orderId
    `);

    if (existing.recordset[0]) {
      await transaction.commit();
      return rowToRedemption(existing.recordset[0]);
    }

    const insertRequest = new sql.Request(transaction);
    const id = normalizeString(input.id) || `coupon-redemption-${randomUUID()}`;
    insertRequest.input("id", sql.NVarChar(160), id);
    insertRequest.input("ruleId", sql.NVarChar(120), ruleId);
    insertRequest.input("code", sql.NVarChar(80), code);
    insertRequest.input("orderId", sql.NVarChar(80), orderId);
    insertRequest.input("amount", sql.Decimal(12, 2), Number(input.amount) || 0);
    insertRequest.input("customerEmail", sql.NVarChar(320), normalizeOptionalString(input.customerEmail));
    insertRequest.input("userId", sql.NVarChar(120), normalizeOptionalString(input.userId));

    const inserted = await insertRequest.query(`
      INSERT INTO dbo.Albero_Coupon_Redemptions (
        id,
        rule_id,
        code,
        order_id,
        redeemed_at,
        amount,
        customer_email,
        user_id
      )
      OUTPUT
        inserted.id,
        inserted.rule_id,
        inserted.code,
        inserted.order_id,
        inserted.redeemed_at,
        inserted.amount,
        inserted.customer_email,
        inserted.user_id
      VALUES (
        @id,
        @ruleId,
        @code,
        @orderId,
        SYSUTCDATETIME(),
        @amount,
        @customerEmail,
        @userId
      )
    `);

    await transaction.commit();
    return rowToRedemption(inserted.recordset[0]);
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function getRuntimeDiscountHealth() {
  const result = await runQuery(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Albero_Discount_Rules) AS rule_count,
      (SELECT COUNT(*) FROM dbo.Albero_Coupon_Redemptions) AS redemption_count,
      (SELECT MAX(updated_at) FROM dbo.Albero_Discount_Rules) AS rules_updated_at
  `);
  const row = result.recordset[0] || {};
  const doc = await readDiscountRules();

  return {
    storage: "sql-server",
    ruleCount: Number(row.rule_count) || 0,
    redemptionCount: Number(row.redemption_count) || 0,
    rulesRevision: doc.revision,
    rulesUpdatedAt: row.rules_updated_at ? new Date(row.rules_updated_at).toISOString() : doc.updatedAt,
  };
}

module.exports = {
  getCouponUsageCounts,
  getRuntimeDiscountHealth,
  readCouponRedemptions,
  readDiscountRules,
  recordCouponRedemption,
  writeDiscountRules,
};
