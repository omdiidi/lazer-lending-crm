import { describe, it, expect } from 'vitest';
import { applyMergeFields } from '@/lib/merge-fields';

describe('applyMergeFields', () => {
  it('substitutes single fields', () => {
    expect(applyMergeFields('Hi {{firstName}}', { firstName: 'Ann' })).toBe('Hi Ann');
  });

  it('builds fullName from first + last', () => {
    expect(applyMergeFields('{{fullName}}', { firstName: 'Ann', lastName: 'Lee' })).toBe('Ann Lee');
  });

  it('replaces all occurrences of a field', () => {
    expect(applyMergeFields('{{company}} {{company}}', { company: 'Acme' })).toBe('Acme Acme');
  });

  it('replaces missing fields with empty string', () => {
    expect(applyMergeFields('Hi {{firstName}}!', {})).toBe('Hi !');
  });

  it('leaves unknown tags untouched', () => {
    expect(applyMergeFields('{{unknownTag}}', { firstName: 'Ann' })).toBe('{{unknownTag}}');
  });
});
