export function contentPreview(summary, body = '', limit = 150) {
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  const plain = String(body || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ').trim();
  return plain.length > limit ? plain.slice(0, limit) + '…' : plain;
}
