import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { parseMarkdownBlocks, type Block } from "./parse";

// Block[] -> PDF bytes (PLAN §8). pdf-lib has no markdown/HTML support, so
// pagination and word-wrap are hand-rolled. Kept deliberately simple: two fonts
// (regular + bold), single column, bullet glyph + indent for bullets.

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BULLET_INDENT = 16;

interface Style {
  size: number;
  bold: boolean;
  spaceAfter: number;
  indent: number;
  bulletGlyph?: string;
}

function styleFor(block: Block): Style {
  switch (block.type) {
    case "heading": {
      const size = block.level === 1 ? 22 : block.level === 2 ? 16 : 13;
      return { size, bold: true, spaceAfter: 6, indent: 0 };
    }
    case "bullet":
      return { size: 11, bold: false, spaceAfter: 4, indent: BULLET_INDENT, bulletGlyph: "•  " };
    case "paragraph":
      return { size: 11, bold: false, spaceAfter: 8, indent: 0 };
  }
}

// Greedy word-wrap: pack as many words as fit within `maxWidth` per line.
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export async function exportPdf(markdown: string): Promise<Uint8Array<ArrayBuffer>> {
  const blocks = parseMarkdownBlocks(markdown);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const block of blocks) {
    const style = styleFor(block);
    const font = style.bold ? bold : regular;
    const lineHeight = style.size * 1.35;
    const glyph = style.bulletGlyph ?? "";
    const glyphWidth = glyph ? font.widthOfTextAtSize(glyph, style.size) : 0;
    const textWidth = CONTENT_WIDTH - style.indent - glyphWidth;
    const lines = wrapText(block.text, font, style.size, textWidth);

    lines.forEach((line, i) => {
      if (y - lineHeight < MARGIN) newPage();
      y -= lineHeight;
      const x = MARGIN + style.indent;
      if (i === 0 && glyph) {
        page.drawText(glyph, { x, y, size: style.size, font, color: rgb(0, 0, 0) });
      }
      page.drawText(line, {
        x: x + glyphWidth,
        y,
        size: style.size,
        font,
        color: rgb(0, 0, 0),
      });
    });

    y -= style.spaceAfter;
  }

  // Wrap so the result is concretely ArrayBuffer-backed (a BlobPart), not the
  // generic Uint8Array<ArrayBufferLike> that pdf-lib declares.
  return new Uint8Array(await pdf.save());
}
