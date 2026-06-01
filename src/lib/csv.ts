/**
 * Minimal, dependency-free CSV utilities for the lead-import flow.
 *
 * parseCsv handles the common cases that trip up a naive `split(',')`:
 *   - quoted fields containing commas:           "Acme, Inc."
 *   - escaped double-quotes inside quotes:        "She said ""hi"""
 *   - CRLF or LF line endings
 *   - a trailing newline at end of file
 *
 * It is intentionally small — it is not a full RFC 4180 parser (no support for
 * embedded newlines inside quoted fields, which lead CSVs effectively never
 * contain). If we ever need that, swap in a real library.
 */

export interface ParsedCsv {
  headers: string[];
  /** Data rows (header row excluded). Each row is an array of cell strings. */
  rows: string[][];
}

/** Parse a single CSV line into cells, respecting double-quoted fields. */
function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Escaped quote ("") → literal quote; otherwise close the quoted field.
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/**
 * Parse CSV text. Returns the header row and all non-empty data rows.
 * Throws if the text has no header row.
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('CSV is empty.');
  }

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

/**
 * UTF-8-safe base64 encode. `btoa` alone throws on any non-Latin1 character
 * (accented names, etc.), so we encode to UTF-8 bytes first.
 */
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Best-effort auto-detection of which CSV column maps to which lead field,
 * by fuzzy-matching header names. Returns a map of leadField → columnIndex
 * (or -1 if no confident match). The caller can override in the UI.
 */
export type LeadField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'company'
  | 'jobTitle'
  | 'phone'
  | 'industry'
  | 'location';

const HEADER_ALIASES: Record<LeadField, string[]> = {
  email: ['email', 'email address', 'e-mail', 'work email', 'emailaddress'],
  firstName: ['first name', 'firstname', 'first', 'fname', 'given name'],
  lastName: ['last name', 'lastname', 'last', 'lname', 'surname', 'family name'],
  company: ['company', 'company name', 'organization', 'organisation', 'employer', 'account'],
  jobTitle: ['job title', 'title', 'jobtitle', 'role', 'position'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'phonenumber'],
  industry: ['industry', 'sector', 'vertical'],
  location: ['location', 'city', 'address', 'region', 'state', 'geo'],
};

export function autoDetectColumns(headers: string[]): Record<LeadField, number> {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  const result = {} as Record<LeadField, number>;

  for (const field of Object.keys(HEADER_ALIASES) as LeadField[]) {
    const aliases = HEADER_ALIASES[field];
    // Exact match first, then "contains" fallback.
    let idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx === -1) {
      idx = normalized.findIndex((h) => aliases.some((a) => h.includes(a)));
    }
    result[field] = idx;
  }
  return result;
}
