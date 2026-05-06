/**
 * Stage-1 keyword pre-classifier for cold-reply classification.
 *
 * Design:
 *   - Scans ALL label regexes (not first-match) to catch dual-signal replies
 *     like "not interested but please remove me" where first-match would silently
 *     miss the unsubscribe — a compliance risk in the regulated lending vertical.
 *   - Single match → return that classification.
 *   - Zero matches OR multi-label → return null (route to LLM stage 2).
 *   - Compile-time regexes (defined as module-level constants) — no runtime re-compile.
 *
 * Used by:
 *   - Edge Function `classify-reply` (imports via relative path)
 *   - Browser-side developer tooling / testing (pure function, no I/O)
 */

export type ClassificationLabel = 'positive' | 'neutral' | 'ooo' | 'unsubscribe' | 'negative';

export interface Classification {
  label: ClassificationLabel;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Compile-time regex constants
// ---------------------------------------------------------------------------

/** Out-of-office / vacation autoresponder patterns. */
const OOO_RE =
  /\b(out of office|vacation|away until|return on|on leave|on holiday|be back|will be back|currently out|temporarily unavailable|auto-?reply|automatic reply)\b/i;

/** Explicit unsubscribe / opt-out intent. Strong signals only. */
const UNSUB_RE =
  /\b(unsubscribe|remove me|stop (calling|emailing|contacting)|opt out|take me off|don't email|do not email|remove my (name|email)|please stop|no more emails?|stop sending)\b/i;

/** Clear negative — not interested, hostile, do-not-contact. */
const NEGATIVE_RE =
  /\b(not interested|leave me alone|do not contact|don't contact|never email|fuck off|go away|lose my (number|email|contact)|stop bothering|this is spam|mark as spam|unsubscribe me)\b/i;

/**
 * Positive affirmatives — stronger signals only.
 * Avoids false positives on bare "schedule" / "wrong person" / "can you send".
 */
const POSITIVE_RE =
  /\b(yes[,!.]? please|i'?m interested|i am interested|tell me more|send me (more|info|details|information)|sign me up|book (a call|time|a meeting)|let'?s connect|i'?d like to (chat|talk|connect|learn more)|sounds good|i'?d be interested|great timing|perfect timing|how does .{1,30} work|can we schedule|set up a call|interested in learning|want to learn more)\b/i;

// ---------------------------------------------------------------------------
// keywordClassify
// ---------------------------------------------------------------------------

/**
 * Scan subject + body against all keyword patterns.
 *
 * Returns a single Classification when exactly one pattern matches.
 * Returns null when:
 *   - No patterns match (ambiguous → route to LLM).
 *   - Multiple patterns match (dual-signal → route to LLM for arbitration).
 *
 * @param reply - Object with `subject` and `body` strings (raw, not redacted).
 */
export function keywordClassify(reply: {
  subject: string;
  body: string;
}): Classification | null {
  // Concatenate subject + newline + body for a single scan pass.
  const text = (reply.subject ?? '') + '\n' + (reply.body ?? '');

  const matches: Classification[] = [];

  if (OOO_RE.test(text)) {
    matches.push({ label: 'ooo', confidence: 0.95 });
  }
  if (UNSUB_RE.test(text)) {
    matches.push({ label: 'unsubscribe', confidence: 0.95 });
  }
  if (NEGATIVE_RE.test(text)) {
    matches.push({ label: 'negative', confidence: 0.85 });
  }
  if (POSITIVE_RE.test(text)) {
    matches.push({ label: 'positive', confidence: 0.85 });
  }

  // Single match: confident, return immediately.
  if (matches.length === 1) return matches[0];

  // 0 or 2+ matches: route to LLM stage 2.
  return null;
}
