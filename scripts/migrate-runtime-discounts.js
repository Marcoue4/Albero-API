const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const config = require("../src/config");
const { closePool } = require("../src/db");
const {
  readDiscountRules,
  recordCouponRedemption,
  writeDiscountRules,
} = require("../src/repositories/runtimeDiscountRepository");
const {
  readRuntimeDocument,
  writeRuntimeDocument,
} = require("../src/repositories/runtimeDocumentRepository");

const RULES_BLOB_PATH = "discounts/rules.json";
const REDEMPTIONS_BLOB_PATH = "discounts/coupon-redemptions.json";
const RUNTIME_DOCUMENT_SOURCES = [
  {
    key: "catalog-season",
    blobPath: "catalog-season/data.json",
    fileEnv: "CATALOG_SEASON_JSON_PATH",
  },
  {
    key: "home-featured",
    blobPath: "homepage/featured-products.json",
    fileEnv: "HOME_FEATURED_JSON_PATH",
  },
  {
    key: "home-categories",
    blobPath: "homepage/category-showcase.json",
    fileEnv: "HOME_CATEGORIES_JSON_PATH",
  },
  {
    key: "inventory-overrides",
    blobPath: "inventory/overrides.json",
    fileEnv: "INVENTORY_OVERRIDES_JSON_PATH",
  },
  {
    key: "curated-outfits",
    blobPath: "curated-outfits/data.json",
    fileEnv: "CURATED_OUTFITS_JSON_PATH",
  },
];

function getBlobDirectUrl(pathname) {
  const token = config.blob.readWriteToken || "";
  const match = token.match(/^vercel_blob_rw_([^_]+)_/);
  if (!match) return null;
  return `https://${match[1]}.public.blob.vercel-storage.com/${pathname}`;
}

function readJsonFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

async function readPublicBlobJson(pathname) {
  const url = getBlobDirectUrl(pathname);
  if (!url) return null;

  const response = await fetch(`${url}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Blob read failed for ${pathname}: ${response.status}`);
  }

  return response.json();
}

function normalizeDocument(value) {
  if (!value || typeof value !== "object") {
    return { rules: [], updatedAt: new Date(0).toISOString() };
  }

  return {
    rules: Array.isArray(value.rules) ? value.rules : [],
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt
        ? value.updatedAt
        : new Date(0).toISOString(),
  };
}

function chooseNewestDocument(documents) {
  return documents
    .filter(Boolean)
    .map(normalizeDocument)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || {
    rules: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeRedemptions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => {
    return (
      entry &&
      typeof entry === "object" &&
      typeof entry.ruleId === "string" &&
      typeof entry.code === "string" &&
      typeof entry.orderId === "string"
    );
  });
}

function chooseRuntimeDocument(blobValue, fileValue) {
  if (blobValue === null || blobValue === undefined) return fileValue ?? null;
  if (fileValue === null || fileValue === undefined) return blobValue;

  if (
    blobValue &&
    fileValue &&
    typeof blobValue === "object" &&
    typeof fileValue === "object" &&
    typeof blobValue.updatedAt === "string" &&
    typeof fileValue.updatedAt === "string"
  ) {
    return new Date(blobValue.updatedAt).getTime() >= new Date(fileValue.updatedAt).getTime()
      ? blobValue
      : fileValue;
  }

  return blobValue;
}

async function main() {
  const force = process.argv.includes("--force");
  const rulesFile = process.env.DISCOUNT_RULES_JSON_PATH
    ? path.resolve(process.env.DISCOUNT_RULES_JSON_PATH)
    : null;
  const redemptionsFile = process.env.COUPON_REDEMPTIONS_JSON_PATH
    ? path.resolve(process.env.COUPON_REDEMPTIONS_JSON_PATH)
    : null;

  const [blobRules, blobRedemptions] = await Promise.all([
    readPublicBlobJson(RULES_BLOB_PATH).catch((error) => {
      console.warn(error.message);
      return null;
    }),
    readPublicBlobJson(REDEMPTIONS_BLOB_PATH).catch((error) => {
      console.warn(error.message);
      return null;
    }),
  ]);

  const current = await readDiscountRules();
  if (current.rules.length > 0 && !force) {
    throw new Error(
      `Albero_Discount_Rules already contains ${current.rules.length} rows. Re-run with --force to replace them.`
    );
  }

  const rulesDoc = chooseNewestDocument([blobRules, readJsonFile(rulesFile)]);
  const redemptions = normalizeRedemptions(
    blobRedemptions || readJsonFile(redemptionsFile) || []
  );

  const written = await writeDiscountRules(rulesDoc.rules, {
    expectedRevision: force ? current.revision : undefined,
  });

  let recordedRedemptions = 0;
  for (const record of redemptions) {
    await recordCouponRedemption(record);
    recordedRedemptions += 1;
  }

  const migratedDocuments = [];
  for (const source of RUNTIME_DOCUMENT_SOURCES) {
    const currentDoc = await readRuntimeDocument(source.key);
    if (currentDoc.document !== null && !force) {
      migratedDocuments.push({ key: source.key, skipped: true });
      continue;
    }

    const [blobValue, fileValue] = await Promise.all([
      readPublicBlobJson(source.blobPath).catch((error) => {
        console.warn(error.message);
        return null;
      }),
      Promise.resolve(
        process.env[source.fileEnv]
          ? readJsonFile(path.resolve(process.env[source.fileEnv]))
          : null
      ),
    ]);
    const document = chooseRuntimeDocument(blobValue, fileValue);
    if (document === null || document === undefined) {
      migratedDocuments.push({ key: source.key, skipped: true });
      continue;
    }

    const saved = await writeRuntimeDocument(source.key, document, {
      expectedRevision: force ? currentDoc.revision || undefined : undefined,
    });
    migratedDocuments.push({
      key: source.key,
      skipped: false,
      revision: saved.revision,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        rules: written.rules.length,
        redemptions: recordedRedemptions,
        documents: migratedDocuments,
        revision: written.revision,
        forced: force,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Failed to migrate runtime discounts.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
