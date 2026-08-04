import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseMarkdownBlocks, type Block } from "./parse";

// Block[] -> .docx Blob (PLAN §8). Uses Packer.toBlob (not toBuffer) — the
// portable choice across the Workers runtime.

const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

function blockToParagraph(block: Block): Paragraph {
  switch (block.type) {
    case "heading":
      return new Paragraph({
        heading: HEADING_LEVELS[block.level],
        children: [new TextRun({ text: block.text })],
      });
    case "bullet":
      return new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: block.text })],
      });
    case "paragraph":
      return new Paragraph({ children: [new TextRun({ text: block.text })] });
  }
}

export async function exportDocx(markdown: string): Promise<Blob> {
  const blocks = parseMarkdownBlocks(markdown);
  const doc = new Document({
    sections: [{ children: blocks.map(blockToParagraph) }],
  });
  return Packer.toBlob(doc);
}
