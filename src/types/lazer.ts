/**
 * Lazer Lending CRM — domain types.
 * These are hand-typed until `database.ts` is regenerated post-migration.
 * All field names are camelCase (toCamelCase transform applied at API layer).
 */

// ---- Domain (burner domain pool) ----

export type DomainStatus =
  | 'provisioning'
  | 'dns_pending'
  | 'verifying'
  | 'ready'
  | 'cooldown'
  | 'retired'
  | 'failed';

export type DmarcPolicy = 'none' | 'quarantine' | 'reject';

export interface Domain {
  id: string;
  hostname: string;
  provider: 'zapmail' | 'maildoso' | 'other';
  status: DomainStatus;
  dkimVerified: boolean;
  spfVerified: boolean;
  dmarcVerified: boolean;
  dmarcPolicy: DmarcPolicy | null;
  dmarcRua: string | null;
  registrar: string | null;
  ownerEntity: string | null;
  registeredAt: string | null;
  retiredAt: string | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Mailbox ----

export type MailboxWarmupState =
  | 'provisioning'
  | 'connection_pending'
  | 'warming'
  | 'live'
  | 'paused'
  | 'failed';

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'app_password_invalid';

export type PausedReason =
  | 'bounce_threshold'
  | 'complaint_threshold'
  | 'single_complaint_review'
  | 'smartlead_rate_limit'
  | 'dns_failure'
  | 'app_password_invalid'
  | 'connection_lost'
  | 'manual';

export interface Mailbox {
  id: string;
  domainId: string;
  address: string;
  smartleadAccountId: string | null;
  connectionStatus: ConnectionStatus;
  warmupState: MailboxWarmupState;
  dailyCap: number;
  todayEnrolledCount: number;
  todaySentCount: number;
  lastResetAt: string | null;
  liveStartedAt: string | null;
  last24hBounceRate: number | null;
  last24hComplaintRate: number | null;
  pausedReason: PausedReason | null;
  lastHealthCheckAt: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  // joined from domains table when needed
  domain?: Pick<Domain, 'hostname' | 'status'>;
}

// Warmup stats from Smartlead Edge Function stub
export interface WarmupStats {
  mailboxId: string;
  warmupEmailsSent: number;
  warmupEmailsReceived: number;
  warmupScore: number | null;
  lastFetchedAt: string;
}

// ---- Sending Pool ----

export interface SendingPool {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PoolMembership {
  id: string;
  poolId: string;
  mailboxId: string;
  createdAt: string;
}

// ---- Create/Update payloads ----

export interface CreateDomainPayload {
  hostname: string;
  provider?: Domain['provider'];
  registrar?: string;
  ownerEntity?: string;
}

export interface UpdateDomainPayload {
  status?: DomainStatus;
  dkimVerified?: boolean;
  spfVerified?: boolean;
  dmarcVerified?: boolean;
  dmarcPolicy?: DmarcPolicy;
  dmarcRua?: string;
  cooldownUntil?: string;
  retiredAt?: string;
}

export interface PauseMailboxPayload {
  reason: PausedReason;
}

export interface CreateSendingPoolPayload {
  name: string;
}

// ---- Reply (cold-outreach reply inbox) ----

export type ReplyClassification =
  | 'positive'
  | 'neutral'
  | 'ooo'
  | 'unsubscribe'
  | 'negative';

/**
 * Reply row as returned from the `replies` table.
 * Hand-typed until database.ts is regenerated post-migration.
 */
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
  // Joined from campaigns when selected
  campaigns?: {
    name: string;
    teamEmail: string | null;
  } | null;
}
