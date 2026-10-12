function clean(value) {
  return String(value || "").trim();
}

function preserveTerminalPunctuation(original, shortened) {
  const terminal = clean(original).match(/[.!?]$/u)?.[0] || "";
  const base = clean(shortened).replace(/[,:;.!?]+$/u, "");
  return terminal ? base + terminal : base;
}

// Display-only recovery for the thematic banner. This never mutates the
// canonical highlight stored with the news item or the publication caption.
export function shortenEditorialDisplayCopy(value, { minWords = 4 } = {}) {
  const text = clean(value);
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length <= minWords) {
    return "";
  }

  return preserveTerminalPunctuation(
    text,
    words.slice(0, -1).join(" ")
  );
}
