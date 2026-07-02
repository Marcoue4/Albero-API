const STORE_CATEGORIES = ["abbigliamento", "accessori", "calzature"];

const KNOWN_SUBTYPE_ENTRIES = [
  { key: "abito", label: "Abito", category: "abbigliamento" },
  { key: "bermuda", label: "Bermuda", category: "abbigliamento" },
  { key: "camicia", label: "Camicia", category: "abbigliamento" },
  { key: "chemisere", label: "Chemisere", category: "abbigliamento" },
  { key: "felpa", label: "Felpa", category: "abbigliamento" },
  { key: "giacca", label: "Giacca", category: "abbigliamento" },
  { key: "giubbino", label: "Giubbino", category: "abbigliamento" },
  { key: "gonna", label: "Gonna", category: "abbigliamento" },
  { key: "maglia", label: "Maglia", category: "abbigliamento" },
  { key: "pantalone", label: "Pantalone", category: "abbigliamento" },
  { key: "polo", label: "Polo", category: "abbigliamento" },
  { key: "t-shirt", label: "T-shirt", category: "abbigliamento" },
  { key: "top", label: "Top", category: "abbigliamento" },
  { key: "tuta", label: "Tuta", category: "abbigliamento" },
  { key: "borsa", label: "Borsa", category: "accessori" },
  { key: "cappello", label: "Cappello", category: "accessori" },
  { key: "cintura", label: "Cintura", category: "accessori" },
  { key: "portafoglio", label: "Portafoglio", category: "accessori" },
  { key: "pochette", label: "Pochette", category: "accessori" },
  { key: "zaino", label: "Zaino", category: "accessori" },
  { key: "chanel", label: "Chanel", category: "calzature" },
  { key: "ciabatta", label: "Ciabatta", category: "calzature" },
  { key: "decollete", label: "Decollete", category: "calzature" },
  { key: "mocassino", label: "Mocassino", category: "calzature" },
  { key: "sandalo", label: "Sandalo", category: "calzature" },
  { key: "sneakers", label: "Sneakers", category: "calzature" },
  { key: "stivale", label: "Stivale", category: "calzature" },
];

const COLLECTION_GROUP_CATEGORY_MAP = {
  calzature: "calzature",
  maglieria: "abbigliamento",
  outerwear: "abbigliamento",
  accessori: "accessori",
};

const KNOWN_SUBTYPE_LOOKUP = new Map(
  KNOWN_SUBTYPE_ENTRIES.map((entry) => [entry.key, entry])
);

function toTitleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeSubtypeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStoreCategory(value) {
  const normalized = normalizeSubtypeKey(value);

  if (!normalized) {
    return null;
  }

  if (normalized.includes("calz")) {
    return "calzature";
  }

  if (normalized.includes("accessor")) {
    return "accessori";
  }

  if (normalized.includes("abbigli")) {
    return "abbigliamento";
  }

  return null;
}

function normalizeGender(value) {
  return String(value || "").trim().toUpperCase() === "UOMO" ? "uomo" : "donna";
}

function inferCategorySubtype(rawCategory, rawSubtype, rawCollectionGroup) {
  const subtype = String(rawSubtype || "").trim();
  const subtypeKey = normalizeSubtypeKey(subtype);
  const knownSubtype = KNOWN_SUBTYPE_LOOKUP.get(subtypeKey);

  if (knownSubtype) {
    return {
      category: knownSubtype.category,
      subtype: knownSubtype.label,
      subtypeKey,
    };
  }

  const normalizedCategory =
    normalizeStoreCategory(rawCategory) ||
    COLLECTION_GROUP_CATEGORY_MAP[normalizeSubtypeKey(rawCollectionGroup)] ||
    "abbigliamento";

  return {
    category: normalizedCategory,
    subtype: subtype ? toTitleCase(subtype) : undefined,
    subtypeKey: subtypeKey || undefined,
  };
}

module.exports = {
  STORE_CATEGORIES,
  inferCategorySubtype,
  normalizeGender,
  normalizeStoreCategory,
  normalizeSubtypeKey,
};
