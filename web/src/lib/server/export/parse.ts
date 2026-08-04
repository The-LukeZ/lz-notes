// Deliberately minimal markdown parser (PLAN §8). The note templates in
// templates.ts only ever produce `#`/`##`/`###` headings, `- ` bullets, and
// plain paragraphs — no tables, bold, or nesting — so we don't need a full
// markdown engine to drive the docx / pdf exporters.

export type Block =
	| { type: 'heading'; level: 1 | 2 | 3; text: string }
	| { type: 'bullet'; text: string }
	| { type: 'paragraph'; text: string };

export function parseMarkdownBlocks(markdown: string): Block[] {
	const blocks: Block[] = [];
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');

	for (const raw of lines) {
		const line = raw.trimEnd();
		const trimmed = line.trim();
		if (trimmed === '') continue;

		const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
		if (heading) {
			blocks.push({
				type: 'heading',
				level: heading[1].length as 1 | 2 | 3,
				text: heading[2].trim()
			});
			continue;
		}

		const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
		if (bullet) {
			blocks.push({ type: 'bullet', text: bullet[1].trim() });
			continue;
		}

		blocks.push({ type: 'paragraph', text: trimmed });
	}

	return blocks;
}
