import { describe, it, expect } from 'vitest';
import { keywordClassify } from '@/lib/classifier-keywords';

const body = (b: string) => ({ subject: '', body: b });

describe('keywordClassify', () => {
  it('classifies a clear out-of-office reply', () => {
    expect(keywordClassify(body('I am out of office until Monday.'))?.label).toBe('ooo');
  });

  it('classifies an explicit unsubscribe', () => {
    expect(keywordClassify(body('please remove me from your list'))?.label).toBe('unsubscribe');
  });

  it('classifies a clear positive', () => {
    expect(keywordClassify(body("Yes please, I'm interested — tell me more"))?.label).toBe('positive');
  });

  it('classifies a clear negative', () => {
    expect(keywordClassify(body('not interested, do not contact me'))?.label).toBe('negative');
  });

  it('returns null on no keyword match (route to LLM)', () => {
    expect(keywordClassify(body('who is this regarding?'))).toBeNull();
  });

  it('returns null on dual-signal replies (compliance-safe arbitration)', () => {
    // "not interested" (negative) + "remove me" (unsubscribe) → ambiguous → LLM.
    expect(keywordClassify(body('not interested, please remove me'))).toBeNull();
  });

  it('attaches a confidence score to single matches', () => {
    const result = keywordClassify(body('unsubscribe'));
    expect(result?.confidence).toBeGreaterThan(0);
    expect(result?.confidence).toBeLessThanOrEqual(1);
  });
});
