const { randomUUID } = require("node:crypto");
const { getPool, runQuery, sql } = require("../db");

const VALID_STATUSES = new Set(["received", "processing", "completed", "failed"]);

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(value) {
  return text(value) || null;
}

function money(value) {
  const number = Number(value);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function positiveInteger(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function normalizeStatus(value) {
  const status = text(value).toLowerCase();
  return VALID_STATUSES.has(status) ? status : "received";
}

function buildOrderId(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `ORD-${y}${m}${d}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeOrderInput(value, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const customer = source.customer && typeof source.customer === "object" ? source.customer : {};
  const address =
    source.shippingAddress && typeof source.shippingAddress === "object"
      ? source.shippingAddress
      : {};
  const totals = source.totals && typeof source.totals === "object" ? source.totals : {};
  const items = Array.isArray(source.items)
    ? source.items
        .map((item) => {
          const row = item && typeof item === "object" ? item : {};
          const quantity = positiveInteger(row.quantity);
          if (!quantity || !text(row.productId) || !text(row.name)) return null;
          const finalUnitPrice = money(row.finalUnitPrice ?? row.unitPrice);
          return {
            productId: text(row.productId),
            sku: optionalText(row.sku),
            name: text(row.name),
            image: text(row.image),
            size: text(row.size, "-") || "-",
            quantity,
            unitPrice: finalUnitPrice,
            baseUnitPrice: money(row.baseUnitPrice ?? row.unitPrice),
            finalUnitPrice,
            lineSubtotal: money(row.lineSubtotal),
            lineDiscountTotal: money(row.lineDiscountTotal),
            lineTotal: money(row.lineTotal),
            appliedDiscounts: jsonArray(row.appliedDiscounts),
          };
        })
        .filter(Boolean)
    : [];

  const now = new Date();
  const createdAt = options.preserveTimestamps && source.createdAt ? new Date(source.createdAt) : now;
  const updatedAt = options.preserveTimestamps && source.updatedAt ? new Date(source.updatedAt) : createdAt;
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) {
    const error = new Error("ORDER_TIMESTAMP_INVALID");
    error.statusCode = 400;
    throw error;
  }

  const normalized = {
    id: text(source.id) || buildOrderId(now),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    status: normalizeStatus(source.status),
    paymentIntentId: optionalText(source.paymentIntentId),
    paymentStatus: optionalText(source.paymentStatus),
    customer: {
      firstName: text(customer.firstName),
      lastName: text(customer.lastName),
      email: text(customer.email).toLowerCase(),
      phone: optionalText(customer.phone) || undefined,
    },
    shippingAddress: {
      line1: text(address.line1),
      city: text(address.city),
      postalCode: text(address.postalCode),
      province: text(address.province).toUpperCase(),
      country: (text(address.country, "IT") || "IT").toUpperCase(),
    },
    totals: {
      subtotal: money(totals.subtotal),
      discount: money(totals.discount),
      shipping: money(totals.shipping),
      shippingDiscount: money(totals.shippingDiscount),
      islandSurcharge: money(totals.islandSurcharge),
      total: money(totals.total),
      currency: "EUR",
    },
    appliedDiscounts: jsonArray(source.appliedDiscounts),
    coupon: source.coupon && typeof source.coupon === "object" ? source.coupon : null,
    items,
  };

  if (
    !normalized.customer.firstName ||
    !normalized.customer.lastName ||
    !normalized.customer.email ||
    !normalized.shippingAddress.line1 ||
    !normalized.shippingAddress.city ||
    !normalized.shippingAddress.postalCode ||
    !normalized.shippingAddress.province ||
    normalized.items.length === 0
  ) {
    const error = new Error("ORDER_INVALID");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

const ORDER_COLUMNS = `
  id, created_at, updated_at, status, payment_intent_id, payment_status,
  customer_first_name, customer_last_name, customer_email, customer_phone,
  shipping_line1, shipping_city, shipping_postal_code, shipping_province, shipping_country,
  subtotal, discount, shipping, shipping_discount, island_surcharge, total, currency,
  applied_discounts_json, coupon_json
`;

function headerFromRow(row) {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    status: normalizeStatus(row.status),
    paymentIntentId: row.payment_intent_id || null,
    paymentStatus: row.payment_status || null,
    customer: {
      firstName: row.customer_first_name,
      lastName: row.customer_last_name,
      email: row.customer_email,
      ...(row.customer_phone ? { phone: row.customer_phone } : {}),
    },
    shippingAddress: {
      line1: row.shipping_line1,
      city: row.shipping_city,
      postalCode: row.shipping_postal_code,
      province: row.shipping_province,
      country: row.shipping_country,
    },
    totals: {
      subtotal: Number(row.subtotal) || 0,
      discount: Number(row.discount) || 0,
      shipping: Number(row.shipping) || 0,
      shippingDiscount: Number(row.shipping_discount) || 0,
      islandSurcharge: Number(row.island_surcharge) || 0,
      total: Number(row.total) || 0,
      currency: "EUR",
    },
    appliedDiscounts: jsonArray(parseJson(row.applied_discounts_json, [])),
    coupon: parseJson(row.coupon_json, null),
    items: [],
  };
}

function itemFromRow(row) {
  return {
    productId: row.product_id,
    sku: row.sku || null,
    name: row.name,
    image: row.image || "",
    size: row.size,
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    baseUnitPrice: Number(row.base_unit_price) || 0,
    finalUnitPrice: Number(row.final_unit_price) || 0,
    lineSubtotal: Number(row.line_subtotal) || 0,
    lineDiscountTotal: Number(row.line_discount_total) || 0,
    lineTotal: Number(row.line_total) || 0,
    appliedDiscounts: jsonArray(parseJson(row.applied_discounts_json, [])),
  };
}

async function attachItems(orders, requestFactory) {
  if (!orders.length) return orders;
  const byId = new Map(orders.map((order) => [order.id, order]));
  const ids = orders.map((order) => order.id);

  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const request = requestFactory ? requestFactory() : (await getPool()).request();
    const params = batch.map((id, index) => {
      const name = `orderId${index}`;
      request.input(name, sql.NVarChar(80), id);
      return `@${name}`;
    });
    const result = await request.query(`
      SELECT
        order_id, line_number, product_id, sku, name, image, size, quantity,
        unit_price, base_unit_price, final_unit_price, line_subtotal,
        line_discount_total, line_total, applied_discounts_json
      FROM dbo.Albero_Order_Items
      WHERE order_id IN (${params.join(", ")})
      ORDER BY order_id, line_number
    `);
    for (const row of result.recordset) byId.get(row.order_id)?.items.push(itemFromRow(row));
  }
  return orders;
}

async function listOrders() {
  const result = await runQuery(`
    SELECT ${ORDER_COLUMNS}
    FROM dbo.Albero_Orders
    ORDER BY created_at DESC, id DESC
  `);
  return attachItems(result.recordset.map(headerFromRow));
}

async function getOrderById(id) {
  const result = await runQuery(
    `SELECT ${ORDER_COLUMNS} FROM dbo.Albero_Orders WHERE id = @id`,
    [{ name: "id", type: sql.NVarChar, value: text(id) }]
  );
  if (!result.recordset[0]) return null;
  return (await attachItems([headerFromRow(result.recordset[0])]))[0];
}

async function getOrderByPaymentIntentId(paymentIntentId) {
  const normalized = optionalText(paymentIntentId);
  if (!normalized) return null;
  const result = await runQuery(
    `SELECT ${ORDER_COLUMNS} FROM dbo.Albero_Orders WHERE payment_intent_id = @paymentIntentId`,
    [{ name: "paymentIntentId", type: sql.NVarChar, value: normalized }]
  );
  if (!result.recordset[0]) return null;
  return (await attachItems([headerFromRow(result.recordset[0])]))[0];
}

async function createOrder(value, options = {}) {
  const order = normalizeOrderInput(value, options);
  if (order.paymentIntentId) {
    const existing = await getOrderByPaymentIntentId(order.paymentIntentId);
    if (existing) return { order: existing, created: false };
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const request = new sql.Request(transaction);
    request.input("id", sql.NVarChar(80), order.id);
    request.input("createdAt", sql.DateTime2, new Date(order.createdAt));
    request.input("updatedAt", sql.DateTime2, new Date(order.updatedAt));
    request.input("status", sql.NVarChar(20), order.status);
    request.input("paymentIntentId", sql.NVarChar(255), order.paymentIntentId);
    request.input("paymentStatus", sql.NVarChar(40), order.paymentStatus);
    request.input("customerFirstName", sql.NVarChar(120), order.customer.firstName);
    request.input("customerLastName", sql.NVarChar(120), order.customer.lastName);
    request.input("customerEmail", sql.NVarChar(320), order.customer.email);
    request.input("customerPhone", sql.NVarChar(80), order.customer.phone || null);
    request.input("shippingLine1", sql.NVarChar(300), order.shippingAddress.line1);
    request.input("shippingCity", sql.NVarChar(160), order.shippingAddress.city);
    request.input("shippingPostalCode", sql.NVarChar(20), order.shippingAddress.postalCode);
    request.input("shippingProvince", sql.NVarChar(20), order.shippingAddress.province);
    request.input("shippingCountry", sql.NVarChar(2), order.shippingAddress.country);
    request.input("subtotal", sql.Decimal(12, 2), order.totals.subtotal);
    request.input("discount", sql.Decimal(12, 2), order.totals.discount);
    request.input("shipping", sql.Decimal(12, 2), order.totals.shipping);
    request.input("shippingDiscount", sql.Decimal(12, 2), order.totals.shippingDiscount);
    request.input("islandSurcharge", sql.Decimal(12, 2), order.totals.islandSurcharge);
    request.input("total", sql.Decimal(12, 2), order.totals.total);
    request.input("appliedDiscountsJson", sql.NVarChar(sql.MAX), JSON.stringify(order.appliedDiscounts));
    request.input("couponJson", sql.NVarChar(sql.MAX), order.coupon ? JSON.stringify(order.coupon) : null);
    await request.query(`
      INSERT INTO dbo.Albero_Orders (
        id, created_at, updated_at, status, payment_intent_id, payment_status,
        customer_first_name, customer_last_name, customer_email, customer_phone,
        shipping_line1, shipping_city, shipping_postal_code, shipping_province, shipping_country,
        subtotal, discount, shipping, shipping_discount, island_surcharge, total, currency,
        applied_discounts_json, coupon_json
      ) VALUES (
        @id, @createdAt, @updatedAt, @status, @paymentIntentId, @paymentStatus,
        @customerFirstName, @customerLastName, @customerEmail, @customerPhone,
        @shippingLine1, @shippingCity, @shippingPostalCode, @shippingProvince, @shippingCountry,
        @subtotal, @discount, @shipping, @shippingDiscount, @islandSurcharge, @total, 'EUR',
        @appliedDiscountsJson, @couponJson
      )
    `);

    for (const [index, item] of order.items.entries()) {
      const itemRequest = new sql.Request(transaction);
      itemRequest.input("orderId", sql.NVarChar(80), order.id);
      itemRequest.input("lineNumber", sql.Int, index);
      itemRequest.input("productId", sql.NVarChar(120), item.productId);
      itemRequest.input("sku", sql.NVarChar(160), item.sku);
      itemRequest.input("name", sql.NVarChar(300), item.name);
      itemRequest.input("image", sql.NVarChar(2048), item.image);
      itemRequest.input("size", sql.NVarChar(80), item.size);
      itemRequest.input("quantity", sql.Int, item.quantity);
      itemRequest.input("unitPrice", sql.Decimal(12, 2), item.unitPrice);
      itemRequest.input("baseUnitPrice", sql.Decimal(12, 2), item.baseUnitPrice);
      itemRequest.input("finalUnitPrice", sql.Decimal(12, 2), item.finalUnitPrice);
      itemRequest.input("lineSubtotal", sql.Decimal(12, 2), item.lineSubtotal);
      itemRequest.input("lineDiscountTotal", sql.Decimal(12, 2), item.lineDiscountTotal);
      itemRequest.input("lineTotal", sql.Decimal(12, 2), item.lineTotal);
      itemRequest.input("appliedDiscountsJson", sql.NVarChar(sql.MAX), JSON.stringify(item.appliedDiscounts || []));
      await itemRequest.query(`
        INSERT INTO dbo.Albero_Order_Items (
          order_id, line_number, product_id, sku, name, image, size, quantity,
          unit_price, base_unit_price, final_unit_price, line_subtotal,
          line_discount_total, line_total, applied_discounts_json
        ) VALUES (
          @orderId, @lineNumber, @productId, @sku, @name, @image, @size, @quantity,
          @unitPrice, @baseUnitPrice, @finalUnitPrice, @lineSubtotal,
          @lineDiscountTotal, @lineTotal, @appliedDiscountsJson
        )
      `);
    }

    await transaction.commit();
    return { order, created: true };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    if (order.paymentIntentId && (error.number === 2601 || error.number === 2627)) {
      const existing = await getOrderByPaymentIntentId(order.paymentIntentId);
      if (existing) return { order: existing, created: false };
    }
    throw error;
  }
}

async function updateOrderStatus(id, status) {
  const normalizedStatus = normalizeStatus(status);
  const normalizedId = text(id);
  const result = await runQuery(
    `
      UPDATE dbo.Albero_Orders
      SET status = @status, updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `,
    [
      { name: "id", type: sql.NVarChar, value: normalizedId },
      { name: "status", type: sql.NVarChar, value: normalizedStatus },
    ]
  );
  if (!result.rowsAffected[0]) return null;
  return getOrderById(normalizedId);
}

async function deleteOrder(id) {
  const result = await runQuery(
    "DELETE FROM dbo.Albero_Orders WHERE id = @id",
    [{ name: "id", type: sql.NVarChar, value: text(id) }]
  );
  return Boolean(result.rowsAffected[0]);
}

module.exports = {
  buildOrderId,
  createOrder,
  deleteOrder,
  getOrderById,
  getOrderByPaymentIntentId,
  listOrders,
  normalizeOrderInput,
  updateOrderStatus,
};
