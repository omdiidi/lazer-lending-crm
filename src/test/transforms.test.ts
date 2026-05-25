import { describe, it, expect } from 'vitest';
import { toCamelCase, toSnakeCase, transformRows } from '@/lib/transforms';

describe('toCamelCase', () => {
  it('converts simple snake_case keys', () => {
    expect(toCamelCase({ first_name: 'a', last_name: 'b' })).toEqual({
      firstName: 'a',
      lastName: 'b',
    });
  });

  it('handles digit-adjacent underscores (last_24h_bounce_rate → last24hBounceRate)', () => {
    // Regression: the old /_([a-z])/g regex left a stray underscore here.
    expect(toCamelCase({ last_24h_bounce_rate: 0.01 })).toEqual({
      last24hBounceRate: 0.01,
    });
  });

  it('recurses into nested objects and arrays', () => {
    const row = {
      campaign_id: 'c1',
      sending_pool: { pool_name: 'main', max_per_day: 30 },
      step_list: [{ delay_days: 2 }],
    };
    expect(toCamelCase(row)).toEqual({
      campaignId: 'c1',
      sendingPool: { poolName: 'main', maxPerDay: 30 },
      stepList: [{ delayDays: 2 }],
    });
  });
});

describe('toSnakeCase', () => {
  it('converts camelCase back to snake_case', () => {
    expect(toSnakeCase({ firstName: 'a', lastName: 'b' })).toEqual({
      first_name: 'a',
      last_name: 'b',
    });
  });

  it('round-trips a nested structure', () => {
    const camel = { campaignId: 'c1', sendingPool: { poolName: 'main' } };
    expect(toCamelCase(toSnakeCase(camel))).toEqual(camel);
  });
});

describe('transformRows', () => {
  it('maps an array of rows to camelCase', () => {
    expect(transformRows([{ lead_id: '1' }, { lead_id: '2' }])).toEqual([
      { leadId: '1' },
      { leadId: '2' },
    ]);
  });
});
