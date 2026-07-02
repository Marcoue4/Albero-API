const COLOR_HEX = {
  nero: "#1a1a1a",
  bianco: "#f5f5f5",
  rosso: "#b83232",
  blu: "#2c3e6b",
  azzurro: "#6fa8dc",
  verde: "#2d6a4f",
  grigio: "#808080",
  beige: "#d4c5a9",
  camel: "#c4a882",
  cammello: "#c4a882",
  marrone: "#6b4226",
  cuoio: "#8b4513",
  tortora: "#b4a99a",
  panna: "#f5f0e1",
  oro: "#b8860b",
  argento: "#c0c0c0",
  jeans: "#4a6fa5",
  platino: "#b8aa8a",
  burro: "#f1e3b8",
  bluette: "#2949b5",
  cielo: "#9ecae1",
  navy: "#1f2d4d",
  pink: "#d46a92",
  rosa: "#f4a7b9",
  biancoblu: "#d7dce5",
};

function normalizeColorName(value) {
  return String(value || "").trim();
}

function colorToHex(value) {
  const normalized = normalizeColorName(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (!normalized) {
    return "#888888";
  }

  for (const [key, hex] of Object.entries(COLOR_HEX)) {
    if (normalized.includes(key)) {
      return hex;
    }
  }

  return "#888888";
}

module.exports = {
  colorToHex,
  normalizeColorName,
};
