import { describe, it, expect } from 'vitest';
import { redactPII } from '@/lib/pii-redact';

describe('redactPII', () => {
  it('redacts a US SSN', () => {
    expect(redactPII('my ssn is 123-45-6789 ok')).toBe('my ssn is [REDACTED] ok');
  });

  it('redacts a 16-digit card number in several formats', () => {
    expect(redactPII('4111 1111 1111 1111')).toBe('[REDACTED]');
    expect(redactPII('4111-1111-1111-1111')).toBe('[REDACTED]');
    expect(redactPII('4111111111111111')).toBe('[REDACTED]');
  });

  it('redacts US phone numbers', () => {
    expect(redactPII('call me at (555) 123-4567')).toContain('[REDACTED]');
    expect(redactPII('555-123-4567')).toBe('[REDACTED]');
  });

  it('redacts email addresses', () => {
    expect(redactPII('reach me at john.doe@example.com')).toBe('reach me at [REDACTED]');
  });

  it('leaves clean text untouched', () => {
    const clean = 'Thanks, this sounds interesting. Can we chat next week?';
    expect(redactPII(clean)).toBe(clean);
  });

  it('redacts multiple distinct PII types in one pass', () => {
    const out = redactPII('SSN 123-45-6789 email a@b.com phone 555-123-4567');
    expect(out).not.toContain('123-45-6789');
    expect(out).not.toContain('a@b.com');
    expect(out).not.toContain('555-123-4567');
  });
});
