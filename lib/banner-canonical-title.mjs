// Pure canonical title split: never rewrite or paraphrase the supplied words.
// Return null when the two approved title lines cannot accommodate the text.
export function splitCanonicalVisualTitle(value) {
  const title = String(value || "").trim();
  const colonIndex = title.indexOf(":");
  let parts = [];
  if (colonIndex > 0) {
    parts = [title.slice(0, colonIndex).trim(), title.slice(colonIndex + 1).trim()];
  } else {
    const words = title.split(/\s+/).filter(Boolean);
    for (let cut = 1; cut < words.length; cut++) {
      const left = words.slice(0, cut).join(" ");
      const right = words.slice(cut).join(" ");
      if (left.length <= 24 && right.length <= 32 &&
          (!parts.length || Math.abs(left.length - right.length) <
            Math.abs(parts[0].length - parts[1].length))) {
        parts = [left, right];
      }
    }
  }
  return parts.length === 2 && parts.every(Boolean) &&
    parts[0].length <= 24 && parts[1].length <= 32 ? parts : null;
}
