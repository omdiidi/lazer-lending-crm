/**
 * ValidateLeadsDialog — run ZeroBounce validation on leads ALREADY in the CRM.
 *
 * Unlike the import flow (which inserts then validates), this validates leads
 * that are already stored — e.g. a big CSV that was imported before ZeroBounce
 * credits were loaded. It synthesises an email-only CSV from the current
 * unverified leads and runs the exact same `validate-upload` path, which is
 * update-only and matches rows by email_normalized. No leads are created or
 * duplicated.
 *
 * Flow:
 *   1. idle       — shows how many leads still need validation
 *   2. validating — submit → poll → finalize (ZeroBounce bulk)
 *   3. done        — valid / suppressed / checked summary
 *   Degrades gracefully if ZeroBounce is unconfigured or out of credits.
 */

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { utf8ToBase64 } from '@/lib/csv';
import {
  submitValidation,
  pollThenFinalize,
  finalizeValidation,
  ValidateUploadError,
  type FinalizeResult,
} from '@/lib/api/validate-upload';
import type { Lead } from '@/types/crm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';

type Phase = 'idle' | 'validating' | 'done';

/** Statuses the campaign builder treats as sendable — anything else needs validation. */
const VERIFIED_STATUSES = new Set(['verified', 'likely_to_engage']);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
}

export default function ValidateLeadsDialog({ open, onOpenChange, leads }: Props) {
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<string | number | undefined>(undefined);
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoverFileId, setRecoverFileId] = useState('');

  // Unverified leads with a non-empty email, deduped by lowercased email.
  const unverifiedEmails = useMemo(() => {
    const seen = new Set<string>();
    const emails: string[] = [];
    for (const l of leads) {
      const email = (l.email ?? '').trim();
      if (!email) continue;
      if (VERIFIED_STATUSES.has(l.emailStatus ?? '')) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(email);
    }
    return emails;
  }, [leads]);

  function reset() {
    setPhase('idle');
    setProgress(undefined);
    setResult(null);
    setError(null);
    setRecoverFileId('');
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function handleValidate() {
    if (unverifiedEmails.length === 0) {
      toast.error('No unverified leads to validate.');
      return;
    }
    setPhase('validating');
    setError(null);
    try {
      // Synthesise an email-only CSV (header + one email per line). Emails never
      // contain commas/newlines, so no quoting is needed. Email column index = 0.
      const csv = `email\n${unverifiedEmails.join('\n')}`;
      const submit = await submitValidation(utf8ToBase64(csv), 0);
      const finalized = await pollThenFinalize(submit.file_id, { onProgress: setProgress });
      setResult(finalized);
      // Refresh leads so newly-verified statuses appear (realtime also covers this).
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    } catch (err) {
      const msg = err instanceof ValidateUploadError
        ? err.message
        : err instanceof Error ? err.message : 'Validation unavailable.';
      setError(msg);
    }
    setPhase('done');
  }

  /**
   * Apply results from a validation ZeroBounce ALREADY ran (identified by file_id)
   * without submitting again — no new credits. Use this to recover a run whose
   * results didn't get stamped (e.g. the email_normalized backfill bug).
   */
  async function handleRecover() {
    const fileId = recoverFileId.trim();
    if (!fileId) {
      toast.error('Enter the ZeroBounce file ID to recover.');
      return;
    }
    setPhase('validating');
    setError(null);
    try {
      const finalized = await finalizeValidation(fileId);
      setResult(finalized);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    } catch (err) {
      const msg = err instanceof ValidateUploadError
        ? err.message
        : err instanceof Error ? err.message : 'Recovery failed.';
      setError(msg);
    }
    setPhase('done');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Validate Lead Emails
          </DialogTitle>
          <DialogDescription>
            Runs ZeroBounce on leads already in the CRM. Valid addresses become
            sendable; undeliverable ones are suppressed. Nothing is duplicated.
          </DialogDescription>
        </DialogHeader>

        {phase === 'idle' && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                {unverifiedEmails.length} unverified
              </Badge>
              <span className="text-muted-foreground">leads will be checked</span>
            </div>
            <p className="text-xs text-muted-foreground">
              This uses ZeroBounce credits — roughly one credit per email. Make sure
              your ZeroBounce account has enough credits before running.
            </p>

            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs font-medium">Recover a previous run (no credits)</Label>
              <p className="text-[11px] text-muted-foreground">
                Already ran validation but the results didn’t apply? Paste the ZeroBounce
                bulk <span className="font-medium">file ID</span> (from your ZeroBounce dashboard →
                Bulk → your file) to apply those results without spending credits again.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="ZeroBounce file ID"
                  value={recoverFileId}
                  onChange={(e) => setRecoverFileId(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button variant="outline" size="sm" onClick={handleRecover} disabled={!recoverFileId.trim()}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}

        {phase === 'validating' && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Validating {unverifiedEmails.length} emails via ZeroBounce
              {progress !== undefined ? ` · ${progress}%` : '…'}
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-4 py-2">
            {result && (
              <>
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Validation complete</span>
                </div>
                <div className="flex gap-2 flex-wrap text-sm">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    {result.valid} valid
                  </Badge>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    {result.suppressed} suppressed
                  </Badge>
                  <Badge variant="outline" className="bg-slate-50 text-slate-600">
                    {result.total} checked
                  </Badge>
                </div>
                {Object.keys(result.by_substatus).length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {Object.entries(result.by_substatus)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </div>
                )}
              </>
            )}
            {error && (
              <p className="text-sm text-amber-600 flex items-start gap-1.5">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Validation didn’t run: {error}</span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'idle' && (
            <>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={handleValidate} disabled={unverifiedEmails.length === 0}>
                Validate {unverifiedEmails.length} leads
              </Button>
            </>
          )}
          {phase === 'validating' && (
            <Button variant="outline" disabled>Validating…</Button>
          )}
          {phase === 'done' && <Button onClick={close}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
