import { supabase } from '@/lib/supabase';
import type { Lead } from '@/types/crm';

export interface ApolloSearchResult {
  leads: Lead[];
  totalFound: number;
  creditsUsed: number;
  filtersUsed: Record<string, unknown>;
  error?: string;
}

export async function searchApollo(
  prompt: string,
  perPage: number
): Promise<ApolloSearchResult> {
  const { data, error } = await supabase.functions.invoke('apollo-search', {
    body: { prompt, perPage },
  });

  if (error) throw new Error(error.message || 'Search failed');
  if (data?.error) throw new Error(data.error);
  return data as ApolloSearchResult;
}
