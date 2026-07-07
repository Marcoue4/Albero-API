const DEFAULT_STOREFRONT_ALLOWED_STORE_NAMES = Object.freeze([
  "MAZZINI UOMO",
  "MAZZINI 17/19",
  "MAZZINI DONNA",
  "CORSO TRIESTE",
  "TURATI",
]);

function normalizeStoreLocationName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeStoreLocationList(values) {
  const entries = Array.isArray(values) ? values : String(values || "").split(",");
  const normalized = [];
  const seen = new Set();

  for (const value of entries) {
    const name = normalizeStoreLocationName(value);

    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    normalized.push(name);
  }

  return normalized;
}

function parseAllowedStoreNames(value) {
  const parsed = normalizeStoreLocationList(value);
  return parsed.length
    ? parsed
    : [...DEFAULT_STOREFRONT_ALLOWED_STORE_NAMES];
}

function formatStoreLocationScopeValue(values) {
  const normalized = normalizeStoreLocationList(values);
  return normalized.length ? normalized.join(",") : null;
}

function quoteSqlUnicodeString(value) {
  return `N'${String(value || "").replace(/'/g, "''")}'`;
}

function buildStoreLocationPredicateSql(columnExpression, allowedStoreNames) {
  const normalized = normalizeStoreLocationList(allowedStoreNames);

  if (!normalized.length) {
    return null;
  }

  return `UPPER(LTRIM(RTRIM(${columnExpression}))) IN (${normalized
    .map(quoteSqlUnicodeString)
    .join(", ")})`;
}

module.exports = {
  DEFAULT_STOREFRONT_ALLOWED_STORE_NAMES,
  buildStoreLocationPredicateSql,
  formatStoreLocationScopeValue,
  normalizeStoreLocationList,
  normalizeStoreLocationName,
  parseAllowedStoreNames,
};
