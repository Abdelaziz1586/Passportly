import { buildSimplePdf } from './simple-pdf';

describe('buildSimplePdf', () => {
  it('produces a PDF with the header, the text, a valid xref and the trailer', () => {
    const pdf = buildSimplePdf([
      { text: 'Passportly E-Ticket', size: 18, bold: true },
      { text: 'Booking ABCD2345' },
    ]);
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(Passportly E-Ticket) Tj');
    expect(text).toContain('(Booking ABCD2345) Tj');
    expect(text).toContain('/BaseFont /Helvetica-Bold');

    // startxref points at the xref table, and every offset points at "<n> 0 obj"
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text
      .slice(startxref)
      .split('\n')
      .filter((line) => /^\d{10} 00000 n $/.test(line));
    expect(entries.length).toBeGreaterThanOrEqual(6);
    entries.forEach((entry, index) => {
      const at = Number(entry.slice(0, 10));
      expect(text.slice(at, at + `${index + 1} 0 obj`.length)).toBe(
        `${index + 1} 0 obj`,
      );
    });
  });

  it('escapes PDF special characters and replaces non-Latin-1 text', () => {
    const pdf = buildSimplePdf([{ text: 'A (b) \\ c م é' }]);
    const text = pdf.toString('latin1');

    expect(text).toContain('(A \\(b\\) \\\\ c ? \xe9) Tj');
  });

  it('keeps a line break or tab from breaking the content stream', () => {
    const text = buildSimplePdf([{ text: 'one\ntwo\tthree' }]).toString(
      'latin1',
    );

    expect(text).toContain('(one two three) Tj');
  });

  it('adds pages when the lines do not fit on one', () => {
    const lines = Array.from({ length: 120 }, (_v, i) => ({
      text: `line ${i}`,
    }));
    const text = buildSimplePdf(lines).toString('latin1');

    expect(/\/Count (\d+)/.exec(text)?.[1]).toBe('3');
    expect(text).toContain('(line 119) Tj');
  });

  it('is deterministic for the same input', () => {
    const input = [{ text: 'same' }];

    expect(buildSimplePdf(input).equals(buildSimplePdf(input))).toBe(true);
  });
});
