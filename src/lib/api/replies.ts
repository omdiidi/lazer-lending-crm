/**
 * Replies API client — wraps Supabase queries for the `replies` table.
 *
 * All field names returned are camelCase (toCamelCase transform applied).
 */

import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase } from '@/lib/transforms';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplyClassification =
  | 'positive'
  | 'neutral'
  | 'ooo'
  | 'unsubscribe'
  | 'negative';

export interface Reply {
  id: string;
  leadId: string;
  campaignId: string;
  mailboxId: string | null;
  inReplyToSendId: string | null;
  smartleadThreadId: string | null;
  subject: string | null;
  bodyText: string | null;
  redactedBodyText: string | null;
  fromEmail: string | null;
  fromName: string | null;
  classification: ReplyClassification | null;
  classifierConfidence: number | null;
  classifierError: string | null;
  language: string | null;
  rationale: string | null;
  rawMessageId: string | null;
  receivedAt: string | null;
  notifiedAt: string | null;
  notifiedTo: string | null;
  fubPushedAt: string | null;
  fubEventId: string | null;
  requiresHumanReview: boolean;
  // Joined from campaigns (when requested)
  campaigns?: { name: string; teamEmail: string | null } | null;
}

export interface GetRepliesOptions {
  /** Filter by campaign ID */
  campaignId?: string;
  /** Filter by classification label */
  classification?: ReplyClassification;
  /** Only return replies requiring human review */
  requiresHumanReview?: boolean;
  /** Sort direction (default: desc by received_at) */
  ascending?: boolean;
  limit?: number;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** List replies with optional filters. Sorted by received_at desc by default. */
export async function getReplies(options: GetRepliesOptions = {}): Promise<Reply[]> {
  let query = supabase
    .from('replies')
    .select('*, campaigns(name, team_email)')
    .order('received_at', { ascending: options.ascending ?? false });

  if (options.campaignId) {
    query = query.eq('campaign_id', options.campaignId);
  }
  if (options.classification) {
    query = query.eq('classification', options.classification);
  }
  if (options.requiresHumanReview !== undefined) {
    query = query.eq('requires_human_review', options.requiresHumanReview);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return transformRows<Reply>(data || []);
}

/** Get a single reply by ID. Returns null if not found. */
export async function getReply(id: string): Promise<Reply | null> {
  const { data, error } = await supabase
    .from('replies')
    .select('*, campaigns(name, team_email)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toCamelCase<Reply>(data);
}

/**
 * Manually reclassify a reply.
 *
 * Updates classification locally and triggers the classify-reply Edge Function
 * to persist rationale/confidence changes. The Edge Function call is fire-and-forget
 * since the local update is authoritative for the UI.
 */
export async function reclassifyReply(
  id: string,
  classification: ReplyClassification,
): Promise<void> {
  // Update directly — operator reclassification overrides classifier
  const { error } = await supabase
    .from('replies')
    .update({
      classification,
      classifier_confidence: 1.0,  // manual override = full confidence
      rationale: 'Manual reclassification by operator',
      requires_human_review: false,
    })
    .eq('id', id);

  if (error) throw error;

  // If reclassifying to positive, trigger FUB push (fire-and-forget via Edge Function)
  if (classification === 'positive') {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fub-push`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reply_id: id }),
        },
      ).catch((err: Error) => {
        console.warn('[replies API] fub-push trigger failed:', err.message);
      });
    }
  }
}

/**
 * Manually trigger FUB push for a reply (operator action).
 *
 * Returns the Edge Function response. Caller should handle 429 (rate limited)
 * and 400 (not positive) errors.
 */
export async function manualPushToFub(replyId: string): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fub-push`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reply_id: replyId }),
    },
  );

  const data = await res.json() as { success: boolean; error?: string; skipped?: boolean };
  if (!res.ok && !data.success) {
    throw new Error(data.error ?? `FUB push failed (HTTP ${res.status})`);
  }
  return data;
}
