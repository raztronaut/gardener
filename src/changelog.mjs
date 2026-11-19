// Pull the human-facing "what changed" phrase out of a tending-run summary.
// Prefers the mandated `CHANGELOG:` line; otherwise the first line that isn't
// test/process boilerplate ("All 71 checks green", "smoke passes", "clean tree"),
// so even older runs that ended with test status display something meaningful.
const isBoiler = (l) =>
  (/\b(smoke|checks?|tests?|working tree|clipping|lint|deploy)\b/i.test(l) &&
   /\b(green|pass(?:es|ed)?|clean|ok|complete|succeed(?:s|ed)?)\b/i.test(l)) ||
  /^all\s+(\d+\s+)?checks\b/i.test(l);

export function changelogPhrase(summary, max = 160) {
  if (!summary) return '';
  // Normalize each line first (markdown bold/heading stripped) so the filters
  // see the real text — e.g. "**Summary of what changed:**" is a lead-in, not content.
  const lines = String(summary).split('\n')
    .map((l) => l.trim().replace(/^#{1,6}\s+/, '').replace(/^\*+\s*|\s*\*+$/g, '').trim())
    .filter(Boolean);
  const tagged = lines.find((l) => /^changelog\s*:/i.test(l));
  const pick = tagged
    ? tagged.replace(/^changelog\s*:\s*/i, '')
    : (lines.find((l) => !isBoiler(l) && !/^summary\b/i.test(l) && !/:$/.test(l)) || lines[0] || '');
  return pick.replace(/\s+/g, ' ').slice(0, max);
}

// Keep the authored detail independently of the one-line list summary.
export function changelogDetails(summary) {
  const text = String(summary || '');
  const tagged = text.match(/(?:^|\n)\s*CHANGELOG_DETAILS:\s*\n?([\s\S]*)/i);
  const detail = tagged ? tagged[1] : text.replace(/^.*CHANGELOG:\s*.*$/gim, '');
  return detail.split('\n').filter((line) => !isBoiler(line.trim())).join('\n').trim();
}

// Manual entries extend the preceding tending without advancing its counter.
// Keep stable storage IDs separate from the human-facing decimal number.
export function numberChangelog(entries) {
  const ordered = [...entries].sort((a, b) => a.at - b.at ||
    (a.kind === b.kind ? String(a.id).localeCompare(String(b.id)) : a.kind === 'manual' ? 1 : -1));
  let tending = 0, increment = 0;
  return ordered.map(entry => {
    if (entry.kind === 'manual') return { ...entry, number: `${tending}.${++increment}` };
    tending = entry.id;
    increment = 0;
    return { ...entry, number: String(tending) };
  }).reverse();
}
