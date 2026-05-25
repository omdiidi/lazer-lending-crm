import { describe, it, expect } from 'vitest';
import {
  signUnsubToken,
  verifyUnsubToken,
  buildUnsubUrl,
  type UnsubTokenPayload,
} from '@/lib/list-unsub-token';

const SECRET = 'test-secret-do-not-use-in-prod';
const ALT_SECRET = 'a-different-secret';

const payload: UnsubTokenPayload = {
  lead_id: 'lead-123',
  campaign_id: 'camp-456',
  mailbox_id: 'mbx-789',
  email: 'prospect@example.com',
  expiry_unix: 9999999999,
};

describe('list-unsub-token', () => {
  it('signs and verifies a round-trip token', async () => {
    const token = await signUnsubToken(payload, SECRET);
    expect(token).toContain('.');
    const decoded = await verifyUnsubToken(token, SECRET);
    expect(decoded).toEqual(payload);
  });

  it('rejects a token signed with a different secret (rotation safety)', async () => {
    const token = await signUnsubToken(payload, SECRET);
    const decoded = await verifyUnsubToken(token, ALT_SECRET);
    expect(decoded).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signUnsubToken(payload, SECRET);
    const [body, sig] = token.split('.');
    // Flip a character in the payload segment; signature no longer matches.
    const tamperedBody = body.slice(0, -1) + (body.slice(-1) === 'A' ? 'B' : 'A');
    const decoded = await verifyUnsubToken(`${tamperedBody}.${sig}`, SECRET);
    expect(decoded).toBeNull();
  });

  it('returns null for a malformed token (no separator)', async () => {
    expect(await verifyUnsubToken('not-a-token', SECRET)).toBeNull();
  });

  it('builds an unsubscribe URL with a verifiable token and no double slash', async () => {
    const url = await buildUnsubUrl(
      { lead_id: 'l', campaign_id: 'c', mailbox_id: 'm', email: 'x@y.com' },
      'https://crm.example.com/',
      SECRET,
    );
    expect(url.startsWith('https://crm.example.com/api/list-unsubscribe?t=')).toBe(true);
    expect(url).not.toContain('com//api');

    const token = decodeURIComponent(url.split('t=')[1]);
    const decoded = await verifyUnsubToken(token, SECRET);
    expect(decoded?.email).toBe('x@y.com');
    expect(decoded?.expiry_unix).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
