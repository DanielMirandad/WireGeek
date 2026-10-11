// Renderer-safe shortening only after a thematic width rejection.
// The canonical title and editorial body are never mutated.
export function shorterThematicTitle(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, -1).join(' ');
  // A single identity word cannot be safely shortened without changing a name.
  return '';
}
export function shortenRejectedVisualTitle(title, field) {
  if (!['title_main','title_theme'].includes(field)) return null;
  const current = String(title?.[field] || '').trim();
  const shorter = shorterThematicTitle(current);
  if (!shorter || shorter === current) return null;
  return { ...title, [field]: shorter };
}
