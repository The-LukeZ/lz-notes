import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { parseMarkdownBlocks, type Block, type Span } from "./parse";

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

// Greedy word-wrap over mixed bold/regular spans: flattens to words (each
// tagged with its font weight) and packs them onto lines within maxWidth.
function wrapSpans(spans: Span[], regular: PDFFont, bold: PDFFont, size: number, maxWidth: number): Span[][] {
  const words: Span[] = [];
  for (const span of spans) {
    for (const word of span.text.split(/\s+/).filter(Boolean)) {
      words.push({ text: word, bold: span.bold });
    }
  }

  const spaceWidth = regular.widthOfTextAtSize(" ", size);
  const lines: Span[][] = [];
  let current: Span[] = [];
  let currentWidth = 0;

  for (const word of words) {
    const font = word.bold ? bold : regular;
    const wordWidth = font.widthOfTextAtSize(word.text, size);
    const extra = current.length > 0 ? spaceWidth : 0;
    if (current.length === 0 || currentWidth + extra + wordWidth <= maxWidth) {
      current.push(word);
      currentWidth += extra + wordWidth;
    } else {
      lines.push(current);
      current = [word];
      currentWidth = wordWidth;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [[]];
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
    const lineHeight = style.size * 1.35;
    const glyph = style.bulletGlyph ?? "";
    const glyphWidth = glyph ? regular.widthOfTextAtSize(glyph, style.size) : 0;
    const textWidth = CONTENT_WIDTH - style.indent - glyphWidth;

    // Headings render fully bold regardless of inline ** markers.
    const spans = style.bold ? block.spans.map((s) => ({ ...s, bold: true })) : block.spans;
    const lines = wrapSpans(spans, regular, bold, style.size, textWidth);
    const spaceWidth = regular.widthOfTextAtSize(" ", style.size);

    lines.forEach((lineWords, i) => {
      if (y - lineHeight < MARGIN) newPage();
      y -= lineHeight;
      let x = MARGIN + style.indent;

      if (i === 0 && glyph) {
        page.drawText(glyph, { x, y, size: style.size, font: regular, color: rgb(0, 0, 0) });
        x += glyphWidth;
      }

      lineWords.forEach((word, wi) => {
        const font = word.bold ? bold : regular;
        page.drawText(word.text, { x, y, size: style.size, font, color: rgb(0, 0, 0) });
        x += font.widthOfTextAtSize(word.text, style.size);
        if (wi < lineWords.length - 1) x += spaceWidth;
      });
    });

    y -= style.spaceAfter;
  }

  // Wrap so the result is concretely ArrayBuffer-backed (a BlobPart), not the
  // generic Uint8Array<ArrayBufferLike> that pdf-lib declares.
  return new Uint8Array(await pdf.save());
}
