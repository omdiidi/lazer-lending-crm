import { supabase } from '@/lib/supabase';

export interface AppSettings {
  complianceFooterTemplate: string;
  footerEnabled: boolean;
}

const PLACEHOLDER = '[FOOTER PLACEHOLDER — NOT FOR PRODUCTION]';

export function isFooterPlaceholder(template: string): boolean {
  return template.trim() === '' || template.includes(PLACEHOLDER);
}

export async function getAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('lazer_settings')
    .select('compliance_footer_template, footer_enabled')
    .single();
  if (error) throw error;
  return {
    complianceFooterTemplate: data.compliance_footer_template,
    footerEnabled: data.footer_enabled,
  };
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.complianceFooterTemplate !== undefined)
    row.compliance_footer_template = patch.complianceFooterTemplate;
  if (patch.footerEnabled !== undefined)
    row.footer_enabled = patch.footerEnabled;
  const { error } = await supabase
    .from('lazer_settings')
    .update(row)
    .eq('id', true);
  if (error) throw error;
}
