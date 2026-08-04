// Deliberately minimal markdown parser (PLAN §8). The note templates in
// templates.ts only ask the LLM for `#`/`##`/`###` headings, `- ` bullets,
// and plain paragraphs, but models routinely wrap output in a ```markdown
// fence and bold speaker names — so fences are stripped and `**bold**` spans
// are parsed, without pulling in a full markdown engine.

export type Span = { text: string; bold: boolean };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; spans: Span[] }
  | { type: "bullet"; spans: Span[] }
  | { type: "paragraph"; spans: Span[] };

function parseInlineSpans(text: string): Span[] {
  const spans: Span[] = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text))) {
    if (match.index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    spans.push({ text: match[1], bold: true });
    lastIndex = boldPattern.lastIndex;
  }
  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), bold: false });
  }

  return spans.length > 0 ? spans : [{ text: "", bold: false }];
}

export function parseMarkdownBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (/^```/.test(trimmed)) continue; // strip ```markdown fences

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        spans: parseInlineSpans(heading[2].trim()),
      });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      blocks.push({ type: "bullet", spans: parseInlineSpans(bullet[1].trim()) });
      continue;
    }

    blocks.push({ type: "paragraph", spans: parseInlineSpans(trimmed) });
  }

  return blocks;
}
