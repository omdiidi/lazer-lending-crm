// WARMUP TIERS — also duplicated in src/pages/CampaignBuilderPage.tsx (frontend, can't share)
// This file is the canonical source for edge functions.
export function getMaxDailyAllowed(daysSinceFirstEmail: number): number {
  if (daysSinceFirstEmail >= 91) return 200
  if (daysSinceFirstEmail >= 61) return 150
  if (daysSinceFirstEmail >= 31) return 100
  if (daysSinceFirstEmail >= 22) return 75
  if (daysSinceFirstEmail >= 15) return 50
  if (daysSinceFirstEmail >= 8)  return 25
  return 20
}
