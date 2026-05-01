import { useQuery } from '@tanstack/react-query';
import { getEmailAttachments } from '@/lib/api/email-attachments';

export function useEmailAttachments(emailId: string | undefined) {
  return useQuery({
    queryKey: ['email-attachments', emailId],
    queryFn: () => getEmailAttachments(emailId!),
    enabled: !!emailId,
    staleTime: 5 * 60 * 1000,
  });
}
