const http = require("node:http");
const { once } = require("node:events");
const { createApp } = require("../src/app");
const { closePool } = require("../src/db");

async function main() {
  const app = createApp();
  const server = http.createServer(app);

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/health/db`).then((response) => response.json());
    console.log("health/db", health.status, health.database.database_name);

    const listPayload = await fetch(
      `${baseUrl}/api/products?page=1&pageSize=5`
    ).then((response) => response.json());
    console.log("products", listPayload.pagination.totalItems, listPayload.items.length);

    const firstProductId = listPayload.items[0]?.id;

    if (!firstProductId) {
      throw new Error("Smoke test could not find a product from /api/products.");
    }

    const detailPayload = await fetch(
      `${baseUrl}/api/products/${encodeURIComponent(firstProductId)}`
    ).then((response) => response.json());
    console.log("product detail", detailPayload.product.id, detailPayload.product.variants.length);

    const firstSku =
      detailPayload.product.variants.find((variant) => variant.sku)?.sku ||
      detailPayload.product.colors?.find((color) => color.sku)?.sku;

    if (!firstSku) {
      throw new Error("Smoke test could not find a SKU for stock lookup.");
    }

    const stockPayload = await fetch(`${baseUrl}/api/stock/lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        skus: [firstSku],
      }),
    }).then((response) => response.json());
    console.log("stock lookup", Object.keys(stockPayload.stocks));
  } finally {
    server.close();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
