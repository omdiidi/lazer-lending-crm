/**
 * Team-domain constants for UI rendering.
 *
 * Why this lives in src/lib (and not as inline `import.meta.env...` everywhere):
 * Connect CRM was built with `integrateapi.ai` baked in across 4 files. Centralizing
 * here lets us swap deployments by setting one env var, and gives us a single place
 * to revisit the Lazer-specific "campaign sends don't have a single from address" rule.
 *
 * - TEAM_DOMAIN: where {emailPrefix}@... lives for compose/replies (transactional).
 * - CAMPAIGN_SEND_DOMAIN: legacy Connect CRM concept (mail.<TEAM_DOMAIN>) — only
 *   meaningful when campaign.provider === 'resend'. For Lazer's Smartlead campaigns,
 *   the from-address is per-mailbox and chosen by Smartlead; the UI should show
 *   pool-based copy instead of this constant.
 */

export const TEAM_DOMAIN: string =
  (import.meta.env.VITE_TEAM_DOMAIN as string | undefined) ?? 'integrateapi.ai';

export const CAMPAIGN_SEND_DOMAIN: string = `mail.${TEAM_DOMAIN}`;
