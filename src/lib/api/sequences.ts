import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase } from '@/lib/transforms';
import type { EmailSequence, SequenceStep } from '@/types/crm';

export async function getSequences(): Promise<EmailSequence[]> {
  const { data, error } = await supabase
    .from('email_sequences')
    .select('*, sequence_steps(*)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Transform: rename sequence_steps → steps and convert to camelCase
  return (data || []).map(row => {
    const steps = (row.sequence_steps || [])
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (a.order as number) - (b.order as number)
      )
      .map((step: Record<string, unknown>) => toCamelCase<SequenceStep>(step));

    const { sequence_steps: _, ...rest } = row;
    const sequence = toCamelCase<EmailSequence>(rest as Record<string, unknown>);
    return { ...sequence, steps };
  });
}

export async function getSequenceWithSteps(id: string): Promise<EmailSequence | null> {
  const { data, error } = await supabase
    .from('email_sequences')
    .select('*, sequence_steps(*)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  const steps = (data.sequence_steps || [])
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      (a.order as number) - (b.order as number)
    )
    .map((step: Record<string, unknown>) => toCamelCase<SequenceStep>(step));

  const { sequence_steps: _, ...rest } = data;
  const sequence = toCamelCase<EmailSequence>(rest as Record<string, unknown>);
  return { ...sequence, steps };
}
