import { describe, it, expect } from 'vitest';
import { parseCsv, utf8ToBase64, autoDetectColumns } from '@/lib/csv';

describe('parseCsv', () => {
  it('parses a simple CSV with header', () => {
    const { headers, rows } = parseCsv('email,first\na@b.com,Ann\nc@d.com,Cy');
    expect(headers).toEqual(['email', 'first']);
    expect(rows).toEqual([
      ['a@b.com', 'Ann'],
      ['c@d.com', 'Cy'],
    ]);
  });

  it('respects quoted fields containing commas', () => {
    const { rows } = parseCsv('company,city\n"Acme, Inc.",Austin');
    expect(rows[0]).toEqual(['Acme, Inc.', 'Austin']);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    const { rows } = parseCsv('note\n"She said ""hi"""');
    expect(rows[0]).toEqual(['She said "hi"']);
  });

  it('handles CRLF line endings and skips blank lines', () => {
    const { headers, rows } = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('throws on empty input', () => {
    expect(() => parseCsv('   ')).toThrow();
  });
});

describe('utf8ToBase64', () => {
  it('round-trips UTF-8 content (including accents)', () => {
    const original = 'José,Café,naïve';
    const b64 = utf8ToBase64(original);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(original);
  });
});

describe('autoDetectColumns', () => {
  it('maps common header names to lead fields', () => {
    const m = autoDetectColumns(['Email Address', 'First Name', 'Last Name', 'Company']);
    expect(m.email).toBe(0);
    expect(m.firstName).toBe(1);
    expect(m.lastName).toBe(2);
    expect(m.company).toBe(3);
  });

  it('returns -1 for fields with no matching header', () => {
    const m = autoDetectColumns(['email', 'random_col']);
    expect(m.email).toBe(0);
    expect(m.phone).toBe(-1);
  });

  it('falls back to contains-matching', () => {
    const m = autoDetectColumns(['work email', 'mobile phone']);
    expect(m.email).toBe(0);
    expect(m.phone).toBe(1);
  });
});
