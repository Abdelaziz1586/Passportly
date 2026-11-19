export interface PdfLine {
  text: string;
  /** Font size in points (default 11). */
  size?: number;
  bold?: boolean;
}

const PAGE_WIDTH = 595; // A4
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const LINE_GAP = 4;

/** Standard PDF fonts only cover Latin-1: anything else becomes "?". */
function toLatin1(text: string): string {
  return Array.from(text)
    .map((char) => (char.charCodeAt(0) <= 255 ? char : '?'))
    .join('')
    .replace(/[\r\n\t]+/g, ' ');
}

function escapePdfText(text: string): string {
  return toLatin1(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Builds a small text-only PDF (Helvetica, A4, automatic page breaks) without
 * any dependency. Used for the downloadable e-ticket.
 */
export function buildSimplePdf(lines: PdfLine[]): Buffer {
  // Lay lines out on pages.
  const pages: string[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 11;
    if (y - size < MARGIN) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= size;
    pages[pages.length - 1].push(
      `BT /${line.bold ? 'F2' : 'F1'} ${size} Tf ${MARGIN} ${y} Td (${escapePdfText(line.text)}) Tj ET`,
    );
    y -= LINE_GAP;
  }

  // Objects: 1 catalog, 2 pages, 3 font, 4 bold font, then (page, content) pairs.
  const objects: string[] = [];
  const pageObjectIds = pages.map((_page, index) => 5 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  pages.forEach((page, index) => {
    const contentId = 6 + index * 2;
    const stream = page.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  });

  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
