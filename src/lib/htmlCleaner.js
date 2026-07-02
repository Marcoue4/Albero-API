const LINE_BREAK_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function stripMarkup(value) {
  return decodeEntities(String(value || ""))
    .replace(/<\?xml[^>]*>/gi, "")
    .replace(/<\/?o:p>/gi, "")
    .replace(LINE_BREAK_RE, "\n")
    .replace(TAG_RE, " ");
}

function normalizeInlineWhitespace(value) {
  return value.replace(/[ \t\f\v]+/g, " ").trim();
}

function cleanRichText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const stripped = stripMarkup(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const cleanedLines = stripped
    .split("\n")
    .map(normalizeInlineWhitespace)
    .filter(Boolean);

  if (!cleanedLines.length) {
    return null;
  }

  return cleanedLines.join("\n");
}

function cleanText(value) {
  const cleaned = cleanRichText(value);

  if (!cleaned) {
    return null;
  }

  return cleaned.replace(/\n+/g, " ").trim() || null;
}

function splitFeatureLines(value) {
  const cleaned = cleanRichText(value);

  if (!cleaned) {
    return [];
  }

  const seen = new Set();
  const lines = [];

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const dedupeKey = line.toLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    lines.push(line);
  }

  return lines;
}

module.exports = {
  cleanRichText,
  cleanText,
  splitFeatureLines,
};
