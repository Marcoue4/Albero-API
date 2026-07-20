const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { list } = require("@vercel/blob");
const config = require("../src/config");
const { closePool } = require("../src/db");
const {
  createOrder,
  deleteOrder,
  getOrderById,
} = require("../src/repositories/orderRepository");

const ORDERS_INDEX_PATH = "orders/index.json";
const ORDERS_PREFIX = "orders/";

function getBlobDirectUrl(pathname) {
  const token = config.blob.readWriteToken || "";
  const match = token.match(/^vercel_blob_rw_([^_]+)_/);
  if (!match) return null;
  return `https://${match[1]}.public.blob.vercel-storage.com/${pathname}`;
}

async function readPublicBlobJson(pathname) {
  const url = getBlobDirectUrl(pathname);
  if (!url) return null;
  const response = await fetch(`${url}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blob read failed for ${pathname}: ${response.status}`);
  return response.json();
}

function readLocalOrders() {
  const filePath = process.env.ORDERS_JSON_PATH
    ? path.resolve(process.env.ORDERS_JSON_PATH)
    : null;
  if (!filePath || !existsSync(filePath)) return [];
  const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  return Array.isArray(parsed) ? parsed : [];
}

async function readBlobOrders() {
  const index = await readPublicBlobJson(ORDERS_INDEX_PATH);
  if (Array.isArray(index)) return index;
  if (!config.blob.readWriteToken) return [];

  const { blobs } = await list({
    prefix: ORDERS_PREFIX,
    token: config.blob.readWriteToken,
  });
  const orders = [];
  for (const blob of blobs) {
    if (blob.pathname === ORDERS_INDEX_PATH || !blob.pathname.endsWith(".json")) continue;
    const order = await readPublicBlobJson(blob.pathname);
    if (order && typeof order === "object") orders.push(order);
  }
  return orders;
}

function mergeOrders(groups) {
  const merged = new Map();
  for (const order of groups.flat()) {
    const id = typeof order?.id === "string" ? order.id.trim() : "";
    if (!id) continue;
    const existing = merged.get(id);
    const nextTime = new Date(order.updatedAt || order.createdAt || 0).getTime();
    const existingTime = new Date(existing?.updatedAt || existing?.createdAt || 0).getTime();
    if (!existing || nextTime >= existingTime) merged.set(id, order);
  }
  return [...merged.values()];
}

async function main() {
  const force = process.argv.includes("--force");
  const [blobOrders, localOrders] = await Promise.all([
    readBlobOrders().catch((error) => {
      console.warn(error.message);
      return [];
    }),
    Promise.resolve(readLocalOrders()),
  ]);
  const orders = mergeOrders([localOrders, blobOrders]);
  let imported = 0;
  let skipped = 0;

  for (const source of orders) {
    const existing = await getOrderById(source.id);
    if (existing && !force) {
      skipped += 1;
      continue;
    }
    if (existing && force) await deleteOrder(source.id);
    const result = await createOrder(source, { preserveTimestamps: true });
    imported += result.created ? 1 : 0;
    skipped += result.created ? 0 : 1;
  }

  console.log(JSON.stringify({ ok: true, found: orders.length, imported, skipped, forced: force }, null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to migrate orders from Blob.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
