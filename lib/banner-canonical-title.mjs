// Pure canonical title split: never rewrite or paraphrase the supplied words.
// Return null when the two approved title lines cannot accommodate the text.
function wordsOf(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function validParts(parts) {
  return parts.length === 2 &&
    parts.every(Boolean) &&
    parts[0].length <= 24 &&
    parts[1].length <= 32;
}

function balancedSplit(title) {
  const words = wordsOf(title);
  let parts = [];

  for (let cut = 1; cut < words.length; cut++) {
    const left = words.slice(0, cut).join(" ");
    const right = words.slice(cut).join(" ");

    if (
      left.length <= 24 &&
      right.length <= 32 &&
      (
        !parts.length ||
        Math.abs(left.length - right.length) <
          Math.abs(parts[0].length - parts[1].length)
      )
    ) {
      parts = [left, right];
    }
  }

  return validParts(parts) ? parts : null;
}

export function splitCanonicalVisualTitle(value) {
  const title = String(value || "").trim();
  const colonIndex = title.indexOf(":");

  if (colonIndex > 0) {
    const left = title.slice(0, colonIndex).trim();
    const right = title.slice(colonIndex + 1).trim();

    // The thematic main line is rendered at 132 px and is substantially wider
    // than the theme line. Keep the natural colon split only when the main
    // identity is compact; otherwise repartition at a word boundary while
    // preserving every canonical word and the colon token.
    if (left.length <= 14 && validParts([left, right])) {
      return [left, right];
    }

    return balancedSplit(title);
  }

  return balancedSplit(title);
}

export function recoverCanonicalVisualTitle(value, current, field) {
  const words = wordsOf(value);
  const currentMainWords = wordsOf(current?.title_main).length;

  if (
    words.length < 2 ||
    !["title_main", "title_theme"].includes(field) ||
    !currentMainWords
  ) {
    return null;
  }

  const direction = field === "title_main" ? -1 : 1;
  const nextCut = currentMainWords + direction;

  if (nextCut < 1 || nextCut >= words.length) {
    return null;
  }

  const parts = [
    words.slice(0, nextCut).join(" "),
    words.slice(nextCut).join(" "),
  ];

  if (!validParts(parts)) {
    return null;
  }

  return {
    title_main: parts[0],
    title_theme: parts[1],
  };
}
