/**
 * Best-effort PII redaction before LLM input.
 *
 * Replaces known PII patterns with [REDACTED].
 *
 * IMPORTANT: This is a best-effort safeguard, NOT a perfect PII scrubber.
 * The load-bearing compliance control is the no-train DPA signed with the
 * LLM provider (Anthropic API default, or OpenAI Enterprise — see
 * VENDOR-CONTRACTS.md §6). This function reduces surface area but should
 * never be treated as a substitute for the DPA.
 *
 * Patterns handled:
 *   - US SSN:  ddd-dd-dddd
 *   - Credit/debit card-like 16-digit sequences (4×4 groups)
 *   - ITIN: 9XX-XX-XXXX (first digit 9, consistent with IRS format)
 *   - US phone numbers (several common formats)
 *   - Email addresses
 *
 * Used by Edge Function `classify-reply` before sending body to LLM.
 * Also exported for use in any other context that needs body sanitization.
 */

/** US Social Security Numbers: ddd-dd-dddd */
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * 16-digit card-like sequences.
 * Matches: 1234567890123456 or 1234-5678-9012-3456 or 1234 5678 9012 3456
 */
const CARD_RE = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

/**
 * ITIN: same format as SSN but always starts with 9.
 * Regex covers 9XX-XX-XXXX. This overlaps with SSN_RE intentionally —
 * both are replaced so we don't need separate passes.
 */
const ITIN_RE = /\b9\d{2}-\d{2}-\d{4}\b/g;

/**
 * US phone numbers in common formats:
 *   (ddd) ddd-dddd
 *   ddd-ddd-dddd
 *   ddd.ddd.dddd
 *   ddd ddd dddd
 *   +1 ddd ddd dddd
 *   +1-ddd-ddd-dddd
 */
const PHONE_RE =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;

/**
 * Email addresses (simplified RFC 5321 local-part + domain).
 * Intentionally not capturing Unicode local-parts — handles the common case.
 */
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Redact known PII patterns from a string.
 *
 * Order matters: card numbers are checked before phone numbers to avoid
 * partial overlaps. ITIN and SSN regexes are run separately so both
 * patterns always get replaced regardless of order.
 *
 * @param text - Raw text (email body, subject, etc.)
 * @returns Text with PII replaced by `[REDACTED]`.
 */
export function redactPII(text: string): string {
  return text
    .replace(CARD_RE, '[REDACTED]')   // 16-digit cards first (longer pattern)
    .replace(ITIN_RE, '[REDACTED]')   // ITIN (overlaps SSN format, run before SSN)
    .replace(SSN_RE, '[REDACTED]')    // SSN
    .replace(PHONE_RE, '[REDACTED]')  // Phone numbers
    .replace(EMAIL_RE, '[REDACTED]'); // Email addresses
}
