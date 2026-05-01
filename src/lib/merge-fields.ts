export const MERGE_FIELDS = [
  { label: 'First Name', tag: '{{firstName}}' },
  { label: 'Last Name', tag: '{{lastName}}' },
  { label: 'Full Name', tag: '{{fullName}}' },
  { label: 'Job Title', tag: '{{jobTitle}}' },
  { label: 'Company', tag: '{{company}}' },
  { label: 'Industry', tag: '{{industry}}' },
  { label: 'Location', tag: '{{location}}' },
  { label: 'Phone', tag: '{{phone}}' },
  { label: 'Email', tag: '{{email}}' },
  { label: 'Unsubscribe Link', tag: '{{unsubscribeLink}}' },
] as const

export function applyMergeFields(text: string, data: {
  firstName?: string; lastName?: string; jobTitle?: string; company?: string;
  industry?: string; location?: string; phone?: string; email?: string;
}): string {
  return text
    .replace(/\{\{firstName\}\}/g, data.firstName || '')
    .replace(/\{\{lastName\}\}/g, data.lastName || '')
    .replace(/\{\{fullName\}\}/g, [data.firstName, data.lastName].filter(Boolean).join(' '))
    .replace(/\{\{jobTitle\}\}/g, data.jobTitle || '')
    .replace(/\{\{company\}\}/g, data.company || '')
    .replace(/\{\{industry\}\}/g, data.industry || '')
    .replace(/\{\{location\}\}/g, data.location || '')
    .replace(/\{\{phone\}\}/g, data.phone || '')
    .replace(/\{\{email\}\}/g, data.email || '')
}
